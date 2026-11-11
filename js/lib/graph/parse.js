/**
 * Lexer and parser for one line of the graphing language.
 *
 * A line is `expr [relation expr [relation expr]] [{restrictions}]`. Nothing is
 * evaluated here: the parser produces an AST that `compile.js` turns into
 * closures, so the app never needs eval or Function.
 *
 * Node types: num, id, neg, bin, call, deriv, ddx, point, list, range, index,
 * listcomp, piece, abs, fact, deg, dot, cmp. A `point` has `z` set when it was
 * written with three coordinates; only the 3D graph accepts those.
 */
import { RESERVED_WORDS, isFunctionName, BINDERS } from './names.js';

export class GraphSyntaxError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'GraphSyntaxError';
    this.position = position;
  }
}

export const MAX_LENGTH = 500;
const MAX_DEPTH = 48;
const RELATIONS = new Set(['=', '<', '>', '<=', '>=']);

/* ------------------------------------------------------------------- lexer */

function normalise(source) {
  return source
    .replace(/\u03c0/g, 'pi')
    .replace(/\u03c4/g, 'tau')
    .replace(/\u03b8/g, 'theta')
    .replace(/\u221a/g, 'sqrt')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/[\u00d7\u00b7\u22c5]/g, '*')
    .replace(/\u00f7/g, '/')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u00b2/g, '^2')
    .replace(/\u00b3/g, '^3')
    .replace(/\*\*/g, '^');
}

/** Split a run of letters into reserved words and single letters. */
function splitLetters(run) {
  const pieces = [];
  let i = 0;
  while (i < run.length) {
    const word = RESERVED_WORDS.find((w) => run.startsWith(w, i));
    if (word) {
      pieces.push(word);
      i += word.length;
    } else {
      pieces.push(run[i]);
      i += 1;
    }
  }
  return pieces;
}

const TOKEN = new RegExp(
  [
    '\\s*(?:',
    // numbers; "1...10" must lex as 1, ..., 10
    '(\\d+(?:\\.(?!\\.)\\d*)?(?:[eE][+-]?\\d+)?|\\.\\d+(?:[eE][+-]?\\d+)?)',
    '|([A-Za-z\\u03b1-\\u03c9]+)',
    "|(\\.\\.\\.|<=|>=|==|[-+*/^()\\[\\]{},:|'!=<>.\\u00b0])",
    ')',
  ].join(''),
  'y',
);
const SUBSCRIPT = /_(?:(\d+)|([A-Za-z])|\{([A-Za-z0-9]+)\})/y;

function tokenize(source) {
  const tokens = [];
  let pos = 0;
  while (pos < source.length) {
    TOKEN.lastIndex = pos;
    const match = TOKEN.exec(source);
    if (match === null) {
      const rest = source.slice(pos);
      if (rest.trim() === '') break;
      const at = pos + rest.search(/\S/);
      throw new GraphSyntaxError(`Unexpected character "${source[at]}"`, at);
    }
    pos = TOKEN.lastIndex;
    const start = match.index + (match[0].length - match[0].trimStart().length);
    if (match[1] !== undefined) {
      tokens.push({ type: 'num', value: Number(match[1]), pos: start });
    } else if (match[2] !== undefined) {
      const pieces = splitLetters(match[2]);
      SUBSCRIPT.lastIndex = pos;
      const sub = SUBSCRIPT.exec(source);
      if (sub) pos = SUBSCRIPT.lastIndex;
      pieces.forEach((piece, k) => {
        const last = k === pieces.length - 1;
        const name = last && sub ? `${piece}_${sub[1] ?? sub[2] ?? sub[3]}` : piece;
        tokens.push({ type: 'id', value: name, pos: start + k });
      });
    } else {
      tokens.push({ type: 'op', value: match[3] === '==' ? '=' : match[3], pos: start });
    }
  }
  tokens.push({ type: 'end', value: '', pos: source.length });
  return tokens;
}

/* ------------------------------------------------------------------ parser */

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    this.depth = 0;
    this.bars = 0;
  }

  peek(k = 0) {
    return this.tokens[Math.min(this.index + k, this.tokens.length - 1)];
  }

  next() {
    const token = this.tokens[this.index];
    if (this.index < this.tokens.length - 1) this.index += 1;
    return token;
  }

  isOp(value, k = 0) {
    const t = this.peek(k);
    return t.type === 'op' && t.value === value;
  }

  isRelation() {
    const t = this.peek();
    return t.type === 'op' && RELATIONS.has(t.value);
  }

  expectOp(value, hint = null) {
    if (!this.isOp(value)) {
      const t = this.peek();
      const base = t.type === 'end' ? `Expected "${value}" but the expression ended` : `Expected "${value}"`;
      throw new GraphSyntaxError(hint ? `${base}. ${hint}` : base, t.pos);
    }
    return this.next();
  }

  enter() {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new GraphSyntaxError('The expression is nested too deeply');
  }

  leave() {
    this.depth -= 1;
  }

  /** Parse with `|` bars disabled, as inside parentheses and brackets. */
  nested(fn) {
    const saved = this.bars;
    this.bars = 0;
    try {
      return fn();
    } finally {
      this.bars = saved;
    }
  }

  statement() {
    const parts = [this.exprFor()];
    const ops = [];
    while (this.isRelation()) {
      ops.push(this.next().value);
      parts.push(this.expr());
    }
    if (ops.length > 2) throw new GraphSyntaxError('At most two comparisons can be chained, like 0 < y < x');
    let restrictions = null;
    if (this.isOp('{')) restrictions = this.restriction();
    const t = this.peek();
    if (t.type !== 'end') throw new GraphSyntaxError(`Unexpected "${t.value}"`, t.pos);
    return { parts, ops, restrictions };
  }

  restriction() {
    this.expectOp('{');
    const conds = [];
    this.nested(() => {
      for (;;) {
        const first = this.expr();
        if (!this.isRelation()) {
          throw new GraphSyntaxError('A restriction needs a comparison, like {x > 0}', this.peek().pos);
        }
        conds.push(this.condFrom(first));
        if (this.isOp(',')) {
          this.next();
          continue;
        }
        break;
      }
    });
    this.expectOp('}');
    return conds;
  }

  condFrom(first) {
    const parts = [first];
    const ops = [];
    while (this.isRelation()) {
      ops.push(this.next().value);
      parts.push(this.expr());
    }
    if (ops.length > 2) throw new GraphSyntaxError('At most two comparisons can be chained');
    return { type: 'cmp', parts, ops };
  }

  /** An expression optionally followed by `for a=[...], b=[...]`. */
  exprFor() {
    const body = this.expr();
    const t = this.peek();
    if (t.type === 'id' && t.value === 'for') {
      this.next();
      const bindings = [];
      for (;;) {
        const name = this.next();
        if (name.type !== 'id' || isFunctionName(name.value)) {
          throw new GraphSyntaxError('"for" needs a variable name, like 2i for i=[1...5]', name.pos);
        }
        this.expectOp('=', 'Write it like 2i for i=[1...5].');
        bindings.push({ name: name.value, source: this.expr() });
        const more = this.isOp(',') && this.peek(1).type === 'id' && this.isOp('=', 2);
        if (!more) break;
        this.next();
      }
      return { type: 'listcomp', body, bindings };
    }
    return body;
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
    if (t.type === 'num') return true;
    if (t.type === 'id') return t.value !== 'for';
    if (t.type !== 'op') return false;
    if (t.value === '(' || t.value === '[') return true;
    return t.value === '|' && this.bars === 0;
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
    const base = this.postfix();
    if (this.isOp('^')) {
      this.next();
      return { type: 'bin', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  indexable(node) {
    return ['id', 'call', 'index', 'list', 'listcomp', 'range', 'dot'].includes(node.type) || node.grouped === true;
  }

  postfix() {
    let node = this.primary();
    for (;;) {
      if (this.isOp('!')) {
        this.next();
        node = { type: 'fact', arg: node };
      } else if (this.isOp('\u00b0')) {
        this.next();
        node = { type: 'deg', arg: node };
      } else if (this.isOp('[') && this.indexable(node)) {
        this.next();
        const index = this.nested(() => this.listBody(']'));
        node = { type: 'index', target: node, index };
      } else if (
        this.isOp('.') &&
        this.peek(1).type === 'id' &&
        (this.peek(1).value === 'x' || this.peek(1).value === 'y' || this.peek(1).value === 'z')
      ) {
        this.next();
        node = { type: 'dot', target: node, field: this.next().value };
      } else {
        return node;
      }
    }
  }

  args() {
    this.expectOp('(');
    const list = [];
    this.nested(() => {
      if (!this.isOp(')')) {
        list.push(this.expr());
        while (this.isOp(',')) {
          this.next();
          list.push(this.expr());
        }
      }
    });
    this.expectOp(')', 'Check that every ( has a matching ).');
    return list;
  }

  /** Exponent written between a function name and its argument: sin^2(x). */
  functionExponent() {
    this.expectOp('^');
    let negative = false;
    if (this.isOp('-')) {
      this.next();
      negative = true;
    }
    let value;
    const t = this.peek();
    if (t.type === 'num') {
      this.next();
      value = { type: 'num', value: t.value };
    } else if (this.isOp('(')) {
      this.next();
      value = this.nested(() => this.expr());
      this.expectOp(')');
    } else {
      throw new GraphSyntaxError('Write the exponent as a number or in parentheses, like sin^2(x)', t.pos);
    }
    return negative ? { type: 'neg', arg: value } : value;
  }

  primary() {
    const t = this.next();
    if (t.type === 'num') return { type: 'num', value: t.value };
    if (t.type === 'id') return this.identifier(t);
    if (t.type === 'op') {
      if (t.value === '(') {
        const first = this.nested(() => this.expr());
        if (this.isOp(',')) {
          this.next();
          const second = this.nested(() => this.expr());
          let third = null;
          if (this.isOp(',')) {
            this.next();
            third = this.nested(() => this.expr());
            if (this.isOp(',')) throw new GraphSyntaxError('Points have two or three coordinates', this.peek().pos);
          }
          this.expectOp(')');
          return third ? { type: 'point', x: first, y: second, z: third } : { type: 'point', x: first, y: second };
        }
        this.expectOp(')', 'Check that every ( has a matching ).');
        first.grouped = true;
        return first;
      }
      if (t.value === '[') return this.nested(() => this.listBody(']'));
      if (t.value === '{') return this.nested(() => this.piecewise());
      if (t.value === '|') {
        this.bars += 1;
        try {
          const arg = this.expr();
          this.expectOp('|', 'Close the absolute value with a second |.');
          return { type: 'abs', arg };
        } finally {
          this.bars -= 1;
        }
      }
    }
    if (t.type === 'end') throw new GraphSyntaxError('The expression ended unexpectedly', t.pos);
    throw new GraphSyntaxError(`Unexpected "${t.value}"`, t.pos);
  }

  identifier(t) {
    const name = t.value;
    if (name === 'for') throw new GraphSyntaxError('"for" must follow an expression, like 2i for i=[1...5]', t.pos);
    if (isFunctionName(name)) {
      let exponent = null;
      if (this.isOp('^') && !BINDERS.has(name)) exponent = this.functionExponent();
      if (!this.isOp('(')) {
        throw new GraphSyntaxError(`"${name}" needs parentheses, like ${name}(x)`, t.pos);
      }
      const call = { type: 'call', name, args: this.args(), pos: t.pos };
      return exponent ? { type: 'bin', op: '^', left: call, right: exponent } : call;
    }
    if (name === 'd' && this.startsDerivative()) {
      this.next();
      this.next();
      const variable = this.next().value;
      return { type: 'ddx', variable, arg: this.power(), pos: t.pos };
    }
    let primes = 0;
    while (this.isOp("'")) {
      this.next();
      primes += 1;
    }
    if (primes > 0) {
      if (!this.isOp('(')) throw new GraphSyntaxError(`Write the derivative as ${name}'(x)`, t.pos);
      return { type: 'deriv', name, order: primes, args: this.args(), pos: t.pos };
    }
    if (this.isOp('(')) return { type: 'call', name, args: this.args(), pos: t.pos };
    return { type: 'id', name, pos: t.pos };
  }

  /** After a `d`: is this `/dx`, the derivative operator (`d/dx x^2`)? */
  startsDerivative() {
    const [slash, d, v] = [this.peek(0), this.peek(1), this.peek(2)];
    return (
      slash.type === 'op' &&
      slash.value === '/' &&
      d.type === 'id' &&
      d.value === 'd' &&
      v.type === 'id' &&
      !isFunctionName(v.value) &&
      v.value !== 'for'
    );
  }

  /** Items of a list or range after "[" up to the closing bracket. */
  listBody(close) {
    if (this.isOp(close)) {
      this.next();
      return { type: 'list', items: [] };
    }
    const items = [];
    let ellipsis = -1;
    for (;;) {
      if (this.isOp('...')) {
        if (ellipsis >= 0) throw new GraphSyntaxError('A list can have only one "..."', this.peek().pos);
        ellipsis = items.length;
        this.next();
        if (this.isOp(',')) this.next();
        if (this.isOp(close)) break;
        continue;
      }
      items.push(items.length === 0 ? this.exprFor() : this.expr());
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      if (this.isOp('...')) continue;
      break;
    }
    this.expectOp(close, 'Check that every [ has a matching ].');
    if (ellipsis >= 0) {
      const before = items.slice(0, ellipsis);
      const after = items.slice(ellipsis);
      if (before.length < 1 || before.length > 2 || after.length > 1) {
        throw new GraphSyntaxError('Write ranges like [1...10] or [1, 3...11]');
      }
      return { type: 'range', start: before[0], second: before[1] ?? null, end: after[0] ?? null };
    }
    if (items.length === 1 && items[0].type === 'listcomp') return items[0];
    return { type: 'list', items };
  }

  piecewise() {
    const branches = [];
    let otherwise = null;
    for (;;) {
      const first = this.expr();
      if (this.isRelation()) {
        const cond = this.condFrom(first);
        this.expectOp(':', 'Write piecewise values like {x < 0: -x, x}.');
        branches.push({ cond, value: this.expr() });
      } else {
        otherwise = first;
        break;
      }
      if (this.isOp(',')) {
        this.next();
        if (this.isOp('}')) break;
        continue;
      }
      break;
    }
    this.expectOp('}', 'Put the default value last, like {x < 0: -x, x}.');
    if (branches.length === 0) {
      throw new GraphSyntaxError('Write piecewise values like {x < 0: -x, x}');
    }
    return { type: 'piece', branches, otherwise };
  }
}

/**
 * Parse a line into `{ parts, ops, restrictions }`.
 * `parts` has one more entry than `ops`; `restrictions` is null or a list of comparisons.
 */
export function parseStatement(source) {
  if (typeof source !== 'string') throw new GraphSyntaxError('Expression must be text');
  if (source.length > MAX_LENGTH) throw new GraphSyntaxError(`Expressions can be at most ${MAX_LENGTH} characters`);
  const text = normalise(source);
  if (text.trim() === '') throw new GraphSyntaxError('Enter an expression');
  return new Parser(tokenize(text)).statement();
}

/** Parse text that must be one plain expression, such as a slider bound. */
export function parseExpression(source) {
  const stmt = parseStatement(source);
  if (stmt.ops.length > 0 || stmt.restrictions) throw new GraphSyntaxError('Enter a number or an expression');
  return stmt.parts[0];
}
