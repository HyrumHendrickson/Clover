import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './support/dom.js';

const env = installDom();
const { window, document } = env;
const { createMathField, enclosingBinder, binderSlots } = await import('../js/core/mathfield.js');
const { typeset, typesetField, autoSymbols } = await import('../js/lib/graph/typeset.js');

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

test('typing sum, prod, or int turns the word into its sign with every slot ready', () => {
  for (const [word, sign, at] of [
    ['sum', '\u2211', 2],
    ['prod', '\u220f', 2],
    ['int', '\u222b', 3],
  ]) {
    const { input } = makeField();
    typeText(input, word);
    assert.equal(input.value, `${sign}(,,,)`, `${word} becomes ${sign} with four empty slots`);
    assert.equal(caret(input), at, `${word} starts in its first slot`);
  }
  const { input } = makeField();
  typeText(input, '2+sum');
  assert.equal(input.value, '2+\u2211(,,,)', 'it works in the middle of a line');
  assert.equal(autoSymbols('sum', 3).text, '\u2211', 'the plain helper still only swaps the sign');
  assert.equal(autoSymbols('sum(', 3, { templates: true }).text, '\u2211(', 'an existing bracket is left alone');
});

test('typing a sum the old way, with brackets and commas, still works', () => {
  for (const [word, sign, body] of [
    ['sum', '\u2211', '(k,1,10,k^2)'],
    ['prod', '\u220f', '(k,1,5,k)'],
    ['int', '\u222b', '(t,0,x,sin(t))'],
  ]) {
    const { input } = makeField();
    typeText(input, `${word}${body}`);
    assert.equal(input.value, `${sign}${body}`, `${word}${body}`);
  }
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
  assert.ok(big.querySelectorAll('.mt-gap').length >= 4, 'with an empty box for every slot');
  typeText(input, 'k');
  key(input, 'Tab');
  typeText(input, '1');
  key(input, 'Tab');
  typeText(input, '10');
  key(input, 'Tab');
  typeText(input, 'k^2');
  assert.equal(input.value, '\u2211(k,1,10,k^2)');
  assert.equal(field.el.querySelectorAll('.mt-bigstack').length, 1);
  assert.equal(field.el.querySelectorAll('.mt-gap').length, 0, 'no empty boxes remain once every slot is filled');
});

/** Press ArrowRight (or ArrowLeft) repeatedly and list the offsets the caret lands on. */
function walk(input, presses, name = 'ArrowRight') {
  const seen = [caret(input)];
  for (let i = 0; i < presses; i += 1) {
    key(input, name);
    seen.push(caret(input));
  }
  return seen;
}

test('arrow keys visit every slot of a sum in reading order, then leave it', () => {
  const { input } = makeField('\u2211(,,,)');
  place(input, 0);
  // variable, start, end, body, then past the operator
  assert.deepEqual(walk(input, 5), [0, 2, 3, 4, 5, 6]);
  assert.deepEqual(walk(input, 5, 'ArrowLeft'), [6, 5, 4, 3, 2, 0]);
});

test('arrow keys visit every slot of an integral: lower, upper, body, then dx', () => {
  const { input } = makeField('\u222b(,,,)');
  place(input, 0);
  assert.deepEqual(walk(input, 5), [0, 3, 4, 5, 2, 6]);
  assert.deepEqual(walk(input, 5, 'ArrowLeft'), [6, 2, 5, 4, 3, 0]);
});

test('arrow keys also cross the slots of a filled product and visit its inner structure', () => {
  const { input } = makeField('\u220f(k,1,5,k^2)');
  place(input, 0);
  const seen = walk(input, 40);
  const stops = [...new Set(seen)];
  for (const slotStart of [2, 4, 6, 8]) assert.ok(stops.includes(slotStart), `reaches offset ${slotStart}`);
  assert.equal(seen.at(-1), 12, 'ends past the closing bracket');
});

test('plain text still moves one place at a time', () => {
  const { input } = makeField('x^2+1');
  place(input, 0);
  assert.deepEqual(walk(input, 6), [0, 1, 2, 3, 4, 5, 5], 'and stops at the end');
});

test("Up and Down move between the limits of a sum and between a fraction's parts", () => {
  const { input } = makeField('\u2211(k,1,10,k)');
  place(input, 5);
  assert.equal(key(input, 'ArrowUp').defaultPrevented, true);
  assert.ok(caret(input) >= 6 && caret(input) <= 8, 'from the start value up into the end value');
  assert.equal(key(input, 'ArrowDown').defaultPrevented, true);
  assert.ok(caret(input) >= 2 && caret(input) <= 3, 'and back down into the index variable');
  place(input, 9);
  assert.equal(
    key(input, 'ArrowUp').defaultPrevented,
    false,
    'the body has nothing above it, so rows can take the key',
  );

  const frac = makeField('1/2');
  place(frac.input, 3);
  key(frac.input, 'ArrowUp');
  assert.equal(caret(frac.input), 1, 'denominator to numerator');
  key(frac.input, 'ArrowDown');
  assert.ok(caret(frac.input) >= 2, 'numerator to denominator');
});

test('a comma or Tab in a complete sum moves to the next slot, and an integral ends on dx', () => {
  const { input } = makeField('\u2211(,,,)');
  place(input, 2);
  typeText(input, 'k');
  typeText(input, ',');
  assert.equal(input.value, '\u2211(k,,,)', 'no extra comma is added');
  assert.equal(caret(input), 4, 'the caret moved to the start value');

  const int = makeField('\u222b(,,,)');
  place(int.input, 3);
  assert.deepEqual(
    [1, 2, 3, 4].map(() => {
      key(int.input, 'Tab');
      return caret(int.input);
    }),
    [4, 5, 2, 6],
    'lower, upper, body, dx, then out',
  );
  const info = binderSlots('\u222b(,,,)', 3);
  assert.deepEqual(info.visit, [1, 2, 3, 0]);
  assert.equal(info.kind, 'int');
});

test('the typeset tree reports reading order and stacked slots', () => {
  const sum = typesetField('\u2211(k,1,10,k^2)');
  assert.ok(sum.order.indexOf(4) < sum.order.indexOf(6), 'start before end');
  assert.ok(sum.order.indexOf(6) < sum.order.indexOf(9), 'end before body');
  assert.equal(sum.vertical.length, 1);
  assert.equal(sum.vertical[0].length, 2, 'end value above start value');
  const int = typesetField('\u222b(,,,)');
  assert.deepEqual(int.order, [0, 3, 4, 5, 2, 6]);
  assert.equal(typesetField('1/2').vertical.length, 1);
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
