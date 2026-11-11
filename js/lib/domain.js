/**
 * Domain colouring: map each point z of the complex plane to a colour that
 * encodes f(z). Pure functions over typed arrays, so they are unit testable.
 */
import { TAU } from './complexmath.js';
import { writeHsl, writeHsv } from './colors.js';

export const MODES = ['phase', 'magnitude', 'enhanced'];

/**
 * Colour one pixel from the value f(z) = re + im*i.
 *   phase      hue = arg f(z)
 *   magnitude  hue = arg f(z); lightness rises from black (zeros) to white (poles)
 *   enhanced   hue = arg f(z); brightness steps mark each doubling of |f(z)|
 */
export function colorize(data, i, re, im, mode) {
  if (Number.isNaN(re) || Number.isNaN(im)) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 255;
    return;
  }
  const mag = Math.hypot(re, im);
  if (!Number.isFinite(mag)) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
    return;
  }
  let hue = Math.atan2(im, re) / TAU;
  if (hue < 0) hue += 1;
  if (mode === 'phase') {
    writeHsv(data, i, hue, 0.8, 0.95);
  } else if (mode === 'magnitude') {
    writeHsl(data, i, hue, (2 / Math.PI) * Math.atan(mag ** 0.4));
  } else if (mag === 0) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  } else {
    const lm = Math.log2(mag);
    const fm = lm - Math.floor(lm);
    const fp = hue * 12 - Math.floor(hue * 12);
    writeHsv(data, i, hue, 0.7 + 0.3 * fp, 0.62 + 0.38 * fm);
  }
}

/**
 * Evaluate f over rows [rowStart, rowEnd) of a buffer that samples the view at
 * `s` samples per CSS pixel.
 * @param {object} job
 * @param {Uint8ClampedArray} job.data RGBA output of size rw*rh*4
 * @param {number} job.rw buffer width in samples
 * @param {number} job.s samples per CSS pixel
 * @param {number} job.width view width in CSS pixels
 * @param {number} job.height view height in CSS pixels
 * @param {number} job.cx centre x (world)
 * @param {number} job.cy centre y (world)
 * @param {number} job.scale pixels per world unit
 * @param {(re: number, im: number) => number[]} job.f
 * @param {string} job.mode one of MODES
 */
export function renderRows({ data, rw, s, width, height, cx, cy, scale, f, mode, rowStart, rowEnd }) {
  for (let row = rowStart; row < rowEnd; row += 1) {
    const y = cy - ((row + 0.5) / s - height / 2) / scale;
    let index = row * rw * 4;
    for (let col = 0; col < rw; col += 1) {
      const x = cx + ((col + 0.5) / s - width / 2) / scale;
      const value = f(x, y);
      colorize(data, index, value[0], value[1], mode);
      index += 4;
    }
  }
}
