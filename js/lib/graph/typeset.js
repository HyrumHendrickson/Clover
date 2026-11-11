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
 *
 * Every node records where it came from (`p` and `e`, offsets into the source).
 * `typeset(text, { anchors: true })` also drops a zero-width marker at each place
 * the caret may sit, which is how the math field edits typeset math in place: the
 * text stays the source of truth and the markers say where each offset is drawn.
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

/** Single characters that stand for a word. They are written into the text as typed or pasted. */
const GLYPH_WORDS = {
  '\u03c0': 'pi',
  '\u03c4': 'tau',
  '\u03b8': 'theta',
  '\u221a': 'sqrt',
  '\u2211': 'sum',
  '\u220f': 'prod',
  '\u222b': 'int',
};

/* ------------------------------------------------------------------- lexer */

const WORD = /[A-Za-z\u03b1-\u03c9]+/y;
const NUMBER = /(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const SUB = /_(?:(\d+)|([A-Za-z])|\{([A-Za-z0-9]+)\})/y;
const OPERATORS = ['...', '<=', '>=', '==', '\u2264', '\u2265'];
const MAX_SOURCE = 600;

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

/**
 * Tokens carry `p` and `e`, the offsets of their first character and the one after
 * their last, in the original text. Subscripts record their own range as well.
 */
function lex(text) {
  const tokens = [];
  let pos = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (/\s/.test(ch)) {
      pos += 1;
      continue;
    }
    if (ch === '*' && text[pos + 1] === '*') {
      tokens.push({ k: 'op', s: '^', p: pos, e: pos + 2 });
      pos += 2;
      continue;
    }
    if (ch === '\u2212' || ch === '\u2013' || ch === '\u2014') {
      tokens.push({ k: 'op', s: '-', p: pos, e: pos + 1 });
      pos += 1;
      continue;
    }
    if (Object.hasOwn(GLYPH_WORDS, ch)) {
      tokens.push({ k: 'word', s: GLYPH_WORDS[ch], p: pos, e: pos + 1, glyph: true });
      pos += 1;
      continue;
    }
    NUMBER.lastIndex = pos;
    const num = NUMBER.exec(text);
    if (num) {
      const end = NUMBER.lastIndex;
      tokens.push({ k: 'num', s: num[0], p: pos, e: end });
      pos = end;
      continue;
    }
    WORD.lastIndex = pos;
    const word = WORD.exec(text);
    if (word) {
      const start = pos;
      pos = WORD.lastIndex;
      const pieces = splitWord(word[0]);
      SUB.lastIndex = pos;
      const sub = SUB.exec(text);
      const subStart = pos;
      if (sub) pos = SUB.lastIndex;
      let at = start;
      pieces.forEach((piece, i) => {
        const last = i === pieces.length - 1;
        const token = { k: 'word', s: piece, p: at, e: at + piece.length, sub: null };
        if (last && sub) {
          token.sub = sub[1] ?? sub[2] ?? sub[3];
          token.be = at + piece.length;
          token.e = pos;
          token.subFrom = sub[3] === undefined ? subStart + 1 : subStart + 2;
          token.subTo = token.subFrom + token.sub.length;
        }
        at += piece.length;
        tokens.push(token);
      });
      continue;
    }
    const op = OPERATORS.find((o) => text.startsWith(o, pos));
    if (op) {
      tokens.push({ k: 'op', s: op, p: pos, e: pos + op.length });
      pos += op.length;
      continue;
    }
    tokens.push({ k: 'op', s: ch, p: pos, e: pos + 1 });
    pos += 1;
  }
  return tokens;
}

/* ------------------------------------------------------------------ layout */

const RELATIONS = new Set(['=', '==', '<', '>', '<=', '>=', '\u2264', '\u2265', ':']);
const OPENERS = { '(': ')', '[': ']', '{': '}' };
const GLYPHS = { '*': '\u00b7', '-': '\u2212', '<=': '\u2264', '>=': '\u2265', '==': '=', '...': '\u2026' };
const BIG = { sum: '\u2211', prod: '\u220f', int: '\u222b' };

const gapAt = (at) => ({ k: 'gap', p: at, e: at });
const range = (nodes, from, to, implicit = false) => ({ nodes, from, to, implicit });

class Layout {
  constructor(tokens, length) {
    this.tokens = tokens;
    this.length = length;
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
      const caret = this.next();
      const base = out.pop() ?? gapAt(caret.p);
      out.push(this.power(base, caret));
      return;
    }
    out.push(...this.atom(out));
  }

  /** `base ^ exponent`, the caret already consumed. The exponent is one operand. */
  power(base, caret) {
    const nodes = this.operand();
    const only = nodes.length === 1 && nodes[0].k === 'fence' && nodes[0].open === '(' ? nodes[0] : null;
    if (only) {
      return { k: 'sup', base, exp: only.arg, xr: range(only.arg, only.ip, only.ie), p: base.p, e: only.e };
    }
    const end = nodes.length ? nodes[nodes.length - 1].e : caret.e;
    return { k: 'sup', base, exp: nodes, xr: range(nodes, caret.e, end, true), p: base.p, e: end };
  }

  /** An operand with its own postfix marks, as a list of nodes. */
  operand() {
    const out = [];
    const t = this.peek();
    if (t === null) return out;
    if (t.k === 'op' && (t.s === '-' || t.s === '+')) {
      this.next();
      out.push({ k: 'op', s: GLYPHS[t.s] ?? t.s, tight: true, p: t.p, e: t.e });
    }
    const first = this.peek();
    if (first === null || (first.k === 'op' && !(first.s in OPENERS) && first.s !== '|')) return out;
    out.push(...this.atom(out));
    while (this.isOp('^') || this.isOp('!') || this.isOp("'") || this.isOp('\u00b0')) {
      const mark = this.next();
      if (mark.s === '^') {
        const base = out.pop() ?? gapAt(mark.p);
        out.push(this.power(base, mark));
      } else {
        out.push(this.postfix(mark));
      }
    }
    return out;
  }

  postfix(mark) {
    const at = { p: mark.p, e: mark.e };
    if (mark.s === "'") return { k: 'prime', ...at };
    if (mark.s === '\u00b0') return { k: 'text', s: '\u00b0', ...at };
    return { k: 'text', s: '!', ...at };
  }

  /** a/b: the previous atom over the next one. Brackets around either are dropped. */
  fraction(out) {
    const slash = this.next();
    const prev = out[out.length - 1];
    const stackable = prev && prev.k !== 'op' && prev.k !== 'comma' && prev.k !== 'gap';
    if (!stackable) {
      out.push({ k: 'op', s: '/', tight: true, p: slash.p, e: slash.e });
      return;
    }
    out.pop();
    const wrapped = prev.k === 'fence' && prev.open === '(';
    const nr = wrapped ? range(prev.arg, prev.ip, prev.ie) : range([prev], prev.p, prev.e);
    const isDerivative = prev.k === 'var' && prev.s === 'd' && this.peek()?.k === 'word' && this.peek().s === 'd';
    if (isDerivative) {
      const second = this.next();
      const v = this.next();
      const dNode = (token) => ({ k: 'func', s: 'd', p: token.p, e: token.e });
      const den = [dNode(second), ...(v ? this.word(v) : [])];
      const end = v ? v.e : second.e;
      out.push({
        k: 'frac',
        num: [dNode(prev)],
        den,
        nr: range([dNode(prev)], prev.p, prev.e),
        dr: range(den, slash.e, end),
        p: prev.p,
        e: end,
      });
      return;
    }
    const den = this.operand();
    if (den.length === 1 && den[0].k === 'fence' && den[0].open === '(') {
      const f = den[0];
      out.push({ k: 'frac', num: nr.nodes, den: f.arg, nr, dr: range(f.arg, f.ip, f.ie), p: prev.p, e: f.e });
      return;
    }
    const end = den.length ? den[den.length - 1].e : slash.e;
    out.push({ k: 'frac', num: nr.nodes, den, nr, dr: range(den, slash.e, end, true), p: prev.p, e: end });
  }

  atom(out) {
    const t = this.next();
    const at = { p: t.p, e: t.e };
    if (t.k === 'num') return [{ k: 'num', s: t.s, ...at }];
    if (t.k === 'word') return this.word(t);
    const { s } = t;
    if (s in OPENERS) return [this.fence(t)];
    if (s === '|') {
      const arg = this.sequence(['|']);
      const close = this.isOp('|') ? this.next() : null;
      return [
        { k: 'abs', arg, ar: range(arg, t.e, close ? close.p : this.length), p: t.p, e: close ? close.e : this.length },
      ];
    }
    if (s === ',') return [{ k: 'comma', ...at }];
    if (s === '!' || s === "'" || s === '\u00b0') return [this.postfix(t)];
    if (s === ')' || s === ']' || s === '}') return [{ k: 'text', s, ...at }];
    if (RELATIONS.has(s)) return [{ k: 'op', s: GLYPHS[s] ?? s, rel: true, ...at }];
    if (s === '+' || s === '-' || s === '*' || s === '...') {
      const before = out[out.length - 1];
      const unary = !before || before.k === 'op' || before.k === 'comma' || before.k === 'gap';
      return [{ k: 'op', s: GLYPHS[s] ?? s, tight: unary && s !== '*' && s !== '...', ...at }];
    }
    return [{ k: 'text', s, ...at }];
  }

  fence(open) {
    const close = OPENERS[open.s];
    const arg = this.sequence([close]);
    const closer = this.isOp(close) ? this.next() : null;
    const ie = closer ? closer.p : this.length;
    return {
      k: 'fence',
      open: open.s,
      close,
      arg,
      closed: closer !== null,
      ip: open.e,
      ie,
      p: open.p,
      e: closer ? closer.e : this.length,
    };
  }

  /** Arguments of a call, split at top-level commas. The next token is the opening bracket. */
  callArgs() {
    const open = this.next();
    const args = [];
    let from = open.e;
    for (;;) {
      const nodes = this.sequence([',', ')']);
      const stop = this.peek();
      args.push(range(nodes, from, stop ? stop.p : this.length));
      if (this.isOp(',')) {
        from = this.next().e;
        continue;
      }
      break;
    }
    const close = this.isOp(')') ? this.next() : null;
    return { args, end: close ? close.e : this.length };
  }

  word(t) {
    const name = t.s;
    const at = { p: t.p, e: t.e };
    const callNext = this.isOp('(');
    if (callNext && name === 'sqrt') {
      const { args, end } = this.callArgs();
      const arg = args[0] ?? range([], t.e, t.e);
      return [{ k: 'sqrt', arg: arg.nodes, ar: arg, index: null, p: t.p, e: end }];
    }
    if (callNext && name === 'nthroot') {
      const { args, end } = this.callArgs();
      const index = args[0] ?? range([], t.e, t.e);
      const arg = args[1] ?? range([], end, end);
      return [{ k: 'sqrt', arg: arg.nodes, ar: arg, index: index.nodes, ir: index, p: t.p, e: end }];
    }
    if (callNext && name === 'abs') {
      const { args, end } = this.callArgs();
      const arg = args[0] ?? range([], t.e, t.e);
      return [{ k: 'abs', arg: arg.nodes, ar: arg, p: t.p, e: end }];
    }
    if (name in BIG) {
      const start = this.i;
      if (callNext) {
        const { args, end } = this.callArgs();
        const [v, lo, hi, body] = args;
        const single = v && v.nodes.length === 1 && v.nodes[0].k === 'var' ? v.nodes[0] : null;
        if ((args.length === 4 && single) || (t.glyph && args.length <= 4 && (v.nodes.length === 0 || single))) {
          return [this.bigOperator(name, t, end, { v, lo, hi, body })];
        }
        this.i = start;
      } else if (t.glyph) {
        return [this.bigOperator(name, t, t.e, {})];
      }
    }
    if (name === 'for') return [{ k: 'func', s: 'for', spaced: true, ...at }];
    const subs = t.sub ? { sub: t.sub, be: t.be, subFrom: t.subFrom, subTo: t.subTo } : { sub: null };
    if (name in GREEK) {
      const letter = GREEK[name];
      return [UPRIGHT_GREEK.has(name) ? { k: 'func', s: letter, ...at } : { k: 'var', s: letter, ...subs, ...at }];
    }
    if (isFunctionName(name) || (name === 'log' && t.sub)) {
      return [{ k: 'func', s: name, call: callNext, ...subs, ...at }];
    }
    return [{ k: 'var', s: name, ...subs, ...at }];
  }

  /** A big operator whose slots may still be unfilled while it is being typed. */
  bigOperator(name, token, end, { v, lo, hi, body }) {
    const side = name === 'int';
    const slot = (r) => (r ? r : null);
    const variable = v && v.nodes.length === 1 ? v.nodes[0] : null;
    const lower = side
      ? (lo?.nodes ?? [])
      : variable
        ? [variable, { k: 'op', s: '=', rel: true, p: variable.e, e: variable.e }, ...(lo?.nodes ?? [])]
        : (lo?.nodes ?? []);
    return {
      k: 'big',
      sym: BIG[name],
      side,
      lower,
      upper: hi?.nodes ?? [],
      body: body?.nodes ?? [],
      differential: side ? variable : null,
      parts: { v: slot(v), lo: slot(lo), hi: slot(hi), body: slot(body) },
      p: token.p,
      e: end,
    };
  }
}

/**
 * Parse `source` into a layout tree: an array of nodes. Node kinds: num, var,
 * func, text, op, comma, gap, sup, frac, sqrt, abs, fence, big, prime.
 */
export function layout(source) {
  return layoutWithLength(source).nodes;
}

function layoutWithLength(source) {
  if (typeof source !== 'string') return { nodes: [], length: 0 };
  const text = source.slice(0, MAX_SOURCE);
  const parser = new Layout(lex(text), text.length);
  const nodes = [];
  while (parser.peek() !== null) nodes.push(...parser.sequence([]));
  return { nodes, length: text.length };
}

/* ---------------------------------------------------------------- renderer */

const hasTall = (nodes) =>
  nodes.some((n) => ['frac', 'big', 'sqrt', 'sup'].includes(n.k) && (n.k !== 'sup' || hasTall([n.base])));
const span = (cls, ...children) => h('span', { class: cls }, ...children);

/**
 * Builds the DOM for a layout tree. With `anchors` on, a zero-width `span.mf-a`
 * with `data-o` marks every offset the caret may occupy, and leaves carry
 * `data-p` and `data-e` so a selection can be drawn over them.
 */
function createRenderer(anchors) {
  const mark = (o) => (anchors ? h('span', { class: 'mf-a', 'data-o': String(o) }) : null);

  /** Text split so a marker sits between its characters (when each one is a source character). */
  function chars(text, from) {
    if (!anchors || text.length < 2) return [text];
    const out = [];
    [...text].forEach((ch, i) => {
      if (i > 0) out.push(mark(from + i));
      out.push(ch);
    });
    return out;
  }

  const leaf = (cls, text, n) => {
    const oneToOne = n.e - n.p === text.length;
    const el = span(cls, ...(oneToOne ? chars(text, n.p) : [text]));
    if (anchors) {
      el.dataset.p = String(n.p);
      el.dataset.e = String(n.e);
    }
    return el;
  };

  /** Render a slot: a marker at each end and before every node. */
  function seq(nodes, r) {
    const out = [];
    let last = null;
    const put = (o) => {
      if (!anchors || o === undefined || o === last) return;
      out.push(mark(o));
      last = o;
    };
    if (r) put(r.from);
    for (const node of nodes) {
      put(node.p);
      out.push(renderNode(node));
      put(node.e);
    }
    if (r && !(r.implicit && nodes.length > 0)) put(r.to);
    return out;
  }

  const slot = (r, { gap = true } = {}) =>
    r.nodes.length === 0 && gap ? [...seq([], r), span('mt-gap')] : seq(r.nodes, r);
  const filled = (r, nodes, fallback = null) =>
    r ? slot(r) : nodes.length ? seq(nodes) : [fallback ?? span('mt-gap')];

  function renderNode(n) {
    switch (n.k) {
      case 'num':
        return leaf('mt-n', n.s, n);
      case 'var': {
        if (!n.sub) return leaf('mt-v', n.s, n);
        const el = span('mt-v', ...chars(n.s, n.p));
        if (anchors) {
          el.dataset.p = String(n.p);
          el.dataset.e = String(n.e);
        }
        return span(
          'mt-vs',
          el,
          mark(n.be),
          span('mt-sub', mark(n.subFrom), ...chars(n.sub, n.subFrom), mark(n.subTo)),
        );
      }
      case 'func': {
        const el = leaf(n.spaced ? 'mt-f mt-spaced' : 'mt-f', n.s, n);
        if (n.sub) el.append(span('mt-sub', ...chars(n.sub, n.subFrom)));
        return el;
      }
      case 'text':
        return leaf('mt-t', n.s, n);
      case 'prime':
        return leaf('mt-prime', '\u2032', n);
      case 'comma':
        return leaf('mt-comma', ',', n);
      case 'gap':
        return span('mt-gap');
      case 'op':
        return leaf(`mt-o${n.tight ? ' mt-tight' : ''}${n.rel ? ' mt-rel' : ''}`, n.s, n);
      case 'sup':
        return span('mt-supwrap', ...seq([n.base], { from: n.base.p, to: n.base.e }), span('mt-sup', ...slot(n.xr)));
      case 'frac':
        return span('mt-frac', span('mt-num', ...slot(n.nr)), span('mt-den', ...slot(n.dr)));
      case 'sqrt':
        return span(
          'mt-sqrt',
          n.index ? span('mt-index', ...slot(n.ir)) : null,
          span('mt-radix', '\u221a'),
          span('mt-radicand', ...slot(n.ar)),
        );
      case 'abs':
        return span(
          `mt-abs${hasTall(n.arg) ? ' mt-tall' : ''}`,
          span('mt-bar'),
          span('mt-inner', ...seq(n.arg, n.ar)),
          span('mt-bar'),
        );
      case 'fence':
        return span(
          `mt-fence${hasTall(n.arg) ? ' mt-tall' : ''}`,
          span('mt-open', n.open),
          span('mt-inner', ...seq(n.arg, { from: n.ip, to: n.ie })),
          span('mt-close', n.close),
        );
      case 'big': {
        const { v, lo, hi, body } = n.parts;
        const hiEls = filled(hi, n.upper);
        const loEls = n.side
          ? filled(lo, n.lower)
          : [...(v ? slot(v) : [span('mt-gap')]), span('mt-o mt-rel', '='), ...(lo ? slot(lo) : [span('mt-gap')])];
        const stack = n.side
          ? span(
              'mt-bigside',
              span('mt-sym mt-sym-int', n.sym),
              span('mt-lims', span('mt-lim', ...hiEls), span('mt-lim', ...loEls)),
            )
          : span('mt-bigstack', span('mt-lim', ...hiEls), span('mt-sym', n.sym), span('mt-lim', ...loEls));
        const diff = n.side
          ? span(
              'mt-diff',
              span('mt-f', 'd'),
              ...(v ? slot(v) : n.differential ? [renderNode(n.differential)] : [span('mt-gap')]),
            )
          : null;
        return span('mt-big', stack, span('mt-body', ...(body ? slot(body) : [span('mt-gap')])), diff);
      }
      default:
        return span('mt-t');
    }
  }

  return { seq, mark };
}

/**
 * Render `source` as typeset math: a `span.mt` ready to insert.
 * @param {string} source
 * @param {{ anchors?: boolean }} [options] mark every caret position (used by the math field)
 */
export function typeset(source, { anchors = false } = {}) {
  const root = span('mt');
  try {
    const { nodes, length } = layoutWithLength(source);
    const { seq } = createRenderer(anchors);
    root.append(...seq(nodes, { from: 0, to: length }));
  } catch {
    root.replaceChildren(document.createTextNode(String(source ?? '')));
  }
  return root;
}

/* ------------------------------------------------------------ typing aids */

/** Words that turn into a symbol as soon as they are typed. */
const AUTO_REPLACE = { ...GREEK, sum: '\u2211', prod: '\u220f', int: '\u222b' };

/**
 * Replace a name the person has just finished typing with its symbol: Greek names
 * become letters, and sum, prod, and int become the summation, product, and
 * integral signs. Only the run of letters ending at the caret is considered, and
 * only when it is exactly one of the names (so `theta` becomes \u03b8 but `beta` is
 * not read as `eta`).
 *
 * @returns {{ text: string, caret: number }}
 */
export function autoSymbols(text, caret = text.length) {
  const before = text.slice(0, caret);
  const run = /[A-Za-z]+$/.exec(before);
  if (!run || !Object.hasOwn(AUTO_REPLACE, run[0])) return { text, caret };
  const start = run.index;
  if (before[start - 1] === '_' || before[start - 1] === '{') return { text, caret };
  const letter = AUTO_REPLACE[run[0]];
  return { text: text.slice(0, start) + letter + text.slice(caret), caret: start + letter.length };
}
