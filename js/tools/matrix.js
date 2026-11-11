import { h, clamp, onResize } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openMenu } from '../core/menu.js';
import { evaluateNumber } from '../lib/expr.js';
import { det2, dotTerms, formatNumber, multiply } from '../lib/matrix.js';
import { View, drawArrow, drawGrid, fitCanvas, normalizeView, themeColors } from '../lib/viewport.js';
import { attachPanZoom } from '../lib/interact.js';

const MAX_DIM = 6;
const DEFAULT_VIEW = { cx: 0, cy: 0, radius: 7 };
const SUBSCRIPTS = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';
const sub = (n) => String(n).replace(/\d/g, (d) => SUBSCRIPTS[Number(d)]);
const TERM_COLORS = ['a', 'b', 'c'];

const DEFAULTS = {
  A: [
    ['2', '1'],
    ['1', '3'],
  ],
  B: [
    ['1', '-1'],
    ['1', '1'],
  ],
  x: ['1', '1'],
};

const dim = (value, fallback) => (Number.isInteger(value) ? clamp(value, 1, MAX_DIM) : fallback);

function readMatrix(raw, rows, cols, fallback) {
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const cell = Array.isArray(raw) && Array.isArray(raw[i]) ? raw[i][j] : undefined;
      if (typeof cell === 'string' || typeof cell === 'number') return String(cell).slice(0, 14);
      return fallback?.[i]?.[j] ?? '0';
    }),
  );
}

export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const m = dim(r.m, 2);
  const n = dim(r.n, 2);
  const p = dim(r.p, 2);
  const x = readMatrix(
    Array.isArray(r.x) ? r.x.map((v) => [v]) : null,
    n,
    1,
    DEFAULTS.x.map((v) => [v]),
  ).map((row) => row[0]);
  return {
    mode: r.mode === 'mv' ? 'mv' : 'mm',
    m,
    n,
    p,
    A: readMatrix(r.A, m, n, DEFAULTS.A),
    B: readMatrix(r.B, n, p, DEFAULTS.B),
    x,
    view: normalizeView(r.view, DEFAULT_VIEW),
  };
}

const parseCells = (cells) => cells.map((row) => row.map((text) => evaluateNumber(text)));
const allFinite = (matrix) => matrix.every((row) => row.every(Number.isFinite));
const fmtInput = (value) => String(Number(value.toFixed(4)));

const PRESETS = [
  {
    label: 'Identity',
    data: (m, n) => Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? '1' : '0'))),
  },
  {
    label: 'Rotate 90\u00b0',
    two: [
      ['0', '-1'],
      ['1', '0'],
    ],
  },
  {
    label: 'Rotate 45\u00b0',
    two: [
      ['sqrt(2)/2', '-sqrt(2)/2'],
      ['sqrt(2)/2', 'sqrt(2)/2'],
    ],
  },
  {
    label: 'Shear',
    two: [
      ['1', '1'],
      ['0', '1'],
    ],
  },
  {
    label: 'Scale',
    two: [
      ['2', '0'],
      ['0', '0.5'],
    ],
  },
  {
    label: 'Reflect over x-axis',
    two: [
      ['1', '0'],
      ['0', '-1'],
    ],
  },
  {
    label: 'Project onto x-axis',
    two: [
      ['1', '0'],
      ['0', '0'],
    ],
  },
];

export default {
  type: 'matrix',
  name: 'Matrices',
  description:
    'Multiply matrices and matrix-vector products, one dot product at a time, with the geometry of 2\u00d72 maps.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    const view = new View({ cx: 0, cy: 0, radius: 2.6 }, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, view, colors, { labels: false });
    const M = [
      [1.2, 0.7],
      [0.1, 0.9],
    ];
    const map = (x, y) => view.toScreen(M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = colors.accent;
    ctx.beginPath();
    for (let k = -6; k <= 6; k += 1) {
      const a = map(k, -6);
      const b = map(k, 6);
      const c = map(-6, k);
      const d = map(6, k);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(d[0], d[1]);
    }
    ctx.stroke();
    ctx.restore();
    const o = map(0, 0);
    const i = map(1, 0);
    const j = map(0, 1);
    drawArrow(ctx, o[0], o[1], i[0], i[1], { color: colors.a, width: 2.5 });
    drawArrow(ctx, o[0], o[1], j[0], j[1], { color: colors.b, width: 2.5 });
  },

  mount(root, ctx) {
    const state = ctx.state;
    const view = new View(state.view, 1, 1);
    const ui = {};
    let selected = { i: 0, j: 0 };
    let hover = null;
    let timer = null;
    let numeric = { A: [], B: [], C: [], valid: false };
    let grids = {};

    const dims = () => ({ m: state.m, n: state.n, p: state.mode === 'mv' ? 1 : state.p });
    const effectiveB = () => (state.mode === 'mv' ? state.x.map((v) => [v]) : state.B);
    const geometryAvailable = () => {
      const { m, n, p } = dims();
      return state.mode === 'mv' ? m === 2 && n === 2 : m === 2 && n === 2 && p === 2;
    };

    /* --------------------------------------------------------- grid builders */

    function matrixGrid({ rows, cols, editable, name, variant, get, set, onChange }) {
      const cells = [];
      const el = h('div', { class: `mx-grid mx-grid-${variant}`, role: 'group', 'aria-label': `Matrix ${name}` });
      el.style.setProperty('--cols', String(cols));
      for (let i = 0; i < rows; i += 1) {
        const row = [];
        for (let j = 0; j < cols; j += 1) {
          let cell;
          if (editable) {
            cell = h('input', {
              class: 'mx-cell',
              type: 'text',
              inputmode: 'decimal',
              spellcheck: 'false',
              autocomplete: 'off',
              value: get(i, j),
              'aria-label': `${name} row ${i + 1}, column ${j + 1}`,
              onfocus: () => cell.select(),
              oninput: () => {
                set(i, j, cell.value.slice(0, 14));
                onChange();
              },
              onkeydown: (event) => {
                const target = { ArrowUp: [i - 1, j], ArrowDown: [i + 1, j], Enter: [i + 1, j] }[event.key];
                if (!target) return;
                const next = cells[target[0]]?.[target[1]];
                if (event.key === 'Enter' && !next) return;
                event.preventDefault();
                next?.focus();
              },
            });
          } else {
            cell = h('button', {
              class: 'mx-cell mx-out',
              type: 'button',
              'aria-label': `Result row ${i + 1}, column ${j + 1}`,
              onclick: () => select(i, j),
              onfocus: () => select(i, j),
              onpointerenter: (event) => {
                if (event.pointerType === 'mouse') select(i, j);
              },
            });
          }
          row.push(cell);
        }
        cells.push(row);
        el.append(...row);
      }
      return { el, cells };
    }

    const readOnlyGrid = (values, colorClass) => {
      const el = h('div', { class: `mx-grid mx-mini ${colorClass}`, 'aria-hidden': 'true' });
      el.style.setProperty('--cols', '1');
      values.forEach((v) => el.append(h('div', { class: 'mx-cell mx-static' }, formatNumber(v))));
      return el;
    };

    /* ------------------------------------------------------------ interaction */

    function select(i, j) {
      if (selected.i === i && selected.j === j) return;
      selected = { i, j };
      highlight();
    }

    function setHover(spec) {
      hover = spec;
      highlight();
    }

    function highlight() {
      const { m, p } = dims();
      selected = { i: Math.min(selected.i, m - 1), j: Math.min(selected.j, p - 1) };
      const { i, j } = selected;
      const aRow = hover?.aCol !== undefined ? null : i;
      const aCol = hover?.aCol ?? null;
      const bCol = hover ? null : j;
      const bRow = hover?.bRow ?? null;
      grids.A.cells.forEach((row, r) => row.forEach((c) => c.classList.toggle('is-row', r === aRow)));
      grids.A.cells.forEach((row) => row.forEach((c, k) => c.classList.toggle('is-col', k === aCol)));
      grids.B.cells.forEach((row, r) =>
        row.forEach((c, k) => {
          c.classList.toggle('is-col', k === bCol);
          c.classList.toggle('is-row', r === bRow);
        }),
      );
      grids.C.cells.forEach((row, r) =>
        row.forEach((c, k) => {
          c.classList.toggle('is-target', r === i && k === j);
          c.setAttribute('aria-pressed', r === i && k === j ? 'true' : 'false');
        }),
      );
      renderExplanation();
    }

    function renderExplanation() {
      const out = ui.explain;
      out.replaceChildren();
      if (!numeric.valid) {
        out.append(h('p', { class: 'mx-hint' }, 'Enter numbers or simple expressions such as 1/2 or sqrt(2).'));
        return;
      }
      const { i, j } = selected;
      const terms = dotTerms(numeric.A, numeric.B, i, j);
      const total = terms.reduce((sum, t) => sum + t.product, 0);
      const target = state.mode === 'mv' ? `(Ax)${sub(i + 1)}` : `(AB)${sub(i + 1)}${sub(j + 1)}`;
      const row = `row ${i + 1} of A`;
      const column = state.mode === 'mv' ? 'the vector x' : `column ${j + 1} of B`;
      out.append(
        h('p', { class: 'mx-explain-title' }, `${target} is ${row} dotted with ${column}`),
        h(
          'p',
          { class: 'mx-sum' },
          terms.map((t, k) => [
            k > 0 ? h('span', { class: 'mx-op' }, ' + ') : null,
            h('span', { class: 'mx-t-row' }, formatNumber(t.a)),
            h('span', { class: 'mx-op' }, ' \u00d7 '),
            h('span', { class: 'mx-t-col' }, formatNumber(t.b)),
          ]),
        ),
        h(
          'p',
          { class: 'mx-sum mx-sum-products' },
          terms.map((t, k) => [k > 0 ? h('span', { class: 'mx-op' }, ' + ') : null, formatNumber(t.product)]),
          h('span', { class: 'mx-op' }, ' = '),
          h('strong', {}, formatNumber(total)),
        ),
      );
    }

    function renderColumns() {
      const host = ui.columns;
      host.replaceChildren();
      host.hidden = state.mode !== 'mv' || !numeric.valid;
      if (host.hidden) return;
      const { m, n } = dims();
      const pieces = [];
      for (let k = 0; k < n; k += 1) {
        const color = TERM_COLORS[k % TERM_COLORS.length];
        const column = numeric.A.map((row) => row[k]);
        const term = h(
          'div',
          {
            class: `mx-term mx-color-${color}`,
            tabindex: 0,
            'aria-label': `Term ${k + 1}: x${sub(k + 1)} times column ${k + 1} of A`,
            onpointerenter: () => setHover({ aCol: k, bRow: k }),
            onpointerleave: () => setHover(null),
            onfocus: () => setHover({ aCol: k, bRow: k }),
            onblur: () => setHover(null),
          },
          h('span', { class: 'mx-scalar' }, formatNumber(numeric.B[k][0])),
          h('span', { class: 'mx-op' }, '\u00d7'),
          readOnlyGrid(column, ''),
        );
        if (k > 0) pieces.push(h('span', { class: 'mx-op mx-plus' }, '+'));
        pieces.push(term);
      }
      pieces.push(
        h('span', { class: 'mx-op mx-plus' }, '='),
        readOnlyGrid(
          numeric.C.map((row) => row[0]),
          'mx-result',
        ),
      );
      host.append(
        h(
          'p',
          { class: 'mx-columns-title' },
          `Ax is a combination of the ${n} column${n === 1 ? '' : 's'} of A, weighted by the entries of x`,
        ),
        h('div', { class: 'mx-columns-row', 'data-rows': String(m) }, pieces),
      );
    }

    function recompute() {
      const A = parseCells(state.A);
      const B = parseCells(effectiveB());
      const valid = allFinite(A) && allFinite(B);
      let C = [];
      if (valid) C = multiply(A, B);
      numeric = { A, B, C, valid };
      state.A.forEach((row, i) =>
        row.forEach((_, j) => grids.A.cells[i][j].toggleAttribute('aria-invalid', !Number.isFinite(A[i][j]))),
      );
      effectiveB().forEach((row, i) =>
        row.forEach((_, j) => grids.B.cells[i][j].toggleAttribute('aria-invalid', !Number.isFinite(B[i][j]))),
      );
      grids.C.cells.forEach((row, i) =>
        row.forEach((cell, j) => {
          const text = valid ? formatNumber(C[i][j]) : '?';
          cell.textContent = text;
          cell.setAttribute('aria-label', `Result row ${i + 1}, column ${j + 1}: ${text}`);
        }),
      );
    }

    function refresh({ geometry = true } = {}) {
      recompute();
      highlight();
      renderColumns();
      if (geometry) drawGeometry();
    }

    function onEdit() {
      stopPlaying();
      refresh();
      ctx.save();
    }

    /* ------------------------------------------------------------ build layout */

    function build() {
      const { m, n, p } = dims();
      const labelB = state.mode === 'mv' ? 'x' : 'B';
      grids = {
        A: matrixGrid({
          rows: m,
          cols: n,
          editable: true,
          name: 'A',
          variant: 'a',
          get: (i, j) => state.A[i][j],
          set: (i, j, value) => {
            state.A[i][j] = value;
          },
          onChange: onEdit,
        }),
        B: matrixGrid({
          rows: n,
          cols: p,
          editable: true,
          name: labelB,
          variant: 'b',
          get: (i, j) => (state.mode === 'mv' ? state.x[i] : state.B[i][j]),
          set: (i, j, value) => {
            if (state.mode === 'mv') state.x[i] = value;
            else state.B[i][j] = value;
          },
          onChange: onEdit,
        }),
        C: matrixGrid({ rows: m, cols: p, editable: false, name: state.mode === 'mv' ? 'Ax' : 'AB', variant: 'c' }),
      };
      const caption = (name, rows, cols) =>
        h(
          'div',
          { class: 'mx-caption' },
          h('span', { class: 'mx-name' }, name),
          h('span', { class: 'mx-dim' }, `${rows} \u00d7 ${cols}`),
        );
      const equation = h(
        'div',
        { class: 'mx-equation' },
        h('div', { class: 'mx-part' }, caption('A', m, n), grids.A.el),
        h('div', { class: 'mx-symbol', 'aria-hidden': 'true' }, '\u00d7'),
        h('div', { class: 'mx-part' }, caption(labelB, n, p), grids.B.el),
        h('div', { class: 'mx-symbol', 'aria-hidden': 'true' }, '='),
        h('div', { class: 'mx-part' }, caption(state.mode === 'mv' ? 'Ax' : 'AB', m, p), grids.C.el),
      );
      ui.equationHost.replaceChildren(equation);
      ui.pCtl.hidden = state.mode === 'mv';
      ui.nLabel.textContent = state.mode === 'mv' ? 'A columns = x length' : 'A columns = B rows';
      updateSteppers();
      ui.modeButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
      refresh();
    }

    function updateSteppers() {
      ui.mOut.textContent = String(state.m);
      ui.nOut.textContent = String(state.n);
      ui.pOut.textContent = String(state.p);
    }

    function resizeState(key, delta) {
      const next = clamp(state[key] + delta, 1, MAX_DIM);
      if (next === state[key]) return;
      state[key] = next;
      state.A = readMatrix(state.A, state.m, state.n, null);
      state.B = readMatrix(state.B, state.n, state.p, null);
      state.x = readMatrix(
        state.x.map((v) => [v]),
        state.n,
        1,
        null,
      ).map((row) => row[0]);
      stopPlaying();
      build();
      ctx.save();
    }

    function stepper(key, label) {
      const out = h('output', { class: 'stepper-value', 'aria-live': 'polite' });
      const labelEl = h('span', { class: 'field-label' }, label);
      const el = h(
        'div',
        { class: 'field', role: 'group', 'aria-label': label },
        labelEl,
        h(
          'div',
          { class: 'stepper' },
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': `Decrease ${label}`,
              onclick: () => resizeState(key, -1),
            },
            '\u2212',
          ),
          out,
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': `Increase ${label}`,
              onclick: () => resizeState(key, 1),
            },
            '+',
          ),
        ),
      );
      return { el, out, labelEl };
    }

    function setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      stopPlaying();
      build();
      ctx.save();
    }

    function applyPreset(preset) {
      if (preset.two) {
        state.m = 2;
        state.n = 2;
        state.A = preset.two.map((row) => [...row]);
        state.B = readMatrix(state.B, 2, state.p, null);
        state.x = readMatrix(
          state.x.map((v) => [v]),
          2,
          1,
          null,
        ).map((row) => row[0]);
      } else {
        state.A = preset.data(state.m, state.n);
      }
      stopPlaying();
      build();
      ctx.save();
    }

    function randomize() {
      const rand = () => String(Math.floor(Math.random() * 7) - 3);
      state.A = state.A.map((row) => row.map(rand));
      state.B = state.B.map((row) => row.map(rand));
      state.x = state.x.map(rand);
      stopPlaying();
      build();
      ctx.save();
    }

    /* ------------------------------------------------------------ step player */

    function stopPlaying() {
      if (timer) clearInterval(timer);
      timer = null;
      if (ui.playButton) {
        ui.playButton.replaceChildren(icon('play', 14), ' Step through');
        ui.playButton.setAttribute('aria-pressed', 'false');
      }
    }

    function togglePlay() {
      if (timer) {
        stopPlaying();
        return;
      }
      ui.playButton.replaceChildren(icon('stop', 14), ' Stop');
      ui.playButton.setAttribute('aria-pressed', 'true');
      timer = setInterval(() => {
        const { m, p } = dims();
        let { i, j } = selected;
        j += 1;
        if (j >= p) {
          j = 0;
          i = (i + 1) % m;
        }
        selected = { i, j };
        highlight();
      }, 1100);
    }

    /* --------------------------------------------------------------- geometry */

    const dragHandler = {
      hitTest(px, py) {
        if (state.mode !== 'mv' || !geometryAvailable() || !numeric.valid) return false;
        const [sx, sy] = view.toScreen(numeric.B[0][0], numeric.B[1][0]);
        return Math.hypot(px - sx, py - sy) < 16;
      },
      move(px, py) {
        const [wx, wy] = view.toWorld(px, py);
        const snap = (v) => Math.round(v * 4) / 4;
        state.x = [fmtInput(snap(wx)), fmtInput(snap(wy))];
        grids.B.cells[0][0].value = state.x[0];
        grids.B.cells[1][0].value = state.x[1];
        refresh();
        ctx.save();
      },
    };

    function drawGeometry() {
      const available = geometryAvailable();
      ui.geoEmpty.hidden = available;
      ui.canvas.hidden = !available;
      ui.geoCaption.hidden = !available;
      if (!available) return;
      const { ctx: g, width, height } = fitCanvas(ui.canvas);
      if (width <= 1 || height <= 1) return;
      view.resize(width, height);
      const colors = themeColors();
      g.fillStyle = colors.bg;
      g.fillRect(0, 0, width, height);
      drawGrid(g, view, colors, { grid: true, labels: true });
      if (!numeric.valid) {
        ui.geoCaption.textContent = 'Enter valid numbers to see the transformation.';
        return;
      }
      const M = state.mode === 'mv' ? numeric.A : numeric.C;
      const map = (T, x, y) => view.toScreen(T[0][0] * x + T[0][1] * y, T[1][0] * x + T[1][1] * y);
      const polygon = (T, color, fill, dash) => {
        g.beginPath();
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ].forEach(([x, y], k) => {
          const [sx, sy] = map(T, x, y);
          if (k === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        });
        g.closePath();
        if (fill) {
          g.save();
          g.globalAlpha = 0.18;
          g.fillStyle = color;
          g.fill();
          g.restore();
        }
        g.setLineDash(dash ?? []);
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.stroke();
        g.setLineDash([]);
      };

      g.save();
      g.globalAlpha = 0.45;
      g.strokeStyle = colors.accent;
      g.lineWidth = 1;
      g.beginPath();
      const N = 14;
      for (let k = -N; k <= N; k += 1) {
        const [ax, ay] = map(M, k, -N);
        const [bx, by] = map(M, k, N);
        const [cx, cy] = map(M, -N, k);
        const [dx, dy] = map(M, N, k);
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.moveTo(cx, cy);
        g.lineTo(dx, dy);
      }
      g.stroke();
      g.restore();

      if (state.mode === 'mm') polygon(numeric.B, colors.c, false, [5, 4]);
      polygon(M, colors.accent, true);

      const [ox, oy] = view.toScreen(0, 0);
      const e1 = map(M, 1, 0);
      const e2 = map(M, 0, 1);
      drawArrow(g, ox, oy, e1[0], e1[1], { color: colors.a, width: 2.5 });
      drawArrow(g, ox, oy, e2[0], e2[1], { color: colors.b, width: 2.5 });
      g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillStyle = colors.a;
      g.fillText('e\u2081\u2032', e1[0] + 8, e1[1] - 8);
      g.fillStyle = colors.b;
      g.fillText('e\u2082\u2032', e2[0] + 8, e2[1] - 8);

      if (state.mode === 'mv') {
        const [vx, vy] = [numeric.B[0][0], numeric.B[1][0]];
        const [px, py] = view.toScreen(vx, vy);
        const [tx, ty] = map(M, vx, vy);
        drawArrow(g, ox, oy, px, py, { color: colors.text, width: 2, dash: [5, 4] });
        drawArrow(g, ox, oy, tx, ty, { color: colors.ink, width: 3 });
        g.fillStyle = colors.ink;
        g.fillText('Ax', tx + 10, ty - 10);
        g.fillStyle = colors.text;
        g.fillText('x', px + 10, py + 12);
        g.beginPath();
        g.arc(px, py, 5.5, 0, Math.PI * 2);
        g.fillStyle = colors.bg;
        g.fill();
        g.strokeStyle = colors.ink;
        g.lineWidth = 2;
        g.stroke();
      }

      const det = det2(M);
      const nature =
        Math.abs(det) < 1e-9
          ? 'The map collapses the plane onto a line or point.'
          : det < 0
            ? 'Areas scale by |det| and orientation flips.'
            : 'Areas scale by det and orientation is kept.';
      ui.geoCaption.textContent = `${state.mode === 'mv' ? 'det A' : 'det AB'} = ${formatNumber(det)}. ${nature}`;
    }

    /* -------------------------------------------------------------- assemble */

    const mCtl = stepper('m', 'A rows');
    const nCtl = stepper('n', 'A columns');
    const pCtl = stepper('p', 'B columns');
    ui.mOut = mCtl.out;
    ui.nOut = nCtl.out;
    ui.pOut = pCtl.out;
    ui.nLabel = nCtl.labelEl;
    ui.pCtl = pCtl.el;

    ui.modeButtons = [
      h(
        'button',
        { class: 'segment', type: 'button', role: 'radio', dataset: { mode: 'mm' }, onclick: () => setMode('mm') },
        'Matrix \u00d7 matrix',
      ),
      h(
        'button',
        { class: 'segment', type: 'button', role: 'radio', dataset: { mode: 'mv' }, onclick: () => setMode('mv') },
        'Matrix \u00d7 vector',
      ),
    ];
    const presetsButton = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        'aria-haspopup': 'menu',
        onclick: () =>
          openMenu(presetsButton, [
            ...PRESETS.map((preset) => ({ label: preset.label, onSelect: () => applyPreset(preset) })),
            { separator: true },
            { label: 'Randomize', icon: 'reset', onSelect: randomize },
          ]),
      },
      'Examples for A',
    );
    ui.playButton = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: togglePlay });
    ui.equationHost = h('div', { class: 'mx-equation-host' });
    ui.explain = h('div', { class: 'mx-explain', 'aria-live': 'polite' });
    ui.columns = h('div', { class: 'mx-columns' });
    ui.canvas = h('canvas', {
      class: 'plot-canvas mx-canvas',
      role: 'img',
      'aria-label': 'Geometric view of the transformation. Drag to pan, scroll to zoom.',
    });
    ui.geoEmpty = h(
      'p',
      { class: 'tool-note mx-geo-empty' },
      'The geometric view appears when the matrices are 2 \u00d7 2 (and, for products with a vector, when x has two entries).',
    );
    ui.geoCaption = h('p', { class: 'mx-geo-caption' });

    root.classList.add('tool', 'matrix-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Operation' }, ui.modeButtons),
        mCtl.el,
        nCtl.el,
        pCtl.el,
        presetsButton,
      ),
      h(
        'div',
        { class: 'tool-body mx-body' },
        h(
          'section',
          { class: 'mx-main', 'aria-label': 'Product' },
          ui.equationHost,
          h('div', { class: 'mx-explain-wrap' }, ui.explain, ui.playButton),
          ui.columns,
        ),
        h(
          'section',
          { class: 'mx-geo', 'aria-label': 'Geometry' },
          h('div', { class: 'mx-canvas-wrap' }, ui.canvas, ui.geoEmpty),
          ui.geoCaption,
        ),
      ),
    );

    const detach = attachPanZoom(ui.canvas, view, {
      onChange: () => {
        state.view = view.toJSON();
        drawGeometry();
        ctx.save();
      },
      onReset: () => {
        view.set(DEFAULT_VIEW);
        state.view = view.toJSON();
        drawGeometry();
        ctx.save();
      },
      onHover: (x, y) => {
        ui.canvas.style.cursor = dragHandler.hitTest(x, y) ? 'grab' : '';
      },
      drag: dragHandler,
    });
    const stopObserving = onResize(ui.canvas, () => drawGeometry());
    const onTheme = () => drawGeometry();
    document.addEventListener('clover:themechange', onTheme);

    stopPlaying();
    build();

    return {
      onShow: () => drawGeometry(),
      onHide: () => stopPlaying(),
      destroy: () => {
        stopPlaying();
        detach();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
