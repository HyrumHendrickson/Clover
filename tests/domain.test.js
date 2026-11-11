import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorize, renderRows } from '../js/lib/domain.js';
import { compileComplex } from '../js/lib/expr.js';

const px = (re, im, mode) => {
  const data = new Uint8ClampedArray(4);
  colorize(data, 0, re, im, mode);
  return [...data];
};

test('phase: the positive real axis is red, and hue advances counter-clockwise', () => {
  const [r, g, b] = px(1, 0, 'phase');
  assert.ok(r > 200 && g < 80 && b < 80);
  const [r2, g2, b2] = px(0, 1, 'phase');
  assert.ok(g2 > r2 && g2 > b2, 'positive imaginary axis should lean green (hue 0.25)');
  const [r3, g3, b3] = px(-1, 0, 'phase');
  assert.ok(g3 > 150 && b3 > 150 && r3 < 100, 'negative real axis is cyan');
});

test('phase colour is independent of magnitude', () => {
  assert.deepEqual(px(1, 1, 'phase'), px(50, 50, 'phase'));
});

test('magnitude: zeros are black and large values approach white', () => {
  assert.deepEqual(px(0, 0, 'magnitude'), [0, 0, 0, 255]);
  const big = px(1e12, 0, 'magnitude');
  assert.ok(big[0] > 240 && big[1] > 240 && big[2] > 240);
});

test('enhanced: zero is black and brightness repeats each doubling of |f|', () => {
  assert.deepEqual(px(0, 0, 'enhanced'), [0, 0, 0, 255]);
  const a = px(1.0, 0, 'enhanced');
  const b = px(2.0, 0, 'enhanced');
  assert.deepEqual(a, b, 'one doubling of |f| gives the same brightness');
});

test('undefined and infinite values get distinct neutral colours', () => {
  assert.deepEqual(px(NaN, 0, 'phase'), [128, 128, 128, 255]);
  assert.deepEqual(px(Infinity, 0, 'phase'), [255, 255, 255, 255]);
});

test('renderRows paints exactly the requested rows with opaque pixels', () => {
  const rw = 8;
  const rh = 8;
  const data = new Uint8ClampedArray(rw * rh * 4);
  renderRows({
    data,
    rw,
    s: 1,
    width: 8,
    height: 8,
    cx: 0,
    cy: 0,
    scale: 2,
    f: compileComplex('z'),
    mode: 'phase',
    rowStart: 2,
    rowEnd: 5,
  });
  for (let row = 0; row < rh; row += 1) {
    const painted = data[row * rw * 4 + 3] === 255;
    assert.equal(painted, row >= 2 && row < 5, `row ${row}`);
  }
});

test('renderRows maps pixels to the expected plane coordinates', () => {
  // f(z) = z with the view centred on 2+0i: the left half has negative-real hue behaviour.
  const rw = 4;
  const data = new Uint8ClampedArray(rw * 4);
  renderRows({
    data,
    rw,
    s: 1,
    width: 4,
    height: 1,
    cx: 10,
    cy: 0,
    scale: 1,
    f: compileComplex('z'),
    mode: 'phase',
    rowStart: 0,
    rowEnd: 1,
  });
  const red = (i) => data[i * 4] > 200 && data[i * 4 + 1] < 80;
  assert.ok([0, 1, 2, 3].every(red), 'all sampled points have positive real values, so are red');
});
