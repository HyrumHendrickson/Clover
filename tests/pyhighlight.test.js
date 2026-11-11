import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizePython } from '../js/lib/pyhighlight.js';

const types = (code) =>
  tokenizePython(code)
    .filter((t) => t.type !== 'plain')
    .map((t) => [t.type, t.text]);

test('keywords, builtins, functions, numbers', () => {
  assert.deepEqual(types('def go(n):\n    return range(n) + 3.5'), [
    ['keyword', 'def'],
    ['function', 'go'],
    ['keyword', 'return'],
    ['builtin', 'range'],
    ['number', '3.5'],
  ]);
});

test('comments and strings hide keywords inside them', () => {
  assert.deepEqual(types('x = "for in" # if while'), [
    ['string', '"for in"'],
    ['comment', '# if while'],
  ]);
  assert.deepEqual(types("s = 'it\\'s' + f\"{x}\""), [
    ['string', "'it\\'s'"],
    ['string', 'f"{x}"'],
  ]);
});

test('triple-quoted strings span lines and unterminated strings do not hang', () => {
  assert.deepEqual(types('"""a\nb""" x'), [['string', '"""a\nb"""']]);
  assert.deepEqual(types('"never closed'), [['string', '"never closed']]);
  assert.deepEqual(types("'''open"), [['string', "'''open"]]);
});

test('tokens reassemble to the original text', () => {
  const code = 'import turtle\nfor i in range(10):\n\tt.forward(i * 2.5)  # go\nprint("done")\n';
  assert.equal(
    tokenizePython(code)
      .map((t) => t.text)
      .join(''),
    code,
  );
});

test('identifiers containing keywords are not split', () => {
  assert.deepEqual(types('format = island'), []);
});

test('handles large input quickly', () => {
  const code = 'x = "a" + 1  # c\n'.repeat(5000);
  const start = Date.now();
  assert.equal(
    tokenizePython(code)
      .map((t) => t.text)
      .join(''),
    code,
  );
  assert.ok(Date.now() - start < 2000);
});
