/**
 * Parser for the geometry language. One line is a comment (`# ...`), a
 * definition (`M = midpoint(A, B)`), or a claim to check (`collinear(A, B, C)`).
 *
 * Numbers are exact rationals: `3`, `-1.5`, `3/4`. The parser never evaluates
 * anything; `engine.js` gives the syntax tree its meaning.
 */

export class DslError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DslError';
  }
}

const MAX_LINE = 300;
const MAX_NESTING = 12;
const NAME = /^[\p{L}][\p{L}\p{N}_']*/u;
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)/;

/** @typedef {{ t: 'num', n: bigint, d: bigint } | { t: 'id', name: string } | { t: 'call', name: string, args: Node[] } | { t: 'tuple', items: Node[] }} Node */

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

export function makeRational(n, d = 1n) {
  if (d === 0n) throw new DslError('A fraction cannot have a denominator of 0.');
  const g = gcd(n, d) || 1n;
  const sign = d < 0n ? -1n : 1n;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

/** Parse "3/4", "-1.5", "2" to a reduced { n, d }, or null. */
export function parseRational(text) {
  const match = /^\s*(-)?\s*(\d+(?:\.\d+)?|\.\d+)\s*(?:\/\s*(\d+(?:\.\d+)?|\.\d+))?\s*$/.exec(String(text));
  if (!match) return null;
  const fromDecimal = (s) => {
    const [whole, frac = ''] = s.split('.');
    return makeRational(BigInt((whole || '0') + frac), 10n ** BigInt(frac.length));
  };
  let { n, d } = fromDecimal(match[2]);
  if (match[3] !== undefined) {
    const den = fromDecimal(match[3]);
    if (den.n === 0n) return null;
    ({ n, d } = makeRational(n * den.d, d * den.n));
  }
  return match[1] ? { n: -n, d } : { n, d };
}

/** Format { n, d } as "3/4" or "3". */
export function formatRational({ n, d }) {
  return d === 1n ? String(n) : `${n}/${d}`;
}

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
    this.depth = 0;
  }

  skip() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1;
  }

  peek() {
    this.skip();
    return this.s[this.i] ?? '';
  }

  eat(ch) {
    if (this.peek() === ch) {
      this.i += 1;
      return true;
    }
    return false;
  }

  expect(ch, hint) {
    if (!this.eat(ch)) {
      const found = this.peek();
      throw new DslError(
        `Expected "${ch}"${hint ? ` ${hint}` : ''}${found ? `, found "${found}"` : ' at the end of the line'}.`,
      );
    }
  }

  number() {
    this.skip();
    let negative = false;
    if (this.s[this.i] === '-') {
      negative = true;
      this.i += 1;
      this.skip();
    }
    const rest = this.s.slice(this.i);
    const match = NUMBER.exec(rest);
    if (!match) throw new DslError('Expected a number such as 3, -1.5, or 3/4.');
    this.i += match[0].length;
    const [whole, frac = ''] = match[0].split('.');
    let value = makeRational(BigInt((whole || '0') + frac), 10n ** BigInt(frac.length));
    this.skip();
    if (this.s[this.i] === '/') {
      this.i += 1;
      this.skip();
      const denMatch = NUMBER.exec(this.s.slice(this.i));
      if (!denMatch) throw new DslError('Expected a number after "/".');
      this.i += denMatch[0].length;
      const [dw, df = ''] = denMatch[0].split('.');
      const den = makeRational(BigInt((dw || '0') + df), 10n ** BigInt(df.length));
      if (den.n === 0n) throw new DslError('A fraction cannot have a denominator of 0.');
      value = makeRational(value.n * den.d, value.d * den.n);
    }
    return { t: 'num', n: negative ? -value.n : value.n, d: value.d };
  }

  expr() {
    this.depth += 1;
    try {
      if (this.depth > MAX_NESTING) throw new DslError('This line is nested too deeply.');
      const ch = this.peek();
      if (ch === '(') {
        this.i += 1;
        const items = [this.expr()];
        while (this.eat(',')) items.push(this.expr());
        this.expect(')', 'to close the point');
        if (items.length !== 2 || items.some((n) => n.t !== 'num')) {
          throw new DslError('A point is written (x, y) with two numbers, like (3, -1/2).');
        }
        return { t: 'tuple', items };
      }
      if (ch === '-' || ch === '.' || /\d/.test(ch)) return this.number();
      const match = NAME.exec(this.s.slice(this.i));
      if (!match) {
        throw new DslError(
          ch
            ? `Unexpected "${ch}". Use a name, a number, or a construction like midpoint(A, B).`
            : 'Expected a name or number.',
        );
      }
      this.i += match[0].length;
      const name = match[0];
      if (this.peek() === '(') {
        this.i += 1;
        const args = [];
        if (this.peek() !== ')') {
          args.push(this.expr());
          while (this.eat(',')) args.push(this.expr());
        }
        this.expect(')', `to close ${name}(`);
        return { t: 'call', name, args };
      }
      return { t: 'id', name };
    } finally {
      this.depth -= 1;
    }
  }
}

/**
 * @typedef {{ kind: 'blank' } | { kind: 'comment', text: string } | { kind: 'assign', name: string, expr: Node }
 *   | { kind: 'claim', expr: Node } | { kind: 'error', message: string }} Statement
 */

/** Parse one line into a statement. Never throws. */
export function parseLine(raw) {
  const text = typeof raw === 'string' ? raw.slice(0, MAX_LINE) : '';
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'blank' };
  if (trimmed.startsWith('#')) return { kind: 'comment', text: trimmed.replace(/^#+\s*/, '') };
  try {
    const parser = new Parser(text);
    let name = null;
    const lead = NAME.exec(trimmed);
    if (lead) {
      const after = trimmed.slice(lead[0].length).trimStart();
      if (after.startsWith('=')) {
        name = lead[0];
        parser.skip();
        parser.i = text.indexOf('=') + 1;
      }
    }
    const expr = parser.expr();
    if (parser.peek() !== '') throw new DslError(`Unexpected "${parser.peek()}" after the end of the expression.`);
    if (name !== null) return { kind: 'assign', name, expr };
    return { kind: 'claim', expr };
  } catch (error) {
    if (error instanceof DslError) return { kind: 'error', message: error.message };
    throw error;
  }
}

/** Write a syntax tree back out as source text. */
export function formatNode(node) {
  if (node.t === 'num') return formatRational({ n: node.n, d: node.d });
  if (node.t === 'id') return node.name;
  if (node.t === 'tuple') return `(${node.items.map(formatNode).join(', ')})`;
  return `${node.name}(${node.args.map(formatNode).join(', ')})`;
}
