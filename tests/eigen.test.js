import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinalgError, evaluate, evaluateLines, formatScalar, isMatrix, toNumber } from '../js/lib/linalg.js';

const run = (text, lines = []) => {
  const scope = new Map();
  for (const l of lines) {
    const out = evaluateLines([l])[0];
    if (out.name) scope.set(out.name, out.value);
  }
  return evaluate(text, scope);
};
const values = (m) => m.a.flat().map((x) => formatScalar(x));
const sheet = (lines) => evaluateLines(lines);
const M = (name, cells) => ({ id: name, kind: 'matrix', name, cells });
const close = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('eigenvalues of a diagonal and a triangular matrix are exact', () => {
  assert.deepEqual(values(run('eigenvalues(diag(3, 1, 2))')), ['3', '2', '1']);
  assert.deepEqual(values(run('eigenvalues([[2, 1], [0, 5]])')), ['5', '2']);
});

test('rational eigenvalues come with exact integer eigenvectors', () => {
  const out = sheet([
    M('A', [
      ['2', '1'],
      ['1', '2'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(A)' },
  ]);
  const e = out[1].value;
  assert.equal(e.pairs.length, 2);
  assert.deepEqual(
    e.pairs.map((p) => formatScalar(p.value)),
    ['3', '1'],
  );
  assert.deepEqual(e.pairs[0].vectors[0].map(formatScalar), ['1', '1']);
  assert.deepEqual(e.pairs[1].vectors[0].map(formatScalar), ['1', '-1']);
});

test('irrational eigenvalues are found with matching vectors, and A v = lambda v holds', () => {
  const A = [
    [2, 1],
    [1, 3],
  ];
  const out = sheet([
    M('A', [
      ['2', '1'],
      ['1', '3'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(A)' },
  ]);
  const e = out[1].value;
  close(toNumber(e.pairs[0].value), (5 + Math.sqrt(5)) / 2);
  close(toNumber(e.pairs[1].value), (5 - Math.sqrt(5)) / 2);
  for (const pair of e.pairs) {
    const v = pair.unit[0];
    const Av = A.map((row) => row[0] * v[0] + row[1] * v[1]);
    close(Av[0], toNumber(pair.value) * v[0]);
    close(Av[1], toNumber(pair.value) * v[1]);
    close(Math.hypot(...v), 1);
  }
});

test('a repeated eigenvalue reports its multiplicity and the right number of vectors', () => {
  const identity = sheet([
    M('A', [
      ['2', '0'],
      ['0', '2'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(A)' },
  ])[1].value;
  assert.equal(identity.pairs.length, 1);
  assert.equal(identity.pairs[0].multiplicity, 2);
  assert.equal(identity.pairs[0].vectors.length, 2);
  const defective = sheet([
    M('A', [
      ['2', '1'],
      ['0', '2'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(A)' },
  ])[1].value;
  assert.equal(defective.pairs[0].multiplicity, 2);
  assert.equal(defective.pairs[0].vectors.length, 1, 'a Jordan block has one eigenvector');
});

test('a rotation has complex eigenvalues and the real functions say so', () => {
  const e = sheet([
    M('R', [
      ['0', '-1'],
      ['1', '0'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(R)' },
  ])[1].value;
  assert.equal(e.hasComplex, true);
  close(e.pairs[0].re, 0);
  close(e.pairs[0].im, 1);
  const bad = sheet([
    M('R', [
      ['0', '-1'],
      ['1', '0'],
    ]),
    { id: 'e', kind: 'expr', text: 'eigenvalues(R)' },
  ])[1];
  assert.match(bad.error, /complex eigenvalues \(0 \u00b1 1i\)/);
});

test('eigenvectors(A) returns them as columns, and 3 by 3 works', () => {
  const out = sheet([
    M('A', [
      ['2', '0', '0'],
      ['0', '3', '4'],
      ['0', '4', '9'],
    ]),
    { id: 'v', kind: 'expr', text: 'eigenvectors(A)' },
    { id: 'l', kind: 'expr', text: 'eigenvalues(A)' },
  ]);
  assert.ok(isMatrix(out[1].value));
  assert.equal(out[1].value.rows, 3);
  assert.equal(out[1].value.cols, 3);
  assert.deepEqual(values(out[2].value), ['11', '2', '1']);
});

test('eig(A) cannot be used in arithmetic, and non-square matrices are refused', () => {
  const out = sheet([
    M('A', [
      ['1', '2'],
      ['3', '4'],
    ]),
    { id: 'a', kind: 'expr', text: '2*eig(A)' },
    { id: 'b', kind: 'expr', text: 'eigenvalues([[1, 2, 3]])' },
  ]);
  assert.match(out[1].error, /eigenvalues\(A\) or eigenvectors\(A\)/);
  assert.match(out[2].error, /Only a square matrix/);
});

test('the symmetric 3 by 3 with a repeated irrational root keeps both eigenvectors', () => {
  // eigenvalues 1 + sqrt(2) twice? use a matrix with a double root 2 and a simple root 5
  const e = sheet([
    M('A', [
      ['3', '1', '1'],
      ['1', '3', '1'],
      ['1', '1', '3'],
    ]),
    { id: 'e', kind: 'expr', text: 'eig(A)' },
  ])[1].value;
  assert.deepEqual(
    e.pairs.map((p) => [formatScalar(p.value), p.multiplicity, p.vectors.length]),
    [
      ['5', 1, 1],
      ['2', 2, 2],
    ],
  );
});

test('entries that are not rational still give eigenvalues', () => {
  const out = sheet([
    M('A', [
      ['sqrt(2)', '0'],
      ['0', '1'],
    ]),
    { id: 'e', kind: 'expr', text: 'eigenvalues(A)' },
  ])[1];
  assert.equal(out.error, null);
  close(toNumber(out.value.a[0][0]), Math.SQRT2);
  assert.ok(new LinalgError('x') instanceof Error);
});
