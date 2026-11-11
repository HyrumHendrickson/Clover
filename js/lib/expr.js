/**
 * Expression parser and compilers.
 *
 * One grammar feeds two back ends:
 *   - compileReal    -> (x, y, ...) => number
 *   - compileComplex -> (re, im) => [re, im]   (shared output buffer)
 *
 * Expressions are interpreted by closures, never through eval or Function,
 * so the app runs under a strict Content-Security-Policy.
 */
import * as C from './complexmath.js';

export class ExpressionError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

/** Every function name the parser recognises as a call. */
const CALLABLE = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'ln',
  'log',
  'log2',
  'log10',
  'sqrt',
  'cbrt',
  'abs',
  'sign',
  'floor',
  'ceil',
  'round',
  'min',
  'max',
  'atan2',
  'pow',
  'mod',
  'hypot',
  'conj',
  're',
  'im',
  'arg',
  'gamma',
]);

/* ------------------------------------------------------------------ lexer */

function normalise(source) {
  return source
    .replace(/\u03c0/g, 'pi')
    .replace(/\u03c4/g, 'tau')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/[\u00d7\u00b7\u22c5]/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/\*\*/g, '^');
}

function tokenize(source) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))/y;
  let match;
  while (re.lastIndex < source.length && (match = re.exec(source)) !== null) {
    const pos = match.index + match[0].length - 1;
    if (match[1] !== undefined) tokens.push({ type: 'num', value: Number(match[1]), pos });
    else if (match[2] !== undefined) tokens.push({ type: 'id', value: match[2], pos });
    else if ('+-*/^(),'.includes(match[3])) tokens.push({ type: 'op', value: match[3], pos });
    else if (/\s/.test(match[3])) continue;
    else throw new ExpressionError(`Unexpected character "${match[3]}"`, pos);
  }
  tokens.push({ type: 'end', value: '', pos: source.length });
  return tokens;
}

/* ----------------------------------------------------------------- parser */

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  next() {
    return this.tokens[this.index++];
  }

  isOp(value) {
    const t = this.peek();
    return t.type === 'op' && t.value === value;
  }

  expectOp(value) {
    if (!this.isOp(value)) {
      const t = this.peek();
      throw new ExpressionError(
        t.type === 'end' ? `Expected "${value}" but the expression ended` : `Expected "${value}"`,
        t.pos,
      );
    }
    return this.next();
  }

  enter() {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new ExpressionError('Expression is nested too deeply');
  }

  leave() {
    this.depth -= 1;
  }

  parse() {
    const node = this.expr();
    const t = this.peek();
    if (t.type !== 'end') throw new ExpressionError(`Unexpected "${t.value}"`, t.pos);
    return node;
  }

  expr() {
    this.enter();
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      left = { type: 'bin', op, left, right: this.term() };
    }
    this.leave();
    return left;
  }

  startsOperand() {
    const t = this.peek();
    return t.type === 'num' || t.type === 'id' || (t.type === 'op' && t.value === '(');
  }

  term() {
    let left = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = this.next().value;
        left = { type: 'bin', op, left, right: this.unary() };
      } else if (this.startsOperand()) {
        left = { type: 'bin', op: '*', left, right: this.power() };
      } else {
        return left;
      }
    }
  }

  unary() {
    if (this.isOp('-')) {
      this.next();
      return { type: 'neg', arg: this.unary() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  power() {
    const base = this.primary();
    if (this.isOp('^')) {
      this.next();
      return { type: 'bin', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  primary() {
    const t = this.next();
    if (t.type === 'num') return { type: 'num', value: t.value };
    if (t.type === 'id') {
      if (CALLABLE.has(t.value)) {
        if (!this.isOp('(')) {
          throw new ExpressionError(`"${t.value}" needs parentheses, e.g. ${t.value}(z)`, t.pos);
        }
        this.next();
        const args = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.next();
            args.push(this.expr());
          }
        }
        this.expectOp(')');
        return { type: 'call', name: t.value, args, pos: t.pos };
      }
      return { type: 'id', name: t.value, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = this.expr();
      this.expectOp(')');
      return inner;
    }
    if (t.type === 'end') throw new ExpressionError('The expression ended unexpectedly', t.pos);
    throw new ExpressionError(`Unexpected "${t.value}"`, t.pos);
  }
}

/** Parse source text into an AST. Throws ExpressionError. */
export function parse(source) {
  if (typeof source !== 'string') throw new ExpressionError('Expression must be text');
  if (source.length > MAX_LENGTH) throw new ExpressionError('Expression is too long');
  const text = normalise(source);
  if (text.trim() === '') throw new ExpressionError('Enter an expression');
  return new Parser(tokenize(text)).parse();
}

/* ------------------------------------------------------------- real back end */

const REAL_CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

const REAL_FUNCTIONS = {
  sin: [1, Math.sin],
  cos: [1, Math.cos],
  tan: [1, Math.tan],
  cot: [1, (x) => 1 / Math.tan(x)],
  sec: [1, (x) => 1 / Math.cos(x)],
  csc: [1, (x) => 1 / Math.sin(x)],
  asin: [1, Math.asin],
  acos: [1, Math.acos],
  atan: [1, Math.atan],
  sinh: [1, Math.sinh],
  cosh: [1, Math.cosh],
  tanh: [1, Math.tanh],
  asinh: [1, Math.asinh],
  acosh: [1, Math.acosh],
  atanh: [1, Math.atanh],
  exp: [1, Math.exp],
  ln: [1, Math.log],
  log: [1, Math.log],
  log2: [1, Math.log2],
  log10: [1, Math.log10],
  sqrt: [1, Math.sqrt],
  cbrt: [1, Math.cbrt],
  abs: [1, Math.abs],
  sign: [1, Math.sign],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  round: [1, Math.round],
  atan2: [2, Math.atan2],
  pow: [2, Math.pow],
  hypot: [2, Math.hypot],
  mod: [2, (a, b) => ((a % b) + b) % b],
  min: [2, Math.min],
  max: [2, Math.max],
};

function checkArity(node, expected) {
  if (node.args.length !== expected) {
    const noun = expected === 1 ? 'argument' : 'arguments';
    throw new ExpressionError(`${node.name}() takes ${expected} ${noun}`, node.pos);
  }
}

function buildReal(node, variables) {
  switch (node.type) {
    case 'num': {
      const v = node.value;
      return () => v;
    }
    case 'id': {
      const slot = variables.indexOf(node.name);
      if (slot >= 0) return (env) => env[slot];
      if (Object.hasOwn(REAL_CONSTANTS, node.name)) {
        const v = REAL_CONSTANTS[node.name];
        return () => v;
      }
      throw new ExpressionError(`Unknown name "${node.name}"`, node.pos);
    }
    case 'neg': {
      const a = buildReal(node.arg, variables);
      return (env) => -a(env);
    }
    case 'bin': {
      const a = buildReal(node.left, variables);
      const b = buildReal(node.right, variables);
      switch (node.op) {
        case '+':
          return (env) => a(env) + b(env);
        case '-':
          return (env) => a(env) - b(env);
        case '*':
          return (env) => a(env) * b(env);
        case '/':
          return (env) => a(env) / b(env);
        default:
          return (env) => Math.pow(a(env), b(env));
      }
    }
    case 'call': {
      const entry = Object.hasOwn(REAL_FUNCTIONS, node.name) ? REAL_FUNCTIONS[node.name] : null;
      if (!entry) throw new ExpressionError(`${node.name}() is not available for real values`, node.pos);
      checkArity(node, entry[0]);
      const fn = entry[1];
      const args = node.args.map((arg) => buildReal(arg, variables));
      if (args.length === 1) return (env) => fn(args[0](env));
      return (env) => fn(args[0](env), args[1](env));
    }
    default:
      throw new ExpressionError('Unsupported expression');
  }
}

/**
 * Compile a real-valued expression of the named variables.
 * @param {string} source
 * @param {string[]} variables e.g. ['x', 'y']
 * @returns {(...values: number[]) => number}
 */
export function compileReal(source, variables = []) {
  const root = buildReal(parse(source), variables);
  const env = new Array(variables.length).fill(0);
  return (...values) => {
    for (let i = 0; i < env.length; i += 1) env[i] = values[i] ?? 0;
    return root(env);
  };
}

/** Evaluate a constant expression such as "1/2" or "sqrt(2)/2". Returns NaN if invalid. */
export function evaluateNumber(source) {
  const text = String(source ?? '').trim();
  if (text === '') return 0;
  try {
    return compileReal(text, [])();
  } catch {
    return NaN;
  }
}

/* ---------------------------------------------------------- complex back end */

const COMPLEX_CONSTANTS = {
  pi: [Math.PI, 0],
  e: [Math.E, 0],
  tau: [Math.PI * 2, 0],
  i: [0, 1],
};

const COMPLEX_UNARY = {
  sin: C.sin,
  cos: C.cos,
  tan: C.tan,
  cot: C.cot,
  sec: C.sec,
  csc: C.csc,
  asin: C.asin,
  acos: C.acos,
  atan: C.atan,
  sinh: C.sinh,
  cosh: C.cosh,
  tanh: C.tanh,
  asinh: C.asinh,
  acosh: C.acosh,
  atanh: C.atanh,
  exp: C.exp,
  ln: C.log,
  log: C.log,
  sqrt: C.sqrt,
  conj: C.conj,
  gamma: C.gamma,
};

const COMPLEX_REAL_VALUED = {
  abs: (a) => C.abs(a),
  arg: (a) => C.arg(a),
  re: (a) => a[0],
  im: (a) => a[1],
};

function containsVariable(node) {
  switch (node.type) {
    case 'id':
      return node.name === 'z';
    case 'neg':
      return containsVariable(node.arg);
    case 'bin':
      return containsVariable(node.left) || containsVariable(node.right);
    case 'call':
      return node.args.some(containsVariable);
    default:
      return false;
  }
}

function buildComplex(node) {
  switch (node.type) {
    case 'num': {
      const value = [node.value, 0];
      return () => value;
    }
    case 'id': {
      if (node.name === 'z') {
        const out = [0, 0];
        return (re, im) => {
          out[0] = re;
          out[1] = im;
          return out;
        };
      }
      if (Object.hasOwn(COMPLEX_CONSTANTS, node.name)) {
        const value = COMPLEX_CONSTANTS[node.name];
        return () => value;
      }
      throw new ExpressionError(`Unknown name "${node.name}"; use z as the variable`, node.pos);
    }
    case 'neg': {
      const a = buildComplex(node.arg);
      const out = [0, 0];
      return (re, im) => C.neg(a(re, im), out);
    }
    case 'bin': {
      const a = buildComplex(node.left);
      const out = [0, 0];
      if (node.op === '^') {
        const exponent = foldConstant(node.right);
        if (exponent && exponent[1] === 0 && Number.isInteger(exponent[0]) && Math.abs(exponent[0]) <= 64) {
          const n = exponent[0];
          return (re, im) => C.powInt(a(re, im), n, out);
        }
      }
      const b = buildComplex(node.right);
      switch (node.op) {
        case '+':
          return (re, im) => C.add(a(re, im), b(re, im), out);
        case '-':
          return (re, im) => C.sub(a(re, im), b(re, im), out);
        case '*':
          return (re, im) => C.mul(a(re, im), b(re, im), out);
        case '/':
          return (re, im) => C.div(a(re, im), b(re, im), out);
        default:
          return (re, im) => C.pow(a(re, im), b(re, im), out);
      }
    }
    case 'call': {
      checkArity(node, 1);
      const arg = buildComplex(node.args[0]);
      const out = [0, 0];
      if (Object.hasOwn(COMPLEX_UNARY, node.name)) {
        const fn = COMPLEX_UNARY[node.name];
        return (re, im) => fn(arg(re, im), out);
      }
      if (Object.hasOwn(COMPLEX_REAL_VALUED, node.name)) {
        const fn = COMPLEX_REAL_VALUED[node.name];
        return (re, im) => {
          out[0] = fn(arg(re, im));
          out[1] = 0;
          return out;
        };
      }
      throw new ExpressionError(`${node.name}() is not available for complex values`, node.pos);
    }
    default:
      throw new ExpressionError('Unsupported expression');
  }
}

/** Evaluate a subtree that does not depend on z, or return null. */
function foldConstant(node) {
  if (containsVariable(node)) return null;
  try {
    const value = buildComplex(node)(0, 0);
    return [value[0], value[1]];
  } catch {
    return null;
  }
}

/**
 * Compile a function of the complex variable z.
 * The returned function writes into a shared buffer; copy the result if it
 * must outlive the next call.
 * @param {string} source e.g. "(z^2 - 1) / (z^2 + 1)"
 * @returns {(re: number, im: number) => [number, number]}
 */
export function compileComplex(source) {
  return buildComplex(parse(source));
}
