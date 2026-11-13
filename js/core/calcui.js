/**
 * Pieces shared by the calculator-style tools (Finance and Probability): state helpers, labelled inputs,
 * result tiles and tables, and a chart that repaints itself. Text is inserted as text, never as HTML.
 */
import { h } from './dom.js';
import { evaluateNumber } from '../lib/expr.js';
import { drawChart } from '../lib/statchart.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

export const MAX_FIELD = 24;

/** `value` as a single line of at most `max` characters, or `fallback` when it is not a string. */
export const text = (value, max = MAX_FIELD, fallback = '') =>
  typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, max) : fallback;

/** `value` if it is a key in `list` (rows of [key, label, ...]), otherwise `fallback`. */
export const pick = (value, list, fallback) => (list.some(([key]) => key === value) ? value : fallback);

/** The number in a field. Blank is NaN, and anything that is not a number is NaN. Accepts 1/6 and sqrt(2). */
export const numberOf = (value) => {
  const t = String(value ?? '').trim();
  return t === '' ? NaN : evaluateNumber(t);
};

/** Like `numberOf`, but a blank field counts as zero. */
export const amountOf = (value) => (String(value ?? '').trim() === '' ? 0 : numberOf(value));

/** The message of the first check that fails. Each check is [failed, message]. */
export const firstProblem = (checks) => checks.find(([failed]) => failed)?.[1] ?? null;

/** Axis bounds that fit `values`, with a little room, and a floor of zero when everything is positive. */
export function valueRange(values, floorAtZero = true) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (!(hi > lo)) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [floorAtZero && lo >= 0 ? 0 : lo - pad, hi + pad];
}

/* ---------------------------------------------------------------- results */

export const note = (message) => h('p', { class: 'st-note', role: 'status' }, message);

export const callout = (message, significant = false) =>
  h('p', { class: significant ? 'st-callout is-significant' : 'st-callout' }, message);

/** Headline numbers. Each item is [label, value]. */
export const tiles = (items) =>
  h(
    'div',
    { class: 'st-tiles' },
    items.map(([label, value]) =>
      h(
        'div',
        { class: 'st-tile' },
        h('span', { class: 'st-tile-label' }, label),
        h('span', { class: 'st-tile-value' }, value),
      ),
    ),
  );

/** Label and value rows. Each item is [label, value]. */
export const table = (rows) =>
  h(
    'table',
    { class: 'st-table' },
    h(
      'tbody',
      {},
      rows.map(([label, value]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value))),
    ),
  );

/** A table with a header row, for results that run over many periods. Cells are strings. */
export const grid = (heads, rows) =>
  h(
    'div',
    { class: 'calc-scroll' },
    h(
      'table',
      { class: 'calc-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          heads.map((head) => h('th', { scope: 'col' }, head)),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((row) =>
          h(
            'tr',
            {},
            row.map((cell) => h('td', {}, cell)),
          ),
        ),
      ),
    ),
  );

/** Horizontal bars for values between 0 and 1. Each item is [label, value, valueText]. */
export const bars = (items) =>
  h(
    'div',
    { class: 'calc-bars' },
    items.map(([label, value, shown]) =>
      h(
        'div',
        { class: 'calc-bar' },
        h('span', { class: 'calc-bar-label' }, label),
        h(
          'span',
          { class: 'calc-bar-track' },
          h('span', { class: 'calc-bar-fill', style: { width: `${Math.max(0, Math.min(1, value)) * 100}%` } }),
        ),
        h('span', { class: 'calc-bar-value' }, shown),
      ),
    ),
  );

/** Colour key for a chart. Each item is [swatch, label] with swatch `a`, `b`, or `axis`. */
export const legend = (items) =>
  h(
    'p',
    { class: 'calc-legend' },
    items.map(([swatch, label]) =>
      h('span', { class: 'calc-legend-item' }, h('span', { class: `calc-swatch calc-swatch-${swatch}` }), label),
    ),
  );

/* ----------------------------------------------------------------- inputs */

/**
 * Labelled inputs that write into the tool's state and save it. Typing calls `refreshSoon`; choosing calls
 * `refresh`, after `rebuild` when the choice changes which inputs are shown (pass `rebuilds: true`).
 */
export function inputKit({ save, refresh, refreshSoon, rebuild }) {
  const field = (label, input, { wide = false } = {}) =>
    h('label', { class: wide ? 'field calc-wide' : 'field' }, h('span', { class: 'field-label' }, label), input);

  const textInput = (label, obj, key, { max = MAX_FIELD, placeholder = '' } = {}) => {
    const input = h('input', {
      class: 'input gr-bound',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      maxlength: String(max),
      placeholder,
      'aria-label': label,
      value: obj[key],
      oninput: () => {
        obj[key] = text(input.value, max);
        save();
        refreshSoon();
      },
    });
    return field(label, input);
  };

  const areaInput = (label, obj, key, { max, rows = 4, placeholder = '' }) => {
    const input = h('textarea', {
      class: 'input input-mono calc-area',
      rows: String(rows),
      spellcheck: 'false',
      autocomplete: 'off',
      maxlength: String(max),
      placeholder,
      'aria-label': label,
      value: obj[key],
      oninput: () => {
        obj[key] = String(input.value).slice(0, max);
        save();
        refreshSoon();
      },
    });
    return field(label, input, { wide: true });
  };

  const choice = (label, obj, key, options, { rebuilds = false } = {}) => {
    const select = h(
      'select',
      {
        class: 'select',
        'aria-label': label,
        onchange: () => {
          obj[key] = select.value;
          save();
          if (rebuilds) rebuild();
          refresh();
        },
      },
      options.map(([value, name]) => h('option', { value }, name)),
    );
    select.value = obj[key];
    return field(label, select);
  };

  return { field, textInput, areaInput, choice };
}

/** The row of buttons that picks a mode. `onPick(key)` runs after the state has changed. */
export function modeButtons(modes, current, onPick) {
  return modes.map(([key, name]) =>
    h(
      'button',
      { class: 'btn', type: 'button', 'aria-pressed': String(current === key), onclick: () => onPick(key) },
      name,
    ),
  );
}

/* ------------------------------------------------------------------ chart */

/**
 * A chart canvas that paints a `statchart` spec, and repaints on resize and theme change while its tab is shown.
 * Call `activate(true)` from `onShow` and `activate(false)` from `onHide`, and `destroy()` from `destroy`.
 */
export function chartPane(label) {
  const canvas = h('canvas', { class: 'plot-canvas st-canvas', role: 'img', 'aria-label': label });
  let spec = null;
  let active = false;
  let frame = 0;

  const paint = () => {
    const { ctx, width, height } = fitCanvas(canvas);
    drawChart(ctx, width, height, spec, themeColors());
  };
  const onTheme = () => active && spec && paint();
  document.addEventListener('clover:themechange', onTheme);

  return {
    canvas,
    get spec() {
      return spec;
    },
    /** Show a new spec, or hide the chart when there is nothing to draw (null). */
    show(next, description = label) {
      spec = next;
      canvas.hidden = next === null;
      canvas.setAttribute('aria-label', description);
      if (active && next) paint();
    },
    activate(on) {
      active = on;
      if (on && spec) paint();
    },
    repaintSoon() {
      if (!active || !spec) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    },
    destroy() {
      active = false;
      cancelAnimationFrame(frame);
      document.removeEventListener('clover:themechange', onTheme);
    },
  };
}
