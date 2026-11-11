import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './support/dom.js';
import { parseBlocks } from '../js/lib/markdown.js';

const env = installDom();
const { typeset, layout, autoSymbols } = await import('../js/lib/graph/typeset.js');
const { renderMarkdown } = await import('../js/lib/markdown.js');

const kinds = (nodes) => nodes.map((n) => n.k);

test('powers become superscripts attached to their base', () => {
  const [node] = layout('x^2');
  assert.equal(node.k, 'sup');
  assert.equal(node.base.s, 'x');
  assert.equal(node.exp[0].s, '2');
  const html = typeset('x^2');
  assert.ok(html.querySelector('.mt-sup'), 'the exponent is raised');
  assert.equal(html.querySelector('.mt-sup').textContent, '2');
});

test('exponents take a sign, a bracketed group, or a chain', () => {
  assert.equal(layout('e^-x')[0].exp.length, 2);
  assert.equal(layout('x^(n+1)')[0].exp.length, 3, 'brackets around an exponent are dropped');
  assert.equal(layout('x^2+1').length, 3, 'only the first atom is raised');
  assert.equal(layout('sin^2(x)')[0].base.s, 'sin');
});

test('division stacks into a fraction and drops redundant brackets', () => {
  const [frac] = layout('(x+1)/(x-1)');
  assert.equal(frac.k, 'frac');
  assert.equal(frac.num.length, 3);
  assert.equal(frac.den.length, 3);
  assert.equal(typeset('1/2').querySelectorAll('.mt-frac').length, 1);
});

test('d/dx is shown as a derivative fraction', () => {
  const [frac] = layout('d/dx x^3');
  assert.equal(frac.k, 'frac');
  assert.equal(frac.num[0].s, 'd');
  assert.equal(frac.den.map((n) => n.s).join(''), 'dx');
});

test('Greek names and constants render as letters', () => {
  assert.equal(typeset('r = 1 + cos(theta)').textContent.includes('\u03b8'), true);
  assert.equal(typeset('2pi').textContent, '2\u03c0');
  assert.equal(typeset('alpha_1').textContent, '\u03b11');
});

test('roots, absolute value, and bars render their structure', () => {
  assert.equal(typeset('sqrt(x^2+1)').querySelectorAll('.mt-radicand').length, 1);
  assert.equal(typeset('nthroot(3, x)').querySelectorAll('.mt-index').length, 1);
  assert.equal(typeset('|x| - 1').querySelectorAll('.mt-bar').length, 2);
  assert.equal(typeset('abs(x)').querySelectorAll('.mt-bar').length, 2);
});

test('sum, prod, and int become big operators with limits', () => {
  const sum = layout('sum(k, 1, 10, k^2)')[0];
  assert.equal(sum.k, 'big');
  assert.equal(sum.sym, '\u2211');
  assert.equal(sum.upper[0].s, '10');
  const html = typeset('int(t, 0, x, sin(t))');
  assert.equal(html.querySelector('.mt-sym').textContent, '\u222b');
  assert.match(html.textContent, /dt$/, 'the integral ends with the differential');
  assert.equal(layout('prod(k, 1, 5, k)')[0].sym, '\u220f');
  assert.deepEqual(kinds(layout('sum(1, 2)')), ['func', 'fence'], 'not enough arguments falls back to a call');
});

test('incomplete input still renders as far as it goes', () => {
  for (const text of ['x^(', 'sqrt(', '(1 + ', '|x', 'sum(k, 1', 'x^', '1/', '[1, 2', '{x > 0: ', ')))', '', '@#$']) {
    assert.doesNotThrow(() => typeset(text), JSON.stringify(text));
  }
  assert.equal(typeset('').textContent, '');
});

test('typesetting is bounded for hostile input', () => {
  const deep = `${'('.repeat(400)}x${')'.repeat(400)}`;
  assert.doesNotThrow(() => typeset(deep));
  assert.doesNotThrow(() => typeset('x^'.repeat(300)));
  assert.doesNotThrow(() => typeset('a/'.repeat(300)));
});

test('text is inserted as text, never as markup', () => {
  const html = typeset('<img src=x onerror=alert(1)>');
  assert.equal(html.querySelector('img'), null);
});

test('typing a Greek name replaces it only when the whole word is finished', () => {
  assert.deepEqual(autoSymbols('2 + theta'), { text: '2 + \u03b8', caret: 5 });
  assert.equal(autoSymbols('pi').text, '\u03c0');
  assert.equal(autoSymbols('beta').text, '\u03b2', 'beta is one word, not b and eta');
  assert.equal(autoSymbols('the').text, 'the');
  assert.equal(autoSymbols('x_theta').text, 'x_theta', 'subscripts are left alone');
  assert.equal(autoSymbols('sin(theta) + 1', 9).text, 'sin(\u03b8) + 1');
});

test('big operators typed as signs render with their limits and parse as before', () => {
  const sum = layout('\u2211(k,1,10,k^2)')[0];
  assert.equal(sum.k, 'big');
  assert.equal(sum.upper[0].s, '10');
  assert.equal(layout('\u222b(x,0,1,x^2)')[0].differential.s, 'x');
  assert.equal(layout('\u220f')[0].k, 'big', 'a bare sign is still an operator, with empty limits');
  assert.equal(typeset('\u2211(k,1').querySelectorAll('.mt-bigstack').length, 1, 'half typed still shows the sign');
  assert.deepEqual(kinds(layout('sum(L)')), ['func', 'fence'], 'the ASCII list sum is unchanged');
});

test('every node knows where it came from in the text', () => {
  const [sup] = layout('x^2');
  assert.deepEqual([sup.p, sup.e], [0, 3]);
  const [frac] = layout('(a+b)/c');
  assert.deepEqual([frac.p, frac.e], [0, 7]);
  assert.deepEqual([frac.nr.from, frac.nr.to], [1, 4], 'dropped brackets are not part of the numerator');
});

test('Markdown renders a safe subset', () => {
  assert.deepEqual(
    parseBlocks('# Title\n\nSome *text*\nacross lines\n\n- a\n- b\n1. one').map((b) => b.kind),
    ['h1', 'p', 'list', 'list'],
  );
  const html = renderMarkdown('## Hi\nA **bold**, *slanted*, `code`, and $x^2$ line.\n\n- one\n- two');
  assert.equal(html.querySelector('h2').textContent, 'Hi');
  assert.equal(html.querySelector('strong').textContent, 'bold');
  assert.equal(html.querySelector('em').textContent, 'slanted');
  assert.equal(html.querySelector('code').textContent, 'code');
  assert.equal(html.querySelector('.mt-sup').textContent, '2');
  assert.equal(html.querySelectorAll('li').length, 2);
  const hostile = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) ![i](x)');
  assert.equal(hostile.querySelector('script'), null);
  assert.equal(hostile.querySelector('a'), null);
  assert.equal(hostile.querySelector('img'), null);
});

test.after?.(() => env.window.close());
