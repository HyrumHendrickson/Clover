import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './support/dom.js';

const env = installDom();
const { window, document } = env;
const { createMathField, enclosingBinder } = await import('../js/core/mathfield.js');
const { typeset, autoSymbols } = await import('../js/lib/graph/typeset.js');

after(() => window.close());

function makeField(value = '') {
  const log = [];
  const field = createMathField({ label: 'Expression', value, oninput: (v) => log.push(v) });
  document.body.append(field.el);
  field.input.focus();
  field.focus(true);
  return { field, input: field.input, log };
}

function key(input, name, init = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  input.dispatchEvent(event);
  return event;
}

function typeChar(input, ch) {
  const event = key(input, ch);
  if (event.defaultPrevented) return;
  input.setRangeText(ch, input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
}

const typeText = (input, text) => [...text].forEach((ch) => typeChar(input, ch));

function backspace(input) {
  const event = key(input, 'Backspace');
  if (event.defaultPrevented) return;
  const { selectionStart: start, selectionEnd: end } = input;
  if (start !== end) input.setRangeText('', start, end, 'end');
  else if (start > 0) input.setRangeText('', start - 1, start, 'end');
  input.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
}

const caret = (input) => input.selectionStart;
const place = (input, at) => input.setSelectionRange(at, at);

test('typing sum, prod, or int turns the word into its sign', () => {
  for (const [word, sign] of [
    ['sum', '\u2211'],
    ['prod', '\u220f'],
    ['int', '\u222b'],
  ]) {
    const { input } = makeField();
    typeText(input, word);
    assert.equal(input.value, sign, `${word} becomes ${sign}`);
  }
  const { input } = makeField();
  typeText(input, '2+sum');
  assert.equal(input.value, '2+\u2211', 'it works in the middle of a line');
});

test('names that merely contain those letters are left alone', () => {
  assert.equal(autoSymbols('sin').text, 'sin');
  assert.equal(autoSymbols('x_int').text, 'x_int', 'a subscript stays as typed');
  assert.equal(autoSymbols('summ').text, 'summ');
  assert.equal(autoSymbols('sum', 3).text, '\u2211');
  assert.equal(autoSymbols('print', 5).text, 'print');
  const { input } = makeField();
  typeText(input, 'sin(x)');
  assert.equal(input.value, 'sin(x)');
});

test('the display shows typeset math, and the saved text is still plain', () => {
  const { field, input, log } = makeField();
  typeText(input, 'x^2');
  assert.equal(input.value, 'x^2');
  assert.deepEqual(log.at(-1), 'x^2', 'the stored value is the source text');
  const shown = field.el.querySelector('.mf-display');
  assert.ok(shown.querySelector('.mt-sup'), 'the 2 is raised');
  assert.ok(!shown.textContent.includes('^'), 'the caret mark is not shown');
  assert.equal(input.style.opacity, '', 'the input is hidden by CSS, not removed');
});

test('typing ^ opens an exponent and a fraction bar opens a denominator', () => {
  const { field, input } = makeField();
  typeText(input, 'x^');
  assert.ok(field.el.querySelector('.mt-sup .mt-gap'), 'an empty exponent shows a box');
  assert.ok(field.stops().includes(2), 'the caret can sit in it');
  assert.equal(caret(input), 2);
  typeText(input, '2');
  assert.equal(input.value, 'x^2');
  assert.equal(caret(input), 3);

  const second = makeField();
  typeText(second.input, '1/');
  assert.equal(second.field.el.querySelectorAll('.mt-frac').length, 1);
  assert.ok(second.field.el.querySelector('.mt-den .mt-gap'), 'the denominator waits for input');
  typeText(second.input, '2');
  assert.equal(second.field.el.querySelector('.mt-den').textContent, '2');
});

test('the caret never lands inside syntax that is not drawn', () => {
  const { field, input } = makeField('sqrt(x)');
  assert.deepEqual(field.stops(), [0, 5, 6, 7], 'no stops inside "sqrt("');
  place(input, 5);
  key(input, 'ArrowLeft');
  assert.equal(caret(input), 0, 'left from the radicand goes straight out of the root');
  key(input, 'ArrowRight');
  assert.equal(caret(input), 5, 'and right goes straight in');
  key(input, 'ArrowRight');
  assert.equal(caret(input), 6);

  const power = makeField('x_12+1');
  assert.ok(power.field.stops().includes(2) && power.field.stops().includes(3), 'subscript digits can be edited');
});

test('shift with the arrow keys extends a selection across drawn pieces', () => {
  const { input, field } = makeField('sqrt(x)+1');
  place(input, 0);
  key(input, 'ArrowRight', { shiftKey: true });
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 5]);
  key(input, 'ArrowRight', { shiftKey: true });
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 6]);
  input.dispatchEvent(new window.Event('select', { bubbles: true }));
  assert.ok(field.el.querySelectorAll('.mf-sel').length >= 1, 'the selected pieces are highlighted');
  key(input, 'ArrowLeft');
  assert.equal(caret(input), 0, 'left collapses to the start of the selection');
});

test('brackets close themselves, and typing the closer steps over it', () => {
  const { input } = makeField();
  typeChar(input, '(');
  assert.equal(input.value, '()');
  assert.equal(caret(input), 1);
  typeChar(input, 'x');
  typeChar(input, ')');
  assert.equal(input.value, '(x)');
  assert.equal(caret(input), 3, 'the typed bracket moved over the existing one');

  const empty = makeField();
  typeChar(empty.input, '(');
  backspace(empty.input);
  assert.equal(empty.input.value, '', 'deleting the opener of an empty pair removes both');

  const before = makeField('x');
  place(before.input, 0);
  typeChar(before.input, '(');
  assert.equal(before.input.value, '(x', 'no closer is added in front of a letter');
});

test('Backspace removes a hidden root opener whole and keeps what was inside', () => {
  const { input } = makeField('sqrt(x)');
  place(input, 5);
  backspace(input);
  assert.equal(input.value, 'x');
  assert.equal(caret(input), 0);

  const bare = makeField('2sqrt(3)');
  place(bare.input, 6);
  backspace(bare.input);
  assert.equal(bare.input.value, '23');
});

test('Tab moves through the arguments of a sum, then out of it', () => {
  const text = '\u2211(k,1,10,k^2)';
  const { input } = makeField(text);
  place(input, 2);
  const tab = () => key(input, 'Tab');
  assert.equal(tab().defaultPrevented, true);
  assert.equal(caret(input), 4);
  tab();
  assert.equal(caret(input), 6);
  tab();
  assert.equal(caret(input), 9);
  tab();
  assert.equal(caret(input), 13, 'the last Tab leaves the brackets');
  assert.equal(tab().defaultPrevented, false, 'outside a sum, Tab behaves normally');
  place(input, 9);
  key(input, 'Tab', { shiftKey: true });
  assert.equal(caret(input), 8, 'Shift+Tab goes back an argument');

  assert.equal(enclosingBinder('x+(1,2)', 4), null, 'ordinary brackets are not arguments');
  assert.deepEqual(enclosingBinder('sum(k,1', 5).commas, [5], 'the ASCII spelling works too');
});

test('a sum shows its limits as soon as the sign appears', () => {
  const { field, input } = makeField();
  typeText(input, 'sum');
  const big = field.el.querySelector('.mt-big');
  assert.ok(big, 'the sign is drawn as a big operator');
  assert.ok(big.querySelectorAll('.mt-gap').length >= 2, 'with empty boxes for the limits');
  typeText(input, '(k,1,10,k^2)');
  assert.equal(input.value, '\u2211(k,1,10,k^2)');
  assert.equal(field.el.querySelectorAll('.mt-bigstack').length, 1);
  assert.equal(field.el.querySelectorAll('.mt-gap').length, 0, 'no empty boxes remain once every slot is filled');
});

test('the caret mark is drawn for every position and never adds text', () => {
  for (const text of ['x^2', 'x_1+1', '(x+1)/(x-1)', 'sqrt(x)', '|x|', 'sin(x)', '\u222b(x,0,1,x^2)', '1/', 'x^']) {
    const el = typeset(text, { anchors: true });
    assert.equal(el.textContent, typeset(text).textContent, `marks add no text: ${text}`);
    const marks = [...el.querySelectorAll('[data-o]')].map((m) => Number(m.dataset.o));
    assert.ok(marks.includes(0) && marks.includes(text.length), `both ends are positions: ${text}`);
    assert.ok(
      marks.every((o) => o >= 0 && o <= text.length),
      `positions are inside the text: ${text}`,
    );
  }
});

test('an empty field shows its placeholder and still accepts the first key', () => {
  const log = [];
  const field = createMathField({ label: 'Expression', placeholder: 'Type here', oninput: (v) => log.push(v) });
  document.body.append(field.el);
  assert.equal(field.el.querySelector('.mf-placeholder').textContent, 'Type here');
  field.input.focus();
  typeText(field.input, 'y');
  assert.equal(field.el.querySelector('.mf-placeholder'), null);
  assert.equal(log.at(-1), 'y');
});
