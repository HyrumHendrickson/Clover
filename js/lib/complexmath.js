/**
 * Complex-number primitives.
 *
 * A complex number is a two-element array `[re, im]`. Every function writes
 * its result into the supplied `out` array and returns it, so hot loops (such
 * as domain colouring) can run without allocating. Inputs are never mutated,
 * and `out` may alias an input.
 */

export const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export const add = (a, b, o) => {
  o[0] = a[0] + b[0];
  o[1] = a[1] + b[1];
  return o;
};

export const sub = (a, b, o) => {
  o[0] = a[0] - b[0];
  o[1] = a[1] - b[1];
  return o;
};

export const mul = (a, b, o) => {
  const re = a[0] * b[0] - a[1] * b[1];
  o[1] = a[0] * b[1] + a[1] * b[0];
  o[0] = re;
  return o;
};

export const div = (a, b, o) => {
  const d = b[0] * b[0] + b[1] * b[1];
  if (d === 0) {
    const finite = a[0] === 0 && a[1] === 0 ? NaN : Infinity;
    o[0] = finite;
    o[1] = finite;
    return o;
  }
  const re = (a[0] * b[0] + a[1] * b[1]) / d;
  o[1] = (a[1] * b[0] - a[0] * b[1]) / d;
  o[0] = re;
  return o;
};

export const neg = (a, o) => {
  o[0] = -a[0];
  o[1] = -a[1];
  return o;
};

export const conj = (a, o) => {
  o[0] = a[0];
  o[1] = -a[1];
  return o;
};

export const abs = (a) => Math.hypot(a[0], a[1]);
export const arg = (a) => Math.atan2(a[1], a[0]);

export const exp = (a, o) => {
  const m = Math.exp(a[0]);
  const y = a[1];
  o[0] = m * Math.cos(y);
  o[1] = m * Math.sin(y);
  return o;
};

export const log = (a, o) => {
  const re = Math.log(Math.hypot(a[0], a[1]));
  o[1] = Math.atan2(a[1], a[0]);
  o[0] = re;
  return o;
};

/** Principal square root. */
export const sqrt = (a, o) => {
  const x = a[0];
  const y = a[1];
  const r = Math.hypot(x, y);
  const re = Math.sqrt((r + x) / 2);
  const im = Math.sqrt((r - x) / 2);
  o[0] = re;
  o[1] = y < 0 ? -im : im;
  return o;
};

/** Integer power by repeated squaring; exact for small exponents. */
export const powInt = (a, n, o) => {
  if (n === 0) {
    o[0] = 1;
    o[1] = 0;
    return o;
  }
  let k = Math.abs(n);
  let br = a[0];
  let bi = a[1];
  let rr = 1;
  let ri = 0;
  while (k > 0) {
    if (k & 1) {
      const t = rr * br - ri * bi;
      ri = rr * bi + ri * br;
      rr = t;
    }
    k >>= 1;
    if (k > 0) {
      const t = br * br - bi * bi;
      bi = 2 * br * bi;
      br = t;
    }
  }
  if (n < 0) return div([1, 0], [rr, ri], o);
  o[0] = rr;
  o[1] = ri;
  return o;
};

/** General complex power: a^b = exp(b log a), with 0^b handled explicitly. */
export const pow = (a, b, o) => {
  if (a[0] === 0 && a[1] === 0) {
    if (b[0] === 0 && b[1] === 0) {
      o[0] = 1;
      o[1] = 0;
    } else if (b[0] > 0) {
      o[0] = 0;
      o[1] = 0;
    } else {
      o[0] = Infinity;
      o[1] = Infinity;
    }
    return o;
  }
  const t = log(a, [0, 0]);
  return exp(mul(b, t, t), o);
};

export const sin = (a, o) => {
  const x = a[0];
  const y = a[1];
  o[0] = Math.sin(x) * Math.cosh(y);
  o[1] = Math.cos(x) * Math.sinh(y);
  return o;
};

export const cos = (a, o) => {
  const x = a[0];
  const y = a[1];
  o[0] = Math.cos(x) * Math.cosh(y);
  o[1] = -Math.sin(x) * Math.sinh(y);
  return o;
};

export const tan = (a, o) => {
  if (Math.abs(a[1]) > 20) {
    o[0] = 0;
    o[1] = Math.sign(a[1]);
    return o;
  }
  return div(sin(a, [0, 0]), cos(a, [0, 0]), o);
};

export const sinh = (a, o) => {
  const x = a[0];
  const y = a[1];
  o[0] = Math.sinh(x) * Math.cos(y);
  o[1] = Math.cosh(x) * Math.sin(y);
  return o;
};

export const cosh = (a, o) => {
  const x = a[0];
  const y = a[1];
  o[0] = Math.cosh(x) * Math.cos(y);
  o[1] = Math.sinh(x) * Math.sin(y);
  return o;
};

export const tanh = (a, o) => {
  if (Math.abs(a[0]) > 20) {
    o[0] = Math.sign(a[0]);
    o[1] = 0;
    return o;
  }
  return div(sinh(a, [0, 0]), cosh(a, [0, 0]), o);
};

export const cot = (a, o) => div([1, 0], tan(a, [0, 0]), o);
export const sec = (a, o) => div([1, 0], cos(a, [0, 0]), o);
export const csc = (a, o) => div([1, 0], sin(a, [0, 0]), o);

/** asin(z) = -i ln(iz + sqrt(1 - z^2)) */
export const asin = (a, o) => {
  const z2 = mul(a, a, [0, 0]);
  const root = sqrt([1 - z2[0], -z2[1]], [0, 0]);
  const t = log([root[0] - a[1], root[1] + a[0]], [0, 0]);
  o[0] = t[1];
  o[1] = -t[0];
  return o;
};

export const acos = (a, o) => {
  const t = asin(a, [0, 0]);
  o[0] = HALF_PI - t[0];
  o[1] = -t[1];
  return o;
};

/** atan(z) = (i/2) [ln(1 - iz) - ln(1 + iz)] */
export const atan = (a, o) => {
  const p = log([1 + a[1], -a[0]], [0, 0]);
  const q = log([1 - a[1], a[0]], [0, 0]);
  o[0] = -(p[1] - q[1]) / 2;
  o[1] = (p[0] - q[0]) / 2;
  return o;
};

export const asinh = (a, o) => {
  const z2 = mul(a, a, [0, 0]);
  const root = sqrt([z2[0] + 1, z2[1]], [0, 0]);
  return log([a[0] + root[0], a[1] + root[1]], o);
};

export const acosh = (a, o) => {
  const p = sqrt([a[0] + 1, a[1]], [0, 0]);
  const q = sqrt([a[0] - 1, a[1]], [0, 0]);
  const pq = mul(p, q, [0, 0]);
  return log([a[0] + pq[0], a[1] + pq[1]], o);
};

export const atanh = (a, o) => {
  const t = div([1 + a[0], a[1]], [1 - a[0], -a[1]], [0, 0]);
  log(t, t);
  o[0] = t[0] / 2;
  o[1] = t[1] / 2;
  return o;
};

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Gamma function via the Lanczos approximation with reflection. */
export const gamma = (a, o) => {
  if (a[0] < 0.5) {
    const s = sin([Math.PI * a[0], Math.PI * a[1]], [0, 0]);
    const g = gamma([1 - a[0], -a[1]], [0, 0]);
    const d = mul(s, g, [0, 0]);
    return div([Math.PI, 0], d, o);
  }
  const zr = a[0] - 1;
  const zi = a[1];
  let xr = LANCZOS[0];
  let xi = 0;
  for (let i = 1; i < LANCZOS.length; i += 1) {
    const dr = zr + i;
    const d = dr * dr + zi * zi;
    xr += (LANCZOS[i] * dr) / d;
    xi -= (LANCZOS[i] * zi) / d;
  }
  const t = [zr + LANCZOS_G + 0.5, zi];
  const p = pow(t, [zr + 0.5, zi], [0, 0]);
  const e = exp([-t[0], -t[1]], [0, 0]);
  const pe = mul(p, e, [0, 0]);
  const scale = Math.sqrt(TAU);
  o[0] = scale * (pe[0] * xr - pe[1] * xi);
  o[1] = scale * (pe[0] * xi + pe[1] * xr);
  return o;
};
