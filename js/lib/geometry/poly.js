/**
 * Exact algebra for the geometry engine.
 *
 * `Poly` is a sparse multivariate polynomial with BigInt coefficients. Nothing
 * here uses floating point, so "this is zero" always means zero. A "ring" is a
 * small object of arithmetic functions; the engine is written once against that
 * interface and runs over `PolyRing` (symbolic, for proofs) and `IntRing`
 * (exact integers, for one concrete figure).
 */

/** Most terms any one polynomial may have before the engine gives up honestly. */
export const MAX_TERMS = 60000;
/** Most term-pair products one multiplication may attempt. */
const MAX_WORK = 6_000_000;

export class ComplexityError extends Error {
  constructor(message = 'This needs more algebra than Clover can do in the browser.') {
    super(message);
    this.name = 'ComplexityError';
  }
}

/* A monomial is a string of (variable, exponent) character pairs sorted by variable. */
function mulMono(a, b) {
  if (a === '') return b;
  if (b === '') return a;
  let i = 0;
  let j = 0;
  let out = '';
  while (i < a.length && j < b.length) {
    const va = a.charCodeAt(i);
    const vb = b.charCodeAt(j);
    if (va < vb) {
      out += a.slice(i, i + 2);
      i += 2;
    } else if (va > vb) {
      out += b.slice(j, j + 2);
      j += 2;
    } else {
      out += String.fromCharCode(va, a.charCodeAt(i + 1) + b.charCodeAt(j + 1));
      i += 2;
      j += 2;
    }
  }
  return out + a.slice(i) + b.slice(j);
}

const bigAbs = (n) => (n < 0n ? -n : n);

export function bigGcd(a, b) {
  let x = bigAbs(a);
  let y = bigAbs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export class Poly {
  /** @param {Map<string, bigint>} [terms] */
  constructor(terms = new Map()) {
    this.t = terms;
  }

  static zero() {
    return new Poly();
  }

  static int(n) {
    const value = BigInt(n);
    return value === 0n ? new Poly() : new Poly(new Map([['', value]]));
  }

  static variable(index) {
    return new Poly(new Map([[String.fromCharCode(index, 1), 1n]]));
  }

  isZero() {
    return this.t.size === 0;
  }

  get size() {
    return this.t.size;
  }

  add(other) {
    if (other.t.size === 0) return this;
    if (this.t.size === 0) return other;
    const out = new Map(this.t);
    for (const [key, coef] of other.t) {
      const sum = (out.get(key) ?? 0n) + coef;
      if (sum === 0n) out.delete(key);
      else out.set(key, sum);
    }
    if (out.size > MAX_TERMS) throw new ComplexityError();
    return new Poly(out);
  }

  neg() {
    const out = new Map();
    for (const [key, coef] of this.t) out.set(key, -coef);
    return new Poly(out);
  }

  sub(other) {
    return this.add(other.neg());
  }

  mul(other) {
    if (this.t.size === 0 || other.t.size === 0) return new Poly();
    if (this.t.size * other.t.size > MAX_WORK) throw new ComplexityError();
    const out = new Map();
    for (const [ka, ca] of this.t) {
      for (const [kb, cb] of other.t) {
        const key = mulMono(ka, kb);
        const sum = (out.get(key) ?? 0n) + ca * cb;
        if (sum === 0n) out.delete(key);
        else out.set(key, sum);
      }
    }
    if (out.size > MAX_TERMS) throw new ComplexityError();
    return new Poly(out);
  }

  /**
   * Divide out the integer content and any monomial factor shared by every
   * polynomial in the list. Scaling a whole homogeneous triple does not change
   * the point or line it names, so this only keeps the numbers small.
   */
  static reduce(list) {
    let content = 0n;
    /** @type {Map<number, number> | null} */
    let common = null;
    for (const poly of list) {
      for (const [key, coef] of poly.t) {
        content = bigGcd(content, coef);
        const here = new Map();
        for (let i = 0; i < key.length; i += 2) here.set(key.charCodeAt(i), key.charCodeAt(i + 1));
        if (common === null) common = here;
        else {
          for (const [variable, exp] of [...common]) {
            const other = here.get(variable) ?? 0;
            if (other === 0) common.delete(variable);
            else common.set(variable, Math.min(exp, other));
          }
        }
      }
    }
    if (content === 0n) return list;
    const noMonomial = common === null || common.size === 0;
    if (content === 1n && noMonomial) return list;
    return list.map((poly) => {
      const out = new Map();
      for (const [key, coef] of poly.t) {
        let next = '';
        if (noMonomial) next = key;
        else {
          for (let i = 0; i < key.length; i += 2) {
            const variable = key.charCodeAt(i);
            const exp = key.charCodeAt(i + 1) - (common.get(variable) ?? 0);
            if (exp > 0) next += String.fromCharCode(variable, exp);
          }
        }
        out.set(next, coef / content);
      }
      return new Poly(out);
    });
  }

  /** Human-readable form, with `names[i]` for variable i. */
  toString(names = []) {
    if (this.t.size === 0) return '0';
    const parts = [];
    for (const [key, coef] of this.t) {
      let mono = '';
      for (let i = 0; i < key.length; i += 2) {
        const name = names[key.charCodeAt(i)] ?? `v${key.charCodeAt(i)}`;
        const exp = key.charCodeAt(i + 1);
        mono += exp === 1 ? name : `${name}^${exp}`;
      }
      const sign = coef < 0n ? '-' : '+';
      const mag = bigAbs(coef);
      parts.push(`${sign} ${mono === '' ? mag : mag === 1n ? mono : `${mag}${mono}`}`);
    }
    const text = parts.join(' ');
    return text.startsWith('+ ') ? text.slice(2) : `-${text.slice(2)}`;
  }
}

/** The symbolic ring: every value is a Poly. */
export const PolyRing = {
  name: 'poly',
  zero: () => Poly.zero(),
  int: (n) => Poly.int(n),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  neg: (a) => a.neg(),
  isZero: (a) => a.isZero(),
  reduce: (list) => Poly.reduce(list),
};

/** The numeric ring: exact arbitrary-size integers. */
export const IntRing = {
  name: 'int',
  zero: () => 0n,
  int: (n) => BigInt(n),
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  neg: (a) => -a,
  isZero: (a) => a === 0n,
  reduce: (list) => {
    let g = 0n;
    for (const n of list) g = bigGcd(g, n);
    return g > 1n ? list.map((n) => n / g) : list;
  },
};

/** n / d as a float, safe for integers far beyond the Number range. */
export function ratioToFloat(n, d) {
  if (d === 0n) return NaN;
  if (n === 0n) return 0;
  const sign = n < 0n !== d < 0n ? -1 : 1;
  let a = bigAbs(n);
  let b = bigAbs(d);
  const shift = BigInt(a.toString(2).length - b.toString(2).length);
  // Scale so the integer quotient keeps about 60 bits.
  const scale = 60n - shift;
  if (scale > 0n) a <<= scale;
  else b <<= -scale;
  const q = Number(a / b);
  return sign * q * Math.pow(2, -Number(scale));
}
