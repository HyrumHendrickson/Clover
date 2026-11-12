/**
 * Escape-time fractals, computed one row at a time into typed arrays so rendering allocates nothing per pixel.
 * `t` is a smooth iteration count, or -1 for points that never escape. For Newton's method, `group` says which
 * root the point converged to.
 */

export const FRACTALS = [
  ['mandelbrot', 'Mandelbrot set'],
  ['julia', 'Julia set'],
  ['ship', 'Burning Ship'],
  ['tricorn', 'Tricorn'],
  ['newton', 'Newton, z\u00b3 = 1'],
];

export const PALETTES = [
  ['forest', 'Forest'],
  ['fire', 'Fire'],
  ['ice', 'Ice'],
  ['gray', 'Greyscale'],
];

export const MIN_ITER = 20;
export const MAX_ITER = 2000;

/** Where each kind looks first: centre and half-height. */
export const HOME = {
  mandelbrot: { cx: -0.6, cy: 0, radius: 1.4 },
  julia: { cx: 0, cy: 0, radius: 1.6 },
  ship: { cx: -0.4, cy: -0.5, radius: 1.6 },
  tricorn: { cx: -0.2, cy: 0, radius: 1.8 },
  newton: { cx: 0, cy: 0, radius: 1.6 },
};

const BAILOUT = 256;
const ROOTS = [
  [1, 0],
  [-0.5, Math.sqrt(3) / 2],
  [-0.5, -Math.sqrt(3) / 2],
];

/**
 * Fill `t[0..count)` and `group[0..count)` for the points (x0 + i * dx, y), i = 0 .. count - 1.
 * @param {string} kind one of FRACTALS
 * @param {{ iterations: number, cRe: number, cIm: number, power: number }} p
 */
export function computeRow(kind, p, x0, dx, y, count, t, group) {
  const max = p.iterations;
  for (let i = 0; i < count; i += 1) {
    const px = x0 + i * dx;
    group[i] = 0;
    if (kind === 'newton') {
      let zr = px;
      let zi = y;
      let n = 0;
      let found = -1;
      for (; n < max && found < 0; n += 1) {
        // z - (z^3 - 1) / (3 z^2), written out in real arithmetic.
        const r2 = zr * zr - zi * zi;
        const i2 = 2 * zr * zi;
        const denomR = 3 * r2;
        const denomI = 3 * i2;
        const d = denomR * denomR + denomI * denomI;
        if (d < 1e-24) break;
        const cubeR = r2 * zr - i2 * zi - 1;
        const cubeI = r2 * zi + i2 * zr;
        zr -= (cubeR * denomR + cubeI * denomI) / d;
        zi -= (cubeI * denomR - cubeR * denomI) / d;
        for (let k = 0; k < 3; k += 1) {
          if (Math.abs(zr - ROOTS[k][0]) < 1e-6 && Math.abs(zi - ROOTS[k][1]) < 1e-6) found = k;
        }
      }
      t[i] = found < 0 ? -1 : n;
      group[i] = found < 0 ? 0 : found;
      continue;
    }
    let zr;
    let zi;
    let cr;
    let ci;
    if (kind === 'julia') {
      zr = px;
      zi = y;
      cr = p.cRe;
      ci = p.cIm;
    } else {
      zr = 0;
      zi = 0;
      cr = px;
      ci = y;
    }
    let n = 0;
    let escaped = false;
    for (; n < max; n += 1) {
      if (kind === 'ship') {
        zr = Math.abs(zr);
        zi = Math.abs(zi);
      } else if (kind === 'tricorn') {
        zi = -zi;
      }
      let nr;
      let ni;
      if (p.power === 2) {
        nr = zr * zr - zi * zi;
        ni = 2 * zr * zi;
      } else {
        const radius = Math.hypot(zr, zi);
        const angle = Math.atan2(zi, zr) * p.power;
        const m = radius ** p.power;
        nr = m * Math.cos(angle);
        ni = m * Math.sin(angle);
      }
      zr = nr + cr;
      zi = ni + ci;
      if (zr * zr + zi * zi > BAILOUT) {
        escaped = true;
        break;
      }
    }
    if (!escaped) t[i] = -1;
    else {
      const mod = Math.sqrt(zr * zr + zi * zi);
      t[i] = n + 1 - Math.log(Math.log(mod)) / Math.log(p.power === 2 ? 2 : Math.max(1.0001, p.power));
      if (!(t[i] >= 0)) t[i] = n;
    }
  }
}

const cosine = (t, a, b, c, d) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (c * t + d)) * b + (a - 0.5);
const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Colour for one point as [r, g, b], 0 to 255. Points inside the set are near-black. */
export function colorOf(kind, palette, t, group, iterations) {
  if (t < 0) return [12, 16, 14];
  if (kind === 'newton') {
    const base = [
      [60, 130, 246],
      [239, 68, 68],
      [34, 197, 94],
    ][group];
    const shade = Math.max(0.25, 1 - t / 40);
    return base.map((v) => Math.round(v * shade));
  }
  const s = (t / Math.max(32, Math.min(iterations, 160))) % 1;
  switch (palette) {
    case 'fire':
      return [byte(Math.min(1, s * 2.4)), byte(Math.max(0, s * 2.4 - 0.7)), byte(Math.max(0, s * 2.4 - 1.6))];
    case 'ice':
      return [
        byte(cosine(s, 0.4, 0.6, 1, 0.55)),
        byte(cosine(s, 0.55, 0.6, 1, 0.65)),
        byte(cosine(s, 0.8, 0.5, 1, 0.75)),
      ];
    case 'gray': {
      const v = byte(0.15 + 0.85 * Math.sqrt(s));
      return [v, v, v];
    }
    default:
      return [
        byte(cosine(s, 0.2, 0.55, 1, 0.1)),
        byte(cosine(s, 0.5, 0.7, 1, 0.0)),
        byte(cosine(s, 0.25, 0.45, 1, 0.3)),
      ];
  }
}
