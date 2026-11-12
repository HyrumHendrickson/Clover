/**
 * A small computer algebra system that reads Maxima syntax. It is not Maxima: it covers the everyday commands
 * (expand, diff, integrate, solve, subst, ev, factor for integers, float) and says so when asked for more.
 * Numbers are exact rationals until a decimal is requested. Pure, so it is tested without a DOM.
 */
import { Q, add as qAdd, isZero as qIsZero, mul as qMul, pow as qPow, q } from './linalg.js';

export class CasError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CasError';
  }
}

const MAX_LENGTH = 2000;
const MAX_DEPTH = 60;
const MAX_TERMS = 4000;

/* ------------------------------------------------------------- expressions */
/*  { k: 'n', q: Q } exact number     { k: 'f', v } decimal      { k: 's', name } symbol
    { k: '+', a: [...] } sum          { k: '*', a: [...] } product
    { k: '^', b, e } power            { k: 'fn', name, a: [...] } function call
    { k: 'list', a } list             { k: 'eq', l, r } equation   */

const num = (value) => ({ k: 'n', q: value instanceof Q ? value : q(value) });
const flt = (v) => ({ k: 'f', v });
const sym = (name) => ({ k: 's', name });
const ZERO = num(0);
const ONE = num(1);
const isNum = (e) => e.k === 'n';
const isConst = (e) => e.k === 'n' || e.k === 'f';
const isInt = (e) => e.k === 'n' && e.q.d === 1n;
const intValue = (e) => Number(e.q.n);
const valueOf = (e) => (e.k === 'n' ? Number(e.q.n) / Number(e.q.d) : e.v);
const isZeroE = (e) => (e.k === 'n' ? qIsZero(e.q) : e.k === 'f' && e.v === 0);
const isOneE = (e) => (e.k === 'n' ? e.q.n === 1n && e.q.d === 1n : e.k === 'f' && e.v === 1);

const SPECIAL = { '%pi': Math.PI, '%e': Math.E };

/* ------------------------------------------------------------------ parser */

function tokenize(text) {
  const tokens = [];
  const pattern =
    /\s+|(\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)|(%o\d+|%(?![A-Za-z])|%?[A-Za-z_\u00c0-\uffff][A-Za-z0-9_\u00c0-\uffff]*)|(:=|\*\*|<=|>=|#|[-+*/^=<>(),[\];$:!'])|(.)/gy;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m[1] !== undefined) tokens.push({ t: 'num', s: m[1] });
    else if (m[2] !== undefined) tokens.push({ t: 'id', s: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: 'op', s: m[3] === '**' ? '^' : m[3] });
    else if (m[4] !== undefined) throw new CasError(`Unexpected character "${m[4]}".`);
  }
  return tokens;
}

class Parser {
  constructor(text) {
    if (text.length > MAX_LENGTH) throw new CasError('This input is too long.');
    this.tokens = tokenize(text);
    this.i = 0;
    this.depth = 0;
  }

  peek() {
    return this.tokens[this.i] ?? null;
  }

  isOp(s) {
    const t = this.peek();
    return t !== null && t.t === 'op' && t.s === s;
  }

  expect(s) {
    if (!this.isOp(s)) {
      const t = this.peek();
      throw new CasError(`Expected "${s}"${t ? `, found "${t.s}"` : ' at the end of the input'}.`);
    }
    this.i += 1;
  }

  nest(fn) {
    this.depth += 1;
    try {
      if (this.depth > MAX_DEPTH) throw new CasError('This input is nested too deeply.');
      return fn();
    } finally {
      this.depth -= 1;
    }
  }

  /** Statements separated by ; or $. A `$` hides that statement's result. */
  statements() {
    const out = [];
    while (this.peek()) {
      if (this.isOp(';') || this.isOp('$')) {
        this.i += 1;
        continue;
      }
      const expr = this.statement();
      let hidden = false;
      if (this.isOp('$')) {
        hidden = true;
        this.i += 1;
      } else if (this.isOp(';')) this.i += 1;
      else if (this.peek()) throw new CasError(`Unexpected "${this.peek().s}". Separate commands with ; or $.`);
      out.push({ expr, hidden });
    }
    return out;
  }

  statement() {
    const first = this.peek();
    const second = this.tokens[this.i + 1];
    if (first?.t === 'id' && second?.t === 'op' && second.s === ':') {
      this.i += 2;
      return { k: 'assign', name: first.s, value: this.equation() };
    }
    // f(x, y) := body
    if (first?.t === 'id' && second?.s === '(') {
      let j = this.i + 2;
      const params = [];
      let simple = true;
      while (this.tokens[j] && this.tokens[j].s !== ')') {
        if (this.tokens[j].t === 'id') params.push(this.tokens[j].s);
        else if (this.tokens[j].s !== ',') {
          simple = false;
          break;
        }
        j += 1;
      }
      if (simple && this.tokens[j]?.s === ')' && this.tokens[j + 1]?.s === ':=') {
        this.i = j + 2;
        return { k: 'define', name: first.s, params, body: this.equation() };
      }
    }
    return this.equation();
  }

  equation() {
    const left = this.sum();
    if (this.isOp('=')) {
      this.i += 1;
      return { k: 'eq', l: left, r: this.sum() };
    }
    return left;
  }

  sum() {
    return this.nest(() => {
      const terms = [this.product()];
      while (this.isOp('+') || this.isOp('-')) {
        const minus = this.peek().s === '-';
        this.i += 1;
        const next = this.product();
        terms.push(minus ? { k: '*', a: [num(-1), next] } : next);
      }
      return terms.length === 1 ? terms[0] : { k: '+', a: terms };
    });
  }

  product() {
    const factors = [this.unary()];
    for (;;) {
      if (this.isOp('*')) {
        this.i += 1;
        factors.push(this.unary());
      } else if (this.isOp('/')) {
        this.i += 1;
        factors.push({ k: '^', b: this.unary(), e: num(-1) });
      } else break;
    }
    return factors.length === 1 ? factors[0] : { k: '*', a: factors };
  }

  unary() {
    return this.nest(() => {
      if (this.isOp('-')) {
        this.i += 1;
        return { k: '*', a: [num(-1), this.unary()] };
      }
      if (this.isOp('+')) {
        this.i += 1;
        return this.unary();
      }
      return this.power();
    });
  }

  power() {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.i += 1;
      const exponent = this.nest(() =>
        this.isOp('-') ? (this.i++, { k: '*', a: [num(-1), this.powerOperand()] }) : this.powerOperand(),
      );
      return { k: '^', b: base, e: exponent };
    }
    return base;
  }

  powerOperand() {
    return this.power();
  }

  postfix() {
    return this.primary();
  }

  primary() {
    const t = this.peek();
    if (!t) throw new CasError('The input ends too soon. Add a value after the last operator.');
    this.i += 1;
    if (t.t === 'num') {
      if (/^\d+$/.test(t.s)) return num(BigInt(t.s));
      const value = Number(t.s);
      return flt(value);
    }
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.i += 1;
        const args = [];
        if (!this.isOp(')')) {
          args.push(this.equation());
          while (this.isOp(',')) {
            this.i += 1;
            args.push(this.equation());
          }
        }
        this.expect(')');
        return { k: 'fn', name: t.s, a: args };
      }
      return sym(t.s);
    }
    if (t.s === '(') {
      const inner = this.equation();
      this.expect(')');
      return inner;
    }
    if (t.s === '[') {
      const items = [];
      if (!this.isOp(']')) {
        items.push(this.equation());
        while (this.isOp(',')) {
          this.i += 1;
          items.push(this.equation());
        }
      }
      this.expect(']');
      return { k: 'list', a: items };
    }
    throw new CasError(`Unexpected "${t.s}".`);
  }
}

/* ------------------------------------------------------------ simplifying */

const key = (e) => print(e, 0);

/** Split a term into its numeric coefficient and the rest, so 3*x and 5*x can be added. */
function coefficientOf(e) {
  if (isConst(e)) return [e, ONE];
  if (e.k === '*' && isConst(e.a[0])) return [e.a[0], e.a.length === 2 ? e.a[1] : { k: '*', a: e.a.slice(1) }];
  return [ONE, e];
}

function addConst(a, b) {
  if (a.k === 'n' && b.k === 'n') return num(qAdd(a.q, b.q));
  return flt(valueOf(a) + valueOf(b));
}
function mulConst(a, b) {
  if (a.k === 'n' && b.k === 'n') return num(qMul(a.q, b.q));
  return flt(valueOf(a) * valueOf(b));
}

/** The base and exponent of a factor, so x and x^2 combine. */
const baseExp = (e) => (e.k === '^' ? [e.b, e.e] : [e, ONE]);

function simpSum(terms) {
  const flat = [];
  const take = (t) => (t.k === '+' ? t.a.forEach(take) : flat.push(t));
  terms.forEach((t) => take(simp(t)));
  let constant = ZERO;
  const groups = new Map();
  for (const t of flat) {
    if (isConst(t)) constant = addConst(constant, t);
    else {
      const [c, rest] = coefficientOf(t);
      const k = key(rest);
      const g = groups.get(k);
      if (g) g.c = addConst(g.c, c);
      else groups.set(k, { c, rest });
    }
  }
  const out = [];
  for (const { c, rest } of groups.values()) if (!isZeroE(c)) out.push(isOneE(c) ? rest : simpProduct([c, rest]));
  out.sort((a, b) => order(a, b));
  if (!isZeroE(constant)) out.push(constant);
  if (out.length > MAX_TERMS) throw new CasError('The result is too large.');
  return out.length === 0 ? ZERO : out.length === 1 ? out[0] : { k: '+', a: out };
}

function simpProduct(factors) {
  const flat = [];
  const take = (f) => (f.k === '*' ? f.a.forEach(take) : flat.push(f));
  factors.forEach((f) => take(simp(f)));
  let constant = ONE;
  const groups = new Map();
  for (const f of flat) {
    if (isConst(f)) constant = mulConst(constant, f);
    else {
      const [b, e] = baseExp(f);
      const k = key(b);
      const g = groups.get(k);
      if (g) g.e = simpSum([g.e, e]);
      else groups.set(k, { b, e });
    }
  }
  if (isZeroE(constant)) return ZERO;
  const out = [];
  for (const { b, e } of groups.values()) {
    const p = simpPow(b, e);
    if (isConst(p)) constant = mulConst(constant, p);
    else if (p.k === '*') out.push(...p.a);
    else out.push(p);
  }
  out.sort((a, b) => order(a, b));
  if (!isOneE(constant)) out.unshift(constant);
  if (out.length === 0) return ONE;
  return out.length === 1 ? out[0] : { k: '*', a: out };
}

function simpPow(b, e) {
  b = simp(b);
  e = simp(e);
  if (isZeroE(e)) return ONE;
  if (isOneE(e)) return b;
  if (isOneE(b)) return ONE;
  if (isConst(b) && isConst(e)) {
    if (b.k === 'n' && isInt(e) && Math.abs(intValue(e)) <= 4096) {
      if (qIsZero(b.q) && intValue(e) < 0) throw new CasError('Division by zero.');
      return num(qPow(b.q, intValue(e)));
    }
    if (b.k === 'n' && e.k === 'n' && e.q.d === 2n && b.q.n > 0n && b.q.d === 1n) {
      const root = exactRoot(b.q);
      if (root) return num(qPow(root, Number(e.q.n)));
      // sqrt(8) is 2*sqrt(2): move the square factor out.
      if (b.q.n < 10n ** 12n) {
        let outside = 1n;
        let inside = b.q.n;
        for (let p = 2n; p * p <= inside && p < 1_000_000n; p += 1n) {
          while (inside % (p * p) === 0n) {
            inside /= p * p;
            outside *= p;
          }
        }
        if (outside > 1n)
          return simpProduct([num(qPow(new Q(outside, 1n), Number(e.q.n))), { k: '^', b: num(inside), e }]);
      }
    }
    if (b.k === 'f' || e.k === 'f') return flt(valueOf(b) ** valueOf(e));
    return { k: '^', b, e };
  }
  if (b.k === '^' && isInt(e)) return simpPow(b.b, simpProduct([b.e, e]));
  if (b.k === '*' && isInt(e)) return simpProduct(b.a.map((f) => ({ k: '^', b: f, e })));
  return { k: '^', b, e };
}

function exactRoot(r) {
  const sq = (n) => {
    if (n < 0n) return null;
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x -= 1n;
    while ((x + 1n) * (x + 1n) <= n) x += 1n;
    return x * x === n ? x : null;
  };
  const n = sq(r.n);
  const d = sq(r.d);
  return n !== null && d !== null ? new Q(n, d) : null;
}

const FN_VALUES = {
  sin: [[0, 0]],
  cos: [[0, 1]],
  tan: [[0, 0]],
  exp: [[0, 1]],
  log: [[1, 0]],
  atan: [[0, 0]],
  sinh: [[0, 0]],
  cosh: [[0, 1]],
};
const FN_FLOAT = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log,
  atan: Math.atan,
  asin: Math.asin,
  acos: Math.acos,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  abs: Math.abs,
};

function simpFn(name, args) {
  const a = args.map(simp);
  if (name === 'sqrt' && a.length === 1) return simpPow(a[0], num(q(1, 2)));
  if (!Object.hasOwn(FN_FLOAT, name)) return { k: 'fn', name, a };
  if (a.length !== 1) throw new CasError(`${name} takes one argument.`);
  const x = a[0];
  if (x.k === 'f') return flt(FN_FLOAT[name](x.v));
  for (const [input, output] of FN_VALUES[name] ?? []) if (x.k === 'n' && valueOf(x) === input) return num(output);
  if (name === 'exp') return simpPow(sym('%e'), x);
  if (name === 'log' && x.k === 's' && x.name === '%e') return ONE;
  if (name === 'abs' && x.k === 'n') return num(x.q.n < 0n ? new Q(-x.q.n, x.q.d) : x.q);
  if ((name === 'sin' || name === 'tan') && x.k === 's' && x.name === '%pi') return ZERO;
  if (name === 'cos' && x.k === 's' && x.name === '%pi') return num(-1);
  return { k: 'fn', name, a: [x] };
}

export function simp(e) {
  switch (e.k) {
    case 'n':
    case 'f':
    case 's':
      return e;
    case '+':
      return simpSum(e.a);
    case '*':
      return simpProduct(e.a);
    case '^':
      return simpPow(e.b, e.e);
    case 'fn':
      return simpFn(e.name, e.a);
    case 'list':
      return { k: 'list', a: e.a.map(simp) };
    case 'eq':
      return { k: 'eq', l: simp(e.l), r: simp(e.r) };
    default:
      return e;
  }
}

/** Highest power of any symbol, used to print polynomials from the highest power down, as Maxima does. */
function degreeKey(e) {
  if (e.k === 's') return [e.name, 1];
  if (e.k === '^' && e.b.k === 's' && isConst(e.e)) return [e.b.name, valueOf(e.e)];
  if (e.k === '*') {
    const parts = e.a.map(degreeKey).filter(([n]) => n !== '');
    return parts.length ? parts.reduce((x, y) => (x[0] === y[0] ? [x[0], x[1] + y[1]] : x[0] < y[0] ? x : y)) : ['', 0];
  }
  return ['', 0];
}

function order(a, b) {
  const [na, da] = degreeKey(a);
  const [nb, db] = degreeKey(b);
  if (na !== nb) return na === '' ? 1 : nb === '' ? -1 : na < nb ? -1 : 1;
  if (da !== db) return db - da;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}

/* --------------------------------------------------------------- expanding */

/** The product of two expanded expressions, term by term. */
function distribute(a, b) {
  const next = [];
  for (const t of a.k === '+' ? a.a : [a]) for (const u of b.k === '+' ? b.a : [b]) next.push(simpProduct([t, u]));
  if (next.length > MAX_TERMS) throw new CasError('The result is too large to expand.');
  return simpSum(next);
}

export function expand(e) {
  e = simp(e);
  switch (e.k) {
    case '+':
      return simpSum(e.a.map(expand));
    case '*': {
      let result = ONE;
      for (const f of e.a.map(expand)) result = distribute(result, f);
      return result;
    }
    case '^': {
      const base = expand(e.b);
      if (isInt(e.e) && intValue(e.e) > 1 && intValue(e.e) <= 30 && base.k === '+') {
        let result = base;
        for (let i = 1; i < intValue(e.e); i += 1) result = distribute(result, base);
        return result;
      }
      return simpPow(base, e.e);
    }
    case 'fn':
      return simp({ k: 'fn', name: e.name, a: e.a.map(expand) });
    case 'list':
      return { k: 'list', a: e.a.map(expand) };
    case 'eq':
      return { k: 'eq', l: expand(e.l), r: expand(e.r) };
    default:
      return e;
  }
}

/* ----------------------------------------------------------------- calculus */

const dependsOn = (e, x) => {
  switch (e.k) {
    case 's':
      return e.name === x;
    case '+':
    case '*':
    case 'list':
      return e.a.some((t) => dependsOn(t, x));
    case '^':
      return dependsOn(e.b, x) || dependsOn(e.e, x);
    case 'fn':
      return e.a.some((t) => dependsOn(t, x));
    case 'eq':
      return dependsOn(e.l, x) || dependsOn(e.r, x);
    default:
      return false;
  }
};

const neg = (e) => simpProduct([num(-1), e]);
const mul = (...f) => simpProduct(f);
const sum = (...t) => simpSum(t);
const pow = (b, e) => simpPow(b, e);
const fn = (name, ...a) => simpFn(name, a);

export function diff(e, x) {
  e = simp(e);
  if (!dependsOn(e, x)) return ZERO;
  switch (e.k) {
    case 's':
      return ONE;
    case '+':
      return sum(...e.a.map((t) => diff(t, x)));
    case '*':
      return sum(...e.a.map((_, i) => mul(...e.a.map((f, j) => (i === j ? diff(f, x) : f)))));
    case '^': {
      if (!dependsOn(e.e, x)) return mul(e.e, pow(e.b, sum(e.e, num(-1))), diff(e.b, x));
      return mul(e, sum(mul(diff(e.e, x), fn('log', e.b)), mul(e.e, diff(e.b, x), pow(e.b, num(-1)))));
    }
    case 'fn': {
      const [u] = e.a;
      const du = diff(u, x);
      const outer = {
        sin: () => fn('cos', u),
        cos: () => neg(fn('sin', u)),
        tan: () => pow(fn('cos', u), num(-2)),
        exp: () => e,
        log: () => pow(u, num(-1)),
        atan: () => pow(sum(ONE, pow(u, num(2))), num(-1)),
        asin: () => pow(sum(ONE, neg(pow(u, num(2)))), num(q(-1, 2))),
        acos: () => neg(pow(sum(ONE, neg(pow(u, num(2)))), num(q(-1, 2)))),
        sinh: () => fn('cosh', u),
        cosh: () => fn('sinh', u),
        tanh: () => pow(fn('cosh', u), num(-2)),
      }[e.name];
      if (!outer) throw new CasError(`Cannot differentiate ${e.name}.`);
      return mul(outer(), du);
    }
    default:
      throw new CasError('Cannot differentiate this.');
  }
}

/** The coefficients [c0, c1, ...] of e as a polynomial in x, or null if it is not one. */
function polyCoefficients(e, x) {
  e = expand(e);
  const coefficients = [];
  for (const t of e.k === '+' ? e.a : [e]) {
    let power = 0;
    let coefficient = t;
    if (dependsOn(t, x)) {
      const factors = t.k === '*' ? t.a : [t];
      const rest = [];
      for (const f of factors) {
        if (f.k === 's' && f.name === x) power += 1;
        else if (f.k === '^' && f.b.k === 's' && f.b.name === x && isInt(f.e) && intValue(f.e) >= 0)
          power += intValue(f.e);
        else if (dependsOn(f, x)) return null;
        else rest.push(f);
      }
      coefficient = mul(...rest);
    }
    coefficients[power] = sum(coefficients[power] ?? ZERO, coefficient);
  }
  return Array.from(coefficients, (c) => c ?? ZERO);
}

/** If u = a*x + b with a, b free of x, return [a, b]. */
function linearIn(u, x) {
  const c = polyCoefficients(u, x);
  return c && c.length <= 2 ? [c[1] ?? ZERO, c[0] ?? ZERO] : null;
}

function integrateTerm(t, x, depth = 0) {
  if (!dependsOn(t, x)) return mul(t, sym(x));
  if (t.k === '*') {
    const free = t.a.filter((f) => !dependsOn(f, x));
    const bound = t.a.filter((f) => dependsOn(f, x));
    if (free.length) {
      const inner = integrateTerm(bound.length === 1 ? bound[0] : { k: '*', a: bound }, x, depth);
      return inner && mul(...free, inner);
    }
    if (
      bound.length === 2 &&
      bound.every((f) => f.k === 'fn' && ['sin', 'cos'].includes(f.name)) &&
      key(bound[0].a[0]) === key(bound[1].a[0]) &&
      bound[0].name !== bound[1].name
    ) {
      const lin = linearIn(bound[0].a[0], x);
      const sine = bound.find((f) => f.name === 'sin');
      if (lin && !isZeroE(lin[0])) return mul(num(q(1, 2)), pow(lin[0], num(-1)), pow(sine, num(2)));
    }
    // x^n times exp, sin, or cos of a linear argument: integrate by parts n times.
    const power = bound.find(
      (f) =>
        (f.k === 's' && f.name === x) ||
        (f.k === '^' && f.b.k === 's' && f.b.name === x && isInt(f.e) && intValue(f.e) > 0),
    );
    const other = bound.filter((f) => f !== power);
    const expLike = (g) =>
      g.k === 'fn' ? ['exp', 'sin', 'cos'].includes(g.name) : g.k === '^' && g.b.k === 's' && g.b.name === '%e';
    if (power && other.length === 1 && expLike(other[0]) && depth < 12) {
      const g = other[0];
      const anti = integrateTerm(g, x, depth + 1);
      if (!anti) return null;
      const rest = integrateTerm(mul(diff(power, x), anti), x, depth + 1);
      return rest && sum(mul(power, anti), neg(rest));
    }
    return null;
  }
  if (t.k === 's') return mul(num(q(1, 2)), pow(sym(x), num(2)));
  if (t.k === '^') {
    const lin = linearIn(t.b, x);
    if (lin && !dependsOn(t.e, x) && !isZeroE(lin[0])) {
      const [a] = lin;
      if (isNum(t.e) && qIsZero(qAdd(t.e.q, q(1)))) return mul(pow(a, num(-1)), fn('log', t.b));
      const n1 = sum(t.e, ONE);
      return mul(pow(mul(a, n1), num(-1)), pow(t.b, n1));
    }
    if (t.b.k === 's' && t.b.name === '%e' && !dependsOn(t.e, x)) return null;
    if (t.b.k === 's' && t.b.name === '%e') {
      const lin2 = linearIn(t.e, x);
      if (lin2 && !isZeroE(lin2[0])) return mul(pow(lin2[0], num(-1)), t);
    }
    return null;
  }
  if (t.k === 'fn') {
    const lin = linearIn(t.a[0], x);
    if (!lin || isZeroE(lin[0])) return null;
    const inv = pow(lin[0], num(-1));
    switch (t.name) {
      case 'sin':
        return mul(num(-1), inv, fn('cos', t.a[0]));
      case 'cos':
        return mul(inv, fn('sin', t.a[0]));
      case 'exp':
        return mul(inv, t);
      case 'log':
        return depth < 1
          ? sum(mul(t.a[0], t), neg(mul(lin[0], integrateTerm(mul(t.a[0], pow(t.a[0], num(-1))), x, 1) ?? ZERO)))
          : null;
      default:
        return null;
    }
  }
  return null;
}

export function integrate(e, x) {
  e = expand(e);
  const parts = [];
  for (const t of e.k === '+' ? e.a : [e]) {
    const r = integrateTerm(t, x);
    if (!r) return null;
    parts.push(r);
  }
  return sum(...parts);
}

/* ---------------------------------------------------------------- evaluation */

export function substitute(e, map) {
  const go = (t) => {
    if (t.k === 's' && map.has(t.name)) return map.get(t.name);
    switch (t.k) {
      case '+':
      case '*':
      case 'list':
        return { ...t, a: t.a.map(go) };
      case '^':
        return { k: '^', b: go(t.b), e: go(t.e) };
      case 'fn':
        return { ...t, a: t.a.map(go) };
      case 'eq':
        return { k: 'eq', l: go(t.l), r: go(t.r) };
      default:
        return t;
    }
  };
  return simp(go(e));
}

export function numeric(e) {
  e = simp(substitute(e, new Map(Object.entries(SPECIAL).map(([n, v]) => [n, flt(v)]))));
  const go = (t) => {
    switch (t.k) {
      case 'n':
        return flt(valueOf(t));
      case '+':
      case '*':
      case 'list':
        return { ...t, a: t.a.map(go) };
      case '^':
        return { k: '^', b: go(t.b), e: go(t.e) };
      case 'fn':
        return { ...t, a: t.a.map(go) };
      case 'eq':
        return { k: 'eq', l: go(t.l), r: go(t.r) };
      default:
        return t;
    }
  };
  return simp(go(e));
}

/* ------------------------------------------------------------------ solving */

export function solve(equation, x) {
  const expression = equation.k === 'eq' ? sum(equation.l, neg(equation.r)) : equation;
  const c = polyCoefficients(expression, x);
  if (!c) throw new CasError(`The built-in engine solves polynomial equations in ${x}. This one is not a polynomial.`);
  while (c.length > 1 && isZeroE(c[c.length - 1])) c.pop();
  const eq = (v) => ({ k: 'eq', l: sym(x), r: v });
  if (c.length === 1) return { k: 'list', a: isZeroE(c[0]) ? [] : [] };
  if (c.length === 2) return { k: 'list', a: [eq(mul(neg(c[0]), pow(c[1], num(-1))))] };
  if (c.length === 3) {
    const [cc, b, a] = c;
    const disc = sum(pow(b, num(2)), mul(num(-4), a, cc));
    const root = pow(disc, num(q(1, 2)));
    const two = pow(mul(num(2), a), num(-1));
    const first = mul(sum(neg(b), root), two);
    const second = mul(sum(neg(b), neg(root)), two);
    if (isZeroE(disc)) return { k: 'list', a: [eq(first)] };
    return { k: 'list', a: [eq(second), eq(first)] };
  }
  throw new CasError('The built-in engine solves equations up to degree 2.');
}

function factorInteger(n) {
  if (n === 0n || n === 1n || n === -1n) return num(n);
  const sign = n < 0n ? -1n : 1n;
  const m = n < 0n ? -n : n;
  if (m > 10n ** 15n) throw new CasError('That number is too large to factor here.');
  const factors = [];
  let value = Number(m);
  for (let p = 2; p * p <= value; p += p === 2 ? 1 : 2) {
    let count = 0;
    while (value % p === 0) {
      value /= p;
      count += 1;
    }
    if (count) factors.push({ k: '^', b: num(p), e: num(count) });
  }
  if (value > 1) factors.push(num(value));
  return { k: 'factored', sign, a: factors };
}

/* ------------------------------------------------------------------ printing */

function printNumber(e) {
  if (e.k === 'n') return e.q.d === 1n ? String(e.q.n) : `${e.q.n}/${e.q.d}`;
  if (!Number.isFinite(e.v)) return e.v > 0 ? 'inf' : e.v < 0 ? '-inf' : 'und';
  const text = Number(e.v.toPrecision(15)).toString();
  return /^-?\d+$/.test(text) ? `${text}.0` : text.replace(/e\+?/, 'e');
}

export function print(e, parent = 0) {
  let text;
  let level;
  switch (e.k) {
    case 'n':
    case 'f': {
      text = printNumber(e);
      level = text.startsWith('-') ? 2 : text.includes('/') ? 3 : 9;
      break;
    }
    case 's':
      text = e.name;
      level = 9;
      break;
    case '+': {
      text = e.a
        .map((t, i) => {
          const s = print(t, 2);
          if (i === 0) return s;
          return s.startsWith('-') ? s : `+${s}`;
        })
        .join('');
      level = 2;
      break;
    }
    case '*': {
      const top = [];
      const bottom = [];
      let sign = '';
      for (const [i, f] of e.a.entries()) {
        if (i === 0 && f.k === 'n' && f.q.n < 0n && e.a.length > 1) {
          sign = '-';
          if (!(f.q.n === -1n && f.q.d === 1n)) top.push(print({ k: 'n', q: new Q(-f.q.n, f.q.d) }, 3));
        } else if (f.k === '^' && isConst(f.e) && valueOf(f.e) < 0 && !(f.e.k === 'n' && f.e.q.d !== 1n && false)) {
          bottom.push(print(simpPow(f.b, neg(f.e)), 4));
        } else if (f.k === 'n' && f.q.d !== 1n && i === 0) {
          if (f.q.n !== 1n) top.push(String(f.q.n));
          bottom.push(String(f.q.d));
        } else top.push(print(f, 3));
      }
      const numerator = top.length ? top.join('*') : '1';
      text =
        sign + (bottom.length ? `${numerator}/${bottom.length > 1 ? `(${bottom.join('*')})` : bottom[0]}` : numerator);
      level = bottom.length ? 3 : sign ? 2 : 3;
      break;
    }
    case '^': {
      if (e.e.k === 'n' && e.e.q.n === 1n && e.e.q.d === 2n) {
        text = `sqrt(${print(e.b, 0)})`;
        level = 9;
        break;
      }
      text = `${print(e.b, 6)}^${print(e.e, 6)}`;
      level = 5;
      break;
    }
    case 'fn':
      text = `${e.name}(${e.a.map((t) => print(t, 0)).join(', ')})`;
      level = 9;
      break;
    case 'list':
      text = `[${e.a.map((t) => print(t, 0)).join(', ')}]`;
      level = 9;
      break;
    case 'eq':
      text = `${print(e.l, 1)} = ${print(e.r, 1)}`;
      level = 1;
      break;
    case 'factored':
      text = (e.sign < 0n ? '-' : '') + e.a.map((t) => print(t, 3)).join('*');
      level = 3;
      break;
    default:
      text = '?';
      level = 9;
  }
  return level < parent ? `(${text})` : text;
}

/* ---------------------------------------------------------------- the session */

const BUILTIN_NAMES = new Set([
  'expand',
  'diff',
  'integrate',
  'solve',
  'subst',
  'ev',
  'factor',
  'float',
  'simplify',
  'ratsimp',
  'expand',
  'sqrt',
  'sin',
  'cos',
  'tan',
  'exp',
  'log',
  'atan',
  'asin',
  'acos',
  'sinh',
  'cosh',
  'tanh',
  'abs',
  'numer',
]);

/** A session remembers variables, function definitions, and earlier results (%, %o1, ...). */
export class Session {
  constructor() {
    this.vars = new Map();
    this.defs = new Map();
    this.results = [];
  }

  /** Evaluate one line of input, which can hold several commands. Returns [{ text, hidden }]. */
  run(source) {
    const out = [];
    for (const { expr, hidden } of new Parser(source).statements()) {
      const value = this.statement(expr);
      this.results.push(value);
      out.push({ text: this.show(value), hidden, tex: null });
    }
    return out;
  }

  show(value) {
    if (value.k === 'void') return value.note;
    return print(value);
  }

  statement(s) {
    if (s.k === 'assign') {
      const value = this.eval(s.value);
      this.vars.set(s.name, value);
      return value;
    }
    if (s.k === 'define') {
      this.defs.set(s.name, { params: s.params, body: s.body });
      return { k: 'void', note: `${s.name}(${s.params.join(', ')}) := ${print(simp(s.body))}` };
    }
    return this.eval(s);
  }

  eval(e) {
    const substituted = this.lookup(e, 0);
    return this.call(substituted);
  }

  /** Replace variables, earlier results, and user functions by their values. */
  lookup(e, depth) {
    if (depth > MAX_DEPTH) throw new CasError('A definition refers to itself.');
    switch (e.k) {
      case 's': {
        if (e.name === '%' || /^%o\d+$/.test(e.name)) {
          const at = e.name === '%' ? this.results.length - 1 : Number(e.name.slice(2)) - 1;
          const r = this.results[at];
          if (!r || r.k === 'void') throw new CasError(`There is no earlier result ${e.name}.`);
          return r;
        }
        return this.vars.has(e.name) ? this.vars.get(e.name) : e;
      }
      case '+':
      case '*':
      case 'list':
        return { ...e, a: e.a.map((t) => this.lookup(t, depth + 1)) };
      case '^':
        return { k: '^', b: this.lookup(e.b, depth + 1), e: this.lookup(e.e, depth + 1) };
      case 'eq':
        return { k: 'eq', l: this.lookup(e.l, depth + 1), r: this.lookup(e.r, depth + 1) };
      case 'fn': {
        const def = this.defs.get(e.name);
        if (def) {
          if (def.params.length !== e.a.length)
            throw new CasError(`${e.name} takes ${def.params.length} argument${def.params.length === 1 ? '' : 's'}.`);
          const map = new Map(def.params.map((p, i) => [p, this.lookup(e.a[i], depth + 1)]));
          return this.lookup(substitute(def.body, map), depth + 1);
        }
        if (['diff', 'integrate', 'solve', 'subst', 'ev', 'factor'].includes(e.name)) {
          // The variable of differentiation or integration is a name, not a value.
          const keep =
            e.name === 'subst' ? [1] : e.name === 'diff' || e.name === 'integrate' || e.name === 'solve' ? [1] : [];
          return { ...e, a: e.a.map((t, i) => (keep.includes(i) && t.k === 's' ? t : this.lookup(t, depth + 1))) };
        }
        return { ...e, a: e.a.map((t) => this.lookup(t, depth + 1)) };
      }
      default:
        return e;
    }
  }

  call(e) {
    if (e.k === 'list') return { k: 'list', a: e.a.map((t) => this.call(t)) };
    if (e.k === 'eq') return { k: 'eq', l: this.call(e.l), r: this.call(e.r) };
    if (e.k === '+' || e.k === '*') return simp({ ...e, a: e.a.map((t) => this.call(t)) });
    if (e.k === '^') return simp({ k: '^', b: this.call(e.b), e: this.call(e.e) });
    if (e.k !== 'fn') return simp(e);
    const args = e.a;
    const name = e.name;
    const needVar = (i) => {
      const v = args[i];
      if (!v || v.k !== 's') throw new CasError(`${name} needs a variable name, like ${name}(expression, x).`);
      return v.name;
    };
    const arity = (min, max = min) => {
      if (args.length < min || args.length > max)
        throw new CasError(
          `${name} takes ${min === max ? min : `${min} to ${max}`} argument${max === 1 ? '' : 's'}, but got ${args.length}.`,
        );
    };
    switch (name) {
      case 'expand':
        arity(1);
        return expand(this.call(args[0]));
      case 'simplify':
      case 'ratsimp':
        arity(1);
        return expand(this.call(args[0]));
      case 'diff': {
        arity(2, 3);
        let r = this.call(args[0]);
        const x = needVar(1);
        const times = args[2] ? intValue(this.call(args[2])) : 1;
        if (!Number.isInteger(times) || times < 0 || times > 20)
          throw new CasError('The order of a derivative is a whole number from 0 to 20.');
        for (let i = 0; i < times; i += 1) r = diff(r, x);
        return expand(r);
      }
      case 'integrate': {
        arity(2, 4);
        const body = this.call(args[0]);
        const x = needVar(1);
        const anti = integrate(body, x);
        if (args.length === 2) {
          if (!anti) return { k: 'fn', name: 'integrate', a: [body, sym(x)] };
          return anti;
        }
        if (args.length !== 4) throw new CasError('A definite integral is integrate(expression, x, lower, upper).');
        if (!anti)
          throw new CasError(
            'The built-in engine could not find an antiderivative, so it cannot do this definite integral.',
          );
        const [lo, hi] = [this.call(args[2]), this.call(args[3])];
        return expand(sum(substitute(anti, new Map([[x, hi]])), neg(substitute(anti, new Map([[x, lo]])))));
      }
      case 'solve': {
        arity(2);
        return solve(this.call(args[0]), needVar(1));
      }
      case 'subst': {
        arity(3);
        const value = this.call(args[0]);
        const target = args[1];
        if (target.k !== 's') throw new CasError('subst(a, x, e) replaces the name x by a.');
        return substitute(this.call(args[2]), new Map([[target.name, value]]));
      }
      case 'ev': {
        if (args.length < 1) throw new CasError('ev needs an expression.');
        let r = this.call(args[0]);
        let wantNumber = false;
        const map = new Map();
        for (const option of args.slice(1)) {
          if (option.k === 'eq' && option.l.k === 's') map.set(option.l.name, this.call(option.r));
          else if (option.k === 's' && option.name === 'numer') wantNumber = true;
          else throw new CasError('ev options are x = value, or numer.');
        }
        if (map.size) r = substitute(r, map);
        return wantNumber ? numeric(r) : r;
      }
      case 'float':
      case 'numer':
        arity(1);
        return numeric(this.call(args[0]));
      case 'factor': {
        arity(1);
        const r = this.call(args[0]);
        if (isInt(r)) return factorInteger(r.q.n);
        throw new CasError('The built-in engine factors whole numbers only. Use expand for polynomials.');
      }
      default: {
        if (Object.hasOwn(FN_FLOAT, name) || name === 'sqrt')
          return simpFn(
            name,
            args.map((t) => this.call(t)),
          );
        if (BUILTIN_NAMES.has(name)) return simp(e);
        throw new CasError(
          `The built-in engine does not know ${name}. It supports expand, diff, integrate, solve, subst, ev, factor, float, and the usual functions.`,
        );
      }
    }
  }
}

export const parseCas = (text) => new Parser(text).statements();
