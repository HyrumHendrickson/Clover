import { debounce, h, onResize } from '../core/dom.js';
import { evaluateNumber } from '../lib/expr.js';
import { MODELS, fitModel } from '../lib/fit.js';
import { formatNumber } from '../lib/graph/values.js';
import { parsePastedTable } from '../lib/graph/rows.js';
import {
  DISTRIBUTIONS,
  chiSqGof,
  chiSqIndependence,
  inverseCdf,
  mean,
  meanInterval,
  shape,
  stdev,
  suggestedBinWidth,
  summarize,
  tTest,
  tTestTwo,
  zPropTest,
  zPropTestTwo,
  zTest,
} from '../lib/stats.js';
import {
  boxplotSpec,
  distributionSpec,
  dotplotSpec,
  drawChart,
  histogramSpec,
  residualSpec,
  scatterSpec,
  testSpec,
} from '../lib/statchart.js';
import { conclusion, hypotheses, testDistribution } from '../lib/statsreport.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_COLUMNS = 4;
const MAX_ROWS = 500;
const MAX_CELL = 24;
const MAX_NAME = 20;
const MAX_FIELD = 24;

const MODES = [
  ['describe', 'Summary'],
  ['regress', 'Regression'],
  ['dist', 'Distributions'],
  ['tests', 'Tests'],
];
const CHARTS = [
  ['histogram', 'Histogram'],
  ['box', 'Box plot'],
  ['dots', 'Dot plot'],
];
const TESTS = [
  ['t1', 'One-sample t-test'],
  ['z1', 'One-sample z-test'],
  ['t2', 'Two-sample t-test'],
  ['prop1', 'One-proportion z-test'],
  ['prop2', 'Two-proportion z-test'],
  ['gof', 'Chi-square goodness of fit'],
  ['indep', 'Chi-square independence'],
];
const SHADES = [
  ['between', 'Between a and b'],
  ['left', 'Up to b'],
  ['right', 'From a up'],
  ['none', 'None'],
];
const TAILS = [
  ['two', 'Two-sided'],
  ['left', 'Left tail'],
  ['right', 'Right tail'],
];

const EXAMPLE = [
  { name: 'Hours', cells: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
  { name: 'Score', cells: ['52', '55', '61', '64', '70', '74', '79', '85', '86', '93'] },
];

/* ------------------------------------------------------------------- state */

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, max) : '');
const pick = (value, list, fallback) => (list.some(([key]) => key === value) ? value : fallback);
const index = (value) => (Number.isInteger(value) && value >= 0 && value < MAX_COLUMNS ? value : 0);

function normalizeColumns(raw) {
  const cols = (Array.isArray(raw) ? raw : [])
    .filter((c) => c && typeof c === 'object')
    .slice(0, MAX_COLUMNS)
    .map((c, i) => ({
      name: text(c.name, MAX_NAME) || `Column ${i + 1}`,
      cells: (Array.isArray(c.cells) ? c.cells : []).slice(0, MAX_ROWS).map((v) => text(String(v ?? ''), MAX_CELL)),
    }));
  while (cols.length < 2) cols.push({ name: cols.length === 0 ? 'x' : 'y', cells: [] });
  return cols;
}

function normalizeParams(raw, kind) {
  const out = {};
  const given = raw && typeof raw === 'object' ? raw : {};
  for (const p of DISTRIBUTIONS[kind].params) {
    out[p.key] = Object.hasOwn(given, p.key) ? text(String(given[p.key]), MAX_FIELD) : String(p.value);
  }
  return out;
}

const normalize = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = r.describe ?? {};
  const g = r.regress ?? {};
  const s = r.dist ?? {};
  const t = r.tests ?? {};
  const kind = typeof s.kind === 'string' && Object.hasOwn(DISTRIBUTIONS, s.kind) ? s.kind : 'normal';
  const cols = normalizeColumns(r.cols);
  const clip = (i) => Math.min(index(i), cols.length - 1);
  return {
    cols,
    mode: pick(r.mode, MODES, 'describe'),
    describe: {
      col: clip(d.col),
      chart: pick(d.chart, CHARTS, 'histogram'),
      bin: text(d.bin, 12),
      density: d.density === true,
    },
    regress: {
      x: clip(g.x),
      y: Math.min(index(g.y ?? 1), cols.length - 1),
      model: typeof g.model === 'string' && Object.hasOwn(MODELS, g.model) ? g.model : 'linear',
      residuals: g.residuals === true,
      predict: text(g.predict, MAX_FIELD),
    },
    dist: {
      kind,
      params: normalizeParams(s.params, kind),
      shade: pick(s.shade, SHADES, 'between'),
      a: text(s.a ?? '-1', MAX_FIELD),
      b: text(s.b ?? '1', MAX_FIELD),
      p: text(s.p ?? '0.95', MAX_FIELD),
    },
    tests: {
      kind: pick(t.kind, TESTS, 't1'),
      col: clip(t.col),
      col2: Math.min(index(t.col2 ?? 1), cols.length - 1),
      mu0: text(t.mu0 ?? '0', MAX_FIELD),
      sigma: text(t.sigma ?? '1', MAX_FIELD),
      level: text(t.level ?? '0.95', MAX_FIELD),
      alpha: text(typeof t.alpha === 'string' ? t.alpha : '0.05', MAX_FIELD),
      p0: text(t.p0 ?? '0.5', MAX_FIELD),
      x1: text(t.x1 ?? '', MAX_FIELD),
      n1: text(t.n1 ?? '', MAX_FIELD),
      x2: text(t.x2 ?? '', MAX_FIELD),
      n2: text(t.n2 ?? '', MAX_FIELD),
      tail: pick(t.tail, TAILS, 'two'),
    },
  };
};

/* ----------------------------------------------------------------- helpers */

const number = (value) => {
  const t = String(value ?? '').trim();
  return t === '' ? NaN : evaluateNumber(t);
};

/** The numbers in a column, skipping blanks, and how many entries were not numbers. */
function columnValues(col) {
  const values = [];
  let skipped = 0;
  for (const cell of col.cells) {
    if (cell.trim() === '') continue;
    const v = number(cell);
    if (Number.isFinite(v)) values.push(v);
    else skipped += 1;
  }
  return { values, skipped };
}

/** Rows where both columns hold a number. */
function pairs(a, b) {
  const xs = [];
  const ys = [];
  const length = Math.min(MAX_ROWS, Math.max(a.cells.length, b.cells.length));
  for (let i = 0; i < length; i += 1) {
    const x = number(a.cells[i]);
    const y = number(b.cells[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs, ys };
}

const show = (v) => (typeof v === 'number' ? formatNumber(v, 6) : String(v));
const sig = (v) => formatNumber(v, 8);

/** `y = a + bx` style text for a fitted model, with the numbers filled in. */
export function equationText(kind, params) {
  const [a, b, c, d] = params.map(sig);
  const term = (value, tail) => {
    const n = Number(value);
    return `${n < 0 ? '-' : '+'} ${sig(Math.abs(n))}${tail}`;
  };
  switch (kind) {
    case 'linear':
      return `y = ${a} ${term(params[1], 'x')}`;
    case 'quadratic':
      return `y = ${a} ${term(params[1], 'x')} ${term(params[2], 'x\u00b2')}`;
    case 'cubic':
      return `y = ${a} ${term(params[1], 'x')} ${term(params[2], 'x\u00b2')} ${term(params[3], 'x\u00b3')}`;
    case 'exponential':
      return `y = ${a}\u00b7e^(${b}x)`;
    case 'power':
      return `y = ${a}\u00b7x^${b}`;
    case 'logarithmic':
      return `y = ${a} ${term(params[1], '\u00b7ln(x)')}`;
    default:
      return `${c ?? ''}${d ?? ''}`;
  }
}

/** The same fit in the graphing language, ready to paste into a Graphing row. */
export function graphEquation(kind, params) {
  const [a, b, c, d] = params.map(sig);
  switch (kind) {
    case 'linear':
      return `y = ${a} + ${b}x`;
    case 'quadratic':
      return `y = ${a} + ${b}x + ${c}x^2`;
    case 'cubic':
      return `y = ${a} + ${b}x + ${c}x^2 + ${d}x^3`;
    case 'exponential':
      return `y = ${a}e^(${b}x)`;
    case 'power':
      return `y = ${a}x^(${b})`;
    default:
      return `y = ${a} + ${b}ln(x)`;
  }
}

/* -------------------------------------------------------------------- tool */

export default {
  type: 'stats',
  name: 'Statistics',
  description: 'Summaries, charts, regression, probability distributions, and significance tests for your data.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const heights = [0.2, 0.45, 0.8, 1, 0.7, 0.4, 0.15];
    const gap = width / (heights.length + 2);
    heights.forEach((v, i) => {
      ctx.fillStyle = i % 2 === 0 ? colors.a : colors.b;
      ctx.fillRect(gap * (i + 1) + 2, height * 0.85 - v * height * 0.65, gap - 4, v * height * 0.65);
    });
  },

  mount(root, ctx) {
    const state = ctx.state;
    let active = false;
    let frame = 0;

    const dataBox = h('div', { class: 'st-data' });
    const modeBar = h('div', { class: 'btn-group st-modes', role: 'group', 'aria-label': 'What to do with the data' });
    const controls = h('div', { class: 'st-controls' });
    const results = h('div', { class: 'st-results', 'aria-live': 'polite' });
    const main = h('canvas', { class: 'plot-canvas st-canvas', role: 'img', 'aria-label': 'Chart of your data' });
    const second = h('canvas', {
      class: 'plot-canvas st-canvas st-canvas-small',
      role: 'img',
      'aria-label': 'Residual plot',
      hidden: true,
    });

    /* ----------------------------------------------------------- helpers */

    const save = () => ctx.save();
    const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
    const textInput = (label, obj, key, { placeholder = '' } = {}) => {
      const input = h('input', {
        class: 'input gr-bound',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        maxlength: String(MAX_FIELD),
        placeholder,
        'aria-label': label,
        value: obj[key],
        oninput: () => {
          obj[key] = text(input.value, MAX_FIELD);
          save();
          refreshSoon();
        },
      });
      return field(label, input);
    };
    const choice = (label, obj, key, options, { rebuild = false } = {}) => {
      const select = h(
        'select',
        {
          class: 'select',
          'aria-label': label,
          onchange: () => {
            obj[key] = select.value;
            save();
            if (rebuild) buildControls();
            refresh();
          },
        },
        options.map(([value, name]) => h('option', { value }, name)),
      );
      select.value = obj[key];
      return field(label, select);
    };
    const columnChoice = (label, obj, key) => {
      const select = h(
        'select',
        {
          class: 'select',
          'aria-label': label,
          onchange: () => {
            obj[key] = Number(select.value);
            save();
            refresh();
          },
        },
        state.cols.map((c, i) => h('option', { value: String(i) }, c.name)),
      );
      select.value = String(Math.min(obj[key], state.cols.length - 1));
      return field(label, select);
    };

    /* -------------------------------------------------------------- data */

    /** A pasted block replaces the columns it covers, since it is a whole data set, not an edit. */
    function fillColumns(start, grid) {
      const width = grid[0].length;
      while (state.cols.length < Math.min(MAX_COLUMNS, start + width)) {
        state.cols.push({ name: `Column ${state.cols.length + 1}`, cells: [] });
      }
      for (let c = 0; c < width; c += 1) {
        const col = state.cols[start + c];
        if (col) col.cells = grid.slice(0, MAX_ROWS).map((line) => line[c] ?? '');
      }
      if (grid.length > MAX_ROWS) ctx.notify(`Only the first ${MAX_ROWS} rows were pasted.`);
    }

    function buildData() {
      dataBox.replaceChildren(
        h(
          'div',
          { class: 'st-columns' },
          state.cols.map((col, i) => {
            const name = h('input', {
              class: 'input st-name',
              type: 'text',
              maxlength: String(MAX_NAME),
              'aria-label': `Name of column ${i + 1}`,
              value: col.name,
              oninput: () => {
                col.name = text(name.value, MAX_NAME);
                save();
              },
              onchange: () => buildControls(),
            });
            const area = h('textarea', {
              class: 'input st-area',
              rows: '9',
              spellcheck: 'false',
              'aria-label': `Values in ${col.name}, one per line`,
              placeholder: 'One value per line',
              value: col.cells.join('\n'),
              oninput: () => {
                col.cells = area.value
                  .split('\n')
                  .slice(0, MAX_ROWS)
                  .map((v) => text(v, MAX_CELL));
                save();
                refreshSoon();
              },
              onpaste: (event) => {
                const pasted = event.clipboardData?.getData('text') ?? '';
                const grid = /[\t\n]/.test(pasted.trim()) && pasted.includes('\t') ? parsePastedTable(pasted) : null;
                if (!grid) return;
                event.preventDefault();
                fillColumns(i, grid);
                save();
                buildData();
                buildControls();
                refresh();
              },
            });
            const remove = h(
              'button',
              {
                class: 'btn btn-quiet btn-icon gr-tool',
                type: 'button',
                'aria-label': `Remove column ${i + 1}`,
                title: 'Remove column',
                disabled: state.cols.length <= 2,
                onclick: () => {
                  state.cols.splice(i, 1);
                  Object.assign(state, normalize(state));
                  save();
                  buildData();
                  buildControls();
                  refresh();
                },
              },
              '\u00d7',
            );
            return h('div', { class: 'st-column' }, h('div', { class: 'st-column-head' }, name, remove), area);
          }),
        ),
        h(
          'div',
          { class: 'st-data-actions' },
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              disabled: state.cols.length >= MAX_COLUMNS,
              onclick: () => {
                state.cols.push({ name: `Column ${state.cols.length + 1}`, cells: [] });
                save();
                buildData();
                buildControls();
              },
            },
            'Add column',
          ),
          h(
            'button',
            {
              class: 'btn btn-small',
              type: 'button',
              onclick: () => {
                state.cols = EXAMPLE.map((c) => ({ name: c.name, cells: [...c.cells] }));
                state.describe.col = 0;
                state.regress.x = 0;
                state.regress.y = 1;
                save();
                buildData();
                buildControls();
                refresh();
              },
            },
            'Load an example',
          ),
          h(
            'button',
            {
              class: 'btn btn-small btn-quiet',
              type: 'button',
              onclick: () => {
                for (const c of state.cols) c.cells = [];
                save();
                buildData();
                refresh();
              },
            },
            'Clear values',
          ),
        ),
        h('p', { class: 'st-hint' }, 'Paste from a spreadsheet into any column to fill several at once.'),
      );
    }

    /* ---------------------------------------------------------- controls */

    function buildModes() {
      modeBar.replaceChildren(
        ...MODES.map(([key, name]) =>
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              'aria-pressed': String(state.mode === key),
              onclick: () => {
                state.mode = key;
                save();
                buildModes();
                buildControls();
                refresh();
              },
            },
            name,
          ),
        ),
      );
    }

    function buildControls() {
      const parts = [];
      if (state.mode === 'describe') {
        parts.push(
          columnChoice('Column', state.describe, 'col'),
          choice('Chart', state.describe, 'chart', CHARTS, { rebuild: true }),
        );
        if (state.describe.chart !== 'box') {
          parts.push(textInput('Bin width', state.describe, 'bin', { placeholder: 'automatic' }));
        }
        if (state.describe.chart === 'histogram') {
          const box = h('input', {
            type: 'checkbox',
            checked: state.describe.density,
            onchange: () => {
              state.describe.density = box.checked;
              save();
              refresh();
            },
          });
          parts.push(h('label', { class: 'check' }, box, h('span', {}, 'Show density')));
        }
      } else if (state.mode === 'regress') {
        parts.push(
          columnChoice('x column', state.regress, 'x'),
          columnChoice('y column', state.regress, 'y'),
          choice(
            'Model',
            state.regress,
            'model',
            Object.entries(MODELS).map(([key, m]) => [key, `${m.name}: ${m.form}`]),
          ),
        );
        const box = h('input', {
          type: 'checkbox',
          checked: state.regress.residuals,
          onchange: () => {
            state.regress.residuals = box.checked;
            save();
            refresh();
          },
        });
        parts.push(h('label', { class: 'check' }, box, h('span', {}, 'Plot residuals')));
        parts.push(textInput('Predict y at x', state.regress, 'predict', { placeholder: 'a value of x' }));
      } else if (state.mode === 'dist') {
        const d = state.dist;
        const kindSelect = h(
          'select',
          {
            class: 'select',
            'aria-label': 'Distribution',
            onchange: () => {
              d.kind = kindSelect.value;
              d.params = normalizeParams({}, d.kind);
              save();
              buildControls();
              refresh();
            },
          },
          Object.entries(DISTRIBUTIONS).map(([key, spec]) => h('option', { value: key }, spec.name)),
        );
        kindSelect.value = d.kind;
        parts.push(field('Distribution', kindSelect));
        for (const p of DISTRIBUTIONS[d.kind].params) parts.push(textInput(p.label, d.params, p.key));
        parts.push(choice('Probability of', d, 'shade', SHADES), textInput('a', d, 'a'), textInput('b', d, 'b'));
        parts.push(textInput('Inverse: probability p', d, 'p'));
      } else {
        const t = state.tests;
        parts.push(choice('Test', t, 'kind', TESTS, { rebuild: true }));
        const tail = choice('Alternative', t, 'tail', TAILS);
        const level = textInput('Confidence level', t, 'level');
        const alpha = textInput('Significance level \u03b1', t, 'alpha');
        if (t.kind === 't1' || t.kind === 'z1') {
          parts.push(columnChoice('Data column', t, 'col'), textInput('Hypothesised mean', t, 'mu0'));
          if (t.kind === 'z1') parts.push(textInput('Population standard deviation', t, 'sigma'));
          parts.push(tail, level, alpha);
        } else if (t.kind === 't2') {
          parts.push(columnChoice('Sample 1', t, 'col'), columnChoice('Sample 2', t, 'col2'), tail, level, alpha);
        } else if (t.kind === 'prop1') {
          parts.push(
            textInput('Successes', t, 'x1'),
            textInput('Sample size', t, 'n1'),
            textInput('Hypothesised proportion', t, 'p0'),
            tail,
            level,
            alpha,
          );
        } else if (t.kind === 'prop2') {
          parts.push(
            textInput('Successes, sample 1', t, 'x1'),
            textInput('Size, sample 1', t, 'n1'),
            textInput('Successes, sample 2', t, 'x2'),
            textInput('Size, sample 2', t, 'n2'),
            tail,
            level,
            alpha,
          );
        } else if (t.kind === 'gof') {
          parts.push(
            columnChoice('Observed counts', t, 'col'),
            columnChoice('Expected shares (optional)', t, 'col2'),
            alpha,
          );
        } else {
          parts.push(
            alpha,
            h('p', { class: 'st-hint' }, 'Each column is a column of the table of counts; each row is a row.'),
          );
        }
      }
      controls.replaceChildren(...parts);
    }

    /* ----------------------------------------------------------- results */

    const table = (rows) =>
      h(
        'table',
        { class: 'st-table' },
        h(
          'tbody',
          {},
          rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v))),
        ),
      );
    const note = (message) => h('p', { class: 'st-note', role: 'status' }, message);
    /** Headline numbers, large, above the detail. Each item is [label, value]. */
    const tiles = (items) =>
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
    const callout = (message, significant = false) =>
      h('p', { class: `st-callout${significant ? ' is-significant' : ''}`, role: 'status' }, message);

    function describe() {
      const col = state.cols[state.describe.col];
      const { values, skipped } = columnValues(col);
      const summary = summarize(values);
      const out = [];
      if (!summary) {
        out.push(note('Enter some numbers in a column to see a summary.'));
        return { out, spec: null };
      }
      if (skipped > 0)
        out.push(
          note(
            skipped === 1
              ? '1 entry was not a number and was skipped.'
              : `${skipped} entries were not numbers and were skipped.`,
          ),
        );
      const interval = meanInterval(values, 0.95);
      const { skewness, kurtosis } = shape(values);
      out.push(
        tiles([
          ['Count', show(summary.n)],
          ['Mean', show(summary.mean)],
          ['Median', show(summary.median)],
          ['Standard deviation', show(summary.sd)],
        ]),
      );
      if (interval) {
        out.push(
          callout(
            `95% confidence interval for the mean: ${show(interval.lower)} to ${show(interval.upper)} (t, ${interval.dof} degrees of freedom).`,
          ),
        );
      }
      out.push(
        h(
          'details',
          { class: 'st-more' },
          h('summary', {}, 'All statistics'),
          table([
            ['Count', show(summary.n)],
            ['Mean', show(summary.mean)],
            ['Median', show(summary.median)],
            ['Mode', summary.modes.length ? summary.modes.map(show).join(', ') : 'none'],
            ['Standard deviation (sample)', show(summary.sd)],
            ['Standard deviation (population)', show(summary.sdp)],
            ['Variance (sample)', show(summary.variance)],
            ['Standard error of the mean', interval ? show(interval.stderr) : 'needs 2 values'],
            ['Minimum', show(summary.min)],
            ['First quartile', show(summary.q1)],
            ['Third quartile', show(summary.q3)],
            ['Maximum', show(summary.max)],
            ['Range', show(summary.range)],
            ['Interquartile range', show(summary.iqr)],
            ['Mean absolute deviation', show(summary.mad)],
            ['Sum', show(summary.sum)],
            ['Skewness', skewness === null ? 'needs 3 values with spread' : show(skewness)],
            ['Excess kurtosis', kurtosis === null ? 'needs 4 values with spread' : show(kurtosis)],
            ['Outliers', summary.outliers.length ? summary.outliers.map(show).join(', ') : 'none'],
          ]),
          h('p', { class: 'st-hint' }, 'Quartiles use linear interpolation between sorted values.'),
        ),
      );
      const typed = number(state.describe.bin);
      const width = typed > 0 ? typed : suggestedBinWidth(values);
      let spec;
      if (state.describe.chart === 'box') spec = boxplotSpec(values);
      else if (state.describe.chart === 'dots') spec = dotplotSpec(values, width);
      else spec = histogramSpec(values, width, state.describe.density);
      if (state.describe.chart !== 'box' && !spec)
        out.push(note('That bin width gives too many or too few bins. Try a different one.'));
      return { out, spec };
    }

    function regress() {
      const { x, y } = state.regress;
      const out = [];
      if (x === y) {
        out.push(note('Choose different columns for x and y.'));
        return { out, spec: null };
      }
      const { xs, ys } = pairs(state.cols[x], state.cols[y]);
      if (xs.length === 0) {
        out.push(note('Enter numbers in both columns. Rows missing a value in either one are ignored.'));
        return { out, spec: null };
      }
      const fit = fitModel(xs, ys, state.regress.model);
      if (fit.error) {
        out.push(note(fit.error));
        return { out, spec: scatterSpec(xs, ys), fit: null, xs };
      }
      const names = 'abcd'.split('');
      const rows = [
        ['Equation', equationText(fit.kind, fit.params)],
        ['Points used', String(fit.n)],
        ...fit.params.map((p, i) => [
          `Parameter ${names[i]}`,
          fit.errors ? `${show(p)} \u00b1 ${show(fit.errors[i])}` : show(p),
        ]),
        ['R\u00b2', show(fit.r2)],
      ];
      if (fit.r !== null) rows.push(['Correlation r', show(fit.r)]);
      out.push(
        tiles([
          ['Fitted model', equationText(fit.kind, fit.params)],
          ['R\u00b2', show(fit.r2)],
          ...(fit.r !== null ? [['Correlation r', show(fit.r)]] : []),
        ]),
      );
      out.push(table(rows));
      if (fit.r2 < 0)
        out.push(note('A negative R\u00b2 means this model fits worse than a flat line through the mean.'));
      if (state.regress.predict.trim() !== '') {
        const at = number(state.regress.predict);
        if (!Number.isFinite(at)) out.push(note('Enter a number to predict at.'));
        else {
          const y = fit.predict(at);
          const outside = at < Math.min(...xs) || at > Math.max(...xs);
          out.push(
            callout(
              `At x = ${show(at)} the model predicts y = ${Number.isFinite(y) ? show(y) : 'undefined'}.${outside ? ' That is outside the data, so treat it with care.' : ''}`,
            ),
          );
        }
      }
      out.push(
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(graphEquation(fit.kind, fit.params));
                ctx.notify('Copied. Paste it into a row in the Graphing tool.');
              } catch {
                ctx.notify('Could not copy. Select the equation above and copy it by hand.', 'error');
              }
            },
          },
          'Copy equation for Graphing',
        ),
      );
      return { out, spec: scatterSpec(xs, ys, fit.predict), fit, xs };
    }

    function distribution() {
      const d = state.dist;
      const spec = DISTRIBUTIONS[d.kind];
      const out = [];
      const values = Object.fromEntries(spec.params.map((p) => [p.key, number(d.params[p.key])]));
      const dist = spec.make(values);
      if (!dist) {
        out.push(note('Those values are outside what this distribution allows. Check each one.'));
        return { out, spec: null };
      }
      const a = number(d.a);
      const b = number(d.b);
      let probability = null;
      let shade = null;
      const below = (v) => (spec.discrete ? dist.cdf(Math.ceil(v) - 1) : dist.cdf(v));
      if (d.shade === 'between' && Number.isFinite(a) && Number.isFinite(b) && a <= b) {
        probability = dist.cdf(b) - below(a);
        shade = { from: a, to: b };
      } else if (d.shade === 'left' && Number.isFinite(b)) {
        probability = dist.cdf(b);
        shade = { from: -Infinity, to: b };
      } else if (d.shade === 'right' && Number.isFinite(a)) {
        probability = 1 - below(a);
        shade = { from: a, to: Infinity };
      }
      const rows = [
        ['Mean', show(dist.mean)],
        ['Standard deviation', show(dist.sd)],
        ['Variance', show(dist.variance)],
      ];
      if (probability !== null) rows.push(['Probability', show(probability)]);
      else if (d.shade !== 'none') rows.push(['Probability', 'Enter a number for a and b (a at most b).']);
      const p = number(d.p);
      if (p >= 0 && p <= 1)
        rows.push([`Value with probability ${show(p)} below it`, show(inverseCdf(dist, spec.discrete, p))]);
      out.push(table(rows));
      return { out, spec: distributionSpec(dist, spec.discrete, shade) };
    }

    function pText(result, tail) {
      if (tail === 'left') return show(result.left);
      if (tail === 'right') return show(result.right);
      return show(result.two);
    }

    function tests() {
      const t = state.tests;
      const out = [];
      const level = number(t.level);
      const conf = level > 0 && level < 1 ? level : 0.95;
      const fail = (message) => {
        out.push(note(message));
        return { out, spec: null };
      };
      const rowsFor = (r) => [
        ['Statistic', show(r.score)],
        ...(r.dof !== null && r.dof !== undefined ? [['Degrees of freedom', show(r.dof)]] : []),
        ['Estimate', show(r.estimate)],
        ['Standard error', show(r.stderr)],
        [`p-value (${TAILS.find(([k]) => k === t.tail)[1].toLowerCase()})`, pText(r, t.tail)],
        [`${Math.round(conf * 100)}% confidence interval`, `${show(r.ci.lower)} to ${show(r.ci.upper)}`],
      ];
      const alpha = number(t.alpha);
      const pOf = (r) => (t.tail === 'left' ? r.left : t.tail === 'right' ? r.right : r.two);
      /** Put the hypotheses first, say what the p-value means, and chart where the statistic falls. */
      const finish = (statistic, dof, p) => {
        const hyp = hypotheses(t.kind, t);
        out.unshift(h('div', { class: 'st-hyp' }, h('span', {}, hyp.null), h('span', {}, hyp.alt)));
        const verdict = conclusion(p, alpha);
        if (verdict) out.push(callout(verdict.text, verdict.reject));
        return { out, spec: testSpec(testDistribution(t.kind, { dof }), statistic, t.tail) };
      };
      let result = null;
      if (t.kind === 't1' || t.kind === 'z1') {
        const { values } = columnValues(state.cols[t.col]);
        if (values.length < 2) return fail('Enter at least two numbers in the data column.');
        const mu0 = number(t.mu0);
        if (!Number.isFinite(mu0)) return fail('Enter a number for the hypothesised mean.');
        if (t.kind === 't1') {
          result = tTest(values, { mu0, level: conf });
          if (!result) return fail('The values have no spread, so a t statistic cannot be computed.');
        } else {
          result = zTest(values, { sigma: number(t.sigma), mu0, level: conf });
          if (!result) return fail('Enter a positive number for the population standard deviation.');
        }
        out.push(
          h(
            'p',
            { class: 'st-note' },
            `${result.name}: mean ${show(mean(values))}, sample sd ${show(stdev(values))}, n = ${values.length}.`,
          ),
        );
        out.push(table(rowsFor(result)));
      } else if (t.kind === 't2') {
        const a = columnValues(state.cols[t.col]).values;
        const b = columnValues(state.cols[t.col2]).values;
        result = tTestTwo(a, b, { level: conf });
        if (!result) return fail('Each sample needs at least two numbers, and they cannot both be constant.');
        out.push(h('p', { class: 'st-note' }, `${result.name}: difference of means (sample 1 minus sample 2).`));
        out.push(table(rowsFor(result)));
      } else if (t.kind === 'prop1') {
        result = zPropTest(number(t.x1), number(t.n1), { p0: number(t.p0), level: conf });
        if (!result)
          return fail(
            'Enter whole numbers for successes and sample size (successes at most the size), and a proportion between 0 and 1.',
          );
        out.push(table(rowsFor(result)));
      } else if (t.kind === 'prop2') {
        result = zPropTestTwo(number(t.x1), number(t.n1), number(t.x2), number(t.n2), { level: conf });
        if (!result)
          return fail('Enter successes and sizes for both samples, with each success count at most its size.');
        out.push(table(rowsFor(result)));
      } else if (t.kind === 'gof') {
        const observed = columnValues(state.cols[t.col]).values;
        const expectedCol = t.col2 !== t.col ? columnValues(state.cols[t.col2]).values : [];
        const r = chiSqGof(
          observed,
          expectedCol.length === observed.length && expectedCol.length > 0 ? expectedCol : null,
        );
        if (!r)
          return fail(
            'Enter at least two non-negative counts. Expected shares, if given, must be positive and match in number.',
          );
        out.push(
          table([
            ['Chi-square', show(r.score)],
            ['Degrees of freedom', show(r.dof)],
            ['p-value', show(r.p)],
            ['Expected counts', r.expected.map(show).join(', ')],
          ]),
        );
        return finish(r.score, r.dof, r.p);
      } else {
        const columns = state.cols.map((c) => c.cells.map((v) => number(v)));
        const length = Math.max(...columns.map((c) => c.length));
        const grid = Array.from({ length }, (_, i) => columns.map((c) => c[i]));
        const filled = grid.filter((row) => row.some((v) => Number.isFinite(v)));
        const r = chiSqIndependence(filled);
        if (!r)
          return fail(
            'Enter a table of counts with at least two rows and two columns, with no empty rows or columns and no missing values.',
          );
        out.push(
          table([
            ['Chi-square', show(r.score)],
            ['Degrees of freedom', show(r.dof)],
            ['p-value', show(r.p)],
          ]),
        );
        return finish(r.score, r.dof, r.p);
      }
      return finish(result.score, result.dof, pOf(result));
    }

    /** The numbers in the tables below, as plain text for a report or a message. */
    function copyButton() {
      return h(
        'button',
        {
          class: 'btn btn-small st-copy',
          type: 'button',
          onclick: async () => {
            const lines = [...results.querySelectorAll('.st-table tr')].map(
              (row) => `${row.querySelector('th')?.textContent}: ${row.querySelector('td')?.textContent}`,
            );
            try {
              await navigator.clipboard.writeText(lines.join('\n'));
              ctx.notify('Copied the results as text.');
            } catch {
              ctx.notify('Could not copy. Select the table and copy it by hand.', 'error');
            }
          },
        },
        'Copy results as text',
      );
    }

    /* ------------------------------------------------------------- draw */

    let lastSpec = null;
    let lastResidual = null;

    function paint() {
      const colors = themeColors();
      const a = fitCanvas(main);
      drawChart(a.ctx, a.width, a.height, lastSpec, colors);
      if (!second.hidden) {
        const b = fitCanvas(second);
        drawChart(b.ctx, b.width, b.height, lastResidual, colors);
      }
    }

    function refresh() {
      refreshLater.cancel();
      const compute = { describe, regress, dist: distribution, tests }[state.mode];
      const { out, spec, fit, xs } = compute();
      results.replaceChildren(...out);
      if (results.querySelector('.st-table')) results.append(copyButton());
      lastSpec = spec;
      lastResidual = null;
      const wantResiduals = state.mode === 'regress' && state.regress.residuals && fit;
      second.hidden = !wantResiduals;
      if (wantResiduals) lastResidual = residualSpec(xs, fit.residuals);
      main.hidden = state.mode === 'tests' && !spec;
      if (active) paint();
    }
    const refreshLater = debounce(refresh, 200);
    function refreshSoon() {
      refreshLater();
    }

    /* ------------------------------------------------------------ layout */

    const panel = h(
      'aside',
      { class: 'st-panel', 'aria-label': 'Data' },
      h('h2', { class: 'st-heading' }, 'Data'),
      dataBox,
    );
    const options = h('section', { class: 'st-options', 'aria-label': 'What to do with the data' }, modeBar, controls);
    const stage = h('div', { class: 'st-stage' }, options, h('div', { class: 'st-charts' }, main, second), results);
    root.classList.add('tool', 'stats-tool');
    root.append(h('div', { class: 'stats-layout' }, panel, stage));

    const stopObserving = onResize(stage, () => {
      if (active) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(paint);
      }
    });
    const onTheme = () => active && paint();
    document.addEventListener('clover:themechange', onTheme);

    buildData();
    buildModes();
    buildControls();
    refresh();

    return {
      onShow: () => {
        active = true;
        refresh();
      },
      onHide: () => {
        active = false;
      },
      destroy: () => {
        active = false;
        refreshLater.cancel();
        cancelAnimationFrame(frame);
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
