/** Colour helpers for the visualisation tools. */

/**
 * Write an HSV colour into an RGBA byte array.
 * @param {Uint8ClampedArray} data
 * @param {number} i byte offset of the pixel
 * @param {number} h hue in [0, 1)
 * @param {number} s saturation in [0, 1]
 * @param {number} v value in [0, 1]
 */
export function writeHsv(data, i, h, s, v) {
  const k = (h % 1) * 6;
  const sector = Math.floor(k);
  const f = k - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r;
  let g;
  let b;
  switch (sector) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  data[i] = r * 255;
  data[i + 1] = g * 255;
  data[i + 2] = b * 255;
  data[i + 3] = 255;
}

/** Write a fully saturated HSL colour (lightness `l`) into an RGBA byte array. */
export function writeHsl(data, i, h, l) {
  const c = 1 - Math.abs(2 * l - 1);
  const k = (h % 1) * 6;
  const x = c * (1 - Math.abs((k % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (k < 1) {
    r = c;
    g = x;
  } else if (k < 2) {
    r = x;
    g = c;
  } else if (k < 3) {
    g = c;
    b = x;
  } else if (k < 4) {
    g = x;
    b = c;
  } else if (k < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  data[i] = (r + m) * 255;
  data[i + 1] = (g + m) * 255;
  data[i + 2] = (b + m) * 255;
  data[i + 3] = 255;
}

const STOPS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

/** 256-entry lookup table for a perceptually ordered sequential palette. */
export const PALETTE = (() => {
  const lut = [];
  for (let n = 0; n < 256; n += 1) {
    const t = (n / 255) * (STOPS.length - 1);
    const a = Math.min(STOPS.length - 2, Math.floor(t));
    const f = t - a;
    lut.push(STOPS[a].map((c, k) => Math.round(c + (STOPS[a + 1][k] - c) * f)));
  }
  return lut;
})();

/** Map t in [0, 1] to an [r, g, b] triple. */
export function palette(t) {
  const n = Math.min(255, Math.max(0, Math.round(t * 255)));
  return PALETTE[Number.isNaN(n) ? 0 : n];
}
