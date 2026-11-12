/**
 * Exact linear algebra for the Matrices tool.
 *
 * Scalars are exact rationals (`Q`, BigInt numerator and denominator) wherever the
 * input is rational, so 1/3 + 1/6 is 1/2 and a determinant is an integer. Anything
 * that is not rational (sqrt(2), pi, sin(1)) becomes an ordinary float, and a
 * result that touches a float is a float.
 *
 * The expression language is evaluated by a closure-free recursive-descent
 * parser. There is no eval and no Function.
 */
import { ratioToFloat } from './geometry/poly.js';

export class LinalgError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LinalgError';
  }
}

const MAX_EXPR = 400;
const MAX_DEPTH = 40;
const MAX_POWER = 64;
export const MAX_DIM = 10;

/* ---------------------------------------------------------------- scalars */

const bigGcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new LinalgError('Division by zero.');
    const g = bigGcd(n, d) || 1n;
    const sign = d < 0n ? -1n : 1n;
    this.n = (sign * n) / g;
    this.d = (sign * d) / g;
  }
}

export const q = (n, d = 1n) => new Q(BigInt(n), BigInt(d));
const isQ = (x) => x instanceof Q;
export const toNumber = (x) => (isQ(x) ? ratioToFloat(x.n, x.d) : x);

const EPS = 1e-9;
export const isZero = (x) => (isQ(x) ? x.n === 0n : Math.abs(x) < EPS);
export const add = (a, b) => (isQ(a) && isQ(b) ? new Q(a.n * b.d + b.n * a.d, a.d * b.d) : toNumber(a) + toNumber(b));
export const neg = (a) => (isQ(a) ? new Q(-a.n, a.d) : -a);
export const sub = (a, b) => add(a, neg(b));
export const mul = (a, b) => (isQ(a) && isQ(b) ? new Q(a.n * b.n, a.d * b.d) : toNumber(a) * toNumber(b));
export function div(a, b) {
  if (isZero(b)) throw new LinalgError('Division by zero.');
  return isQ(a) && isQ(b) ? new Q(a.n * b.d, a.d * b.n) : toNumber(a) / toNumber(b);
}

/** a to an integer power; exact when a is exact. */
export function pow(a, k) {
  if (!Number.isInteger(k)) return Math.pow(toNumber(a), k);
  if (k < 0) return div(q(1), pow(a, -k));
  if (isQ(a)) {
    if (k > 4096) return Math.pow(toNumber(a), k);
    return new Q(a.n ** BigInt(k), a.d ** BigInt(k));
  }
  return Math.pow(a, k);
}

function isqrt(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/** Square root, exact when the argument is a perfect-square rational. */
export function sqrt(a) {
  if (isQ(a) && a.n >= 0n && a.n < 10n ** 300n) {
    const rn = isqrt(a.n);
    const rd = isqrt(a.d);
    if (rn * rn === a.n && rd * rd === a.d) return new Q(rn, rd);
  }
  const value = toNumber(a);
  if (value < 0) throw new LinalgError('The square root of a negative number is not real.');
  return Math.sqrt(value);
}

/** Scalar text for display: "3/4", "-2", or a rounded decimal. */
export function formatScalar(x) {
  if (isQ(x)) {
    const text = x.d === 1n ? String(x.n) : `${x.n}/${x.d}`;
    if (text.length <= 40) return text;
    return formatFloat(toNumber(x));
  }
  return formatFloat(x);
}

function formatFloat(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '?' : x > 0 ? '\u221e' : '-\u221e';
  if (Math.abs(x) < 1e-12) return '0';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const text = Number(x.toPrecision(8)).toString();
  return text.includes('e') ? Number(x).toExponential(4) : text;
}

/* --------------------------------------------------------------- matrices */

export class Matrix {
  /** @param {any[][]} data rows of scalars */
  constructor(data) {
    this.a = data;
    this.rows = data.length;
    this.cols = data[0]?.length ?? 0;
  }

  get shape() {
    return `${this.rows}\u00d7${this.cols}`;
  }

  get isSquare() {
    return this.rows === this.cols;
  }
}

export const isMatrix = (x) => x instanceof Matrix;
const build = (rows, cols, f) =>
  new Matrix(Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => f(i, j))));
export const zeros = (r, c) => build(r, c, () => q(0));
export const identity = (n) => build(n, n, (i, j) => q(i === j ? 1 : 0));
const map = (A, f) => build(A.rows, A.cols, (i, j) => f(A.a[i][j], i, j));

export function matAdd(A, B, verb = 'add') {
  if (A.rows !== B.rows || A.cols !== B.cols) {
    throw new LinalgError(`Cannot ${verb} a ${A.shape} matrix and a ${B.shape} matrix. Both must have the same size.`);
  }
  return build(A.rows, A.cols, (i, j) => (verb === 'add' ? add(A.a[i][j], B.a[i][j]) : sub(A.a[i][j], B.a[i][j])));
}

export function matMul(A, B) {
  if (A.cols !== B.rows) {
    throw new LinalgError(
      `Cannot multiply a ${A.shape} matrix by a ${B.shape} matrix. The first must have as many columns as the second has rows.`,
    );
  }
  return build(A.rows, B.cols, (i, j) => {
    let total = q(0);
    for (let k = 0; k < A.cols; k += 1) total = add(total, mul(A.a[i][k], B.a[k][j]));
    return total;
  });
}

export const scale = (A, s) => map(A, (x) => mul(x, s));
export const transpose = (A) => build(A.cols, A.rows, (i, j) => A.a[j][i]);

export function trace(A) {
  if (!A.isSquare) throw new LinalgError(`The trace needs a square matrix, but this one is ${A.shape}.`);
  return A.a.reduce((sum, row, i) => add(sum, row[i]), q(0));
}

/** Gauss-Jordan elimination. Returns the reduced matrix, pivot columns, and the row-swap sign. */
export function rref(A) {
  const m = A.a.map((row) => [...row]);
  const pivots = [];
  let sign = 1;
  let r = 0;
  for (let c = 0; c < A.cols && r < A.rows; c += 1) {
    let best = -1;
    let bestSize = 0;
    for (let i = r; i < A.rows; i += 1) {
      if (isZero(m[i][c])) continue;
      const size = Math.abs(toNumber(m[i][c]));
      if (best < 0 || (!isQ(m[i][c]) && size > bestSize)) {
        best = i;
        bestSize = size;
        if (isQ(m[i][c])) break;
      }
    }
    if (best < 0) continue;
    if (best !== r) {
      [m[best], m[r]] = [m[r], m[best]];
      sign = -sign;
    }
    const pivot = m[r][c];
    m[r] = m[r].map((x) => div(x, pivot));
    for (let i = 0; i < A.rows; i += 1) {
      if (i === r || isZero(m[i][c])) continue;
      const factor = m[i][c];
      m[i] = m[i].map((x, j) => sub(x, mul(factor, m[r][j])));
    }
    pivots.push(c);
    r += 1;
  }
  return { matrix: new Matrix(m), pivots, sign };
}

export const rank = (A) => rref(A).pivots.length;

export function det(A) {
  if (!A.isSquare) throw new LinalgError(`The determinant needs a square matrix, but this one is ${A.shape}.`);
  if (A.rows === 0) return q(1);
  // Eliminate downward only, tracking the product of pivots.
  const m = A.a.map((row) => [...row]);
  let result = q(1);
  for (let c = 0; c < A.cols; c += 1) {
    let best = -1;
    for (let i = c; i < A.rows; i += 1) {
      if (isZero(m[i][c])) continue;
      if (best < 0 || (!isQ(m[i][c]) && Math.abs(toNumber(m[i][c])) > Math.abs(toNumber(m[best][c])))) best = i;
      if (isQ(m[i][c]) && best === i) break;
    }
    if (best < 0) return q(0);
    if (best !== c) {
      [m[best], m[c]] = [m[c], m[best]];
      result = neg(result);
    }
    result = mul(result, m[c][c]);
    for (let i = c + 1; i < A.rows; i += 1) {
      if (isZero(m[i][c])) continue;
      const factor = div(m[i][c], m[c][c]);
      m[i] = m[i].map((x, j) => sub(x, mul(factor, m[c][j])));
    }
  }
  return result;
}

export function inverse(A) {
  if (!A.isSquare) throw new LinalgError(`Only a square matrix has an inverse, but this one is ${A.shape}.`);
  const n = A.rows;
  const augmented = build(n, 2 * n, (i, j) => (j < n ? A.a[i][j] : q(i === j - n ? 1 : 0)));
  const { matrix, pivots } = rref(augmented);
  if (pivots.length < n || pivots[n - 1] >= n) {
    throw new LinalgError('This matrix is singular (its determinant is 0), so it has no inverse.');
  }
  return build(n, n, (i, j) => matrix.a[i][n + j]);
}

export function solve(A, b) {
  if (A.rows !== b.rows)
    throw new LinalgError(
      `solve needs A and b to have the same number of rows, but they are ${A.shape} and ${b.shape}.`,
    );
  const augmented = build(A.rows, A.cols + b.cols, (i, j) => (j < A.cols ? A.a[i][j] : b.a[i][j - A.cols]));
  const { matrix, pivots } = rref(augmented);
  if (pivots.some((p) => p >= A.cols)) throw new LinalgError('The system has no solution.');
  if (pivots.length < A.cols)
    throw new LinalgError('The system has infinitely many solutions, so there is no single answer.');
  return build(A.cols, b.cols, (i, j) => matrix.a[i][A.cols + j]);
}

const asVector = (v, name) => {
  if (v.cols === 1) return v.a.map((r) => r[0]);
  if (v.rows === 1) return v.a[0];
  throw new LinalgError(`${name} needs vectors (a single row or column), but got a ${v.shape} matrix.`);
};

export function dot(u, v) {
  const a = asVector(u, 'dot');
  const b = asVector(v, 'dot');
  if (a.length !== b.length)
    throw new LinalgError(`dot needs vectors of the same length, but they have ${a.length} and ${b.length} entries.`);
  return a.reduce((sum, x, i) => add(sum, mul(x, b[i])), q(0));
}

export function cross(u, v) {
  const a = asVector(u, 'cross');
  const b = asVector(v, 'cross');
  if (a.length !== 3 || b.length !== 3) throw new LinalgError('cross needs two vectors with 3 entries each.');
  return new Matrix([
    [sub(mul(a[1], b[2]), mul(a[2], b[1]))],
    [sub(mul(a[2], b[0]), mul(a[0], b[2]))],
    [sub(mul(a[0], b[1]), mul(a[1], b[0]))],
  ]);
}

export function norm(A) {
  const total = A.a.flat().reduce((sum, x) => add(sum, mul(x, x)), q(0));
  return sqrt(total);
}

/* --------------------------------------------------------------- the parser */

function tokenize(source) {
  const text = source
    .replace(/[\u2212\u2013]/g, '-')
    .replace(/[\u00d7\u00b7\u22c5]/g, '*')
    .replace(/\u03c0/g, 'pi')
    .replace(/\u22121/g, '^-1')
    .replace(/\u1d40/g, '^T');
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(text.slice(i));
    if (num) {
      tokens.push({ k: 'num', s: num[0], at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[\p{L}][\p{L}\p{N}_]*/u.exec(text.slice(i));
    if (id) {
      tokens.push({ k: 'id', s: id[0], at: i });
      i += id[0].length;
      continue;
    }
    tokens.push({ k: 'op', s: ch, at: i });
    i += 1;
  }
  return tokens;
}

function numberToScalar(text) {
  const [whole, frac = ''] = text.split('.');
  return q(BigInt((whole || '0') + frac), 10n ** BigInt(frac.length));
}

const asScalar = (v, what) => {
  if (isEigen(v)) noEigen(what);
  if (isMatrix(v)) {
    if (v.rows === 1 && v.cols === 1) return v.a[0][0];
    throw new LinalgError(`${what} needs a number, but got a ${v.shape} matrix.`);
  }
  return v;
};

const intArg = (v, what) => {
  const n = toNumber(asScalar(v, what));
  if (!Number.isInteger(n) || n < 0 || n > MAX_DIM)
    throw new LinalgError(`${what} needs a whole number from 0 to ${MAX_DIM}.`);
  return n;
};

function applyScalarFn(name, fn) {
  return (v) => {
    const x = toNumber(asScalar(v, name));
    return fn(x);
  };
}

/* ------------------------------------------------------------ eigenvalues */

/**
 * The eigenvalues and eigenvectors of a square matrix. Each entry of `pairs` is one distinct eigenvalue:
 * `value` (a rational when it is one, else a decimal) or, for a complex pair, `re` and `im` with no vectors.
 * `multiplicity` is the algebraic multiplicity. `vectors` is a basis of the eigenspace, as arrays of scalars,
 * and `unit` holds the same directions as unit-length decimals, ready to draw.
 */
export class Eigen {
  constructor(pairs, size) {
    this.pairs = pairs;
    this.size = size;
  }

  get hasComplex() {
    return this.pairs.some((p) => p.value === null);
  }
}

const noEigen = (what) => {
  throw new LinalgError(
    `${what} is a list of eigenvalues and eigenvectors. Use eigenvalues(A) or eigenvectors(A) in a calculation.`,
  );
};

const isEigen = (x) => x instanceof Eigen;

/** Coefficients of det(xI - A), lowest power first, by the Faddeev-LeVerrier recurrence (exact for rational entries). */
function charPoly(A) {
  const n = A.rows;
  let M = zeros(n, n);
  const c = new Array(n + 1);
  c[n] = q(1);
  for (let k = 1; k <= n; k += 1) {
    M = matAdd(matMul(A, M), scale(identity(n), c[n - k + 1]));
    c[n - k] = neg(div(trace(matMul(A, M)), q(k)));
  }
  return c;
}

const polyTrim = (p) => {
  const out = [...p];
  while (out.length > 1 && isZero(out[out.length - 1])) out.pop();
  return out;
};
const polyDeg = (p) => (p.length === 1 && isZero(p[0]) ? -1 : p.length - 1);
const polyDeriv = (p) => polyTrim(p.length <= 1 ? [q(0)] : p.slice(1).map((x, i) => mul(x, q(i + 1))));
const polySub = (a, b) =>
  polyTrim(Array.from({ length: Math.max(a.length, b.length) }, (_, i) => sub(a[i] ?? q(0), b[i] ?? q(0))));

function polyDivMod(a, b) {
  let r = polyTrim(a);
  const quotient = Array.from({ length: Math.max(1, a.length - b.length + 1) }, () => q(0));
  const lead = b[b.length - 1];
  while (polyDeg(r) >= polyDeg(b) && polyDeg(r) >= 0) {
    const shift = r.length - b.length;
    const f = div(r[r.length - 1], lead);
    quotient[shift] = f;
    for (let i = 0; i < b.length; i += 1) r[i + shift] = sub(r[i + shift], mul(f, b[i]));
    r.pop();
    if (r.length === 0) r.push(q(0));
    r = polyTrim(r);
  }
  return { q: polyTrim(quotient), r };
}

function polyGcd(a, b) {
  let x = polyTrim(a);
  let y = polyTrim(b);
  while (polyDeg(y) >= 0) [x, y] = [y, polyDivMod(x, y).r];
  const lead = x[x.length - 1];
  return x.map((c) => div(c, lead));
}

/** Split a polynomial with rational coefficients into squarefree factors, each with its multiplicity (Yun's method). */
function squarefreeFactors(p) {
  const dp = polyDeriv(p);
  const g = polyGcd(p, dp);
  let b = polyDivMod(p, g).q;
  let d = polySub(polyDivMod(dp, g).q, polyDeriv(b));
  const out = [];
  for (let i = 1; polyDeg(b) > 0 && i <= 12; i += 1) {
    const a = polyGcd(b, d);
    if (polyDeg(a) > 0) out.push({ poly: a, mult: i });
    b = polyDivMod(b, a).q;
    d = polySub(polyDivMod(d, a).q, polyDeriv(b));
  }
  return out;
}

const polyEvalExact = (p, x) => p.reduceRight((acc, c) => add(mul(acc, x), c), q(0));

/** All complex roots of a polynomial (lowest power first, decimals) by Durand-Kerner, as [re, im] pairs. */
function numericRoots(coefficients) {
  const c = coefficients.map(toNumber);
  const n = c.length - 1;
  if (n < 1) return [];
  const lead = c[n];
  const p = c.map((x) => x / lead);
  const radius = 1 + Math.max(...p.slice(0, n).map(Math.abs));
  let z = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4;
    return [(radius / 2) * Math.cos(angle), (radius / 2) * Math.sin(angle)];
  });
  const evalAt = ([re, im]) => {
    let r = 1;
    let i = 0;
    for (let k = n - 1; k >= 0; k -= 1) [r, i] = [r * re - i * im + p[k], r * im + i * re];
    return [r, i];
  };
  for (let iter = 0; iter < 800; iter += 1) {
    let moved = 0;
    z = z.map((zk, k) => {
      const [pr, pi] = evalAt(zk);
      let dr = 1;
      let di = 0;
      z.forEach((zj, j) => {
        if (j === k) return;
        const er = zk[0] - zj[0];
        const ei = zk[1] - zj[1];
        [dr, di] = [dr * er - di * ei, dr * ei + di * er];
      });
      const den = dr * dr + di * di || 1e-300;
      const sr = (pr * dr + pi * di) / den;
      const si = (pi * dr - pr * di) / den;
      moved = Math.max(moved, Math.hypot(sr, si));
      return [zk[0] - sr, zk[1] - si];
    });
    if (moved < 1e-15 * radius) break;
  }
  return z;
}

/** A simple fraction equal to `x` if there is one with a small denominator that makes `poly` exactly zero. */
function exactRoot(poly, x) {
  let [h0, h1, k0, k1] = [1n, BigInt(Math.floor(x)), 0n, 1n];
  let rest = x - Math.floor(x);
  for (let i = 0; i < 24; i += 1) {
    if (k1 > 1_000_000n) break;
    const candidate = new Q(h1, k1);
    // The candidate must be near x as well as a root: 1 is a root too when x is 1.99999999.
    if (Math.abs(toNumber(candidate) - x) < 1e-6 * (1 + Math.abs(x)) && isZero(polyEvalExact(poly, candidate))) {
      return candidate;
    }
    if (rest < 1e-12) break;
    const inverse = 1 / rest;
    const a = BigInt(Math.floor(inverse));
    rest = inverse - Math.floor(inverse);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
  }
  return null;
}

/** A basis of the null space of B. Exact for rational B; otherwise unit vectors found with a tolerance. */
function nullSpace(B) {
  const n = B.cols;
  const exact = B.a.every((row) => row.every(isQ));
  const scaleMax = Math.max(1e-12, ...B.a.flat().map((x) => Math.abs(toNumber(x))));
  let R;
  let pivots;
  if (exact) {
    ({ matrix: R, pivots } = rref(B));
  } else {
    const m = B.a.map((row) => row.map(toNumber));
    pivots = [];
    let r = 0;
    const tol = 1e-8 * scaleMax;
    for (let c = 0; c < n && r < B.rows; c += 1) {
      let best = r;
      for (let i = r; i < B.rows; i += 1) if (Math.abs(m[i][c]) > Math.abs(m[best][c])) best = i;
      if (Math.abs(m[best][c]) <= tol) continue;
      [m[best], m[r]] = [m[r], m[best]];
      const pv = m[r][c];
      m[r] = m[r].map((x) => x / pv);
      for (let i = 0; i < B.rows; i += 1) {
        if (i === r) continue;
        const f = m[i][c];
        m[i] = m[i].map((x, j) => x - f * m[r][j]);
      }
      pivots.push(c);
      r += 1;
    }
    R = new Matrix(m);
  }
  const free = Array.from({ length: n }, (_, i) => i).filter((i) => !pivots.includes(i));
  return free.map((f) => {
    const v = new Array(n).fill(exact ? q(0) : 0);
    v[f] = exact ? q(1) : 1;
    pivots.forEach((pc, row) => {
      v[pc] = exact ? neg(R.a[row][f]) : -R.a[row][f];
    });
    return v;
  });
}

/** Clear denominators and common factors, and make the first nonzero entry positive. */
function tidyExact(v) {
  let lcm = 1n;
  for (const x of v) lcm = (lcm / bigGcd(lcm, x.d)) * x.d;
  let ints = v.map((x) => (x.n * lcm) / x.d);
  const g = ints.reduce((acc, x) => bigGcd(acc, x), 0n) || 1n;
  ints = ints.map((x) => x / g);
  const first = ints.find((x) => x !== 0n) ?? 1n;
  return ints.map((x) => new Q(first < 0n ? -x : x, 1n));
}

function tidyFloat(v) {
  const length = Math.hypot(...v) || 1;
  const first = v.find((x) => Math.abs(x) > 1e-9) ?? 1;
  return v.map((x) => (first < 0 ? -x : x) / length);
}

/** Eigenvalues, with multiplicities, and an eigenvector basis for each real one. */
export function eigen(A) {
  if (!A.isSquare) throw new LinalgError(`Only a square matrix has eigenvalues, but this one is ${A.shape}.`);
  if (A.rows > MAX_DIM) throw new LinalgError(`Eigenvalues are limited to ${MAX_DIM} by ${MAX_DIM} matrices.`);
  const n = A.rows;
  const poly = charPoly(A);
  const roots = []; // { re, im, mult, exact: Q | null }
  if (poly.every(isQ)) {
    for (const { poly: f, mult } of squarefreeFactors(poly)) {
      if (polyDeg(f) === 1) {
        roots.push({ re: toNumber(neg(f[0])), im: 0, mult, exact: neg(div(f[0], f[1])) });
        continue;
      }
      for (const [re, im] of numericRoots(f)) {
        const real = Math.abs(im) < 1e-9 * (1 + Math.abs(re));
        if (!real && im < 0) continue; // the conjugate stands for the pair
        const exact = real ? exactRoot(f, re) : null;
        roots.push({ re: exact ? toNumber(exact) : re, im: real ? 0 : im, mult, exact });
      }
    }
  } else {
    const found = [];
    for (const [re, im] of numericRoots(poly)) {
      const real = Math.abs(im) < 1e-7 * (1 + Math.abs(re));
      if (!real && im < 0) continue;
      const same = found.find((r) => Math.abs(r.re - re) < 1e-5 && Math.abs(r.im - (real ? 0 : im)) < 1e-5);
      if (same) same.mult += 1;
      else found.push({ re: real ? re : re, im: real ? 0 : im, mult: 1, exact: null });
    }
    roots.push(...found);
  }
  roots.sort((a, b) => (a.im !== 0) - (b.im !== 0) || b.re - a.re);
  const pairs = roots.map((r) => {
    if (r.im !== 0) return { value: null, re: r.re, im: r.im, multiplicity: r.mult, vectors: [], unit: [] };
    const value = r.exact ?? r.re;
    const B = new Matrix(A.a.map((row, i) => row.map((x, j) => (i === j ? sub(x, value) : x))));
    const basis = nullSpace(B);
    const vectors = basis.map((v) => (v.every(isQ) ? tidyExact(v) : tidyFloat(v.map(toNumber))));
    return {
      value,
      re: r.re,
      im: 0,
      multiplicity: r.mult,
      vectors,
      unit: vectors.map((v) => tidyFloat(v.map(toNumber))),
    };
  });
  return new Eigen(pairs, n);
}

const complexText = (p) => `${formatScalar(p.re)} \u00b1 ${formatScalar(Math.abs(p.im))}i`;

function realEigen(A, name) {
  const e = eigen(needMatrix(A, name));
  if (e.hasComplex) {
    const pair = e.pairs.find((p) => p.value === null);
    throw new LinalgError(
      `This matrix has complex eigenvalues (${complexText(pair)}), so ${name} cannot give real answers.`,
    );
  }
  return e;
}

function eigenvaluesOf(A) {
  const e = realEigen(A, 'eigenvalues');
  const list = e.pairs.flatMap((p) => Array.from({ length: p.multiplicity }, () => p.value));
  return new Matrix(list.map((x) => [x]));
}

function eigenvectorsOf(A) {
  const e = realEigen(A, 'eigenvectors');
  const columns = e.pairs.flatMap((p) => p.vectors);
  if (columns.length === 0) throw new LinalgError('This matrix has no real eigenvectors.');
  return new Matrix(Array.from({ length: e.size }, (_, i) => columns.map((v) => v[i])));
}

const FUNCTIONS = {
  det: [1, (A) => det(needMatrix(A, 'det'))],
  tr: [1, (A) => trace(needMatrix(A, 'tr'))],
  trace: [1, (A) => trace(needMatrix(A, 'trace'))],
  inv: [1, (A) => inverse(needMatrix(A, 'inv'))],
  transpose: [1, (A) => transpose(needMatrix(A, 'transpose'))],
  rank: [1, (A) => q(rank(needMatrix(A, 'rank')))],
  rref: [1, (A) => rref(needMatrix(A, 'rref')).matrix],
  norm: [1, (A) => norm(needMatrix(A, 'norm'))],
  eig: [1, (A) => eigen(needMatrix(A, 'eig'))],
  eigenvalues: [1, eigenvaluesOf],
  eigenvectors: [1, eigenvectorsOf],
  dot: [2, (u, v) => dot(needMatrix(u, 'dot'), needMatrix(v, 'dot'))],
  cross: [2, (u, v) => cross(needMatrix(u, 'cross'), needMatrix(v, 'cross'))],
  solve: [2, (A, b) => solve(needMatrix(A, 'solve'), needMatrix(b, 'solve'))],
  identity: [1, (n) => identity(intArg(n, 'identity'))],
  zeros: [2, (r, c) => zeros(intArg(r, 'zeros'), intArg(c, 'zeros'))],
  sqrt: [1, (x) => (isMatrix(x) ? sqrt(asScalar(x, 'sqrt')) : sqrt(x))],
  abs: [
    1,
    (x) =>
      isQ(asScalar(x, 'abs'))
        ? new Q(asScalar(x, 'abs').n < 0n ? -asScalar(x, 'abs').n : asScalar(x, 'abs').n, asScalar(x, 'abs').d)
        : Math.abs(asScalar(x, 'abs')),
  ],
  sin: [1, applyScalarFn('sin', Math.sin)],
  cos: [1, applyScalarFn('cos', Math.cos)],
  tan: [1, applyScalarFn('tan', Math.tan)],
  exp: [1, applyScalarFn('exp', Math.exp)],
  ln: [1, applyScalarFn('ln', (x) => (x > 0 ? Math.log(x) : fail('ln needs a positive number.')))],
};

function fail(message) {
  throw new LinalgError(message);
}

function needMatrix(v, name) {
  if (isEigen(v)) noEigen(name);
  if (!isMatrix(v)) throw new LinalgError(`${name} needs a matrix or vector, but got a number.`);
  return v;
}

class Evaluator {
  constructor(source, scope) {
    if (source.length > MAX_EXPR) throw new LinalgError('This line is too long.');
    this.tokens = tokenize(source);
    this.i = 0;
    this.scope = scope;
    this.depth = 0;
  }

  peek(k = 0) {
    return this.tokens[this.i + k] ?? null;
  }

  isOp(s, k = 0) {
    const t = this.peek(k);
    return t !== null && t.k === 'op' && t.s === s;
  }

  expectOp(s) {
    if (!this.isOp(s))
      throw new LinalgError(
        `Expected "${s}"${this.peek() ? `, found "${this.peek().s}"` : ' at the end of the line'}.`,
      );
    this.i += 1;
  }

  run() {
    if (this.tokens.length === 0) throw new LinalgError('Type a calculation.');
    const value = this.sum();
    if (this.peek()) throw new LinalgError(`Unexpected "${this.peek().s}".`);
    return value;
  }

  nested(fn) {
    this.depth += 1;
    try {
      if (this.depth > MAX_DEPTH) throw new LinalgError('This line is nested too deeply.');
      return fn();
    } finally {
      this.depth -= 1;
    }
  }

  sum() {
    return this.nested(() => {
      let left = this.product();
      while (this.isOp('+') || this.isOp('-')) {
        const op = this.peek().s;
        this.i += 1;
        const right = this.product();
        left = combine(op, left, right);
      }
      return left;
    });
  }

  startsOperand() {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'num' || t.k === 'id') return true;
    return t.k === 'op' && (t.s === '(' || t.s === '[');
  }

  product() {
    let left = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = this.peek().s;
        this.i += 1;
        left = combine(op, left, this.unary());
      } else if (this.startsOperand()) {
        left = combine('*', left, this.unary());
      } else break;
    }
    return left;
  }

  unary() {
    return this.nested(() => {
      if (this.isOp('-')) {
        this.i += 1;
        return negate(this.unary());
      }
      if (this.isOp('+')) {
        this.i += 1;
        return this.unary();
      }
      return this.power();
    });
  }

  power() {
    let base = this.postfix();
    if (this.isOp('^')) {
      this.i += 1;
      const t = this.peek();
      if (t && t.k === 'id' && (t.s === 'T' || t.s === 'transpose') && isMatrix(base)) {
        this.i += 1;
        return transpose(base);
      }
      const exponent = this.nested(() => (this.isOp('-') ? (this.i++, negate(this.postfix())) : this.postfix()));
      base = raise(base, exponent);
    }
    return base;
  }

  postfix() {
    let value = this.primary();
    while (this.isOp("'")) {
      this.i += 1;
      value = transpose(needMatrix(value, "The transpose mark '"));
    }
    return value;
  }

  primary() {
    const t = this.peek();
    if (!t) throw new LinalgError('The calculation ends too soon. Add a value after the last operator.');
    if (t.k === 'num') {
      this.i += 1;
      return numberToScalar(t.s);
    }
    if (t.k === 'op' && t.s === '(') {
      this.i += 1;
      const inner = this.sum();
      this.expectOp(')');
      return inner;
    }
    if (t.k === 'op' && t.s === '[') return this.literal();
    if (t.k === 'id') return this.name(t);
    throw new LinalgError(`Unexpected "${t.s}". Use a number, a name, or a bracketed expression.`);
  }

  literal() {
    this.expectOp('[');
    const items = [];
    if (!this.isOp(']')) {
      items.push(this.item());
      while (this.isOp(',')) {
        this.i += 1;
        items.push(this.item());
      }
    }
    this.expectOp(']');
    if (items.length === 0) throw new LinalgError('A matrix needs at least one entry.');
    if (items.every((x) => x.row)) {
      const width = items[0].row.length;
      if (items.some((x) => x.row.length !== width))
        throw new LinalgError('Every row of a matrix must have the same number of entries.');
      return new Matrix(items.map((x) => x.row));
    }
    if (items.some((x) => x.row))
      throw new LinalgError('Write either [[1, 2], [3, 4]] for a matrix or [1, 2, 3] for a column vector.');
    return new Matrix(items.map((x) => [x.value]));
  }

  item() {
    if (this.isOp('[')) {
      this.i += 1;
      const row = [this.sum()];
      while (this.isOp(',')) {
        this.i += 1;
        row.push(this.sum());
      }
      this.expectOp(']');
      return { row: row.map((x) => asScalar(x, 'A matrix entry')) };
    }
    return { value: asScalar(this.sum(), 'A matrix entry') };
  }

  name(t) {
    this.i += 1;
    const name = t.s;
    if (this.isOp('(') && Object.hasOwn(FUNCTIONS, name) && !this.scope.has(name)) {
      this.i += 1;
      const args = [];
      if (!this.isOp(')')) {
        args.push(this.sum());
        while (this.isOp(',')) {
          this.i += 1;
          args.push(this.sum());
        }
      }
      this.expectOp(')');
      const [arity, fn] = FUNCTIONS[name];
      if (args.length !== arity)
        throw new LinalgError(`${name} takes ${arity} argument${arity === 1 ? '' : 's'}, but got ${args.length}.`);
      return fn(...args);
    }
    if (this.scope.has(name)) return this.scope.get(name);
    if (name === 'pi') return Math.PI;
    if (name === 'diag' && this.isOp('(')) {
      this.i += 1;
      const entries = [this.sum()];
      while (this.isOp(',')) {
        this.i += 1;
        entries.push(this.sum());
      }
      this.expectOp(')');
      const values =
        entries.length === 1 && isMatrix(entries[0])
          ? asVector(entries[0], 'diag')
          : entries.map((x) => asScalar(x, 'diag'));
      return build(values.length, values.length, (i, j) => (i === j ? values[i] : q(0)));
    }
    if (Object.hasOwn(FUNCTIONS, name)) throw new LinalgError(`${name} needs brackets, like ${name}(A).`);
    // "AB" with no AB defined, but A and B defined: read it as A times B.
    const letters = [...name];
    if (letters.length > 1 && letters.every((l) => this.scope.has(l))) {
      return letters.map((l) => this.scope.get(l)).reduce((acc, v) => combine('*', acc, v));
    }
    throw new LinalgError(`"${name}" is not defined. Define it on an earlier line.`);
  }
}

function negate(v) {
  if (isEigen(v)) noEigen('Negation');
  return isMatrix(v) ? map(v, neg) : neg(v);
}

function combine(op, a, b) {
  if (isEigen(a) || isEigen(b)) noEigen('eig(A)');
  const am = isMatrix(a);
  const bm = isMatrix(b);
  if (op === '+' || op === '-') {
    if (am && bm) return matAdd(a, b, op === '+' ? 'add' : 'subtract');
    if (am || bm) {
      throw new LinalgError(
        `Cannot ${op === '+' ? 'add' : 'subtract'} a number and a matrix. Use identity(n) times the number if you mean a multiple of the identity.`,
      );
    }
    return op === '+' ? add(a, b) : sub(a, b);
  }
  if (op === '*') {
    if (am && bm) return matMul(a, b);
    if (am) return scale(a, b);
    if (bm) return scale(b, a);
    return mul(a, b);
  }
  if (bm) throw new LinalgError('Cannot divide by a matrix. Multiply by its inverse instead, like A*inv(B).');
  if (am) return map(a, (x) => div(x, b));
  return div(a, b);
}

function raise(base, exponent) {
  if (isEigen(base)) noEigen('eig(A)');
  const k = asScalar(exponent, 'An exponent');
  const n = toNumber(k);
  if (isMatrix(base)) {
    if (!base.isSquare)
      throw new LinalgError(`Only a square matrix can be raised to a power, but this one is ${base.shape}.`);
    if (!Number.isInteger(n)) throw new LinalgError('A matrix can only be raised to a whole-number power.');
    if (Math.abs(n) > MAX_POWER) throw new LinalgError(`Powers of matrices are limited to ${MAX_POWER}.`);
    let result = identity(base.rows);
    let factor = n < 0 ? inverse(base) : base;
    for (let e = Math.abs(n); e > 0; e = Math.floor(e / 2)) {
      if (e % 2 === 1) result = matMul(result, factor);
      if (e > 1) factor = matMul(factor, factor);
    }
    return result;
  }
  if (isQ(base) && Number.isInteger(n)) {
    if (n < 0 && isZero(base)) throw new LinalgError('Zero cannot be raised to a negative power.');
    return pow(base, n);
  }
  const value = Math.pow(toNumber(base), n);
  if (Number.isNaN(value)) throw new LinalgError('That power is not a real number.');
  return value;
}

/** Evaluate one expression against `scope` (a Map of name to scalar or Matrix). */
export function evaluate(source, scope = new Map()) {
  const value = new Evaluator(String(source), scope).run();
  if (isMatrix(value)) {
    if (value.rows > MAX_DIM * 4 || value.cols > MAX_DIM * 4)
      throw new LinalgError('That matrix is too large to show.');
  } else if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new LinalgError('The result is not a finite number.');
  }
  return value;
}

const ASSIGN = /^\s*([\p{L}][\p{L}\p{N}_]*)\s*=(?!=)\s*([\s\S]*)$/u;

/**
 * Evaluate a whole sheet in order.
 * @param {{ id: string, kind: 'matrix' | 'expr', name?: string, text?: string, cells?: string[][] }[]} lines
 * @returns {{ id: string, name: string | null, value: any, error: string | null, cellErrors: Map<string, string> }[]}
 */
export function evaluateLines(lines) {
  const scope = new Map();
  const broken = new Set();
  return lines.map((line) => {
    const result = { id: line.id, name: null, value: null, error: null, cellErrors: new Map() };
    try {
      if (line.kind === 'matrix') {
        const name = String(line.name ?? '').trim();
        result.name = name || null;
        const data = line.cells.map((row, i) =>
          row.map((text, j) => {
            try {
              const raw = evaluate(text, scope);
              return asScalar(raw, 'A matrix entry');
            } catch (error) {
              if (!(error instanceof LinalgError)) throw error;
              result.cellErrors.set(`${i},${j}`, error.message);
              return q(0);
            }
          }),
        );
        const matrix = new Matrix(data);
        result.value = matrix;
        if (result.cellErrors.size > 0) {
          result.error = `${name || 'This matrix'} has ${result.cellErrors.size === 1 ? 'an entry' : 'entries'} that cannot be read. Enter numbers like 3, -1/2, or sqrt(2).`;
          if (name) broken.add(name);
        } else if (name) {
          if (!/^[\p{L}][\p{L}\p{N}_]*$/u.test(name)) {
            result.error = 'A name starts with a letter and uses only letters, digits, and underscores.';
          } else {
            scope.set(name, matrix);
            broken.delete(name);
          }
        }
        return result;
      }
      const text = String(line.text ?? '');
      if (text.trim() === '') return result;
      const assign = ASSIGN.exec(text);
      const body = assign ? assign[2] : text;
      let value;
      try {
        value = evaluate(body, scope);
      } catch (error) {
        const missing = /^"(.+)" is not defined/.exec(error.message ?? '');
        if (missing && broken.has(missing[1])) {
          throw new LinalgError(`${missing[1]} has an entry that cannot be read. Fix that matrix first.`);
        }
        throw error;
      }
      result.value = value;
      if (assign) {
        result.name = assign[1];
        if (Object.hasOwn(FUNCTIONS, assign[1]) || assign[1] === 'pi')
          throw new LinalgError(`"${assign[1]}" is built in, so it cannot be used as a name.`);
        scope.set(assign[1], value);
        broken.delete(assign[1]);
      }
    } catch (error) {
      if (!(error instanceof LinalgError)) throw error;
      result.error = error.message;
      result.value = null;
    }
    return result;
  });
}
