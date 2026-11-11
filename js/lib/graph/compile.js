/**
 * Compile graphing-language ASTs into closures.
 *
 * A compiled node is `(env) => value`, where `env` is an array of slots: the
 * plot variables first (x, y, t, theta, r), then function parameters and the
 * variables bound by sum, prod, int, and for. Nothing here uses eval or
 * Function, so the app can run under a strict Content-Security-Policy.
 */
import { BINDERS, CONSTANT_VALUES, FUNCTION_NAMES, isFunctionName } from './names.js';
import {
  GraphEvalError,
  MAX_LIST,
  Point,
  arith,
  broadcastCall,
  cosDeg,
  factorial,
  flattenItems,
  gcd,
  indexList,
  joinLists,
  lcm,
  listLength,
  listMax,
  listMin,
  makeRange,
  mapNumbers,
  mapNumbers2,
  mean,
  median,
  nCr,
  nPr,
  negate,
  nthRoot,
  realPow,
  roundTo,
  sinDeg,
  sortList,
  stdev,
  stdevp,
  tanDeg,
  total,
  uniqueList,
} from './values.js';

export class GraphCompileError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'GraphCompileError';
    this.position = position;
  }
}

/** Slots reserved for the plot variables. */
export const PLOT_SLOT = { x: 0, y: 1, t: 2, theta: 3, r: 4 };
export const FIRST_FREE_SLOT = 5;

/* ----------------------------------------------------------------- builtins */

const num1 = (min, max, fn) => ({ min, max, num1: fn });

function makeBuiltins(angle) {
  const deg = angle === 'deg';
  const out = (radians) => (deg ? (radians * 180) / Math.PI : radians);
  const sin = deg ? sinDeg : Math.sin;
  const cos = deg ? cosDeg : Math.cos;
  const tan = deg ? tanDeg : Math.tan;
  const arcsin = num1(1, 1, (x) => out(Math.asin(x)));
  const arccos = num1(1, 1, (x) => out(Math.acos(x)));
  const arctan = {
    min: 1,
    max: 2,
    num1: (x) => out(Math.atan(x)),
    num2: (y, x) => out(Math.atan2(y, x)),
  };
  const asinh = num1(1, 1, Math.asinh);
  const acosh = num1(1, 1, Math.acosh);
  const atanh = num1(1, 1, Math.atanh);

  const aggregate = (fn) => ({ min: 1, max: 1, any: (v) => fn(v[0]) });
  const pointPair = (name, fn) => ({
    min: 2,
    max: 2,
    any: ([p, q]) => {
      if (!(p instanceof Point) || !(q instanceof Point)) throw new GraphEvalError(`${name}() needs two points.`);
      return fn(p, q);
    },
  });

  return {
    sin: num1(1, 1, sin),
    cos: num1(1, 1, cos),
    tan: num1(1, 1, tan),
    cot: num1(1, 1, (x) => 1 / tan(x)),
    sec: num1(1, 1, (x) => 1 / cos(x)),
    csc: num1(1, 1, (x) => 1 / sin(x)),
    arcsin,
    arccos,
    arctan,
    arccot: num1(1, 1, (x) => out(Math.PI / 2 - Math.atan(x))),
    arcsec: num1(1, 1, (x) => out(Math.acos(1 / x))),
    arccsc: num1(1, 1, (x) => out(Math.asin(1 / x))),
    asin: arcsin,
    acos: arccos,
    atan: arctan,
    sinh: num1(1, 1, Math.sinh),
    cosh: num1(1, 1, Math.cosh),
    tanh: num1(1, 1, Math.tanh),
    coth: num1(1, 1, (x) => 1 / Math.tanh(x)),
    sech: num1(1, 1, (x) => 1 / Math.cosh(x)),
    csch: num1(1, 1, (x) => 1 / Math.sinh(x)),
    arcsinh: asinh,
    arccosh: acosh,
    arctanh: atanh,
    asinh,
    acosh,
    atanh,
    exp: num1(1, 1, Math.exp),
    ln: num1(1, 1, Math.log),
    log: num1(1, 1, Math.log10),
    sqrt: num1(1, 1, Math.sqrt),
    nthroot: { min: 2, max: 2, num2: nthRoot },
    abs: num1(1, 1, Math.abs),
    sign: num1(1, 1, Math.sign),
    floor: num1(1, 1, Math.floor),
    ceil: num1(1, 1, Math.ceil),
    round: { min: 1, max: 2, num1: (x) => roundTo(x), num2: roundTo },
    mod: { min: 2, max: 2, num2: (a, b) => (b === 0 ? NaN : a - b * Math.floor(a / b)) },
    gcd: { min: 2, max: 2, num2: gcd },
    lcm: { min: 2, max: 2, num2: lcm },
    nCr: { min: 2, max: 2, num2: nCr },
    nPr: { min: 2, max: 2, num2: nPr },
    min: {
      min: 1,
      max: Infinity,
      any: (v) => (v.length === 1 ? listMin(v[0]) : v.reduce((a, b) => mapNumbers2('min', Math.min, a, b))),
    },
    max: {
      min: 1,
      max: Infinity,
      any: (v) => (v.length === 1 ? listMax(v[0]) : v.reduce((a, b) => mapNumbers2('max', Math.max, a, b))),
    },
    total: aggregate(total),
    length: aggregate(listLength),
    mean: aggregate(mean),
    median: aggregate(median),
    stdev: aggregate(stdev),
    stdevp: aggregate(stdevp),
    sort: aggregate(sortList),
    unique: aggregate(uniqueList),
    join: { min: 1, max: Infinity, any: joinLists },
    distance: pointPair('distance', (p, q) => Math.hypot(p.x - q.x, p.y - q.y)),
    midpoint: pointPair('midpoint', (p, q) => new Point((p.x + q.x) / 2, (p.y + q.y) / 2)),
  };
}

/** Names handled outside the builtin table. */
const SPECIAL_FUNCTIONS = new Set(BINDERS);

/** Every name the parser treats as a function must be compilable. Checked by tests. */
export function unimplementedFunctions() {
  const table = makeBuiltins('rad');
  return FUNCTION_NAMES.filter((name) => !table[name] && !SPECIAL_FUNCTIONS.has(name));
}

/* ------------------------------------------------------------------- scope */

/** Compiled user function. Parameters occupy the first slots of `env`. */
export class FnEntry {
  constructor(name, params) {
    this.name = name;
    this.params = params;
    this.arity = params.length;
    this.body = null;
    this.env = [];
  }

  call1(a) {
    if (this.body === null) return NaN;
    this.env[0] = a;
    return this.body(this.env);
  }

  call2(a, b) {
    if (this.body === null) return NaN;
    this.env[0] = a;
    this.env[1] = b;
    return this.body(this.env);
  }

  call(values) {
    if (this.body === null) return NaN;
    for (let i = 0; i < values.length; i += 1) this.env[i] = values[i];
    return this.body(this.env);
  }
}

/** Definitions shared by every row: variables, functions, and the angle unit. */
export class Scope {
  constructor(angle = 'rad') {
    this.angle = angle === 'deg' ? 'deg' : 'rad';
    this.builtins = makeBuiltins(this.angle);
    /** @type {Map<string, { name: string, value: any }>} */
    this.vars = new Map();
    /** @type {Map<string, FnEntry>} */
    this.fns = new Map();
  }
}

/** State for compiling one row or function body. */
export class Ctx {
  constructor(scope, { allowed = [], firstSlot = FIRST_FREE_SLOT } = {}) {
    this.scope = scope;
    this.allowed = new Set(allowed);
    this.locals = new Map();
    this.nslots = firstSlot;
    /** Definitions this code reads (for ordering and cycle detection). */
    this.refs = new Set();
    /** Names that are not defined anywhere (the UI offers sliders for them). */
    this.undefinedNames = new Set();
  }

  alloc() {
    const slot = this.nslots;
    this.nslots += 1;
    return slot;
  }

  newEnv() {
    return new Array(this.nslots).fill(0);
  }

  /** Bind `name` to a fresh slot while `fn` compiles, then restore. */
  withLocal(name, fn) {
    const slot = this.alloc();
    const saved = this.locals.get(name);
    this.locals.set(name, slot);
    try {
      return fn(slot);
    } finally {
      if (saved === undefined) this.locals.delete(name);
      else this.locals.set(name, saved);
    }
  }
}

/* ---------------------------------------------------------------- compiler */

const isNum = (v) => typeof v === 'number';

function binary(op, l, r) {
  switch (op) {
    case '+':
      return (env) => {
        const a = l(env);
        const b = r(env);
        return isNum(a) && isNum(b) ? a + b : arith('+', a, b);
      };
    case '-':
      return (env) => {
        const a = l(env);
        const b = r(env);
        return isNum(a) && isNum(b) ? a - b : arith('-', a, b);
      };
    case '*':
      return (env) => {
        const a = l(env);
        const b = r(env);
        return isNum(a) && isNum(b) ? a * b : arith('*', a, b);
      };
    case '/':
      return (env) => {
        const a = l(env);
        const b = r(env);
        return isNum(a) && isNum(b) ? a / b : arith('/', a, b);
      };
    default:
      return (env) => {
        const a = l(env);
        const b = r(env);
        return isNum(a) && isNum(b) ? realPow(a, b) : arith('^', a, b);
      };
  }
}

function compileId(node, cx) {
  const { name } = node;
  const local = cx.locals.get(name);
  if (local !== undefined) return (env) => env[local];
  if (cx.allowed.has(name)) {
    const slot = PLOT_SLOT[name];
    return (env) => env[slot];
  }
  const cell = cx.scope.vars.get(name);
  if (cell) {
    cx.refs.add(name);
    return () => cell.value;
  }
  if (cx.scope.fns.has(name)) {
    throw new GraphCompileError(`"${name}" is a function. Write ${name}(x) to use it.`, node.pos);
  }
  if (Object.hasOwn(CONSTANT_VALUES, name)) {
    const value = CONSTANT_VALUES[name];
    return () => value;
  }
  if (name === 'theta') {
    throw new GraphCompileError('"theta" only works in polar equations, like r = 1 + cos(theta).', node.pos);
  }
  if (name === 'x' || name === 'y') {
    throw new GraphCompileError(
      `"${name}" only works when graphing, like y = ${name}^2. To reuse an expression, define f(${name}) = ...`,
      node.pos,
    );
  }
  cx.undefinedNames.add(name);
  return () => NaN;
}

function compileCmp(node, cx) {
  const parts = node.parts.map((p) => compileNode(p, cx));
  const ops = node.ops;
  const compare = (op, l, r) => {
    switch (op) {
      case '<':
        return l < r;
      case '<=':
        return l <= r;
      case '>':
        return l > r;
      case '>=':
        return l >= r;
      default:
        return Math.abs(l - r) <= 1e-12 * Math.max(1, Math.abs(l), Math.abs(r));
    }
  };
  return (env) => {
    let left = parts[0](env);
    for (let i = 0; i < ops.length; i += 1) {
      const right = parts[i + 1](env);
      if (!isNum(left) || !isNum(right)) {
        throw new GraphEvalError('Conditions compare single numbers, not lists or points.');
      }
      if (!compare(ops[i], left, right)) return false;
      left = right;
    }
    return true;
  };
}

/** Compile restriction comparisons into one `(env) => boolean` that requires all of them. */
export function compileConditions(cmps, cx) {
  const fns = cmps.map((c) => compileCmp(c, cx));
  if (fns.length === 1) return fns[0];
  return (env) => {
    for (const f of fns) if (!f(env)) return false;
    return true;
  };
}

/** Compile one comparison chain such as 0 < y < x. */
export const compileComparison = compileCmp;

function arityMessage(name, min, max) {
  if (min === max) return `${name}() takes ${min} argument${min === 1 ? '' : 's'}`;
  if (max === Infinity) return `${name}() takes at least ${min} argument${min === 1 ? '' : 's'}`;
  return `${name}() takes ${min} to ${max} arguments`;
}

function compileBuiltin(node, cx) {
  const { name, args } = node;
  if (name.startsWith('log_')) return compileLogBase(node, cx);
  const entry = cx.scope.builtins[name];
  if (!entry) throw new GraphCompileError(`${name}() is not available`, node.pos);
  if (args.length < entry.min || args.length > entry.max) {
    throw new GraphCompileError(arityMessage(name, entry.min, entry.max), node.pos);
  }
  const fns = args.map((a) => compileNode(a, cx));
  if (entry.num1 && fns.length === 1) {
    const [a] = fns;
    const fn = entry.num1;
    return (env) => {
      const v = a(env);
      return isNum(v) ? fn(v) : mapNumbers(name, fn, v);
    };
  }
  if (entry.num2 && fns.length === 2) {
    const [a, b] = fns;
    const fn = entry.num2;
    return (env) => {
      const u = a(env);
      const v = b(env);
      return isNum(u) && isNum(v) ? fn(u, v) : mapNumbers2(name, fn, u, v);
    };
  }
  const apply = entry.any;
  return (env) => apply(fns.map((f) => f(env)));
}

/** log_2(x): the subscript is a number or a variable. */
function compileLogBase(node, cx) {
  if (node.args.length !== 1) throw new GraphCompileError(arityMessage(node.name, 1, 1), node.pos);
  const sub = node.name.slice(4);
  const base = /^\d+$/.test(sub)
    ? (
        (value) => () =>
          value
      )(Number(sub))
    : compileId({ type: 'id', name: sub }, cx);
  const arg = compileNode(node.args[0], cx);
  return (env) => {
    const b = base(env);
    return mapNumbers2('log', (x, bb) => Math.log(x) / Math.log(bb), arg(env), b);
  };
}

function compileUserCall(node, cx) {
  const fn = cx.scope.fns.get(node.name);
  if (node.args.length !== fn.arity) {
    throw new GraphCompileError(`${node.name}() takes ${fn.arity} argument${fn.arity === 1 ? '' : 's'}`, node.pos);
  }
  cx.refs.add(node.name);
  const fns = node.args.map((a) => compileNode(a, cx));
  if (fns.length === 1) {
    const [a] = fns;
    return (env) => {
      const v = a(env);
      return Array.isArray(v) ? broadcastCall(node.name, ([u]) => fn.call1(u), [v]) : fn.call1(v);
    };
  }
  if (fns.length === 2) {
    const [a, b] = fns;
    return (env) => {
      const u = a(env);
      const v = b(env);
      if (!Array.isArray(u) && !Array.isArray(v)) return fn.call2(u, v);
      return broadcastCall(node.name, ([p, q]) => fn.call2(p, q), [u, v]);
    };
  }
  return (env) =>
    broadcastCall(
      node.name,
      (vals) => fn.call(vals),
      fns.map((f) => f(env)),
    );
}

function compileCall(node, cx) {
  const { name, args } = node;
  if (BINDERS.has(name) && args.length === 4) return compileBinder(node, cx);
  const isVariable =
    cx.locals.has(name) || cx.allowed.has(name) || cx.scope.vars.has(name) || Object.hasOwn(CONSTANT_VALUES, name);
  if (!isVariable && cx.scope.fns.has(name)) return compileUserCall(node, cx);
  if (!isVariable && isFunctionName(name)) {
    if (BINDERS.has(name)) {
      if (args.length === 1 && (name === 'sum' || name === 'prod')) return compileBuiltinSumOfList(node, cx);
      throw new GraphCompileError(
        `Write ${name}(k, 1, 10, k^2): a variable, two bounds, then the expression`,
        node.pos,
      );
    }
    return compileBuiltin(node, cx);
  }
  // A letter followed by parentheses multiplies: a(b + 1) means a * (b + 1).
  if (args.length !== 1) {
    throw new GraphCompileError(`"${name}" is not a function, so it cannot take ${args.length} arguments`, node.pos);
  }
  const left = compileId({ type: 'id', name, pos: node.pos }, cx);
  return binary('*', left, compileNode(args[0], cx));
}

/** sum(L) and prod(L) of a list are accepted as total(L) and the product. */
function compileBuiltinSumOfList(node, cx) {
  const arg = compileNode(node.args[0], cx);
  const isSum = node.name === 'sum';
  return (env) => {
    const list = arg(env);
    if (!Array.isArray(list))
      throw new GraphEvalError(`${node.name}() needs a list, or write ${node.name}(k, 1, 10, k^2).`);
    return isSum ? total(list) : list.reduce((a, b) => arith('*', a, b), 1);
  };
}

const GL_NODES = [0, 0.5384693101056831, -0.5384693101056831, 0.906179845938664, -0.906179845938664];
const GL_WEIGHTS = [
  0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908,
];
const GL_PANELS = 64;
const MAX_TERMS = 100000;

function compileBinder(node, cx) {
  const [nameNode, loNode, hiNode, bodyNode] = node.args;
  if (nameNode.type !== 'id') {
    throw new GraphCompileError(
      `${node.name}(...) starts with a variable name, like ${node.name}(k, 1, 10, k^2)`,
      node.pos,
    );
  }
  const lo = compileNode(loNode, cx);
  const hi = compileNode(hiNode, cx);
  return cx.withLocal(nameNode.name, (slot) => {
    const body = compileNode(bodyNode, cx);
    const bounds = (env) => {
      const a = lo(env);
      const b = hi(env);
      if (!isNum(a) || !isNum(b)) throw new GraphEvalError(`The bounds of ${node.name}() must be numbers.`);
      return [a, b];
    };
    if (node.name === 'int') {
      return (env) => {
        const [a, b] = bounds(env);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
        const half = (b - a) / (2 * GL_PANELS);
        let acc = 0;
        for (let p = 0; p < GL_PANELS; p += 1) {
          const centre = a + half * (2 * p + 1);
          for (let k = 0; k < GL_NODES.length; k += 1) {
            env[slot] = centre + half * GL_NODES[k];
            const v = body(env);
            if (!isNum(v) || !Number.isFinite(v)) return NaN;
            acc += GL_WEIGHTS[k] * v * half;
          }
        }
        return acc;
      };
    }
    const isSum = node.name === 'sum';
    return (env) => {
      const [a, b] = bounds(env);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
      const first = Math.ceil(a);
      const last = Math.floor(b);
      if (last - first + 1 > MAX_TERMS)
        throw new GraphEvalError(`${node.name}() has too many terms (the limit is ${MAX_TERMS}).`);
      let acc = isSum ? 0 : 1;
      for (let k = first; k <= last; k += 1) {
        env[slot] = k;
        const v = body(env);
        if (!isNum(v)) throw new GraphEvalError(`The expression inside ${node.name}() must be a number.`);
        acc = isSum ? acc + v : acc * v;
      }
      return acc;
    };
  });
}

function derivative(f, x, order) {
  const at = (v) => {
    const r = f(v);
    return isNum(r) ? r : NaN;
  };
  const scale = Math.max(1, Math.abs(x));
  if (order === 1) {
    const h = 1e-3 * scale;
    return (-at(x + 2 * h) + 8 * at(x + h) - 8 * at(x - h) + at(x - 2 * h)) / (12 * h);
  }
  const h = 1e-2 * scale;
  return (-at(x + 2 * h) + 16 * at(x + h) - 30 * at(x) + 16 * at(x - h) - at(x - 2 * h)) / (12 * h * h);
}

function compileDeriv(node, cx) {
  const fn = cx.scope.fns.get(node.name);
  if (!fn) {
    throw new GraphCompileError(
      `${node.name}' needs a function you have defined, like ${node.name}(x) = x^2`,
      node.pos,
    );
  }
  if (fn.arity !== 1) throw new GraphCompileError('Only functions of one variable can be differentiated', node.pos);
  if (node.order > 2) throw new GraphCompileError('Only first and second derivatives are supported', node.pos);
  if (node.args.length !== 1) throw new GraphCompileError(`${node.name}'() takes 1 argument`, node.pos);
  cx.refs.add(node.name);
  const arg = compileNode(node.args[0], cx);
  const f = (v) => fn.call1(v);
  return (env) => mapNumbers(`${node.name}'`, (x) => derivative(f, x, node.order), arg(env));
}

function makePoint(a, b) {
  if (isNum(a) && isNum(b)) return new Point(a, b);
  const la = Array.isArray(a);
  const lb = Array.isArray(b);
  if (la && lb && a.length !== b.length) {
    throw new GraphEvalError(
      `The coordinates of a point list must have the same length (${a.length} and ${b.length}).`,
    );
  }
  if (la || lb) {
    const length = la ? a.length : b.length;
    const out = new Array(length);
    for (let i = 0; i < length; i += 1) out[i] = makePoint(la ? a[i] : a, lb ? b[i] : b);
    return out;
  }
  throw new GraphEvalError('Point coordinates must be numbers.');
}

function compileListComp(node, cx) {
  const sources = node.bindings.map((b) => compileNode(b.source, cx));
  const names = node.bindings.map((b) => b.name);
  const slots = [];
  const saved = names.map((name) => cx.locals.get(name));
  for (const name of names) {
    const slot = cx.alloc();
    slots.push(slot);
    cx.locals.set(name, slot);
  }
  let body;
  try {
    body = compileNode(node.body, cx);
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) cx.locals.delete(name);
      else cx.locals.set(name, saved[i]);
    });
  }
  return (env) => {
    const lists = sources.map((f) => {
      const v = f(env);
      if (!Array.isArray(v)) throw new GraphEvalError('"for" needs a list, like for i=[1...5].');
      return v;
    });
    if (lists.reduce((n, l) => n * l.length, 1) > MAX_LIST) {
      throw new GraphEvalError(`Lists can have at most ${MAX_LIST} items.`);
    }
    const out = [];
    const run = (k) => {
      if (k === lists.length) {
        out.push(body(env));
        return;
      }
      for (const v of lists[k]) {
        env[slots[k]] = v;
        run(k + 1);
      }
    };
    run(0);
    return flattenItems(out);
  };
}

function compileIndex(node, cx) {
  const target = compileNode(node.target, cx);
  const { index } = node;
  if (index.type === 'range') {
    const start = compileNode(index.start, cx);
    const second = index.second ? compileNode(index.second, cx) : null;
    const end = index.end ? compileNode(index.end, cx) : null;
    return (env) => {
      const list = target(env);
      if (!Array.isArray(list)) throw new GraphEvalError('Only lists can be indexed with [ ].');
      const stop = end ? end(env) : list.length;
      return indexList(list, makeRange(start(env), second ? second(env) : null, stop));
    };
  }
  const pick = compileNode(index, cx);
  return (env) => {
    const list = target(env);
    const k = pick(env);
    if (Array.isArray(k) && k.length === 1 && isNum(k[0])) return indexList(list, k[0]);
    return indexList(list, k);
  };
}

function compileBin(node, cx) {
  const l = compileNode(node.left, cx);
  if (node.op === '^' && node.right.type === 'num' && node.right.value === 2) {
    return (env) => {
      const a = l(env);
      return isNum(a) ? a * a : arith('^', a, 2);
    };
  }
  return binary(node.op, l, compileNode(node.right, cx));
}

/** Compile an AST node to `(env) => value`. */
export function compileNode(node, cx) {
  switch (node.type) {
    case 'num': {
      const value = node.value;
      return () => value;
    }
    case 'id':
      return compileId(node, cx);
    case 'neg': {
      const a = compileNode(node.arg, cx);
      return (env) => {
        const v = a(env);
        return isNum(v) ? -v : negate(v);
      };
    }
    case 'abs': {
      const a = compileNode(node.arg, cx);
      return (env) => {
        const v = a(env);
        return isNum(v) ? Math.abs(v) : mapNumbers('abs', Math.abs, v);
      };
    }
    case 'fact': {
      const a = compileNode(node.arg, cx);
      return (env) => mapNumbers('factorial', factorial, a(env));
    }
    case 'deg': {
      const a = compileNode(node.arg, cx);
      return (env) => mapNumbers('degree', (d) => (d * Math.PI) / 180, a(env));
    }
    case 'bin':
      return compileBin(node, cx);
    case 'call':
      return compileCall(node, cx);
    case 'deriv':
      return compileDeriv(node, cx);
    case 'point': {
      const x = compileNode(node.x, cx);
      const y = compileNode(node.y, cx);
      return (env) => makePoint(x(env), y(env));
    }
    case 'list': {
      const items = node.items.map((item) => compileNode(item, cx));
      return (env) => flattenItems(items.map((f) => f(env)));
    }
    case 'range': {
      if (!node.end) throw new GraphCompileError('A range needs an end value, like [1...10]');
      const start = compileNode(node.start, cx);
      const second = node.second ? compileNode(node.second, cx) : null;
      const end = compileNode(node.end, cx);
      return (env) => makeRange(start(env), second ? second(env) : null, end(env));
    }
    case 'index':
      return compileIndex(node, cx);
    case 'listcomp':
      return compileListComp(node, cx);
    case 'piece': {
      const branches = node.branches.map((b) => ({ cond: compileCmp(b.cond, cx), value: compileNode(b.value, cx) }));
      const otherwise = node.otherwise ? compileNode(node.otherwise, cx) : null;
      return (env) => {
        for (const b of branches) if (b.cond(env)) return b.value(env);
        return otherwise ? otherwise(env) : NaN;
      };
    }
    case 'dot': {
      const target = compileNode(node.target, cx);
      const field = node.field;
      const pick = (v) => {
        if (v instanceof Point) return v[field];
        if (Array.isArray(v)) return v.map(pick);
        throw new GraphEvalError(`.${field} needs a point or a list of points.`);
      };
      return (env) => pick(target(env));
    }
    case 'cmp':
      throw new GraphCompileError('A comparison can only be used as a restriction or inside a piecewise value');
    default:
      throw new GraphCompileError('Unsupported expression');
  }
}
