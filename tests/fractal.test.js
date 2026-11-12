import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRow, colorOf, FRACTALS, HOME } from '../js/lib/fractal.js';

const params = { iterations: 200, cRe: -0.8, cIm: 0.156, power: 2 };
const row = (kind, x, y, p = params) => {
  const t = new Float32Array(1);
  const g = new Uint8Array(1);
  computeRow(kind, p, x, 0, y, 1, t, g);
  return [t[0], g[0]];
};

test('Mandelbrot: the origin and -1 stay bounded, 1 and 2 escape quickly', () => {
  assert.equal(row('mandelbrot', 0, 0)[0], -1);
  assert.equal(row('mandelbrot', -1, 0)[0], -1);
  assert.ok(row('mandelbrot', 1, 0)[0] > 0 && row('mandelbrot', 1, 0)[0] < 5);
  assert.ok(row('mandelbrot', 2, 2)[0] < row('mandelbrot', 0.3, 0.5)[0] + 5);
});

test('Julia set depends on c and the starting point', () => {
  assert.equal(row('julia', 0, 0, { ...params, cRe: 0, cIm: 0 })[0], -1);
  assert.ok(row('julia', 2, 0, { ...params, cRe: 0, cIm: 0 })[0] >= 0);
});

test('Newton fractal sorts points by the cube root of one they reach', () => {
  assert.equal(row('newton', 1.2, 0.1)[1], 0);
  assert.equal(row('newton', -0.6, 0.9)[1], 1);
  assert.equal(row('newton', -0.6, -0.9)[1], 2);
});

test('the symmetries of the sets hold', () => {
  const a = row('mandelbrot', -0.3, 0.6)[0];
  const b = row('mandelbrot', -0.3, -0.6)[0];
  assert.ok(Math.abs(a - b) < 1e-4, 'Mandelbrot is symmetric about the real axis');
  const s = row('ship', -1.7, -0.03)[0];
  assert.ok(Number.isFinite(s));
});

test('every kind has a home view and colours stay in range', () => {
  for (const [kind] of FRACTALS) {
    assert.ok(HOME[kind].radius > 0);
    for (const palette of ['forest', 'fire', 'ice', 'gray']) {
      for (const t of [-1, 0, 5.5, 90, 1000]) {
        const rgb = colorOf(kind, palette, t, 1, 200);
        assert.ok(
          rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255),
          `${kind} ${palette} ${t}`,
        );
      }
    }
  }
});
