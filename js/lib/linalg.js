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

const FUNCTIONS = {
  det: [1, (A) => det(needMatrix(A, 'det'))],
  tr: [1, (A) => trace(needMatrix(A, 'tr'))],
  trace: [1, (A) => trace(needMatrix(A, 'trace'))],
  inv: [1, (A) => inverse(needMatrix(A, 'inv'))],
  transpose: [1, (A) => transpose(needMatrix(A, 'transpose'))],
  rank: [1, (A) => q(rank(needMatrix(A, 'rank')))],
  rref: [1, (A) => rref(needMatrix(A, 'rref')).matrix],
  norm: [1, (A) => norm(needMatrix(A, 'norm'))],
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
  return isMatrix(v) ? map(v, neg) : neg(v);
}

function combine(op, a, b) {
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
