/**
 * A text field that is edited as typeset math, in place.
 *
 * The real control is a plain `<input>` laid invisibly over the typeset display, so
 * selection, undo, paste, input methods, and screen readers all behave normally.
 * What the person sees is the typeset form, with a caret and selection drawn inside
 * it: typing `x^2` shows x with a raised 2 and the caret in the exponent, `1/` shows a
 * fraction with the caret in the denominator, and the words sum, prod, int, sqrt-style
 * symbols and Greek names turn into their signs as they are typed.
 *
 * The text stays the source of truth (it is what the graphing parser reads and what
 * is saved). `typeset(text, { anchors: true })` marks every offset where the caret
 * can sit; arrow keys move between those marks, so the caret never lands inside
 * syntax that is not drawn (the `sqrt(` of a root, say).
 */
import { typesetField, autoSymbols } from '../lib/graph/typeset.js';
import { h } from './dom.js';

const PAIRS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(PAIRS));
const BINDER_START = /(?:[\u2211\u220f\u222b]|\b(?:sum|prod|int))$/;
const BINDER_KIND = [
  [/(?:\u222b|\bint)$/, 'int'],
  [/(?:\u220f|\bprod)$/, 'prod'],
  [/(?:\u2211|\bsum)$/, 'sum'],
];

/**
 * The order the four arguments `(variable, start, end, body)` of a sum or product, or
 * `(variable, lower, upper, body)` of an integral, are visited in, as indexes into the
 * arguments as written. An integral reads its limits and body first and ends on the
 * variable of integration, because that is where `dx` is drawn.
 */
const VISIT_ORDER = { sum: [0, 1, 2, 3], prod: [0, 1, 2, 3], int: [1, 2, 3, 0] };

/**
 * Where the arguments of the nearest enclosing sum, prod, or int call begin and end,
 * for Tab and Shift+Tab. Returns the offset of the "(" and the offsets of the
 * top-level commas and of the matching ")" (or null while it is still unclosed).
 */
export function enclosingBinder(text, caret) {
  const stack = [];
  for (let i = 0; i < caret; i += 1) {
    const ch = text[i];
    if (ch === '(') stack.push({ at: i, binder: BINDER_START.test(text.slice(0, i)) });
    else if (ch === ')') stack.pop();
  }
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    if (!stack[k].binder) continue;
    const open = stack[k].at;
    const commas = [];
    let depth = 0;
    let close = null;
    for (let i = open + 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) {
          close = i;
          break;
        }
        depth -= 1;
      } else if (ch === ',' && depth === 0) commas.push(i);
    }
    const before = text.slice(0, open);
    const kind = BINDER_KIND.find(([pattern]) => pattern.test(before))?.[1] ?? 'sum';
    return { open, commas, close, kind };
  }
  return null;
}

/**
 * The argument ranges of the sum, product, or integral around `caret`, and the order
 * Tab visits them in. `args[i]` is `{ from, to }`, the offsets just inside its ends.
 */
export function binderSlots(text, caret) {
  const binder = enclosingBinder(text, caret);
  if (!binder) return null;
  const starts = [binder.open + 1, ...binder.commas.map((c) => c + 1)];
  const ends = [...binder.commas, binder.close ?? text.length];
  const args = starts.map((from, i) => ({ from, to: ends[i] }));
  const visit = args.length === 4 ? VISIT_ORDER[binder.kind] : args.map((_, i) => i);
  return { ...binder, args, visit };
}

/** Offset of the ")" that closes a "(" just before `from`, or null while it is still open. */
function matchingClose(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return null;
}

/**
 * @param {{ value?: string, label: string, placeholder?: string, maxlength?: number, className?: string,
 *   oninput?: (value: string) => void, onblur?: () => void, onfocus?: () => void, onkeydown?: (e: KeyboardEvent) => void }} options
 */
export function createMathField({
  value = '',
  label,
  placeholder = '',
  maxlength = 500,
  className = 'gr-input',
  oninput,
  onblur,
  onfocus,
  onkeydown,
}) {
  const caret = h('span', { class: 'mf-caret', 'aria-hidden': 'true', hidden: true });
  const display = h('div', { class: 'mf-display', 'aria-hidden': 'true' });
  const input = h('input', {
    class: `${className} mf-input`,
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    maxlength: String(maxlength),
    placeholder,
    'aria-label': label,
    value,
  });
  const el = h('div', { class: 'mf' }, display, input);

  /** @type {Map<number, HTMLElement>} */
  let anchors = new Map();
  /** @type {number[]} */
  let stops = [0];
  /** Offsets in the order Left and Right visit them. */
  let order = [0];
  /** Groups of stacked slots, for Up and Down. */
  let vertical = [];
  let focused = false;
  let content = null;

  function render() {
    const text = input.value;
    const empty = text.trim() === '';
    el.classList.toggle('is-empty', empty);
    anchors = new Map();
    if (empty) {
      content = null;
      display.replaceChildren(h('span', { class: 'mf-placeholder' }, placeholder), caret);
      stops = [0, text.length];
      order = [...stops];
      vertical = [];
    } else {
      const typeset = typesetField(text);
      content = typeset.el;
      for (const mark of content.querySelectorAll('[data-o]')) {
        const offset = Number(mark.dataset.o);
        if (!anchors.has(offset)) anchors.set(offset, mark);
      }
      stops = [...anchors.keys()].sort((a, b) => a - b);
      order = typeset.order.filter((o) => anchors.has(o));
      for (const o of stops) if (!order.includes(o)) order.push(o);
      vertical = typeset.vertical;
      display.replaceChildren(content, caret);
    }
    if (!stops.includes(text.length)) stops.push(text.length);
    if (!order.includes(text.length)) order.push(text.length);
    update();
  }

  const nearest = (offset) =>
    stops.reduce(
      (best, s) =>
        Math.abs(s - offset) < Math.abs(best - offset) || (Math.abs(s - offset) === Math.abs(best - offset) && s > best)
          ? s
          : best,
      stops[0],
    );
  const previousStop = (offset) => [...stops].reverse().find((s) => s < offset) ?? 0;
  const nextStop = (offset) => stops.find((s) => s > offset) ?? input.value.length;

  /** The next or previous place the caret goes with a plain Left or Right, in reading order. */
  function step(offset, forward) {
    const at = order.indexOf(offset);
    if (at < 0) return forward ? nextStop(offset) : previousStop(offset);
    return order[Math.min(order.length - 1, Math.max(0, at + (forward ? 1 : -1)))];
  }

  /**
   * Up and Down between stacked slots: numerator and denominator, the limits of a sum or integral.
   * Returns false when the caret is not in one, so the key can move between rows instead.
   */
  function moveVertical(delta) {
    const at = input.selectionStart ?? 0;
    const hits = [];
    for (const group of vertical) {
      group.forEach((row, ri) => {
        row.forEach((slot, si) => {
          if (slot.from <= at && at <= slot.to) hits.push({ group, ri, si, slot });
        });
      });
    }
    hits.sort((a, b) => a.slot.to - a.slot.from - (b.slot.to - b.slot.from));
    const hit = hits.find((c) => c.ri + delta >= 0 && c.ri + delta < c.group.length);
    if (!hit) return false;
    const row = hit.group[hit.ri + delta];
    const target = row[Math.min(hit.si, row.length - 1)];
    select(Math.min(target.to, target.from + (at - hit.slot.from)));
    return true;
  }

  function select(start, end = start, direction = 'forward') {
    input.setSelectionRange?.(start, end, direction);
    update();
  }

  /** Keep the caret on a drawn position, then draw the caret and the selection. */
  function update() {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    if (focused && start === end && !stops.includes(start)) {
      const snapped = nearest(start);
      input.setSelectionRange?.(snapped, snapped);
      return update();
    }
    const edge = input.selectionDirection === 'backward' ? start : end;
    for (const mark of display.querySelectorAll('.mf-sel')) mark.classList.remove('mf-sel');
    if (start !== end) {
      for (const leaf of display.querySelectorAll('[data-p]')) {
        if (Number(leaf.dataset.p) < end && Number(leaf.dataset.e) > start) leaf.classList.add('mf-sel');
      }
    }
    caret.hidden = !focused || start !== end;
    if (caret.hidden) return undefined;
    const mark = anchors.get(edge);
    if (!mark) {
      caret.style.left = '8px';
      return undefined;
    }
    const box = mark.getBoundingClientRect();
    const frame = display.getBoundingClientRect();
    const height = Math.max(box.height, 14);
    caret.style.left = `${box.left - frame.left + display.scrollLeft}px`;
    caret.style.top = `${box.top - frame.top + display.scrollTop + (box.height - height) / 2}px`;
    caret.style.height = `${height}px`;
    const left = box.left - frame.left;
    if (left < 8) display.scrollLeft += left - 8;
    else if (left > frame.width - 12) display.scrollLeft += left - frame.width + 12;
    return undefined;
  }

  /** Insert text at the selection, keeping the browser's undo history where it can. */
  function insert(text, back = 0) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    let done = false;
    try {
      done = Boolean(document.execCommand?.('insertText', false, text));
    } catch {
      done = false;
    }
    if (!done) {
      input.setRangeText(text, start, end, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (back > 0) {
      const at = (input.selectionStart ?? 0) - back;
      input.setSelectionRange(at, at);
      update();
    }
  }

  function remove(from, to) {
    input.setSelectionRange(from, to);
    let done = false;
    try {
      done = Boolean(document.execCommand?.('delete'));
    } catch {
      done = false;
    }
    if (!done) {
      input.setRangeText('', from, to, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function handleKey(event) {
    if (event.defaultPrevented || event.isComposing) return false;
    const { key } = event;
    const text = input.value;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;

    if ((key === 'ArrowLeft' || key === 'ArrowRight') && plain) {
      event.preventDefault();
      const forward = key === 'ArrowRight';
      if (event.shiftKey) {
        const backward = input.selectionDirection === 'backward';
        const moving = start === end ? (forward ? end : start) : backward ? start : end;
        const target = forward ? nextStop(moving) : previousStop(moving);
        const anchor = start === end ? start : backward ? end : start;
        select(Math.min(anchor, target), Math.max(anchor, target), target < anchor ? 'backward' : 'forward');
      } else if (start !== end) {
        const at = forward ? end : start;
        select(at);
      } else {
        select(step(forward ? end : start, forward));
      }
      return true;
    }

    if ((key === 'ArrowUp' || key === 'ArrowDown') && plain && !event.shiftKey && start === end) {
      if (moveVertical(key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
        return true;
      }
      return false;
    }

    if (key === 'Tab' && plain && !event.defaultPrevented) {
      const info = binderSlots(text, event.shiftKey ? start : end);
      if (!info) return false;
      const at = event.shiftKey ? start : end;
      const here = info.args.findIndex((a) => at >= a.from && at <= a.to);
      if (here < 0) return false;
      const k = info.visit.indexOf(here);
      if (!event.shiftKey) {
        const next = info.args[info.visit[k + 1]];
        if (next) {
          event.preventDefault();
          select(next.from);
          return true;
        }
        if (info.close !== null && end <= info.close) {
          event.preventDefault();
          select(info.close + 1);
          return true;
        }
        return false;
      }
      const before = info.args[info.visit[k - 1]];
      const first = info.args[info.visit[0]];
      if (before) {
        event.preventDefault();
        select(before.to);
        return true;
      }
      if (start > first.from) {
        event.preventDefault();
        select(first.from);
        return true;
      }
      return false;
    }

    // A fresh sum, product, or integral already has its brackets and commas. Typing "(" the old way, as in
    // sum(k, 1, 10, k^2), folds the empty template back into one pair of brackets to type the arguments into.
    if (key === '(' && plain && start === end) {
      const sign = ['\u2211', '\u220f'].includes(text[start - 2])
        ? start - 2
        : text[start - 3] === '\u222b'
          ? start - 3
          : -1;
      if (sign >= 0 && text.slice(sign + 1, sign + 6) === '(,,,)') {
        event.preventDefault();
        remove(sign + 2, sign + 5);
        return true;
      }
    }

    // Once every slot of a sum, product, or integral exists, a comma moves on to the next one.
    if (key === ',' && plain && start === end) {
      const info = binderSlots(text, start);
      if (info && info.args.length === 4 && info.close !== null) {
        const here = info.args.findIndex((a) => start >= a.from && start <= a.to);
        const next = info.args[info.visit[info.visit.indexOf(here) + 1]];
        event.preventDefault();
        select(next ? next.from : info.close + 1);
        return true;
      }
    }

    if (key === 'Backspace' && plain && text !== '') {
      if (start !== end) return false;
      if (start > 0 && Object.hasOwn(PAIRS, text[start - 1]) && PAIRS[text[start - 1]] === text[start]) {
        event.preventDefault();
        remove(start - 1, start + 1);
        return true;
      }
      const prev = previousStop(start);
      if (start - prev > 1) {
        event.preventDefault();
        // Whatever sits between two drawn positions is syntax that is not drawn (like "sqrt("). Remove it whole,
        // and with it the bracket it opened if that bracket is empty.
        const close = text.slice(prev, start).endsWith('(') ? matchingClose(text, start) : null;
        if (close !== null) remove(close, close + 1);
        remove(prev, start);
        return true;
      }
      return false;
    }

    if (key === 'Delete' && plain && start === end && start < text.length) {
      const next = nextStop(start);
      if (next - start > 1) {
        event.preventDefault();
        remove(start, next);
        return true;
      }
      return false;
    }

    if (plain && Object.hasOwn(PAIRS, key)) {
      const after = text[end] ?? '';
      if (start === end && (after === '' || /\s/.test(after) || CLOSERS.has(after) || after === ',')) {
        event.preventDefault();
        insert(`${key}${PAIRS[key]}`, 1);
        return true;
      }
      return false;
    }

    if (plain && CLOSERS.has(key) && start === end && text[start] === key) {
      event.preventDefault();
      select(start + 1);
      return true;
    }
    return false;
  }

  input.addEventListener('keydown', (event) => {
    const keep = event.key === 'Backspace' && input.value === '';
    if (!keep && handleKey(event)) return;
    onkeydown?.(event);
  });

  input.addEventListener('input', (event) => {
    // Typing a name turns it into its symbol; deleting never re-triggers it.
    if (event.inputType === undefined || !event.inputType.startsWith('delete')) {
      const at = input.selectionStart ?? input.value.length;
      const next = autoSymbols(input.value, at, { templates: true });
      if (next.text !== input.value) {
        input.value = next.text;
        input.setSelectionRange?.(next.caret, next.caret);
      }
    }
    render();
    oninput?.(input.value);
  });

  input.addEventListener('focus', () => {
    focused = true;
    el.classList.add('is-focused');
    update();
    onfocus?.();
  });
  input.addEventListener('blur', () => {
    focused = false;
    el.classList.remove('is-focused');
    update();
    onblur?.();
  });
  // The selection can change without any input: clicks, select-all, and keys the browser handles.
  for (const type of ['select', 'keyup', 'click']) input.addEventListener(type, () => update());

  /* ----------------------------------------------------------- the pointer */

  /** The offset whose drawn position is closest to a point on screen. */
  function offsetAt(x, y) {
    let best = input.value.length;
    let bestScore = Infinity;
    for (const [offset, mark] of anchors) {
      const box = mark.getBoundingClientRect();
      const dx = box.left - x;
      const dy = (box.top + box.height / 2 - y) * 2.2;
      const score = dx * dx + dy * dy;
      if (score < bestScore) {
        bestScore = score;
        best = offset;
      }
    }
    return anchors.size === 0 ? 0 : best;
  }

  let dragFrom = null;
  const moveDrag = (event) => {
    if (dragFrom === null) return;
    const at = offsetAt(event.clientX, event.clientY);
    select(Math.min(dragFrom, at), Math.max(dragFrom, at), at < dragFrom ? 'backward' : 'forward');
  };
  const endDrag = () => {
    dragFrom = null;
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', endDrag);
  };
  el.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    input.focus();
    const at = offsetAt(event.clientX, event.clientY);
    dragFrom = at;
    select(at);
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', endDrag);
  });
  el.addEventListener('dblclick', () => {
    input.select();
    update();
  });

  render();
  return {
    el,
    input,
    refresh: render,
    /** Offsets the caret can occupy, in order. */
    stops: () => [...stops],
    setValue(text) {
      input.value = text;
      render();
    },
    focus(atEnd = true) {
      input.focus();
      if (atEnd) {
        const end = input.value.length;
        input.setSelectionRange?.(end, end);
        update();
      }
    },
    destroy() {
      endDrag();
    },
  };
}
