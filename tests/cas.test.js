import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CasError, Session, numeric, parseCas, print, simp } from '../js/lib/cas.js';

const run = (source, session = new Session()) =>
  session
    .run(source)
    .filter((r) => !r.hidden)
    .map((r) => r.text)
    .join(' | ');
const value = (text, vars = {}) => {
  const s = new Session();
  const map = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}$`)
    .join('');
  return Number(s.run(`${map}ev(${text}, numer)`)[0].text);
};

test('expand and exact arithmetic', () => {
  assert.equal(run('expand((x+1)^3)'), 'x^3+3*x^2+3*x+1');
  assert.equal(run('expand((x+y)^2-(x-y)^2)'), '4*x*y');
  assert.equal(run('1/3+1/6'), '1/2');
  assert.equal(run('sqrt(8)'), '2*sqrt(2)');
  assert.equal(run('sqrt(2)^2'), '2');
  assert.equal(run('x/y*y'), 'x');
  assert.equal(run('0.5+1/4'), '0.75');
});

test('differentiation', () => {
  assert.equal(run('diff(x^3*sin(x), x)'), 'x^3*cos(x)+3*x^2*sin(x)');
  assert.equal(run('diff(exp(2*x), x)'), '2*%e^(2*x)');
  assert.equal(run('diff(x^4, x, 2)'), '12*x^2');
  assert.equal(run('diff(log(x^2+1), x)'), '2*x/(x^2+1)');
  assert.equal(run('diff(5, x)'), '0');
});

test('integration, including definite integrals and the cases it cannot do', () => {
  assert.equal(run('integrate(x^2, x)'), 'x^3/3');
  assert.equal(run('integrate(3*x^2+2*x+1, x)'), 'x^3+x^2+x');
  assert.equal(run('integrate(1/x, x)'), 'log(x)');
  assert.equal(run('integrate(x^2, x, 0, 3)'), '9');
  assert.equal(run('integrate(x*exp(x), x)'), 'x*%e^x-%e^x');
  assert.equal(run('integrate(sin(x)*cos(x), x)'), 'sin(x)^2/2');
  assert.equal(run('integrate(sin(x^2), x)'), 'integrate(sin(x^2), x)', 'an unknown integral is returned unevaluated');
});

test('the derivative of an antiderivative returns the integrand', () => {
  const samples = [
    'x^5',
    '3*x^2-7',
    'x*exp(2*x)',
    'x^2*sin(3*x)',
    'x*cos(x)',
    'exp(-x)',
    '1/(3*x+2)',
    'sin(2*x+1)',
    '(2*x+1)^4',
    'x^3*exp(x)',
  ];
  for (const sample of samples) {
    const s = new Session();
    s.run(`F: integrate(${sample}, x)$`);
    for (const x of [0.7, 1.3, 2.1]) {
      const derivative = Number(s.run(`ev(diff(F, x), x=${x}, numer)`)[0].text);
      const direct = Number(s.run(`ev(${sample}, x=${x}, numer)`)[0].text);
      assert.ok(
        Math.abs(derivative - direct) < 1e-9 * (1 + Math.abs(direct)),
        `${sample} at ${x}: ${derivative} vs ${direct}`,
      );
    }
  }
});

test('solving polynomial equations', () => {
  assert.equal(run('solve(2*x+3=7, x)'), '[x = 2]');
  assert.equal(run('solve(x^2-5*x+6=0, x)'), '[x = 2, x = 3]');
  assert.match(run('solve(a*x^2+b*x+c=0, x)'), /sqrt\(-4\*a\*c\+b\^2\)/);
  assert.throws(() => run('solve(sin(x)=0, x)'), /not a polynomial/);
});

test('substitution, evaluation, factoring, and decimals', () => {
  assert.equal(run('subst(2, x, x^2+1)'), '5');
  assert.equal(run('ev(x^2+y, x=3, y=1)'), '10');
  assert.equal(run('factor(360)'), '2^3*3^2*5');
  assert.equal(run('factor(97)'), '97');
  assert.equal(run('float(%pi)'), '3.14159265358979');
  assert.ok(Math.abs(value('%e^2') - Math.exp(2)) < 1e-12);
});

test('variables, functions, and earlier results', () => {
  const s = new Session();
  assert.equal(run('f(x) := x^2+1', s), 'f(x) := x^2+1');
  assert.equal(run('f(3)', s), '10');
  assert.equal(run('f(a+1)', s), '(a+1)^2+1');
  assert.equal(run('a: 5$ a^2', s), '25', 'a $ hides a result');
  assert.deepEqual(
    s.run('b: 2; b*3').map((r) => [r.text, r.hidden]),
    [
      ['2', false],
      ['6', false],
    ],
  );
  assert.equal(run('%', s), '6');
  assert.equal(run('%o2', s), '10', 'results are numbered from 1 in the order they were produced');
});

test('errors say what to do, and hostile input is bounded', () => {
  for (const [input, pattern] of [
    ['foo(x)', /does not know foo/],
    ['x +', /ends too soon/],
    ['diff(x^2)', /takes 2 to 3 arguments/],
    ['expand((a+b+c+d)^30)', /too large/],
    ['1/0', /Division by zero/],
    ['x $$ )', /Unexpected/],
    ['diff(x, 3)', /needs a variable name/],
  ]) {
    assert.throws(
      () => run(input),
      (error) => error instanceof CasError && pattern.test(error.message),
      input,
    );
  }
  assert.throws(() => run('('.repeat(500) + '1' + ')'.repeat(500)), CasError);
  assert.throws(() => run('x'.repeat(5000)), CasError);
  assert.ok(Math.abs(Number(run('2^(1/2)*2^(1/2)')) - 2) < 1e-12);
});

test('printing keeps necessary brackets and parses back to the same value', () => {
  for (const source of ['(x+1)^2', '-(x+1)', 'x^(-2)', '2^x', 'x^(1/3)', '(a+b)/(c*d)', '-3*x^2+x-1']) {
    const once = print(simp(parseCas(source)[0].expr));
    const twice = print(simp(parseCas(once)[0].expr));
    assert.equal(twice, once, source);
  }
  assert.ok(numeric(parseCas('%pi')[0].expr).k === 'f');
});
