import { h, onResize, uid } from '../core/dom.js';
import { createExprList, emptyRow, normalizeRows } from '../core/exprlist.js';
import { icon } from '../core/icons.js';
import { renderGraph, rowColor } from '../lib/graph/draw.js';
import { GraphModel } from '../lib/graph/model.js';
import { GraphView, normalizeGraphView } from '../lib/graph/view.js';
import { attachPanZoom } from '../lib/interact.js';
import { MAX_MARKDOWN, renderMarkdown } from '../lib/markdown.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_CELLS = 60;
const MAX_GRAPHS = 10;
const MAX_GRAPH_ROWS = 24;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const DEFAULT_VIEW = { cx: 0, cy: 0, xspan: 20, yspan: 0 };
const KINDS = new Set(['text', 'math', 'graph']);
/** Row kinds that draw something, as opposed to defining or computing a value. */
const PLOTTED = new Set(['explicit', 'explicitX', 'implicit', 'ineq', 'polar', 'param']);

/* ------------------------------------------------------------------- state */

function normalizeCell(raw, taken, counts) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.type)) return null;
  if (raw.type === 'graph' && counts.graph >= MAX_GRAPHS) return null;
  const id =
    typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !taken.has(raw.id)
      ? raw.id
      : `c${taken.size + 1}-${counts.n}`;
  taken.add(id);
  counts.n += 1;
  if (raw.type === 'text') {
    return { id, type: 'text', text: typeof raw.text === 'string' ? raw.text.slice(0, MAX_MARKDOWN) : '' };
  }
  const rowTaken = counts.rows;
  if (raw.type === 'math') {
    const [row] = normalizeRows([raw.row], { max: 1, taken: rowTaken });
    return { id, type: 'math', row: row ?? emptyRow(freshRowId(rowTaken), 0) };
  }
  counts.graph += 1;
  const rows = normalizeRows(raw.rows, { max: MAX_GRAPH_ROWS, taken: rowTaken });
  if (rows.length === 0) rows.push(emptyRow(freshRowId(rowTaken), 0));
  return {
    id,
    type: 'graph',
    rows,
    view: normalizeGraphView(raw.view, DEFAULT_VIEW),
    grid: raw.grid !== false,
  };
}

function freshRowId(taken) {
  let n = 0;
  let id;
  do {
    n += 1;
    id = `r${n}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

const starter = () => [
  {
    type: 'text',
    text: '# Untitled notebook\nNotes, calculations, and graphs share one set of definitions. Define a function in a math cell, then plot it in a graph cell. Write math inside text with dollar signs, like $x^2 + 1$.',
  },
  { type: 'math', row: { id: 'r1', text: 'f(x) = x^2 - 2', color: 0 } },
  { type: 'math', row: { id: 'r2', text: 'f(3)', color: 1 } },
  { type: 'graph', rows: [{ id: 'r3', text: 'y = f(x)', color: 1 }] },
];

function normalize(raw) {
  const taken = new Set();
  const counts = { n: 0, graph: 0, rows: new Set() };
  const entries = Array.isArray(raw?.cells) ? raw.cells.slice(0, MAX_CELLS) : [];
  const cells = entries.map((c) => normalizeCell(c, taken, counts)).filter(Boolean);
  if (cells.length === 0) {
    taken.clear();
    counts.rows.clear();
    counts.graph = 0;
    for (const c of starter()) cells.push(normalizeCell(c, taken, counts));
  }
  return { cells, angle: raw?.angle === 'deg' ? 'deg' : 'rad' };
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

const cellRows = (cell) => (cell.type === 'math' ? [cell.row] : cell.type === 'graph' ? cell.rows : []);

/* -------------------------------------------------------------------- tool */

export default {
  type: 'notebook',
  name: 'Notebook',
  description: 'Mix notes, calculations, and graphs in one document. Definitions are shared by every cell.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const line = (y, w, color, thick = 6) => {
      ctx.fillStyle = color;
      ctx.fillRect(width * 0.1, y, width * w, thick);
    };
    line(height * 0.14, 0.45, colors.ink, 8);
    line(height * 0.28, 0.7, colors.grid, 5);
    line(height * 0.36, 0.55, colors.grid, 5);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    const top = height * 0.5;
    const box = height * 0.4;
    ctx.strokeRect(width * 0.1, top, width * 0.8, box);
    ctx.beginPath();
    ctx.moveTo(width * 0.1, top + box / 2);
    ctx.lineTo(width * 0.9, top + box / 2);
    ctx.stroke();
    ctx.beginPath();
    for (let px = 0; px <= width * 0.8; px += 2) {
      const x = (px / (width * 0.8)) * 2 - 1;
      const y = top + box / 2 - (x * x * 1.6 - 0.5) * (box / 3);
      if (px === 0) ctx.moveTo(width * 0.1, y);
      else ctx.lineTo(width * 0.1 + px, y);
    }
    ctx.strokeStyle = colors.a;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  },

  mount(root, ctx) {
    const state = ctx.state;
    const model = new GraphModel();
    let active = false;
    let frame = 0;
    let settleTimer = 0;
    let fastPending = false;
    const renderErrors = new Map();
    /** @type {Map<string, { el: HTMLElement, destroy(): void, render(fast: boolean): void, syncAll(): void, focus(): void, pause(): void, resume(): void }>} */
    let instances = new Map();

    const container = h('div', { class: 'nb-cells' });

    const allRows = () => state.cells.flatMap(cellRows);

    /* --------------------------------------------------------------- model */

    function recompileNow() {
      model.update(allRows(), { angle: state.angle });
      for (const instance of instances.values()) instance.syncAll();
      scheduleRender(true);
    }

    function scheduleRender(moving = false) {
      fastPending = fastPending || moving;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const quick = fastPending;
        fastPending = false;
        for (const instance of instances.values()) instance.render(quick);
        if (quick) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => {
            for (const instance of instances.values()) instance.render(false);
          }, 160);
        }
      });
    }

    function collectErrors(rows, next) {
      const before = JSON.stringify([...renderErrors]);
      for (const row of rows) renderErrors.delete(row.id);
      for (const [id, message] of next) renderErrors.set(id, message);
      if (before !== JSON.stringify([...renderErrors])) for (const instance of instances.values()) instance.syncAll();
    }

    /* ------------------------------------------------------------ cell ops */

    const indexOf = (id) => state.cells.findIndex((c) => c.id === id);

    function insertCell(type, afterId = null, { focus = true } = {}) {
      if (state.cells.length >= MAX_CELLS) {
        ctx.notify(`A notebook can have up to ${MAX_CELLS} cells. Delete one to add another.`);
        return null;
      }
      if (type === 'graph' && state.cells.filter((c) => c.type === 'graph').length >= MAX_GRAPHS) {
        ctx.notify(`A notebook can have up to ${MAX_GRAPHS} graphs. Delete one to add another.`);
        return null;
      }
      const taken = new Set(allRows().map((r) => r.id));
      const rowId = () => freshRowId(taken);
      const id = uid('c');
      const cell =
        type === 'text'
          ? { id, type, text: '' }
          : type === 'math'
            ? { id, type, row: emptyRow(rowId(), state.cells.length % 6) }
            : { id, type, rows: [emptyRow(rowId(), state.cells.length % 6)], view: { ...DEFAULT_VIEW }, grid: true };
      const at = afterId === null ? state.cells.length : indexOf(afterId) + 1;
      state.cells.splice(at, 0, cell);
      rebuildCells();
      recompileNow();
      ctx.save();
      if (focus) instances.get(id)?.focus();
      return cell;
    }

    function removeCell(id) {
      const index = indexOf(id);
      if (index < 0) return;
      if (state.cells.length === 1) {
        state.cells.splice(0, 1);
        insertCell('math');
        return;
      }
      state.cells.splice(index, 1);
      rebuildCells();
      recompileNow();
      ctx.save();
      instances.get(state.cells[Math.max(0, index - 1)].id)?.focus();
    }

    function moveCell(id, delta) {
      const index = indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= state.cells.length) return;
      const [cell] = state.cells.splice(index, 1);
      state.cells.splice(target, 0, cell);
      rebuildCells();
      recompileNow();
      ctx.save();
      container.querySelector(`[data-cell="${cell.id}"] .nb-move`)?.focus();
    }

    /* --------------------------------------------------------------- cells */

    function cellChrome(cell, label, body) {
      const button = (name, text, onclick) =>
        h(
          'button',
          {
            class: 'btn btn-quiet btn-icon nb-tool',
            type: 'button',
            'aria-label': `${text}, ${label}`,
            title: text,
            onclick,
          },
          icon(name, 14),
        );
      const index = indexOf(cell.id);
      return h(
        'section',
        { class: `nb-cell nb-${cell.type}`, dataset: { cell: cell.id }, 'aria-label': label },
        h(
          'div',
          { class: 'nb-bar' },
          h('span', { class: 'nb-kind' }, cell.type === 'text' ? 'Text' : cell.type === 'math' ? 'Math' : 'Graph'),
          h(
            'span',
            { class: 'nb-actions' },
            index > 0 ? button('arrow-up', 'Move up', () => moveCell(cell.id, -1)) : null,
            index < state.cells.length - 1 ? button('arrow-down', 'Move down', () => moveCell(cell.id, 1)) : null,
            button('close', 'Delete cell', () => removeCell(cell.id)),
          ),
        ),
        body,
      );
    }

    function buildText(cell, label) {
      const view = h('div', { class: 'nb-text-view', tabindex: 0, role: 'button', 'aria-label': `Edit ${label}` });
      const editor = h('textarea', {
        class: 'nb-text-edit',
        rows: '3',
        maxlength: String(MAX_MARKDOWN),
        spellcheck: 'true',
        'aria-label': `${label}, Markdown`,
        placeholder: 'Write a note. Use # for headings, ** for bold, and $x^2$ for math.',
        value: cell.text,
        hidden: true,
      });
      const show = () => {
        view.replaceChildren(
          cell.text.trim() === ''
            ? h('p', { class: 'nb-placeholder' }, 'Empty note. Click to write.')
            : renderMarkdown(cell.text),
        );
      };
      const fit = () => {
        editor.rows = Math.min(24, Math.max(3, editor.value.split('\n').length + 1));
      };
      const edit = () => {
        view.hidden = true;
        editor.hidden = false;
        fit();
        editor.focus();
      };
      const done = () => {
        editor.hidden = true;
        view.hidden = false;
        show();
      };
      view.addEventListener('click', edit);
      view.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          edit();
        }
      });
      editor.addEventListener('input', () => {
        cell.text = editor.value.slice(0, MAX_MARKDOWN);
        fit();
        ctx.save();
      });
      editor.addEventListener('blur', done);
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          done();
          view.focus();
        }
      });
      show();
      return {
        el: cellChrome(cell, label, h('div', { class: 'nb-body' }, view, editor)),
        destroy() {},
        render() {},
        syncAll() {},
        pause() {},
        resume() {},
        focus: edit,
      };
    }

    function buildMath(cell, label) {
      const list = createExprList({
        rows: [cell.row],
        model,
        ctx,
        compact: true,
        maxRows: 1,
        placeholder: 'Type a calculation or definition, like f(x) = x^2',
        onChange: recompileNow,
        onSlider: () => scheduleRender(true),
        renderErrors: () => renderErrors,
        isActive: () => active,
        hint: (info) => (PLOTTED.has(info?.kind) ? 'This draws a curve. Add it to a graph cell to see it.' : ''),
        hooks: {
          onEnter: () => {
            insertCell('math', cell.id);
            return true;
          },
          onBackspaceEmpty: () => {
            if (state.cells.length < 2) return false;
            removeCell(cell.id);
            return true;
          },
        },
      });
      return {
        el: cellChrome(cell, label, h('div', { class: 'nb-body' }, list.el)),
        destroy: () => list.destroy(),
        render() {},
        syncAll: () => list.syncAll(),
        pause: () => list.pause(),
        resume: () => list.resume(),
        focus: () => list.focusRow(cell.row.id),
      };
    }

    function buildGraph(cell, label) {
      const view = new GraphView(cell.view, 1, 1);
      let sized = false;
      let visible = typeof IntersectionObserver === 'undefined';
      const canvas = h('canvas', {
        class: 'plot-canvas nb-canvas',
        role: 'img',
        tabindex: 0,
        'aria-label': `${label}. Drag to pan, scroll or pinch to zoom, arrow keys to pan, plus and minus to zoom, 0 to reset.`,
      });

      const list = createExprList({
        rows: cell.rows,
        model,
        ctx,
        maxRows: MAX_GRAPH_ROWS,
        onChange: recompileNow,
        onSlider: () => scheduleRender(true),
        onVisual: () => scheduleRender(),
        renderErrors: () => renderErrors,
        isActive: () => active,
      });

      function render(fast = false) {
        if (!visible) return;
        const { ctx: g, width, height } = fitCanvas(canvas);
        if (width <= 1 || height <= 1) return;
        view.resize(width, height);
        if (!sized) {
          view.set(cell.view);
          sized = true;
        }
        const dark = isDark();
        const items = [];
        for (const row of cell.rows) {
          const plot = model.info(row.id)?.plot;
          if (row.kind === 'note' || row.hidden || !plot) continue;
          items.push({ id: row.id, plot, color: rowColor(row.color, dark) });
        }
        const result = renderGraph(g, view, items, {
          colors: themeColors(),
          grid: cell.grid,
          minor: true,
          numbers: true,
          fast,
        });
        collectErrors(cell.rows, result.errors);
      }

      const changeView = () => {
        cell.view = view.toJSON();
        ctx.save();
        scheduleRender(true);
      };
      const detach = attachPanZoom(canvas, view, {
        onChange: changeView,
        onReset: () => {
          view.set(DEFAULT_VIEW);
          changeView();
        },
      });
      const zoom = (factor) => {
        view.zoomAt(view.width / 2, view.height / 2, factor);
        changeView();
      };
      const stopObserving = onResize(canvas, () => {
        scheduleRender();
      });
      let observer = null;
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver((entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (visible) scheduleRender();
        });
        observer.observe(canvas);
      }

      const tools = h(
        'div',
        { class: 'nb-graph-tools btn-group', role: 'group', 'aria-label': `View, ${label}` },
        h(
          'button',
          {
            class: 'btn btn-icon',
            type: 'button',
            'aria-label': 'Zoom in',
            title: 'Zoom in',
            onclick: () => zoom(1.4),
          },
          icon('zoom-in'),
        ),
        h(
          'button',
          {
            class: 'btn btn-icon',
            type: 'button',
            'aria-label': 'Zoom out',
            title: 'Zoom out',
            onclick: () => zoom(1 / 1.4),
          },
          icon('zoom-out'),
        ),
        h(
          'button',
          {
            class: 'btn btn-icon',
            type: 'button',
            'aria-label': 'Reset view',
            title: 'Reset view',
            onclick: () => {
              view.set(DEFAULT_VIEW);
              changeView();
            },
          },
          icon('home'),
        ),
      );
      const add = h(
        'div',
        { class: 'gr-add' },
        h(
          'button',
          { class: 'btn btn-small', type: 'button', onclick: () => list.addRow() },
          icon('plus', 14),
          'Add expression',
        ),
      );
      return {
        el: cellChrome(
          cell,
          label,
          h(
            'div',
            { class: 'nb-body nb-graph-body' },
            h('div', { class: 'nb-graph-rows' }, list.el, add),
            h('div', { class: 'nb-stage plot-body' }, canvas, tools),
          ),
        ),
        destroy() {
          list.destroy();
          detach();
          stopObserving();
          observer?.disconnect();
        },
        render,
        syncAll: () => {
          list.syncAll();
        },
        pause: () => list.pause(),
        resume: () => list.resume(),
        focus: () => list.focusRow(cell.rows[0].id),
      };
    }

    function buildCell(cell, index) {
      const label = `${cell.type === 'text' ? 'Text' : cell.type === 'math' ? 'Math' : 'Graph'} cell ${index + 1}`;
      if (cell.type === 'text') return buildText(cell, label);
      if (cell.type === 'math') return buildMath(cell, label);
      return buildGraph(cell, label);
    }

    const insertBar = (afterId) =>
      h(
        'div',
        { class: 'nb-insert', role: 'group', 'aria-label': 'Insert a cell here' },
        ...['text', 'math', 'graph'].map((type) =>
          h(
            'button',
            { class: 'btn btn-quiet btn-small', type: 'button', onclick: () => insertCell(type, afterId) },
            icon('plus', 12),
            type === 'text' ? 'Text' : type === 'math' ? 'Math' : 'Graph',
          ),
        ),
      );

    function rebuildCells() {
      for (const instance of instances.values()) instance.destroy();
      instances = new Map();
      container.replaceChildren();
      state.cells.forEach((cell, index) => {
        const instance = buildCell(cell, index);
        instances.set(cell.id, instance);
        container.append(instance.el, insertBar(cell.id));
      });
    }

    /* -------------------------------------------------------------- layout */

    const angle = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Angle unit',
        onchange: () => {
          state.angle = angle.value === 'deg' ? 'deg' : 'rad';
          ctx.save();
          recompileNow();
        },
      },
      h('option', { value: 'rad' }, 'Radians'),
      h('option', { value: 'deg' }, 'Degrees'),
    );
    angle.value = state.angle;

    const toolbar = h(
      'div',
      { class: 'nb-toolbar', role: 'toolbar', 'aria-label': 'Notebook' },
      h('span', { class: 'nb-toolbar-label' }, 'Add'),
      ...['text', 'math', 'graph'].map((type) =>
        h(
          'button',
          { class: 'btn btn-small', type: 'button', onclick: () => insertCell(type) },
          icon('plus', 14),
          type === 'text' ? 'Text' : type === 'math' ? 'Math' : 'Graph',
        ),
      ),
      h('span', { class: 'nb-spacer' }),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Angles'), angle),
    );

    root.classList.add('tool', 'notebook-tool');
    root.append(h('div', { class: 'nb-page' }, toolbar, container));

    const stopObserving = onResize(container, () => scheduleRender());
    const onTheme = () => {
      for (const instance of instances.values()) instance.syncAll();
      scheduleRender();
    };
    document.addEventListener('clover:themechange', onTheme);

    rebuildCells();
    recompileNow();

    return {
      onShow: () => {
        active = true;
        scheduleRender();
        for (const instance of instances.values()) instance.resume();
      },
      onHide: () => {
        active = false;
        for (const instance of instances.values()) instance.pause();
      },
      destroy: () => {
        active = false;
        cancelAnimationFrame(frame);
        clearTimeout(settleTimer);
        for (const instance of instances.values()) instance.destroy();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
