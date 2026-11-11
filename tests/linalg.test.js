import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateLines, formatScalar, isMatrix, q } from '../js/lib/linalg.js';

const rows = (m) => m.a.map((r) => r.map(formatScalar));
const sheet = (lines) => evaluateLines(lines.map((l, i) => ({ id: `l${i}`, ...l })));
const A = {
  kind: 'matrix',
  name: 'A',
  cells: [
    ['1', '2'],
    ['3', '4'],
  ],
};
const B = {
  kind: 'matrix',
  name: 'B',
  cells: [
    ['0', '1/2'],
    ['sqrt(4)', '-1'],
  ],
};
const expr = (text) => ({ kind: 'expr', text });

test('matrices on one line combine on the next', () => {
  const out = sheet([A, B, expr('A+B'), expr('A*B'), expr('AB'), expr('2A - B^T')]);
  assert.deepEqual(rows(out[2].value), [
    ['1', '5/2'],
    ['5', '3'],
  ]);
  assert.deepEqual(rows(out[3].value), [
    ['4', '-3/2'],
    ['8', '-5/2'],
  ]);
  assert.deepEqual(rows(out[4].value), rows(out[3].value), 'AB is A times B');
  assert.deepEqual(rows(out[5].value), [
    ['2', '2'],
    ['11/2', '9'],
  ]);
});

test('arithmetic is exact', () => {
  assert.equal(formatScalar(evaluate('1/3+1/6')), '1/2');
  assert.equal(formatScalar(evaluate('0.1+0.2')), '3/10');
  const out = sheet([A, expr('det(A)'), expr('A^-1'), expr('A^3'), expr('A^T*A')]);
  assert.equal(formatScalar(out[1].value), '-2');
  assert.deepEqual(rows(out[2].value), [
    ['-2', '1'],
    ['3/2', '-1/2'],
  ]);
  assert.deepEqual(rows(out[3].value), [
    ['37', '54'],
    ['81', '118'],
  ]);
  assert.deepEqual(rows(out[4].value), [
    ['10', '14'],
    ['14', '20'],
  ]);
});

test('names carry across lines and can be reassigned', () => {
  const out = sheet([A, expr('C = 2A'), expr('C = C + A'), expr('C')]);
  assert.deepEqual(rows(out[3].value), [
    ['3', '6'],
    ['9', '12'],
  ]);
  assert.equal(out[1].name, 'C');
});

test('vectors, solving, rank, and reduction', () => {
  const out = sheet([
    A,
    expr('A*[1,2]'),
    expr('solve(A,[5,6])'),
    expr('rank([[1,2],[2,4]])'),
    expr('rref([[1,2,3],[4,5,6]])'),
    expr('dot([1,2,3],[4,5,6])'),
    expr('cross([1,0,0],[0,1,0])'),
    expr('norm([3,4])'),
  ]);
  assert.deepEqual(rows(out[1].value), [['5'], ['11']]);
  assert.deepEqual(rows(out[2].value), [['-4'], ['9/2']]);
  assert.equal(formatScalar(out[3].value), '1');
  assert.deepEqual(rows(out[4].value), [
    ['1', '0', '-1'],
    ['0', '1', '2'],
  ]);
  assert.equal(formatScalar(out[5].value), '32');
  assert.deepEqual(rows(out[6].value), [['0'], ['0'], ['1']]);
  assert.equal(formatScalar(out[7].value), '5');
});

test('mistakes get specific, fixable messages', () => {
  const out = sheet([
    A,
    expr('A+[1,2,3]'),
    expr('A*[1,2,3]'),
    expr('inv([[1,2],[2,4]])'),
    expr('A*Z'),
    expr('det([1,2,3])'),
    expr('A/A'),
    expr('1/0'),
    expr('2+'),
  ]);
  assert.match(out[1].error, /Cannot add a 2\u00d72 matrix and a 3\u00d71 matrix/);
  assert.match(out[2].error, /Cannot multiply a 2\u00d72 matrix by a 3\u00d71/);
  assert.match(out[3].error, /singular/);
  assert.match(out[4].error, /"Z" is not defined/);
  assert.match(out[5].error, /square/);
  assert.match(out[6].error, /Cannot divide by a matrix/);
  assert.match(out[7].error, /Division by zero/);
  assert.ok(out[8].error);
  assert.equal(out[8].value, null);
});

test('a bad entry is reported on its cell and blocks lines that need the matrix', () => {
  const out = sheet([
    {
      kind: 'matrix',
      name: 'M',
      cells: [
        ['1', 'oops'],
        ['3', '4'],
      ],
    },
    expr('M*2'),
  ]);
  assert.equal(out[0].cellErrors.size, 1);
  assert.ok(out[0].cellErrors.has('0,1'));
  assert.match(out[1].error, /M has an entry that cannot be read/);
});

test('non-rational entries become decimals and stay usable', () => {
  const out = sheet([A, expr('sqrt(2)*A'), expr('sqrt(4)*A')]);
  assert.equal(formatScalar(out[1].value.a[0][0]), '1.4142136');
  assert.equal(formatScalar(out[2].value.a[0][0]), '2', 'a perfect square stays exact');
});

test('hostile input is bounded', () => {
  assert.throws(() => evaluate('('.repeat(500)));
  assert.throws(() => evaluate('1+'.repeat(300)));
  assert.doesNotThrow(() => sheet([{ kind: 'expr', text: '9^9^9^9' }]));
  const out = sheet([A, expr('A^100000')]);
  assert.ok(out[1].error);
  assert.ok(isMatrix(q(1)) === false);
});
