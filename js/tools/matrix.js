import { clamp, debounce, h, onResize } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openMenu } from '../core/menu.js';
import { createMathField } from '../core/mathfield.js';
import { Eigen, evaluateLines, formatScalar, isMatrix, MAX_DIM } from '../lib/linalg.js';
import { attachPanZoom } from '../lib/interact.js';
import { draw2D, draw3D, describePlan, legendFor, summarizePlan, tipOf2 } from '../lib/linvizdraw.js';
import { fitRadius, planFor } from '../lib/linviz.js';
import { typeset } from '../lib/graph/typeset.js';
import { View, fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_LINES = 40;
const MAX_CELL = 24;
const MAX_TEXT = 300;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const NAME_PATTERN = /^[\p{L}][\p{L}\p{N}_]{0,15}$/u;
const SHORTCUT = /^\s*(?:([\p{L}][\p{L}\p{N}_]*)\s*=\s*)?(matrix|vector)\s*$/u;

/* ------------------------------------------------------------------- state */

const zeroCells = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => '0'));

function readCells(raw, fallbackRows = 2, fallbackCols = 2) {
  const source = Array.isArray(raw) ? raw.filter(Array.isArray).slice(0, MAX_DIM) : [];
  const rows = source.length || fallbackRows;
  const cols = source.length ? clamp(Math.max(1, ...source.map((row) => row.length)), 1, MAX_DIM) : fallbackCols;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const cell = source[i]?.[j];
      return typeof cell === 'string' || typeof cell === 'number' ? String(cell).slice(0, MAX_CELL) : '0';
    }),
  );
}

function normalizeLine(raw, taken, counter) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'matrix' && raw.kind !== 'expr') return null;
  let id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !taken.has(raw.id) ? raw.id : null;
  while (id === null || taken.has(id)) {
    counter.n += 1;
    id = `l${counter.n}`;
  }
  taken.add(id);
  if (raw.kind === 'expr') {
    return {
      id,
      kind: 'expr',
      text: typeof raw.text === 'string' ? raw.text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) : '',
    };
  }
  const name = typeof raw.name === 'string' && NAME_PATTERN.test(raw.name.trim()) ? raw.name.trim() : '';
  return { id, kind: 'matrix', name, cells: readCells(raw.cells) };
}

/** Version 1 of this tool held A, B, and a vector x; they become lines. */
function fromLegacy(raw) {
  const A = readCells(raw.A);
  const lines = [{ kind: 'matrix', name: 'A', cells: A }];
  if (raw.mode === 'mv') {
    const x = Array.isArray(raw.x) ? raw.x.map((v) => [v]) : [['1'], ['1']];
    lines.push({ kind: 'matrix', name: 'x', cells: readCells(x) }, { kind: 'expr', text: 'A*x' });
  } else {
    lines.push({ kind: 'matrix', name: 'B', cells: readCells(raw.B) }, { kind: 'expr', text: 'A*B' });
  }
  return lines;
}

const STARTER = () => [
  {
    kind: 'matrix',
    name: 'A',
    cells: [
      ['2', '1'],
      ['1', '3'],
    ],
  },
  {
    kind: 'matrix',
    name: 'B',
    cells: [
      ['1', '-1'],
      ['1', '1'],
    ],
  },
  { kind: 'expr', text: 'A+B' },
  { kind: 'expr', text: 'A*B' },
];

/** Ready-made products for the Examples menu: a matrix, and a vector for it to act on. */
const EXAMPLES = [
  {
    label: 'Rotate by 90\u00b0',
    cells: [
      ['0', '-1'],
      ['1', '0'],
    ],
  },
  {
    label: 'Rotate by 45\u00b0',
    cells: [
      ['sqrt(2)/2', '-sqrt(2)/2'],
      ['sqrt(2)/2', 'sqrt(2)/2'],
    ],
  },
  {
    label: 'Stretch along x',
    cells: [
      ['2', '0'],
      ['0', '1'],
    ],
  },
  {
    label: 'Shear',
    cells: [
      ['1', '1'],
      ['0', '1'],
    ],
  },
  {
    label: 'Reflect over the x axis',
    cells: [
      ['1', '0'],
      ['0', '-1'],
    ],
  },
  {
    label: 'Project onto the x axis',
    cells: [
      ['1', '0'],
      ['0', '0'],
    ],
  },
];

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const taken = new Set();
  const counter = { n: 0 };
  let list = Array.isArray(r.lines) ? r.lines : Array.isArray(r.A) ? fromLegacy(r) : [];
  list = list.slice(0, MAX_LINES);
  let lines = list.map((l) => normalizeLine(l, taken, counter)).filter(Boolean);
  if (lines.length === 0) {
    taken.clear();
    lines = STARTER().map((l) => normalizeLine(l, taken, counter));
  }
  return { lines };
}

/* -------------------------------------------------------------------- tool */

function eigenDisplay(value) {
  const rows = value.pairs.map((pair) => {
    if (pair.value === null) {
      const text = `${formatScalar(pair.re)} \u00b1 ${formatScalar(Math.abs(pair.im))}i`;
      return h(
        'li',
        { class: 'mx-eig' },
        `\u03bb = ${text}`,
        h('span', { class: 'mx-eig-note' }, ' complex pair, no real eigenvectors'),
      );
    }
    const times = pair.multiplicity > 1 ? ` (multiplicity ${pair.multiplicity})` : '';
    const vectors = pair.vectors.map((v) => `(${v.map(formatScalar).join(', ')})`).join(' and ');
    return h(
      'li',
      { class: 'mx-eig' },
      `\u03bb = ${formatScalar(pair.value)}${times}`,
      h(
        'span',
        { class: 'mx-eig-note' },
        vectors ? `, eigenvector${pair.vectors.length > 1 ? 's' : ''} ${vectors}` : ', no eigenvector',
      ),
    );
  });
  return h('ul', { class: 'mx-eigs', 'aria-label': 'Eigenvalues and eigenvectors' }, rows);
}

function matrixDisplay(matrix) {
  const out = h(
    'div',
    { class: 'mx-out', role: 'group', 'aria-label': `Matrix, ${matrix.shape}` },
    ...matrix.a.flat().map((x) => h('span', { class: 'mx-entry' }, typeset(formatScalar(x)))),
  );
  out.style.setProperty('--cols', String(matrix.cols));
  return out;
}

export default {
  type: 'matrix',
  name: 'Linear algebra',
  description:
    'Define matrices and vectors, then add, multiply, invert, and find eigenvalues. Click any line to see it drawn: vectors in the plane, and what a matrix does to them.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const box = Math.min(width * 0.22, height * 0.5);
    const y = (height - box) / 2;
    const bracket = (x) => {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + box);
      ctx.lineTo(x + 6, y + box);
      ctx.moveTo(x + box - 6, y);
      ctx.lineTo(x + box, y);
      ctx.lineTo(x + box, y + box);
      ctx.lineTo(x + box - 6, y + box);
      ctx.stroke();
      ctx.fillStyle = colors.grid;
      for (let i = 0; i < 2; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          ctx.fillRect(x + box * (0.25 + 0.3 * j), y + box * (0.22 + 0.34 * i), box * 0.16, box * 0.16);
        }
      }
    };
    const gap = (width - box * 3) / 4;
    [gap, gap * 2 + box, gap * 3 + box * 2].forEach(bracket);
    ctx.fillStyle = colors.accent;
    ctx.font = `${Math.round(box * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u00d7', gap * 1.5 + box, height / 2);
    ctx.fillText('=', gap * 2.5 + box * 2, height / 2);
  },

  mount(root, ctx) {
    const state = ctx.state;
    const lineEls = new Map();
    const fields = new Map();
    let result = [];

    const list = h('ol', { class: 'mx-lines' });
    let selectedId = null;
    let active = false;
    let t = 1;
    let animation = 0;
    let yaw = 0.6;
    let pitch = 0.45;
    let zoom3 = 1;
    let detail = false;
    let plan = { kind: 'none', message: 'Click a line to see it drawn, or try Examples.' };
    const view = new View({ cx: 0, cy: 0, radius: 5 }, 1, 1);
    const indexOf = (id) => state.lines.findIndex((l) => l.id === id);

    /* ------------------------------------------------------------- picture */

    const canvas = h('canvas', {
      class: 'plot-canvas',
      tabindex: 0,
      role: 'img',
      'aria-label': 'Click a line to see it drawn.',
    });
    const placeholder = h('p', { class: 'mx-viz-empty' });
    const caption = h('p', { class: 'mx-caption', 'aria-live': 'polite' });
    const legend = h('ul', { class: 'mx-legend', 'aria-label': 'What the colours mean' });
    const moreText = h('p', { class: 'mx-more-text' });
    const more = h('details', { class: 'mx-more' }, h('summary', {}, 'More about this picture'), moreText);
    const detailBox = h('input', {
      type: 'checkbox',
      onchange: () => {
        detail = detailBox.checked;
        drawViz();
      },
    });
    const detailToggle = h('label', { class: 'check mx-detail' }, detailBox, h('span', {}, 'Show grid and details'));
    const vizHead = h('div', { class: 'mx-viz-head' }, h('span', { class: 'mx-viz-title' }, 'Picture'), detailToggle);
    const slider = h('input', {
      class: 'mx-slider',
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: '1',
      'aria-label': 'How much of the matrix has been applied, from none to all',
      oninput: () => {
        cancelAnimationFrame(animation);
        t = Number(slider.value);
        drawViz();
      },
    });
    const animate = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        onclick: () => {
          cancelAnimationFrame(animation);
          const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduce) {
            t = 1;
            slider.value = '1';
            drawViz();
            return;
          }
          const start = performance.now();
          const tick = (now) => {
            t = Math.min(1, (now - start) / 1400);
            slider.value = String(t);
            drawViz();
            if (t < 1) animation = requestAnimationFrame(tick);
          };
          t = 0;
          animation = requestAnimationFrame(tick);
        },
      },
      icon('play', 12),
      ' Apply',
    );
    const controls = h(
      'div',
      { class: 'mx-viz-controls' },
      h('span', { class: 'field-label' }, 'Apply'),
      slider,
      animate,
    );
    const stage = h('div', { class: 'mx-viz-stage plot-body' }, canvas, placeholder);

    const selectedIndex = () => state.lines.findIndex((l) => l.id === selectedId);

    /** Text that depends on the plan, not on how far the animation has run. */
    function renderInfo() {
      const none = plan.kind === 'none';
      const full = describePlan(plan);
      caption.textContent = none ? '' : summarizePlan(plan);
      moreText.textContent = none ? '' : full;
      more.hidden = none;
      detailToggle.hidden = plan.kind !== 'apply';
      legend.replaceChildren(
        ...legendFor(plan).map((item) =>
          h(
            'li',
            { class: `mx-key mx-key-${item.role}` },
            h('span', { class: 'mx-swatch', 'aria-hidden': 'true' }),
            item.text,
          ),
        ),
      );
      legend.hidden = legend.childNodes.length === 0;
      canvas.setAttribute('aria-label', none ? plan.message : `Drawing. ${full}`);
    }

    function refreshPlan({ refit = false } = {}) {
      const index = selectedIndex();
      plan =
        index < 0
          ? { kind: 'none', message: 'Click a line to see it drawn, or try Examples.' }
          : planFor(state.lines, result, index);
      if (refit && plan.kind !== 'none') {
        const reached =
          plan.kind === 'apply' ? [plan.A.map((row) => row.reduce((sum, a, k) => sum + a * plan.x[k], 0))] : [];
        const points =
          plan.kind === 'vector'
            ? [plan.v]
            : plan.kind === 'apply'
              ? [plan.x, ...reached]
              : [plan.A.flat(), plan.A.map(() => 1)];
        view.set({ cx: 0, cy: 0, radius: fitRadius(points) });
        zoom3 = 1;
      }
      renderInfo();
      drawViz();
    }

    function drawViz() {
      const matrixPlan = plan.kind === 'transform' || plan.kind === 'apply';
      controls.hidden = !matrixPlan;
      placeholder.hidden = plan.kind !== 'none';
      placeholder.textContent = plan.kind === 'none' ? plan.message : '';
      if (!active) return;
      const a = fitCanvas(canvas);
      view.resize(a.width, a.height);
      const colors = themeColors();
      a.ctx.fillStyle = colors.bg;
      a.ctx.fillRect(0, 0, a.width, a.height);
      if (plan.kind === 'none') return;
      if (plan.dim === 3) {
        const points = plan.kind === 'vector' ? [plan.v] : [plan.A.flat(), ...(plan.x ? [plan.x] : [])];
        draw3D(a.ctx, a.width, a.height, colors, plan, t, {
          yaw,
          pitch,
          radius: fitRadius(points) / zoom3,
          detail: plan.kind !== 'apply' || detail,
        });
      } else {
        draw2D(a.ctx, view, colors, plan, t, { detail: plan.kind !== 'apply' || detail });
      }
    }

    /** Dragging the tip of a 2D vector changes the numbers in its matrix line. */
    const editableVector = () => {
      const line = state.lines[selectedIndex()];
      return plan.kind === 'vector' &&
        plan.dim === 2 &&
        line?.kind === 'matrix' &&
        line.cells.length === 2 &&
        line.cells[0].length === 1
        ? line
        : null;
    };
    const detach = attachPanZoom(canvas, view, {
      onChange: drawViz,
      onReset: () => refreshPlan({ refit: true }),
      drag: {
        hitTest: (x, y) => {
          if (!editableVector()) return false;
          const tip = tipOf2(view, plan);
          return Boolean(tip) && Math.hypot(tip[0] - x, tip[1] - y) < 18;
        },
        move: (x, y) => {
          const line = editableVector();
          if (!line) return;
          const places = view.radius < 2 ? 100 : view.radius < 20 ? 10 : 1;
          const [wx, wy] = view.toWorld(x, y).map((c) => Math.round(c * places) / places);
          line.cells[0][0] = String(Object.is(wx, -0) ? 0 : wx);
          line.cells[1][0] = String(Object.is(wy, -0) ? 0 : wy);
          const refs = lineEls.get(line.id);
          refs.cells[0][0].value = line.cells[0][0];
          refs.cells[1][0].value = line.cells[1][0];
          ctx.save();
          evaluate();
        },
      },
    });
    let spin = null;
    canvas.addEventListener('pointerdown', (event) => {
      if (plan.dim === 3) spin = [event.clientX, event.clientY];
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!spin || plan.dim !== 3 || event.buttons === 0) return;
      yaw += (event.clientX - spin[0]) * 0.01;
      pitch = clamp(pitch + (event.clientY - spin[1]) * 0.01, -1.4, 1.4);
      spin = [event.clientX, event.clientY];
      drawViz();
    });
    canvas.addEventListener('pointerup', () => {
      spin = null;
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        if (plan.dim !== 3) return;
        zoom3 = clamp(zoom3 * Math.exp(-event.deltaY * 0.0015), 0.2, 8);
        drawViz();
      },
      { passive: true },
    );

    function select(id) {
      if (id === selectedId) return;
      selectedId = id;
      for (const [lineId, refs] of lineEls) {
        refs.li.classList.toggle('is-selected', lineId === id);
        refs.li.setAttribute('aria-current', lineId === id ? 'true' : 'false');
      }
      t = 1;
      slider.value = '1';
      refreshPlan({ refit: true });
    }

    /* ------------------------------------------------------------ evaluate */

    function evaluate() {
      result = evaluateLines(state.lines);
      state.lines.forEach((line, index) => syncLine(line, result[index]));
      if (selectedId !== null && selectedIndex() < 0) selectedId = null;
      refreshPlan();
    }
    const evaluateLater = debounce(evaluate, 100);

    function syncLine(line, out) {
      const refs = lineEls.get(line.id);
      if (!refs || !out) return;
      if (line.kind === 'matrix') {
        refs.cells.forEach((row, i) =>
          row.forEach((input, j) => {
            const message = out.cellErrors.get(`${i},${j}`);
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
            input.title = message ?? '';
          }),
        );
        refs.note.hidden = !out.error;
        refs.note.textContent = out.error ?? '';
        return;
      }
      refs.result.replaceChildren();
      refs.field.el.classList.toggle('is-invalid', Boolean(out.error));
      if (out.error) {
        refs.result.append(h('p', { class: 'mx-error', role: 'alert' }, out.error));
      } else if (out.value !== null) {
        const value = out.value;
        const shown =
          value instanceof Eigen
            ? eigenDisplay(value)
            : isMatrix(value)
              ? matrixDisplay(value)
              : h('span', { class: 'mx-scalar' }, typeset(formatScalar(value)));
        refs.result.append(
          h('div', { class: 'mx-answer' }, h('span', { class: 'mx-equals', 'aria-hidden': 'true' }, '='), shown),
        );
      }
      refs.result.hidden = refs.result.childNodes.length === 0;
    }

    /* ------------------------------------------------------------ line ops */

    const taken = () =>
      new Set(
        state.lines
          .flatMap((l) => (l.kind === 'matrix' && l.name ? [l.name] : []))
          .concat(
            state.lines.flatMap((l) =>
              l.kind === 'expr' ? [...l.text.matchAll(/^\s*([\p{L}][\p{L}\p{N}_]*)\s*=/gu)].map((m) => m[1]) : [],
            ),
          ),
      );
    const nextName = (letters) => {
      const used = taken();
      return [...letters].find((c) => !used.has(c)) ?? `${letters[0]}${used.size}`;
    };

    function newId() {
      const ids = new Set(state.lines.map((l) => l.id));
      let n = state.lines.length;
      let id;
      do {
        n += 1;
        id = `l${n}`;
      } while (ids.has(id));
      return id;
    }

    function insertLine(line, afterId = null, { focus = true } = {}) {
      if (state.lines.length >= MAX_LINES) {
        ctx.notify(`A sheet can have up to ${MAX_LINES} lines. Delete one to add another.`);
        return null;
      }
      const made = { id: newId(), ...line };
      const at = afterId === null ? state.lines.length : indexOf(afterId) + 1;
      state.lines.splice(at, 0, made);
      rebuild();
      evaluate();
      ctx.save();
      if (focus) focusLine(made.id);
      return made;
    }

    function removeLine(id) {
      const index = indexOf(id);
      if (index < 0) return;
      state.lines.splice(index, 1);
      if (state.lines.length === 0) state.lines.push({ id: 'l1', kind: 'expr', text: '' });
      rebuild();
      evaluate();
      ctx.save();
      focusLine(state.lines[Math.max(0, index - 1)].id);
    }

    function replaceLine(id, line) {
      const index = indexOf(id);
      if (index < 0) return;
      state.lines[index] = { id, ...line };
      rebuild();
      evaluate();
      ctx.save();
      focusLine(id);
    }

    function focusLine(id) {
      const refs = lineEls.get(id);
      if (!refs) return;
      if (refs.field) refs.field.focus();
      else refs.cells[0]?.[0]?.focus();
    }

    const matrixLine = (name, rows, cols) => ({ kind: 'matrix', name, cells: zeroCells(rows, cols) });

    /** Add a matrix, a vector, and their product to the end of the sheet, and show the product. */
    function addExample(example) {
      if (state.lines.length + 3 > MAX_LINES) {
        ctx.notify(`A sheet can have up to ${MAX_LINES} lines. Delete a few to add an example.`);
        return;
      }
      const matrixName = nextName('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      const first = insertLine(
        { kind: 'matrix', name: matrixName, cells: example.cells.map((row) => [...row]) },
        null,
        {
          focus: false,
        },
      );
      const vectorName = nextName('uvwxyz');
      insertLine({ kind: 'matrix', name: vectorName, cells: [['2'], ['1']] }, null, { focus: false });
      const product = insertLine({ kind: 'expr', text: `${matrixName}*${vectorName}` }, null, { focus: false });
      if (first && product) select(product.id);
    }

    function resize(line, rows, cols) {
      const r = clamp(rows, 1, MAX_DIM);
      const c = clamp(cols, 1, MAX_DIM);
      line.cells = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => line.cells[i]?.[j] ?? '0'));
      rebuild();
      evaluate();
      ctx.save();
    }

    /* --------------------------------------------------------------- lines */

    function buildMatrix(line, index) {
      const rows = line.cells.length;
      const cols = line.cells[0].length;
      const label = line.name || `Matrix ${index + 1}`;
      const refs = { cells: [] };

      const name = h('input', {
        class: 'input input-mono mx-name',
        type: 'text',
        value: line.name,
        placeholder: 'Name',
        spellcheck: 'false',
        autocomplete: 'off',
        maxlength: '16',
        'aria-label': `Name of matrix ${index + 1}`,
        oninput: () => {
          const text = name.value.trim();
          line.name = NAME_PATTERN.test(text) ? text : '';
          name.setAttribute('aria-invalid', text !== '' && line.name === '' ? 'true' : 'false');
          ctx.save();
          evaluateLater();
        },
      });
      const size = (key, value, text) =>
        h('input', {
          class: 'input mx-size',
          type: 'number',
          min: '1',
          max: String(MAX_DIM),
          step: '1',
          inputmode: 'numeric',
          value: String(value),
          'aria-label': `${label}, number of ${text}`,
          onchange: () => {
            const n = Math.round(Number(refs[key].value));
            if (!Number.isFinite(n)) {
              refs[key].value = String(value);
              return;
            }
            resize(line, key === 'rows' ? n : rows, key === 'cols' ? n : cols);
          },
        });
      refs.rows = size('rows', rows, 'rows');
      refs.cols = size('cols', cols, 'columns');

      const move = (i, j) => refs.cells[i]?.[j]?.focus();
      const grid = h('div', {
        class: 'mx-grid',
        role: 'group',
        'aria-label': `${label}, ${rows} by ${cols}`,
      });
      grid.style.setProperty('--cols', String(cols));
      for (let i = 0; i < rows; i += 1) {
        refs.cells.push([]);
        for (let j = 0; j < cols; j += 1) {
          const input = h('input', {
            class: 'input input-mono mx-cell',
            type: 'text',
            value: line.cells[i][j],
            spellcheck: 'false',
            autocomplete: 'off',
            maxlength: String(MAX_CELL),
            'aria-label': `${label}, row ${i + 1}, column ${j + 1}`,
            oninput: () => {
              line.cells[i][j] = input.value.slice(0, MAX_CELL);
              ctx.save();
              evaluateLater();
            },
            onfocus: () => input.select(),
            onkeydown: (event) => {
              const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
              const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                if (i + 1 < rows) move(i + 1, j);
                else if (event.key === 'Enter' && j + 1 < cols) move(0, j + 1);
              } else if (event.key === 'ArrowUp' && i > 0) {
                event.preventDefault();
                move(i - 1, j);
              } else if (event.key === 'ArrowRight' && atEnd && j + 1 < cols) {
                event.preventDefault();
                move(i, j + 1);
              } else if (event.key === 'ArrowLeft' && atStart && j > 0) {
                event.preventDefault();
                move(i, j - 1);
              }
            },
          });
          refs.cells[i].push(input);
          grid.append(input);
        }
      }

      const fill = (kind) => {
        line.cells = line.cells.map((row, i) => row.map((_, j) => (kind === 'identity' && i === j ? '1' : '0')));
        rebuild();
        evaluate();
        ctx.save();
      };
      const more = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon',
          type: 'button',
          'aria-label': `More options, ${label}`,
          'aria-haspopup': 'menu',
          title: 'More',
          onclick: (event) =>
            openMenu(
              event.currentTarget,
              [
                { label: 'Fill with the identity', onSelect: () => fill('identity') },
                { label: 'Fill with zeros', onSelect: () => fill('zeros') },
                { separator: true },
                { label: 'Delete', icon: 'trash', onSelect: () => removeLine(line.id) },
              ],
              { align: 'end' },
            ),
        },
        icon('settings', 16),
      );

      refs.note = h('p', { class: 'mx-error', role: 'alert', hidden: true });
      const li = h(
        'li',
        { class: 'mx-line mx-matrix', dataset: { id: line.id } },
        h(
          'div',
          { class: 'mx-head' },
          name,
          h('span', { class: 'mx-eq', 'aria-hidden': 'true' }, '='),
          h('span', { class: 'mx-dims' }, refs.rows, h('span', { 'aria-hidden': 'true' }, '\u00d7'), refs.cols),
          h('span', { class: 'mx-spacer' }),
          more,
        ),
        grid,
        refs.note,
      );
      refs.li = li;
      return { li, refs };
    }

    function buildExpr(line, index) {
      const refs = {};
      const field = createMathField({
        value: line.text,
        label: `Calculation ${index + 1}`,
        placeholder: 'Type a calculation, like A*B, or matrix',
        maxlength: MAX_TEXT,
        oninput: (text) => {
          const shortcut = SHORTCUT.exec(text);
          if (shortcut) {
            const vector = shortcut[2] === 'vector';
            const name = shortcut[1] ?? nextName(vector ? 'uvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
            replaceLine(line.id, matrixLine(NAME_PATTERN.test(name) ? name : '', vector ? 3 : 2, vector ? 1 : 2));
            return;
          }
          line.text = text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT);
          ctx.save();
          evaluateLater();
        },
        onblur: () => evaluateLater.flush(),
        onkeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            evaluateLater.flush();
            insertLine({ kind: 'expr', text: '' }, line.id);
          } else if (event.key === 'Backspace' && line.text === '' && state.lines.length > 1) {
            event.preventDefault();
            removeLine(line.id);
          } else if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault();
            focusLine(state.lines[index - 1].id);
          } else if (event.key === 'ArrowDown' && state.lines[index + 1]) {
            event.preventDefault();
            focusLine(state.lines[index + 1].id);
          }
        },
      });
      fields.set(line.id, field);
      refs.field = field;
      refs.result = h('div', { class: 'mx-result', 'aria-live': 'polite', hidden: true });
      const remove = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon mx-remove',
          type: 'button',
          'aria-label': `Delete calculation ${index + 1}`,
          title: 'Delete line',
          onclick: () => removeLine(line.id),
        },
        icon('close', 14),
      );
      const li = h(
        'li',
        { class: 'mx-line mx-expr', dataset: { id: line.id } },
        h('div', { class: 'mx-expr-row' }, field.el, remove),
        refs.result,
      );
      refs.li = li;
      return { li, refs };
    }

    function rebuild() {
      lineEls.clear();
      fields.clear();
      const items = state.lines.map((line, index) => {
        const built = line.kind === 'matrix' ? buildMatrix(line, index) : buildExpr(line, index);
        lineEls.set(line.id, built.refs);
        built.li.classList.toggle('is-selected', line.id === selectedId);
        built.li.setAttribute('aria-current', line.id === selectedId ? 'true' : 'false');
        built.li.addEventListener('focusin', () => select(line.id));
        built.li.addEventListener('click', () => select(line.id));
        return built.li;
      });
      list.replaceChildren(...items);
    }

    /* --------------------------------------------------------------- layout */

    const add = (label, onclick) => h('button', { class: 'btn', type: 'button', onclick }, icon('plus', 16), label);

    const help = h(
      'details',
      { class: 'mx-help' },
      h('summary', {}, 'What you can type'),
      h(
        'div',
        { class: 'mx-help-body' },
        h(
          'p',
          {},
          'Type matrix or vector on a line, or use the buttons, to get a grid. Set its size beside the name. Entries can be numbers like 3, -1/2, 0.25, or sqrt(2).',
        ),
        h(
          'p',
          {},
          'Then calculate with the names you defined. Later lines can use earlier results: write C = A*B to keep one.',
        ),
        h(
          'ul',
          {},
          ...[
            ['A+B, A-B, A*B, 2A, A/2', 'sums, products, and scalar multiples'],
            ['A^2, A^-1, A^T', 'powers, inverse, transpose (A\u2019 also works)'],
            ['det(A), tr(A), rank(A), rref(A), inv(A)', 'determinant, trace, rank, reduced row echelon form'],
            ['solve(A, b)', 'the solution x of Ax = b'],
            ['eig(A)', 'eigenvalues with their eigenvectors, one per line'],
            [
              'eigenvalues(A), eigenvectors(A)',
              'the eigenvalues as a vector, and the eigenvectors as columns of a matrix',
            ],
            ['dot(u, v), cross(u, v), norm(v)', 'for vectors'],
            ['[[1, 2], [3, 4]]  and  [1, 2, 3]', 'a matrix, and a column vector, written inline'],
            ['identity(3), zeros(2, 3), diag(1, 2, 3)', 'common matrices'],
          ].map(([code, text]) => h('li', {}, h('code', {}, code), ' \u2014 ', text)),
        ),
        h(
          'p',
          {},
          'Click any line to see it drawn. A vector appears as an arrow (drag its tip to change it), a 2 by 2 or 3 by 3 matrix shows what it does to the plane or to space, and a product like A*x shows x being turned and stretched by A. Dashed lines mark eigenvectors.',
        ),
        h(
          'p',
          {},
          'Fractions stay exact. Anything that is not rational, like sqrt(2) or \u03c0, is calculated as a decimal.',
        ),
      ),
    );

    root.classList.add('tool', 'matrix-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar mx-bar', role: 'toolbar', 'aria-label': 'Add to the sheet' },
        add('Matrix', () => insertLine(matrixLine(nextName('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 2, 2))),
        add('Vector', () => insertLine(matrixLine(nextName('uvwxyz'), 3, 1))),
        add('Calculation', () => insertLine({ kind: 'expr', text: '' })),
        h('span', { class: 'tool-bar-spacer' }),
        h(
          'button',
          {
            class: 'btn btn-quiet',
            type: 'button',
            'aria-haspopup': 'menu',
            onclick: (event) =>
              openMenu(
                event.currentTarget,
                EXAMPLES.map((example) => ({ label: example.label, onSelect: () => addExample(example) })),
                { align: 'end' },
              ),
          },
          'Examples',
        ),
      ),
      h(
        'div',
        { class: 'tool-body mx-body' },
        h('div', { class: 'mx-main' }, list, help),
        h(
          'aside',
          { class: 'mx-viz', 'aria-label': 'Picture of the selected line' },
          vizHead,
          stage,
          controls,
          legend,
          caption,
          more,
        ),
      ),
    );

    rebuild();
    evaluate();
    const stopObserving = onResize(stage, () => active && drawViz());
    const onTheme = () => active && drawViz();
    document.addEventListener('clover:themechange', onTheme);

    return {
      onShow: () => {
        active = true;
        drawViz();
      },
      onHide: () => {
        active = false;
      },
      destroy: () => {
        active = false;
        cancelAnimationFrame(animation);
        stopObserving();
        detach();
        document.removeEventListener('clover:themechange', onTheme);
        evaluateLater.cancel();
        for (const field of fields.values()) field.destroy?.();
      },
    };
  },
};
