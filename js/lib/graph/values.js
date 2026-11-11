/**
 * Values of the graphing language: numbers, points, and lists of either.
 *
 * Arithmetic and functions broadcast over lists the way Desmos does: a scalar
 * is combined with every element, and two lists must have the same length.
 */

export const MAX_LIST = 10000;

/** A runtime error with a message that says how to fix the expression. */
export class GraphEvalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GraphEvalError';
  }
}

export class Point {
  /** `z` is only set for points in the 3D graph. */
  constructor(x, y, z = undefined) {
    this.x = x;
    this.y = y;
    if (z !== undefined) this.z = z;
  }
}

export const isPoint = (v) => v instanceof Point;

export function kindOf(v) {
  if (typeof v === 'number') return 'number';
  if (v instanceof Point) return 'point';
  if (Array.isArray(v)) return 'list';
  return 'unknown';
}

/* ------------------------------------------------------------- scalar math */

const ODD_DENOMINATOR_LIMIT = 99;

/** Smallest denominator d <= 99 with b = n/d, or 0 when b is not a small fraction. */
function denominatorOf(b) {
  for (let d = 1; d <= ODD_DENOMINATOR_LIMIT; d += 1) {
    const scaled = b * d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return d;
  }
  return 0;
}

/**
 * Power with real results for negative bases and odd-denominator exponents,
 * so (-8)^(1/3) is -2 and x^(2/3) is defined for negative x.
 */
export function realPow(a, b) {
  if (a < 0 && Number.isFinite(b) && !Number.isInteger(b)) {
    const d = denominatorOf(b);
    if (d === 0 || d % 2 === 0) return NaN;
    const magnitude = Math.pow(-a, b);
    return Math.round(b * d) % 2 === 0 ? magnitude : -magnitude;
  }
  return Math.pow(a, b);
}

export function nthRoot(n, x) {
  if (!Number.isFinite(n) || n === 0) return NaN;
  if (x >= 0) return Math.pow(x, 1 / n);
  return Number.isInteger(n) && Math.abs(n) % 2 === 1 ? -Math.pow(-x, 1 / n) : NaN;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const w = z - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i += 1) sum += LANCZOS[i] / (w + i);
  const t = w + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, w + 0.5) * Math.exp(-t) * sum;
}

export function factorial(n) {
  if (!Number.isFinite(n)) return NaN;
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let result = 1;
    for (let i = 2; i <= n; i += 1) result *= i;
    return result;
  }
  return gamma(n + 1);
}

export function gcd(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return NaN;
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

export function lcm(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return NaN;
  if (a === 0 || b === 0) return 0;
  return Math.abs(a * b) / gcd(a, b);
}

export function nCr(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) return NaN;
  const m = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= m; i += 1) result = (result * (n - m + i)) / i;
  return Math.round(result);
}

export function nPr(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || k > n) return NaN;
  let result = 1;
  for (let i = 0; i < k; i += 1) result *= n - i;
  return result;
}

export function roundTo(x, digits) {
  if (digits === undefined) return Math.round(x);
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) return NaN;
  const scale = 10 ** digits;
  return Math.round(x * scale) / scale;
}

/** sin and cos of an angle in degrees, exact at multiples of 90. */
export function sinDeg(d) {
  const r = ((d % 360) + 360) % 360;
  if (r === 0 || r === 180) return 0;
  if (r === 90) return 1;
  if (r === 270) return -1;
  return Math.sin((r * Math.PI) / 180);
}

export function cosDeg(d) {
  const r = ((d % 360) + 360) % 360;
  if (r === 90 || r === 270) return 0;
  if (r === 0) return 1;
  if (r === 180) return -1;
  return Math.cos((r * Math.PI) / 180);
}

export function tanDeg(d) {
  const r = ((d % 180) + 180) % 180;
  if (r === 0) return 0;
  if (r === 90) return NaN;
  return Math.tan((r * Math.PI) / 180);
}

/* ---------------------------------------------------------------- broadcast */

function scalarOp(op, a, b) {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    default:
      return realPow(a, b);
  }
}

const movePoint = (a, b, sign) =>
  new Point(a.x + sign * b.x, a.y + sign * b.y, a.z === undefined ? undefined : a.z + sign * b.z);
const scalePoint = (p, k) => new Point(p.x * k, p.y * k, p.z === undefined ? undefined : p.z * k);

function pointOp(op, a, b) {
  const pa = a instanceof Point;
  const pb = b instanceof Point;
  if (pa && pb) {
    if ((a.z === undefined) !== (b.z === undefined)) {
      throw new GraphEvalError('A 2D point and a 3D point cannot be combined.');
    }
    if (op === '+') return movePoint(a, b, 1);
    if (op === '-') return movePoint(a, b, -1);
    throw new GraphEvalError(
      `Two points cannot be combined with "${op}". Add or subtract them, or multiply one by a number.`,
    );
  }
  if (pa && typeof b === 'number') {
    if (op === '*') return scalePoint(a, b);
    if (op === '/') return scalePoint(a, 1 / b);
  }
  if (pb && typeof a === 'number' && op === '*') return scalePoint(b, a);
  throw new GraphEvalError(
    `A point cannot be used with "${op}" here. Multiply or divide a point by a number, or add two points.`,
  );
}

/** Apply a binary operator to numbers, points, and lists. */
export function arith(op, a, b) {
  if (typeof a === 'number' && typeof b === 'number') return scalarOp(op, a, b);
  const la = Array.isArray(a);
  const lb = Array.isArray(b);
  if (la && lb) {
    if (a.length !== b.length) {
      throw new GraphEvalError(`Lists must have the same length to be combined (${a.length} and ${b.length}).`);
    }
    return a.map((v, i) => arith(op, v, b[i]));
  }
  if (la) return a.map((v) => arith(op, v, b));
  if (lb) return b.map((v) => arith(op, a, v));
  return pointOp(op, a, b);
}

export function negate(v) {
  if (typeof v === 'number') return -v;
  if (v instanceof Point) return scalePoint(v, -1);
  if (Array.isArray(v)) return v.map(negate);
  throw new GraphEvalError('Only numbers, points, and lists can be negated.');
}

/** Apply a one-number function to a number or every element of a list. */
export function mapNumbers(name, fn, v) {
  if (typeof v === 'number') return fn(v);
  if (Array.isArray(v)) return v.map((item) => mapNumbers(name, fn, item));
  throw new GraphEvalError(`${name}() needs numbers, not a ${kindOf(v)}.`);
}

/** Apply a two-number function with list broadcasting. */
export function mapNumbers2(name, fn, a, b) {
  if (typeof a === 'number' && typeof b === 'number') return fn(a, b);
  const la = Array.isArray(a);
  const lb = Array.isArray(b);
  if (la && lb) {
    if (a.length !== b.length) {
      throw new GraphEvalError(`${name}() needs lists of the same length (${a.length} and ${b.length}).`);
    }
    return a.map((v, i) => mapNumbers2(name, fn, v, b[i]));
  }
  if (la) return a.map((v) => mapNumbers2(name, fn, v, b));
  if (lb) return b.map((v) => mapNumbers2(name, fn, a, v));
  throw new GraphEvalError(`${name}() needs numbers, not a ${kindOf(a)} and a ${kindOf(b)}.`);
}

/** Call fn once per element when any argument is a list; scalars are repeated. */
export function broadcastCall(name, fn, args) {
  let length = -1;
  for (const v of args) {
    if (!Array.isArray(v)) continue;
    if (length >= 0 && v.length !== length) {
      throw new GraphEvalError(`${name}() needs lists of the same length.`);
    }
    length = v.length;
  }
  if (length < 0) return fn(args);
  const out = new Array(length);
  for (let i = 0; i < length; i += 1) out[i] = fn(args.map((v) => (Array.isArray(v) ? v[i] : v)));
  return out;
}

/* -------------------------------------------------------------------- lists */

/** Build [start, second ... end]. With no end, `limit` bounds the count. */
export function makeRange(start, second, end) {
  if (typeof start !== 'number' || typeof end !== 'number' || (second !== null && typeof second !== 'number')) {
    throw new GraphEvalError('A list range such as [1...10] needs numbers.');
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const step = second === null ? (end >= start ? 1 : -1) : second - start;
  if (step === 0 || (end - start) * step < 0) return second === null || start === end ? [start] : [];
  const count = Math.floor((end - start) / step + 1e-9) + 1;
  if (count > MAX_LIST) throw new GraphEvalError(`Lists can have at most ${MAX_LIST} items.`);
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = start + step * i;
  return out;
}

/** Flatten list items, ranges, and scalars into one list. */
export function flattenItems(values) {
  const out = [];
  for (const v of values) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
    if (out.length > MAX_LIST) throw new GraphEvalError(`Lists can have at most ${MAX_LIST} items.`);
  }
  return out;
}

/** L[k] for one index, or a sub-list for several. Indices start at 1. */
export function indexList(list, index) {
  if (!Array.isArray(list)) throw new GraphEvalError('Only lists can be indexed with [ ].');
  const pick = (k) => {
    if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > list.length) return NaN;
    return list[k - 1];
  };
  if (typeof index === 'number') return pick(index);
  if (Array.isArray(index)) return index.map(pick);
  throw new GraphEvalError('A list index must be a number or a list of numbers.');
}

function numbersOnly(name, list) {
  if (!Array.isArray(list)) throw new GraphEvalError(`${name}() needs a list.`);
  for (const v of list) {
    if (typeof v !== 'number') throw new GraphEvalError(`${name}() needs a list of numbers.`);
  }
  return list;
}

export function total(list) {
  if (!Array.isArray(list)) throw new GraphEvalError('total() needs a list.');
  if (list.length === 0) return 0;
  let acc = list[0];
  for (let i = 1; i < list.length; i += 1) acc = arith('+', acc, list[i]);
  return acc;
}

export const listLength = (list) => {
  if (!Array.isArray(list)) throw new GraphEvalError('length() needs a list.');
  return list.length;
};

export function mean(list) {
  const nums = numbersOnly('mean', list);
  return nums.length === 0 ? NaN : nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function median(list) {
  const nums = [...numbersOnly('median', list)].sort((a, b) => a - b);
  if (nums.length === 0) return NaN;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function sumSquares(nums) {
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((acc, v) => acc + (v - m) * (v - m), 0);
}

/** Sample standard deviation (divides by n - 1). */
export function stdev(list) {
  const nums = numbersOnly('stdev', list);
  return nums.length < 2 ? NaN : Math.sqrt(sumSquares(nums) / (nums.length - 1));
}

/** Population standard deviation (divides by n). */
export function stdevp(list) {
  const nums = numbersOnly('stdevp', list);
  return nums.length === 0 ? NaN : Math.sqrt(sumSquares(nums) / nums.length);
}

export function listMin(list) {
  const nums = numbersOnly('min', list);
  return nums.length === 0 ? NaN : Math.min(...nums);
}

export function listMax(list) {
  const nums = numbersOnly('max', list);
  return nums.length === 0 ? NaN : Math.max(...nums);
}

export function sortList(list) {
  return [...numbersOnly('sort', list)].sort((a, b) => a - b);
}

export function uniqueList(list) {
  if (!Array.isArray(list)) throw new GraphEvalError('unique() needs a list.');
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const key = v instanceof Point ? `${v.x},${v.y}` : v;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function joinLists(lists) {
  return flattenItems(lists);
}

/* --------------------------------------------------------------- formatting */

/** Format a number with up to `digits` significant digits and no trailing zeros. */
export function formatNumber(n, digits = 10) {
  if (Number.isNaN(n)) return 'undefined';
  if (!Number.isFinite(n)) return n > 0 ? '\u221e' : '-\u221e';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) {
    return n
      .toExponential(digits - 1)
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  }
  return String(Number(n.toPrecision(digits)));
}

/** Format any value for display, shortening long lists. */
export function formatValue(v, maxItems = 8) {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Point) {
    const z = v.z === undefined ? '' : `, ${formatNumber(v.z)}`;
    return `(${formatNumber(v.x)}, ${formatNumber(v.y)}${z})`;
  }
  if (Array.isArray(v)) {
    const shown = v.slice(0, maxItems).map((item) => formatValue(item, maxItems));
    const more = v.length > maxItems ? `, \u2026 (${v.length} items)` : '';
    return `[${shown.join(', ')}${more}]`;
  }
  return 'undefined';
}
