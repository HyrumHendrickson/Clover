import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLines } from '../js/lib/linalg.js';
import {
  applyMatrix,
  fitRadius,
  interpolate,
  planFor,
  project3,
  splitProduct,
  stripAssignment,
  turnAndScale,
} from '../js/lib/linviz.js';

const M = (name, cells) => ({ id: name, kind: 'matrix', name, cells });
const E = (id, text) => ({ id, kind: 'expr', text });
const plan = (lines, index) => planFor(lines, evaluateLines(lines), index);

test('products split at top-level stars only', () => {
  assert.deepEqual(splitProduct('A*B*x'), ['A', 'B', 'x']);
  assert.deepEqual(splitProduct('[[1, 2], [3, 4]]*(2*x)'), ['[[1, 2], [3, 4]]', '(2*x)']);
  assert.equal(stripAssignment('y = A*x'), 'A*x');
  assert.equal(stripAssignment('A == B'.replace('==', '=')), 'B');
});

test('a vector line is drawn as a vector, a 2 by 2 as a transformation', () => {
  const lines = [
    M('v', [['3'], ['4']]),
    M('A', [
      ['2', '0'],
      ['0', '3'],
    ]),
    M('w', [['1'], ['2'], ['3']]),
  ];
  assert.deepEqual(plan(lines, 0), { kind: 'vector', dim: 2, v: [3, 4], label: 'v' });
  const t = plan(lines, 1);
  assert.equal(t.kind, 'transform');
  assert.deepEqual(t.A, [
    [2, 0],
    [0, 3],
  ]);
  assert.deepEqual(t.eigen.map((e) => e.value).sort(), [2, 3]);
  assert.equal(plan(lines, 2).dim, 3);
});

test('A*x is drawn as x turned and scaled by A, also with a product of matrices', () => {
  const lines = [
    M('A', [
      ['0', '-1'],
      ['1', '0'],
    ]),
    M('B', [
      ['2', '0'],
      ['0', '2'],
    ]),
    M('x', [['1'], ['0']]),
    E('p', 'A*x'),
    E('q', 'y = B*A*x'),
    E('r', 'Ax'),
  ];
  for (const [i, expected] of [
    [3, [0, 1]],
    [4, [0, 2]],
    [5, [0, 1]],
  ]) {
    const spec = plan(lines, i);
    assert.equal(spec.kind, 'apply', `line ${i}`);
    assert.deepEqual(spec.x, [1, 0]);
    const result = applyMatrix(spec.A, spec.x);
    assert.ok(Math.abs(result[0] - expected[0]) < 1e-12 && Math.abs(result[1] - expected[1]) < 1e-12);
  }
  assert.deepEqual(plan(lines, 3).eigen, [], 'a rotation has no real eigenvectors to draw');
});

test('eig(A) draws the matrix with its eigenvectors, and bad lines explain themselves', () => {
  const lines = [
    M('A', [
      ['2', '1'],
      ['1', '2'],
    ]),
    E('e', 'eig(A)'),
    E('s', '2 + 3'),
    E('b', 'A + '),
    M('Z', [
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]),
  ];
  const e = plan(lines, 1);
  assert.equal(e.kind, 'transform');
  assert.equal(e.eigen.length, 2);
  assert.equal(plan(lines, 2).kind, 'none');
  assert.match(plan(lines, 3).message, /Fix the error/);
  assert.match(plan(lines, 4).message, /2\u00d73 matrix cannot be drawn/);
});

test('turn and scale: a quarter turn doubling the length, and the zero vector', () => {
  const r = turnAndScale([1, 0], [0, 2]);
  assert.ok(Math.abs(r.degrees - 90) < 1e-9 && Math.abs(r.scale - 2) < 1e-9);
  assert.ok(Math.abs(turnAndScale([1, 0], [0, -1]).degrees + 90) < 1e-9);
  assert.equal(turnAndScale([0, 0], [1, 1]).degrees, null);
});

test('interpolation runs from the identity to the matrix', () => {
  const A = [
    [2, 1],
    [0, 3],
  ];
  assert.deepEqual(interpolate(A, 0), [
    [1, 0],
    [0, 1],
  ]);
  assert.deepEqual(interpolate(A, 1), A);
  assert.deepEqual(interpolate(A, 0.5), [
    [1.5, 0.5],
    [0, 2],
  ]);
});

test('projection keeps lengths along the vertical axis and the view fits its content', () => {
  const [, y] = project3([0, 0, 1], 0.7, 0.4);
  assert.ok(Math.abs(y - Math.cos(0.4)) < 1e-12);
  assert.equal(fitRadius([[0.1, 0.2]]), 3);
  assert.ok(fitRadius([[10, -20]]) > 20);
});
