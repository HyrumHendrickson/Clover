/**
 * Typeset a line of the graphing language the way a textbook would: powers
 * rise, fractions stack, roots get a radical, Greek names become letters, and
 * sum, prod, and int become big operators with limits.
 *
 * The layout parser is tolerant on purpose. It runs while someone is typing, so
 * unclosed brackets and dangling operators render as far as they go instead of
 * failing. It never evaluates anything and is separate from the real parser.
 *
 * `layout(text)` returns a plain tree (unit tested without a DOM); `typeset(text)`
 * renders that tree with `h()`, so text is always inserted as text.
 */
import { h } from '../../core/dom.js';
import { RESERVED_WORDS, isFunctionName } from './names.js';

const MAX_DEPTH = 40;

/** Words that become one Greek letter, and the letter they become. */
export const GREEK = {
  theta: '\u03b8',
  pi: '\u03c0',
  tau: '\u03c4',
  alpha: '\u03b1',
  beta: '\u03b2',
  gamma: '\u03b3',
  delta: '\u03b4',
  epsilon: '\u03b5',
  lambda: '\u03bb',
  phi: '\u03c6',
  sigma: '\u03c3',
  omega: '\u03c9',
};

/** Letters that stay upright, like constants and units, rather than italic variables. */
const UPRIGHT_GREEK = new Set(['pi', 'tau']);

/* ------------------------------------------------------------------- lexer */

const WORD = /[A-Za-z\u03b1-\u03c9]+/y;
const NUMBER = /(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const SUB = /_(?:(\d+)|([A-Za-z])|\{([A-Za-z0-9]+)\})/y;
const OPERATORS = ['...', '<=', '>=', '==', '\u2264', '\u2265'];

function splitWord(run) {
  const pieces = [];
  let i = 0;
  while (i < run.length) {
    const word =
      RESERVED_WORDS.find((w) => run.startsWith(w, i)) ?? Object.keys(GREEK).find((w) => run.startsWith(w, i));
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

function lex(source) {
  const text = source
    .replace(/\*\*/g, '^')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/\u03c0/g, 'pi')
    .replace(/\u03c4/g, 'tau')
    .replace(/\u03b8/g, 'theta')
    .replace(/\u221a/g, 'sqrt');
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    NUMBER.lastIndex = pos;
    const num = NUMBER.exec(text);
    if (num) {
      tokens.push({ k: 'num', s: num[0] });
      pos = NUMBER.lastIndex;
      continue;
    }
    WORD.lastIndex = pos;
    const word = WORD.exec(text);
    if (word) {
      pos = WORD.lastIndex;
      const pieces = splitWord(word[0]);
      SUB.lastIndex = pos;
      const sub = SUB.exec(text);
      if (sub) pos = SUB.lastIndex;
      pieces.forEach((piece, i) => {
        const last = i === pieces.length - 1;
        tokens.push({ k: 'word', s: piece, sub: last && sub ? (sub[1] ?? sub[2] ?? sub[3]) : null });
      });
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, pos));
    if (op) {
      tokens.push({ k: 'op', s: op });
      pos += op.length;
      continue;
    }
    tokens.push({ k: 'op', s: ch });
    pos += 1;
  }
  return tokens;
}

/* ------------------------------------------------------------------ layout */

const RELATIONS = new Set(['=', '==', '<', '>', '<=', '>=', '\u2264', '\u2265', ':']);
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const GLYPHS = { '*': '\u00b7', '-': '\u2212', '<=': '\u2264', '>=': '\u2265', '==': '=', '...': '\u2026' };
const BIG = { sum: '\u2211', prod: '\u220f', int: '\u222b' };

class Layout {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
    this.depth = 0;
  }

  peek(k = 0) {
    return this.tokens[this.i + k] ?? null;
  }

  next() {
    const t = this.tokens[this.i];
    this.i += 1;
    return t ?? null;
  }

  isOp(s, k = 0) {
    const t = this.peek(k);
    return t !== null && t.k === 'op' && t.s === s;
  }

  /** Nodes until one of `stops` (not consumed) or the end of the text. */
  sequence(stops = []) {
    this.depth += 1;
    const out = [];
    try {
      if (this.depth > MAX_DEPTH) {
        this.i = this.tokens.length;
        return out;
      }
      for (;;) {
        const t = this.peek();
        if (t === null) break;
        if (t.k === 'op' && stops.includes(t.s)) break;
        this.step(out);
      }
    } finally {
      this.depth -= 1;
    }
    return out;
  }

  step(out) {
    const t = this.peek();
    if (t.k === 'op' && t.s === '/') {
      this.fraction(out);
      return;
    }
    if (t.k === 'op' && t.s === '^') {
      this.next();
      const base = out.pop() ?? { k: 'gap' };
      out.push({ k: 'sup', base, exp: this.exponent() });
      return;
    }
    out.push(...this.atom(out));
  }

  /** An operand with its own postfix marks, as a list of nodes. */
  operand() {
    const out = [];
    const t = this.peek();
    if (t === null) return out;
    if (t.k === 'op' && (t.s === '-' || t.s === '+')) {
      this.next();
      out.push({ k: 'op', s: GLYPHS[t.s] ?? t.s, tight: true });
    }
    const first = this.peek();
    if (first === null || (first.k === 'op' && !(first.s in OPENERS) && first.s !== '|')) return out;
    out.push(...this.atom(out));
    while (this.isOp('^') || this.isOp('!') || this.isOp("'") || this.isOp('\u00b0')) {
      const mark = this.next();
      if (mark.s === '^') {
        const base = out.pop() ?? { k: 'gap' };
        out.push({ k: 'sup', base, exp: this.exponent() });
      } else {
        out.push(this.postfix(mark));
      }
    }
    return out;
  }

  /** The exponent after ^: a sign, then a number, a name, or a bracketed group. */
  exponent() {
    const nodes = this.operand();
    if (nodes.length === 1 && nodes[0].k === 'fence' && nodes[0].open === '(') return nodes[0].arg;
    return nodes;
  }

  postfix(mark) {
    if (mark.s === "'") return { k: 'prime' };
    if (mark.s === '\u00b0') return { k: 'text', s: '\u00b0' };
    return { k: 'text', s: '!' };
  }

  /** a/b: the previous atom over the next one. Brackets around either are dropped. */
  fraction(out) {
    this.next();
    const prev = out[out.length - 1];
    const stackable = prev && prev.k !== 'op' && prev.k !== 'comma' && prev.k !== 'gap';
    if (!stackable) {
      out.push({ k: 'op', s: '/', tight: true });
      return;
    }
    out.pop();
    const unwrap = (node) => (node.k === 'fence' && node.open === '(' ? node.arg : [node]);
    const isDerivative = prev.k === 'var' && prev.s === 'd' && this.peek()?.k === 'word' && this.peek().s === 'd';
    if (isDerivative) {
      this.next();
      const v = this.next();
      out.push({
        k: 'frac',
        num: [{ k: 'func', s: 'd' }],
        den: [{ k: 'func', s: 'd' }, ...(v ? [this.word(v)[0]] : [])],
      });
      return;
    }
    const den = this.operand();
    const denominator = den.length === 1 ? unwrap(den[0]) : den;
    out.push({ k: 'frac', num: unwrap(prev), den: denominator });
  }

  atom(out) {
    const t = this.next();
    if (t.k === 'num') return [{ k: 'num', s: t.s }];
    if (t.k === 'word') return this.word(t);
    const { s } = t;
    if (s in OPENERS) return [this.fence(s)];
    if (s === '|') {
      const arg = this.sequence(['|']);
      if (this.isOp('|')) this.next();
      return [{ k: 'abs', arg }];
    }
    if (s === ',') return [{ k: 'comma' }];
    if (s === '!' || s === "'" || s === '\u00b0') return [this.postfix(t)];
    if (s === ')' || s === ']' || s === '}') return [{ k: 'text', s }];
    if (RELATIONS.has(s)) return [{ k: 'op', s: GLYPHS[s] ?? s, rel: true }];
    if (s === '+' || s === '-' || s === '*' || s === '...') {
      const before = out[out.length - 1];
      const unary = !before || before.k === 'op' || before.k === 'comma' || before.k === 'gap';
      return [{ k: 'op', s: GLYPHS[s] ?? s, tight: unary && s !== '*' && s !== '...' }];
    }
    return [{ k: 'text', s }];
  }

  fence(open) {
    const close = OPENERS[open];
    const arg = this.sequence([close]);
    if (this.isOp(close)) this.next();
    return { k: 'fence', open, close, arg };
  }

  /** Arguments of a call, split at top-level commas, after the opening bracket. */
  callArgs() {
    this.next();
    const args = [];
    for (;;) {
      args.push(this.sequence([',', ')']));
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    if (this.isOp(')')) this.next();
    return args;
  }

  word(t) {
    const name = t.s;
    const callNext = this.isOp('(');
    if (callNext && name === 'sqrt') {
      const [arg = []] = this.callArgs();
      return [{ k: 'sqrt', arg, index: null }];
    }
    if (callNext && name === 'nthroot') {
      const [n = [], arg = []] = this.callArgs();
      return [{ k: 'sqrt', arg, index: n }];
    }
    if (callNext && name === 'abs') {
      const [arg = []] = this.callArgs();
      return [{ k: 'abs', arg }];
    }
    if (callNext && name in BIG) {
      const start = this.i;
      const args = this.callArgs();
      const [v, lo, hi, body] = args;
      const name1 = v?.length === 1 && v[0].k === 'var' ? v[0] : null;
      if (args.length === 4 && name1) return [this.bigOperator(name, name1, lo, hi, body)];
      this.i = start;
    }
    if (name === 'for') return [{ k: 'func', s: 'for', spaced: true }];
    if (name in GREEK) {
      const letter = GREEK[name];
      return [UPRIGHT_GREEK.has(name) ? { k: 'func', s: letter } : { k: 'var', s: letter, sub: t.sub }];
    }
    if (isFunctionName(name) || (name === 'log' && t.sub)) {
      return [{ k: 'func', s: name, sub: t.sub, call: callNext }];
    }
    return [{ k: 'var', s: name, sub: t.sub }];
  }

  bigOperator(name, variable, lower, upper, body) {
    if (name === 'int') {
      return { k: 'big', sym: BIG.int, side: true, lower, upper, body, differential: variable };
    }
    return {
      k: 'big',
      sym: BIG[name],
      side: false,
      lower: [variable, { k: 'op', s: '=', rel: true }, ...lower],
      upper,
      body,
    };
  }
}

/**
 * Parse `source` into a layout tree: an array of nodes. Node kinds: num, var,
 * func, text, op, comma, gap, sup, frac, sqrt, abs, fence, big, prime.
 */
export function layout(source) {
  if (typeof source !== 'string') return [];
  const parser = new Layout(lex(source.slice(0, 600)));
  const nodes = [];
  while (parser.peek() !== null) nodes.push(...parser.sequence([]));
  return nodes;
}

/* ---------------------------------------------------------------- renderer */

const hasTall = (nodes) =>
  nodes.some((n) => ['frac', 'big', 'sqrt', 'sup'].includes(n.k) && (n.k !== 'sup' || hasTall([n.base])));
const span = (cls, ...children) => h('span', { class: cls }, ...children);

function renderNodes(nodes) {
  return nodes.map(renderNode);
}

function renderNode(n) {
  switch (n.k) {
    case 'num':
      return span('mt-n', n.s);
    case 'var':
      return n.sub ? span('mt-v', n.s, span('mt-sub', n.sub)) : span('mt-v', n.s);
    case 'func': {
      const el = span(n.spaced ? 'mt-f mt-spaced' : 'mt-f', n.s);
      if (n.sub) el.append(span('mt-sub', n.sub));
      return el;
    }
    case 'text':
      return span('mt-t', n.s);
    case 'prime':
      return span('mt-prime', '\u2032');
    case 'comma':
      return span('mt-comma', ',');
    case 'gap':
      return span('mt-gap');
    case 'op':
      return span(`mt-o${n.tight ? ' mt-tight' : ''}${n.rel ? ' mt-rel' : ''}`, n.s);
    case 'sup':
      return span(
        'mt-supwrap',
        renderNode(n.base),
        span('mt-sup', ...renderNodes(n.exp), n.exp.length ? null : span('mt-gap')),
      );
    case 'frac':
      return span('mt-frac', span('mt-num', ...renderNodes(n.num)), span('mt-den', ...renderNodes(n.den)));
    case 'sqrt':
      return span(
        'mt-sqrt',
        n.index ? span('mt-index', ...renderNodes(n.index)) : null,
        span('mt-radix', '\u221a'),
        span('mt-radicand', ...renderNodes(n.arg)),
      );
    case 'abs':
      return span(`mt-abs${hasTall(n.arg) ? ' mt-tall' : ''}`, span('mt-bar'), ...renderNodes(n.arg), span('mt-bar'));
    case 'fence':
      return span(
        `mt-fence${hasTall(n.arg) ? ' mt-tall' : ''}`,
        span('mt-open', n.open),
        span('mt-inner', ...renderNodes(n.arg)),
        span('mt-close', n.close),
      );
    case 'big': {
      const lims = n.side
        ? span('mt-lims', span('mt-lim', ...renderNodes(n.upper)), span('mt-lim', ...renderNodes(n.lower)))
        : null;
      const stack = n.side
        ? span('mt-bigside', span('mt-sym mt-sym-int', n.sym), lims)
        : span(
            'mt-bigstack',
            span('mt-lim', ...renderNodes(n.upper)),
            span('mt-sym', n.sym),
            span('mt-lim', ...renderNodes(n.lower)),
          );
      return span(
        'mt-big',
        stack,
        span('mt-body', ...renderNodes(n.body)),
        n.differential ? span('mt-diff', span('mt-f', 'd'), renderNode(n.differential)) : null,
      );
    }
    default:
      return span('mt-t');
  }
}

/** Render `source` as typeset math: a `span.mt` ready to insert. */
export function typeset(source) {
  const root = span('mt');
  try {
    root.append(...renderNodes(layout(source)));
  } catch {
    root.replaceChildren(document.createTextNode(String(source ?? '')));
  }
  return root;
}

/* ------------------------------------------------------------ typing aids */

/** Words that turn into a letter as soon as they are typed. */
const AUTO_LETTER = new Set(Object.keys(GREEK));

/**
 * Replace a Greek name the person has just finished typing with its letter.
 * Only the run of letters ending at the caret is considered, and only when it
 * is exactly one of the names (so `theta` becomes \u03b8 but `beta` is not read as `eta`).
 *
 * @returns {{ text: string, caret: number }}
 */
export function autoSymbols(text, caret = text.length) {
  const before = text.slice(0, caret);
  const run = /[A-Za-z]+$/.exec(before);
  if (!run || !AUTO_LETTER.has(run[0])) return { text, caret };
  const start = run.index;
  if (before[start - 1] === '_' || before[start - 1] === '{') return { text, caret };
  const letter = GREEK[run[0]];
  return { text: text.slice(0, start) + letter + text.slice(caret), caret: start + letter.length };
}
