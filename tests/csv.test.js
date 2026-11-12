import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, hasHeaderRow, parseCsv, toCsv } from '../js/lib/csv.js';

const isNumber = (c) => c !== '' && Number.isFinite(Number(c));

test('delimiters are detected from the first line', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('"a,b";c\n1;2'), ';', 'a comma inside quotes does not count');
  assert.equal(detectDelimiter(''), ',');
  assert.equal(detectDelimiter(undefined), ',');
});

test('rows parse with quotes, doubled quotes, line breaks, CRLF, and a BOM', () => {
  assert.deepEqual(parseCsv('\uFEFFname,score\r\n"Smith, J",9\r\n"say ""hi""",8\r\n'), [
    ['name', 'score'],
    ['Smith, J', '9'],
    ['say "hi"', '8'],
  ]);
  assert.deepEqual(parseCsv('a,b\n"x\ny",2'), [
    ['a', 'b'],
    ['x\ny', '2'],
  ]);
});

test('blank rows are dropped and short rows are padded', () => {
  assert.deepEqual(parseCsv('1,2,3\n\n4\n   \n5,6'), [
    ['1', '2', '3'],
    ['4', '', ''],
    ['5', '6', ''],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv(null), []);
});

test('a final row without a newline is kept, and an explicit delimiter wins', () => {
  assert.deepEqual(parseCsv('1;2\n3;4'), [
    ['1', '2'],
    ['3', '4'],
  ]);
  assert.deepEqual(parseCsv('1,5;2', { delimiter: ';' }), [['1,5', '2']]);
});

test('a header row is recognised only when it is all text with data beneath', () => {
  assert.equal(hasHeaderRow(parseCsv('x,y\n1,2'), isNumber), true);
  assert.equal(hasHeaderRow(parseCsv('1,2\n3,4'), isNumber), false);
  assert.equal(hasHeaderRow(parseCsv('x,2\n3,4'), isNumber), false);
  assert.equal(hasHeaderRow(parseCsv('x,y'), isNumber), false, 'a single row is data');
  assert.equal(hasHeaderRow([], isNumber), false);
});

test('columns write back out as CSV that parses to the same cells', () => {
  const cols = [
    { name: 'Name, full', cells: ['a "b"', 'c', '', ''] },
    { name: 'n', cells: ['1', '2', '', ''] },
  ];
  const text = toCsv(cols);
  assert.equal(text, '"Name, full",n\n"a ""b""",1\nc,2\n');
  assert.deepEqual(parseCsv(text), [
    ['Name, full', 'n'],
    ['a "b"', '1'],
    ['c', '2'],
  ]);
  assert.equal(toCsv([{ name: 'x', cells: [] }]), 'x\n');
});
