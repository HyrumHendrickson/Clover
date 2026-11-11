import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiply, dotTerms, det2, identity, formatNumber } from '../js/lib/matrix.js';
import { View, niceStep, normalizeView, formatTick } from '../js/lib/viewport.js';

test('multiply: rectangular product', () => {
  const A = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const B = [
    [7, 8],
    [9, 10],
    [11, 12],
  ];
  assert.deepEqual(multiply(A, B), [
    [58, 64],
    [139, 154],
  ]);
});

test('multiply: identity is neutral and mismatched sizes throw', () => {
  const A = [
    [2, -1],
    [0.5, 3],
  ];
  assert.deepEqual(multiply(A, identity(2)), A);
  assert.throws(() => multiply([[1, 2]], [[1, 2]]), RangeError);
});

test('dotTerms lists each product in the sum', () => {
  const terms = dotTerms([[1, 2]], [[3], [4]], 0, 0);
  assert.deepEqual(
    terms.map((t) => t.product),
    [3, 8],
  );
});

test('det2', () => {
  assert.equal(
    det2([
      [1, 2],
      [3, 4],
    ]),
    -2,
  );
});

test('formatNumber', () => {
  assert.equal(formatNumber(3), '3');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(NaN), '?');
  assert.equal(formatNumber(Infinity), '\u221e');
  assert.equal(formatNumber(1 / 3), '0.333333');
});

test('View: world and screen coordinates round-trip', () => {
  const view = new View({ cx: 1, cy: -2, radius: 4 }, 800, 600);
  const [px, py] = view.toScreen(3.25, 0.5);
  const [x, y] = view.toWorld(px, py);
  assert.ok(Math.abs(x - 3.25) < 1e-12 && Math.abs(y - 0.5) < 1e-12);
});

test('View: radius maps to half the shorter canvas side', () => {
  const view = new View({ radius: 5 }, 1000, 400);
  assert.equal(view.scale, 40);
  const [, top] = view.toScreen(0, 5);
  assert.equal(top, 0);
});

test('View: zoomAt keeps the anchored point fixed', () => {
  const view = new View({ cx: 0, cy: 0, radius: 5 }, 640, 480);
  const before = view.toWorld(500, 100);
  view.zoomAt(500, 100, 3);
  const after = view.toWorld(500, 100);
  assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
  assert.ok(view.radius < 5);
});

test('View: panBy moves in the drag direction', () => {
  const view = new View({ radius: 5 }, 100, 100);
  view.panBy(10, 0);
  assert.ok(view.cx < 0);
});

test('normalizeView rejects bad input', () => {
  const fallback = { cx: 0, cy: 0, radius: 3 };
  assert.deepEqual(normalizeView(null, fallback), fallback);
  assert.deepEqual(normalizeView({ cx: 'a', cy: NaN, radius: -5 }, fallback).cx, 0);
  assert.ok(normalizeView({ radius: -5 }, fallback).radius > 0);
});

test('niceStep returns 1-2-5 steps', () => {
  assert.equal(niceStep(10), 1);
  assert.equal(niceStep(20), 2);
  assert.equal(niceStep(50), 5);
  assert.equal(niceStep(0.1), 0.01);
});

test('formatTick trims noise', () => {
  assert.equal(formatTick(0.30000000000000004, 0.1), '0.3');
  assert.equal(formatTick(2, 1), '2');
  assert.equal(formatTick(-0, 1), '0');
});
