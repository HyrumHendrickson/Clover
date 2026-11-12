import { debounce, downloadBlob, h, onResize, slugify, uid } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { createMathField } from '../core/mathfield.js';
import { buildFolderRow, buildTableRow, commitRows, createRowMenu } from '../core/structrows.js';
import { pointsOfInterest } from '../lib/graph/analysis.js';
import { ROW_COLORS, renderGraph, rowColor } from '../lib/graph/draw.js';
import { nearestOnPaths } from '../lib/graph/hit.js';
import { GraphModel, sliderStep, sliderText } from '../lib/graph/model.js';
import { formatNumber } from '../lib/graph/values.js';
import {
  cleanField,
  cleanText,
  drawableItems,
  emptyTable,
  isCollapsed,
  moveRow,
  nextTableNames,
  normalizeRowList,
} from '../lib/graph/rows.js';
import { GraphView, normalizeGraphView } from '../lib/graph/view.js';
import { evaluateNumber } from '../lib/expr.js';
import { attachPanZoom } from '../lib/interact.js';
import { sidebarToggle } from '../lib/graph/chrome.js';
import { View, drawGrid, fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_ROWS = 60;
const MAX_TEXT = 500;
const DEFAULT_VIEW = { cx: 0, cy: 0, xspan: 20, yspan: 0 };
const SLIDER_SECONDS = 8;
const HIT_RADIUS = 10;

const SYNTAX = [
  ['Functions', 'y = x^2    f(x) = sin(x)    x = y^2'],
  ['Relations', 'x^2 + y^2 = 25    y > x    0 < y < x'],
  ['Polar, parametric', 'r = 1 + cos(theta)    (cos(t), sin(t))'],
  ['Sliders', 'a = 1, then use a in other rows'],
  ['Restrictions', 'y = x {0 < x < 5}    y = {x < 0: -x, x}'],
  ['Lists and points', '[1...10]    (L, L^2)    total(L)'],
  ['Tables', 'Add table; headings like x_1 and y_1 name the columns, x_1^2 computes one'],
  ['Regression', 'y_1 ~ a x_1 + b    y_1 ~ a x_1^2 + b x_1 + c'],
  ['Statistics', 'mean(L)    quartile(L, 1)    corr(L, M)    normaldist(0, 1).cdf(1.96)'],
  ['Lists of curves', 'f(x) = [1, 2, 3]x draws three lines'],
  ['Calculus', "f'(x)    d/dx x^3    sum(k, 1, 10, k^2)    int(t, 0, x, sin(t))"],
  ['Greek letters', 'Type theta, pi, alpha, beta, ...'],
];

/* ------------------------------------------------------------------- state */

const emptyRow = (id, color, folder = '') => ({
  id,
  kind: 'expr',
  text: '',
  color,
  hidden: false,
  min: '',
  max: '',
  step: '',
  tmin: '',
  tmax: '',
  folder,
  style: {},
});

function normalizeRows(raw) {
  const rows = normalizeRowList(raw, { max: MAX_ROWS });
  if (rows.length === 0) rows.push(emptyRow('r1', 0));
  return rows;
}

const normalize = (raw) => ({
  rows: normalizeRows(raw?.rows),
  view: normalizeGraphView(raw?.view, DEFAULT_VIEW),
  grid: raw?.grid !== false,
  minor: raw?.minor !== false,
  numbers: raw?.numbers !== false,
  angle: raw?.angle === 'deg' ? 'deg' : 'rad',
});

const isDark = () => document.documentElement.dataset.theme === 'dark';
const safe = (fn) => (x) => {
  try {
    const y = fn(x);
    return typeof y === 'number' ? y : NaN;
  } catch {
    return NaN;
  }
};

/* -------------------------------------------------------------------- tool */

export default {
  type: 'graph',
  name: 'Graphing',
  description: 'Graph functions, equations, inequalities, polar and parametric curves, points, and sliders.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    const view = new View({ cx: 0, cy: 0, radius: 2.2 }, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, view, colors, { labels: false });
    const curve = (fn, color) => {
      ctx.beginPath();
      for (let px = 0; px <= width; px += 2) {
        const [x] = view.toWorld(px, 0);
        const [sx, sy] = view.toScreen(x, fn(x));
        if (px === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    };
    curve((x) => Math.sin(x * 1.6) * 1.3, colors.a);
    curve((x) => (x * x) / 2 - 1.2, colors.b);
  },

  mount(root, ctx) {
    const state = ctx.state;
    const model = new GraphModel();
    const view = new GraphView(state.view, 1, 1);
    const rowEls = new Map();
    const playing = new Map();
    let sized = false;
    let active = false;
    let frame = 0;
    let settleTimer = 0;
    let fastPending = false;
    let animFrame = 0;
    let animLast = 0;
    let geometry = new Map();
    let lastItems = [];
    let geometryKey = '';
    let renderErrors = new Map();
    let selectedId = null;
    let poi = [];
    let pinned = null;
    let hover = null;
    let hoverFrame = 0;
    let poiTimer = 0;

    const rowById = (id) => state.rows.find((r) => r.id === id) ?? null;
    const viewKey = () => [view.cx, view.cy, view.sx, view.sy, view.width, view.height].join('|');

    /* ------------------------------------------------------------ elements */

    const list = h('ol', { class: 'gr-list' });
    const base = h('canvas', {
      class: 'plot-canvas',
      role: 'img',
      tabindex: 0,
      'aria-label':
        'Graph. Drag to pan, scroll or pinch to zoom, arrow keys to pan, plus and minus to zoom, 0 to reset. Click a curve to see its intercepts and turning points.',
    });
    const overlay = h('canvas', { class: 'plot-canvas plot-top plot-passive', 'aria-hidden': 'true' });
    const readout = h('div', { class: 'plot-readout', hidden: true });

    /* ------------------------------------------------------------ rendering */

    function render(fast = false) {
      const { ctx: g, width, height } = fitCanvas(base);
      if (width <= 1 || height <= 1) return;
      if (sized) {
        view.resize(width, height);
      } else {
        view.resize(width, height);
        view.set(state.view);
        sized = true;
      }
      const dark = isDark();
      const items = drawableItems(state.rows, (id) => model.info(id)).map((item) => ({
        id: item.id,
        rowId: item.rowId,
        plot: item.plot,
        color: rowColor(item.colorIndex, dark),
        selected: item.rowId === selectedId,
        style: item.style,
      }));
      lastItems = items;
      const result = renderGraph(g, view, items, {
        colors: themeColors(root),
        grid: state.grid,
        minor: state.minor,
        numbers: state.numbers,
        fast,
      });
      geometry = result.geometry;
      geometryKey = viewKey();
      setRenderErrors(result.errors);
      syncBounds();
      drawOverlay();
    }

    function scheduleRender(fast = false) {
      fastPending = fastPending || fast;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          const quick = fastPending;
          fastPending = false;
          render(quick);
          if (quick) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => render(false), 160);
          }
          schedulePoi();
        });
      }
    }

    function setRenderErrors(errors) {
      const before = JSON.stringify([...renderErrors]);
      renderErrors = errors;
      if (before !== JSON.stringify([...errors])) for (const row of state.rows) syncRow(row.id);
    }

    /* ---------------------------------------------------------- overlay layer */

    const labelOf = (p) => `(${formatNumber(p.x, 6)}, ${formatNumber(p.y, 6)})`;

    function drawOverlay() {
      const { ctx: g, width, height } = fitCanvas(overlay);
      g.clearRect(0, 0, width, height);
      if (width <= 1) return;
      const colors = themeColors(root);
      const stale = geometryKey !== viewKey();
      if (!stale) {
        g.save();
        for (const p of poi) {
          const [sx, sy] = view.toScreen(p.x, p.y);
          g.beginPath();
          g.arc(sx, sy, 5, 0, Math.PI * 2);
          g.fillStyle = colors.text;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = colors.bg;
          g.stroke();
        }
        g.restore();
      }
      const label = (sx, sy, text) => {
        g.save();
        g.font = '12px ui-sans-serif, system-ui, sans-serif';
        const w = g.measureText(text).width + 12;
        const x = Math.min(Math.max(sx + 10, 4), width - w - 4);
        const y = Math.min(Math.max(sy - 30, 4), height - 26);
        g.fillStyle = colors.bg;
        g.globalAlpha = 0.94;
        g.fillRect(x, y, w, 22);
        g.globalAlpha = 1;
        g.strokeStyle = colors.axis;
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, w - 1, 21);
        g.fillStyle = colors.ink;
        g.textBaseline = 'middle';
        g.fillText(text, x + 6, y + 11);
        g.restore();
      };
      if (!stale && pinned !== null && poi[pinned]) {
        const [sx, sy] = view.toScreen(poi[pinned].x, poi[pinned].y);
        label(sx, sy, labelOf(poi[pinned]));
      }
      if (hover && !stale) {
        g.save();
        g.beginPath();
        g.arc(hover.sx, hover.sy, 6, 0, Math.PI * 2);
        g.lineWidth = 2.5;
        g.strokeStyle = hover.color;
        g.stroke();
        g.restore();
        if (hover.poi === undefined || hover.poi !== pinned) label(hover.sx, hover.sy, hover.text);
      }
    }

    /** Find the visible curve or point nearest a screen position. */
    function pick(px, py) {
      if (geometryKey !== viewKey()) return null;
      let best = null;
      for (const item of [...lastItems].reverse()) {
        const geo = geometry.get(item.id);
        if (!geo) continue;
        let hit = null;
        if (geo.paths) hit = nearestOnPaths(geo.paths, px, py, HIT_RADIUS);
        if (!hit && geo.dots) {
          for (const d of geo.dots) {
            const dist = Math.hypot(d.sx - px, d.sy - py);
            if (dist <= HIT_RADIUS && (!hit || dist < hit.dist)) hit = { x: d.sx, y: d.sy, dist };
          }
        }
        const row = rowById(item.rowId);
        if (hit && row && (!best || hit.dist < best.hit.dist)) best = { row, hit, color: item.color };
      }
      return best;
    }

    function pickPoi(px, py) {
      let best = -1;
      let bestDist = HIT_RADIUS;
      poi.forEach((p, k) => {
        const [sx, sy] = view.toScreen(p.x, p.y);
        const d = Math.hypot(sx - px, sy - py);
        if (d <= bestDist) [best, bestDist] = [k, d];
      });
      return best;
    }

    function onHover(px, py) {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        updateCursor(px, py);
        const k = pickPoi(px, py);
        if (k >= 0) {
          const [sx, sy] = view.toScreen(poi[k].x, poi[k].y);
          hover = { sx, sy, color: themeColors(root).text, text: labelOf(poi[k]), poi: k };
        } else {
          const hit = pick(px, py);
          if (hit) {
            const [x, y] = view.toWorld(hit.hit.x, hit.hit.y);
            hover = { sx: hit.hit.x, sy: hit.hit.y, color: hit.color, text: labelOf({ x, y }) };
          } else {
            hover = null;
          }
        }
        const [wx, wy] = view.toWorld(px, py);
        readout.hidden = false;
        readout.replaceChildren(
          h('span', {}, `x = ${formatNumber(wx, 5)}`),
          h('span', {}, `y = ${formatNumber(wy, 5)}`),
        );
        drawOverlay();
      });
    }

    function onLeave() {
      hover = null;
      readout.hidden = true;
      drawOverlay();
    }

    function onClick(px, py) {
      const k = pickPoi(px, py);
      if (k >= 0) {
        pinned = pinned === k ? null : k;
        drawOverlay();
        return;
      }
      const hit = pick(px, py);
      selectRow(hit ? hit.row.id : null);
    }

    /* -------------------------------------------------- points of interest */

    function schedulePoi() {
      clearTimeout(poiTimer);
      poiTimer = setTimeout(computePoi, 120);
    }

    function computePoi() {
      poi = [];
      pinned = null;
      const selected = selectedId && model.info(selectedId)?.plot;
      if (selected && selected.type === 'explicit' && lastItems.some((item) => item.rowId === selectedId)) {
        const others = lastItems
          .filter((item) => item.rowId !== selectedId)
          .map((item) => item.plot)
          .filter((plot) => plot && plot.type === 'explicit' && !plot.mask)
          .flatMap((plot) => {
            const count = plot.lanes ? Math.min(plot.lanes.count(), 8) : 1;
            return Array.from({ length: count }, (_, i) => safe(plot.lanes ? plot.lanes.at(i) : plot.f));
          });
        const f = selected.mask ? (x) => (selected.mask(x, selected.f(x)) ? selected.f(x) : NaN) : selected.f;
        const { xmin, xmax, ymin, ymax } = view.bounds();
        try {
          poi = pointsOfInterest(safe(f), others, xmin, xmax).filter((p) => p.y >= ymin && p.y <= ymax);
        } catch {
          poi = [];
        }
      }
      drawOverlay();
    }

    function selectRow(id) {
      selectedId = id;
      for (const [rowId, refs] of rowEls) refs.li.classList.toggle('is-selected', rowId === id);
      poi = [];
      pinned = null;
      render(false);
      computePoi();
    }

    /* --------------------------------------------------------------- rows */

    function nextColor() {
      return state.rows.length % ROW_COLORS.length;
    }

    function recompileNow() {
      recompileLater.cancel();
      model.update(state.rows, { angle: state.angle });
      for (const row of state.rows) syncRow(row.id);
      if (selectedId && !model.info(selectedId)?.plot) selectedId = null;
      scheduleRender();
    }
    const recompileLater = debounce(recompileNow, 160);

    function syncValues() {
      for (const row of state.rows) syncRow(row.id);
    }

    function focusRow(id) {
      const refs = rowEls.get(id);
      if (!refs) return;
      refs.input.focus();
      const end = refs.input.value.length;
      refs.input.setSelectionRange?.(end, end);
    }

    function addRow(afterId = null, init = {}, { focus = true } = {}) {
      if (state.rows.length >= MAX_ROWS) {
        ctx.notify(`A graph can have up to ${MAX_ROWS} rows. Delete one to add another.`);
        return null;
      }
      const after = afterId === null ? null : rowById(afterId);
      const inherited = after ? (after.kind === 'folder' ? after.id : (after.folder ?? '')) : '';
      const row = { ...emptyRow(uid('r'), nextColor(), init.kind === 'folder' ? '' : inherited), ...init };
      const at = afterId === null ? state.rows.length : state.rows.findIndex((r) => r.id === afterId) + 1;
      state.rows.splice(at, 0, row);
      rebuildList();
      recompileNow();
      ctx.save();
      if (focus) focusRow(row.id);
      return row;
    }

    /** Append a table with two columns, named so they do not clash with another table's. */
    function addTable() {
      if (state.rows.length >= MAX_ROWS) {
        ctx.notify(`A graph can have up to ${MAX_ROWS} rows. Delete one to add another.`);
        return;
      }
      const table = emptyTable(uid('r'), nextColor(), nextTableNames(state.rows));
      state.rows.push(table);
      rebuildList();
      recompileNow();
      ctx.save();
      focusRow(table.id);
    }

    function addFolder() {
      addRow(null, { kind: 'folder', text: '', collapsed: false, hidden: false });
    }

    function removeRow(id) {
      const index = state.rows.findIndex((r) => r.id === id);
      if (index < 0) return;
      playing.delete(id);
      if (state.rows.length === 1) {
        state.rows.splice(0, 1, emptyRow(state.rows[0].id, state.rows[0].color));
        rebuildList();
        recompileNow();
        ctx.save();
        focusRow(state.rows[0].id);
        return;
      }
      state.rows.splice(index, 1);
      if (selectedId === id) selectedId = null;
      rebuildList();
      recompileNow();
      ctx.save();
      focusRow(state.rows[Math.max(0, index - 1)].id);
    }

    function insertSliders(id, names) {
      const at = state.rows.findIndex((r) => r.id === id);
      const room = MAX_ROWS - state.rows.length;
      const added = names.slice(0, Math.max(0, room));
      if (added.length === 0) return;
      added.forEach((name, k) => {
        state.rows.splice(at + k, 0, {
          ...emptyRow(uid('r'), (state.rows.length + k) % ROW_COLORS.length),
          text: `${name} = 1`,
        });
      });
      rebuildList();
      recompileNow();
      ctx.save();
    }

    /** The closest row above or below that is showing, since a collapsed folder hides its rows. */
    function neighbour(index, step) {
      for (let i = index + step; i >= 0 && i < state.rows.length; i += step) {
        if (!isCollapsed(state.rows, state.rows[i])) return state.rows[i];
      }
      return null;
    }

    function onKey(event, row) {
      const index = state.rows.findIndex((r) => r.id === row.id);
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const next = moveRow(state.rows, row.id, event.key === 'ArrowUp' ? -1 : 1);
        if (next !== state.rows) {
          commitRows(env, next);
          focusRow(row.id);
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        recompileLater.flush();
        addRow(row.id);
      } else if (event.key === 'ArrowDown' && neighbour(index, 1)) {
        event.preventDefault();
        focusRow(neighbour(index, 1).id);
      } else if (event.key === 'ArrowUp' && neighbour(index, -1)) {
        event.preventDefault();
        focusRow(neighbour(index, -1).id);
      } else if (event.key === 'Backspace' && row.text === '' && state.rows.length > 1) {
        event.preventDefault();
        removeRow(row.id);
      }
    }

    const env = {
      rows: state.rows,
      ctx,
      rebuild: () => rebuildList(),
      onChange: () => recompileNow(),
      onVisual: () => scheduleRender(),
      removeRow: (id) => removeRow(id),
      plot: true,
    };

    function buildRow(row, index) {
      const refs = {};
      const label = (text) => `${text} ${index + 1}`;
      const note = row.kind === 'note';
      refs.dot = h('button', {
        class: 'gr-dot',
        type: 'button',
        'aria-label': label('Show or hide expression'),
        onclick: () => {
          row.hidden = !row.hidden;
          ctx.save();
          syncRow(row.id);
          if (selectedId === row.id && row.hidden) selectedId = null;
          scheduleRender();
        },
      });
      if (note) {
        refs.input = h('input', {
          class: 'gr-input',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          autocapitalize: 'off',
          maxlength: String(MAX_TEXT),
          placeholder: 'Note',
          'aria-label': label('Note'),
          value: row.text,
          oninput: () => {
            row.text = cleanText(refs.input.value);
            ctx.save();
          },
          onkeydown: (event) => onKey(event, row),
          onfocus: () => {
            for (const [id, other] of rowEls) other.li.classList.toggle('is-current', id === row.id);
          },
        });
        refs.field = {
          el: refs.input,
          input: refs.input,
          refresh() {},
          setValue(text) {
            refs.input.value = text;
          },
        };
      } else {
        refs.field = createMathField({
          value: row.text,
          label: label('Expression'),
          placeholder: 'Type an expression, like y = x^2',
          maxlength: MAX_TEXT,
          oninput: (text) => {
            row.text = cleanText(text);
            ctx.save();
            recompileLater();
          },
          onblur: () => recompileLater.flush(),
          onkeydown: (event) => onKey(event, row),
          onfocus: () => {
            for (const [id, other] of rowEls) other.li.classList.toggle('is-current', id === row.id);
          },
        });
        refs.input = refs.field.input;
      }
      refs.value = h('p', { class: 'gr-value', hidden: true });
      refs.error = h('p', { class: 'gr-error', role: 'alert', hidden: true });
      refs.add = h('button', {
        class: 'btn btn-small gr-add-slider',
        type: 'button',
        hidden: true,
        onclick: () => insertSliders(row.id, model.info(row.id)?.undefinedNames ?? []),
      });

      const bound = (key, text) =>
        h('input', {
          class: 'input gr-bound',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          'aria-label': label(`Slider ${text}, expression`),
          onchange: () => {
            row[key] = cleanField(refs[`${key}Input`].value.trim());
            ctx.save();
            recompileNow();
          },
        });
      refs.minInput = bound('min', 'minimum');
      refs.maxInput = bound('max', 'maximum');
      refs.stepInput = bound('step', 'step');
      refs.stepInput.placeholder = 'step';
      refs.range = h('input', {
        class: 'range gr-range',
        type: 'range',
        min: '-10',
        max: '10',
        step: '0.01',
        value: '0',
        'aria-label': label('Slider value, expression'),
        oninput: () => moveSlider(row.id, Number(refs.range.value)),
      });
      refs.play = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon gr-play',
          type: 'button',
          'aria-label': label('Animate slider, expression'),
          'aria-pressed': 'false',
          onclick: () => togglePlay(row.id),
        },
        icon('play', 14),
      );
      refs.slider = h(
        'div',
        { class: 'gr-slider', hidden: true },
        refs.minInput,
        refs.range,
        refs.maxInput,
        refs.stepInput,
        refs.play,
      );

      const domainInput = (key, text) => {
        const el = h('input', {
          class: 'input gr-bound',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          'aria-label': label(`${text}, expression`),
          onchange: () => {
            row[key] = cleanField(el.value.trim());
            ctx.save();
            recompileNow();
          },
        });
        return el;
      };
      refs.tmin = domainInput('tmin', 'Parameter minimum');
      refs.tmax = domainInput('tmax', 'Parameter maximum');
      refs.varName = h('span', { class: 'gr-var' }, 't');
      refs.domain = h(
        'div',
        { class: 'gr-domain', hidden: true },
        refs.tmin,
        '\u2264',
        refs.varName,
        '\u2264',
        refs.tmax,
      );

      refs.color = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon gr-tool',
          type: 'button',
          'aria-label': label('Change colour of expression'),
          title: 'Change colour',
          onclick: () => {
            row.color = (row.color + 1) % ROW_COLORS.length;
            ctx.save();
            syncRow(row.id);
            scheduleRender();
          },
        },
        h('span', { class: 'gr-swatch' }),
      );
      refs.remove = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon gr-tool',
          type: 'button',
          'aria-label': label(note ? 'Delete note' : 'Delete expression'),
          title: 'Delete',
          onclick: () => removeRow(row.id),
        },
        icon('close', 14),
      );
      refs.li = h(
        'li',
        { class: 'gr-row', dataset: { id: row.id, kind: note ? 'note' : 'empty' } },
        note ? h('span', { class: 'gr-dot gr-dot-note', 'aria-hidden': 'true' }, 'N') : refs.dot,
        h('div', { class: 'gr-body' }, refs.field.el, refs.slider, refs.domain, refs.value, refs.error, refs.add),
        h(
          'div',
          { class: 'gr-actions' },
          note ? null : refs.color,
          createRowMenu(row, env, { styled: !note }),
          refs.remove,
        ),
      );
      return refs;
    }

    function rebuildList() {
      rowEls.clear();
      list.replaceChildren();
      state.rows.forEach((row, index) => {
        let refs;
        if (row.kind === 'folder') refs = { ...buildFolderRow(row, index, env), struct: true };
        else if (row.kind === 'table') refs = { ...buildTableRow(row, index, env), struct: true };
        else refs = buildRow(row, index);
        rowEls.set(row.id, refs);
        refs.li.classList.toggle('is-selected', row.id === selectedId);
        refs.li.classList.toggle('in-folder', row.kind !== 'folder' && Boolean(row.folder));
        refs.li.hidden = isCollapsed(state.rows, row);
        list.append(refs.li);
      });
      syncValues();
    }

    function syncRow(id) {
      const refs = rowEls.get(id);
      const row = rowById(id);
      if (!refs || !row) return;
      const info = model.info(id);
      if (refs.struct) {
        refs.sync?.(info);
        return;
      }
      const dark = isDark();
      const color = rowColor(row.color, dark);
      refs.li.dataset.kind = info?.kind ?? 'empty';

      const plot = info?.plot ?? null;
      refs.dot.disabled = !plot;
      refs.dot.setAttribute('aria-pressed', String(!row.hidden));
      refs.dot.style.setProperty('--row-color', color);
      refs.dot.classList.toggle('is-off', row.hidden);
      refs.color.hidden = !plot;
      refs.color.firstChild.style.setProperty('--row-color', color);

      const message = info?.error ?? info?.sliderError ?? info?.runtimeError ?? renderErrors.get(id) ?? '';
      const show = () => {
        const current = model.info(id);
        const text = current?.error ?? current?.sliderError ?? current?.runtimeError ?? renderErrors.get(id) ?? '';
        refs.error.textContent = text;
        refs.error.hidden = text === '';
        if (text) refs.input.setAttribute('aria-invalid', 'true');
        else refs.input.removeAttribute('aria-invalid');
        refs.field.el.classList.toggle('is-invalid', text !== '');
      };
      clearTimeout(refs.errorTimer);
      // While someone is typing, wait a moment before calling half-written input an error.
      if (message && document.activeElement === refs.input) refs.errorTimer = setTimeout(show, 800);
      else show();

      const valueText = info?.valueText ?? '';
      refs.value.textContent = valueText ? `= ${valueText}` : '';
      refs.value.hidden = valueText === '';

      const names = info?.undefinedNames ?? [];
      refs.add.hidden = names.length === 0;
      refs.add.textContent = names.length === 1 ? `Add slider for ${names[0]}` : `Add sliders for ${names.join(', ')}`;

      const slider = info?.slider ?? null;
      refs.slider.hidden = !slider;
      if (slider) {
        const typing = (el) => document.activeElement === el;
        if (!typing(refs.minInput)) refs.minInput.value = row.min || formatNumber(slider.min);
        if (!typing(refs.maxInput)) refs.maxInput.value = row.max || formatNumber(slider.max);
        if (!typing(refs.stepInput)) refs.stepInput.value = row.step;
        refs.range.min = String(slider.min);
        refs.range.max = String(slider.max);
        refs.range.step = String(sliderStep(slider));
        refs.range.value = String(slider.value);
        refs.range.setAttribute('aria-valuetext', formatNumber(slider.value, 6));
      } else {
        playing.delete(id);
      }
      refs.play.setAttribute('aria-pressed', String(playing.has(id)));
      refs.play.replaceChildren(icon(playing.has(id) ? 'stop' : 'play', 14));

      const domain = info?.domain ?? null;
      refs.domain.hidden = !domain || domain.fromRestriction;
      if (domain) {
        refs.varName.textContent = domain.variable === 'theta' ? '\u03b8' : domain.variable;
        refs.tmin.placeholder = domain.min;
        refs.tmax.placeholder = domain.max === '12*pi' ? '12\u03c0' : domain.max;
        if (document.activeElement !== refs.tmin) refs.tmin.value = row.tmin;
        if (document.activeElement !== refs.tmax) refs.tmax.value = row.tmax;
      }
    }

    /* -------------------------------------------------------------- sliders */

    function moveSlider(id, value) {
      const row = rowById(id);
      const info = model.info(id);
      if (!row || !info?.slider || !model.setSlider(id, value)) return;
      row.text = sliderText(info.name, value, sliderStep(info.slider));
      const refs = rowEls.get(id);
      if (refs) refs.field.setValue(row.text);
      syncValues();
      ctx.save();
      scheduleRender(true);
    }

    function stepAnimation(now) {
      animFrame = 0;
      if (playing.size === 0 || !active || document.hidden) return;
      const dt = Math.min(100, now - animLast);
      animLast = now;
      for (const [id, phase] of [...playing]) {
        const slider = model.info(id)?.slider;
        if (!slider) {
          playing.delete(id);
          continue;
        }
        const span = slider.max - slider.min;
        let next = phase + (span * dt) / (SLIDER_SECONDS * 1000);
        if (next > slider.max) next = slider.min + ((next - slider.min) % span);
        playing.set(id, next);
        const step = sliderStep(slider);
        moveSlider(id, slider.min + Math.round((next - slider.min) / step) * step);
      }
      animFrame = requestAnimationFrame(stepAnimation);
    }

    function togglePlay(id) {
      const slider = model.info(id)?.slider;
      if (!slider) return;
      if (playing.has(id)) playing.delete(id);
      else playing.set(id, slider.value);
      syncRow(id);
      cancelAnimationFrame(animFrame);
      if (playing.size > 0) {
        animLast = performance.now();
        animFrame = requestAnimationFrame(stepAnimation);
      }
    }

    /* ----------------------------------------------------------------- view */

    const boundInputs = {
      xmin: h('input', { class: 'input gr-bound', type: 'text', 'aria-label': 'x minimum' }),
      xmax: h('input', { class: 'input gr-bound', type: 'text', 'aria-label': 'x maximum' }),
      ymin: h('input', { class: 'input gr-bound', type: 'text', 'aria-label': 'y minimum' }),
      ymax: h('input', { class: 'input gr-bound', type: 'text', 'aria-label': 'y maximum' }),
    };

    function syncBounds() {
      const b = view.bounds();
      for (const [key, el] of Object.entries(boundInputs)) {
        if (document.activeElement !== el) el.value = formatNumber(b[key], 6);
      }
    }

    function applyBounds() {
      const [xmin, xmax, ymin, ymax] = ['xmin', 'xmax', 'ymin', 'ymax'].map((k) =>
        evaluateNumber(boundInputs[k].value),
      );
      if (view.setBounds(xmin, xmax, ymin, ymax)) {
        changeView();
        for (const el of Object.values(boundInputs)) el.removeAttribute('aria-invalid');
      } else {
        for (const el of Object.values(boundInputs)) el.setAttribute('aria-invalid', 'true');
        ctx.notify('Enter numbers where each minimum is below its maximum.', 'error');
      }
    }

    function changeView() {
      state.view = view.toJSON();
      ctx.save();
      scheduleRender(true);
    }

    const resetView = () => {
      view.set(DEFAULT_VIEW);
      changeView();
    };

    function zoomBy(factor) {
      view.zoomAt(view.width / 2, view.height / 2, factor);
      changeView();
    }

    /** Dragging along the axis numbers stretches only that axis. */
    function axisZone(px, py) {
      const { width, height } = view;
      const ox = view.toScreenX(0);
      const oy = view.toScreenY(0);
      const rowTop = Math.min(Math.max(oy + 5, 5), height - 18);
      if (py >= rowTop - 3 && py <= rowTop + 17) return 'x';
      const roomLeft = ox >= 44;
      const side = roomLeft ? Math.min(ox - 6, width - 6) : Math.max(ox + 6, 6);
      const [from, to] = roomLeft ? [side - 42, side + 2] : [side - 2, side + 42];
      return px >= from && px <= to ? 'y' : null;
    }

    function updateCursor(px, py) {
      const zone = axisZone(px, py);
      base.style.cursor = zone === 'x' ? 'ew-resize' : zone === 'y' ? 'ns-resize' : '';
    }

    let axisDrag = null;
    const axisHandler = {
      hitTest: (x, y) => axisZone(x, y) !== null,
      start: (x, y) => {
        axisDrag = { axis: axisZone(x, y), x, y, sx: view.sx, sy: view.sy, cx: view.cx, cy: view.cy };
      },
      move: (x, y) => {
        if (!axisDrag) return;
        Object.assign(view, { sx: axisDrag.sx, sy: axisDrag.sy, cx: axisDrag.cx, cy: axisDrag.cy });
        const delta = axisDrag.axis === 'x' ? x - axisDrag.x : axisDrag.y - y;
        view.zoomAxisAt(axisDrag.axis, axisDrag.x, axisDrag.y, Math.exp(delta * 0.008));
        changeView();
      },
      end: () => {
        axisDrag = null;
      },
    };

    function saveImage() {
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      out.getContext('2d').drawImage(base, 0, 0);
      out.toBlob((blob) => {
        if (blob) downloadBlob(`${slugify(ctx.title(), 'graph')}.png`, blob);
      }, 'image/png');
    }

    /* --------------------------------------------------------------- layout */

    const check = (text, key) => {
      const box = h('input', {
        type: 'checkbox',
        checked: state[key],
        onchange: () => {
          state[key] = box.checked;
          ctx.save();
          scheduleRender();
        },
      });
      return h('label', { class: 'check' }, box, h('span', {}, text));
    };
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
    const bounds = h(
      'div',
      { class: 'gr-bounds' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'x from'), boundInputs.xmin),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'to'), boundInputs.xmax),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'y from'), boundInputs.ymin),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'to'), boundInputs.ymax),
      h('button', { class: 'btn btn-small', type: 'button', onclick: applyBounds }, 'Apply'),
    );
    for (const el of Object.values(boundInputs)) {
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') applyBounds();
      });
    }
    const settings = h(
      'div',
      {
        class: 'gr-settings',
        id: `gr-settings-${uid('s')}`,
        hidden: true,
        role: 'group',
        'aria-label': 'Graph settings',
      },
      check('Grid', 'grid'),
      check('Minor gridlines', 'minor'),
      check('Axis numbers', 'numbers'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Angles'), angle),
      bounds,
    );
    const settingsButton = h(
      'button',
      {
        class: 'btn btn-icon',
        type: 'button',
        'aria-label': 'Graph settings',
        'aria-expanded': 'false',
        'aria-controls': settings.id,
        title: 'Graph settings',
        onclick: () => {
          settings.hidden = !settings.hidden;
          settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
          if (!settings.hidden) syncBounds();
        },
      },
      icon('settings'),
    );
    settings.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        settings.hidden = true;
        settingsButton.setAttribute('aria-expanded', 'false');
        settingsButton.focus();
      }
    });
    const tools = h(
      'div',
      { class: 'gr-tools', role: 'group', 'aria-label': 'View' },
      settingsButton,
      h(
        'button',
        {
          class: 'btn btn-icon',
          type: 'button',
          'aria-label': 'Zoom in',
          title: 'Zoom in',
          onclick: () => zoomBy(1.4),
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
          onclick: () => zoomBy(1 / 1.4),
        },
        icon('zoom-out'),
      ),
      h(
        'button',
        { class: 'btn btn-icon', type: 'button', 'aria-label': 'Reset view', title: 'Reset view', onclick: resetView },
        icon('home'),
      ),
      h(
        'button',
        {
          class: 'btn btn-icon',
          type: 'button',
          'aria-label': 'Make axes square',
          title: 'Square axes',
          onclick: () => {
            view.makeSquare();
            changeView();
          },
        },
        icon('square'),
      ),
      h(
        'button',
        { class: 'btn btn-icon', type: 'button', 'aria-label': 'Save image', title: 'Save image', onclick: saveImage },
        icon('image'),
      ),
    );

    const panel = h(
      'aside',
      { class: 'gr-panel', 'aria-label': 'Expressions' },
      list,
      h(
        'div',
        { class: 'gr-add' },
        h('button', { class: 'btn', type: 'button', onclick: () => addRow() }, icon('plus', 14), 'Add expression'),
        h(
          'button',
          { class: 'btn btn-quiet', type: 'button', onclick: () => addRow(null, { kind: 'note' }) },
          'Add note',
        ),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: addTable }, 'Add table'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: addFolder }, 'Add folder'),
      ),
      h(
        'details',
        { class: 'gr-help' },
        h('summary', {}, 'Syntax'),
        h(
          'dl',
          {},
          SYNTAX.flatMap(([term, example]) => [h('dt', {}, term), h('dd', {}, h('code', {}, example))]),
        ),
      ),
    );
    const stage = h('div', { class: 'gr-stage plot-body' }, base, overlay, readout, sidebarToggle(), tools, settings);

    root.classList.add('tool', 'graph-tool');
    root.append(h('div', { class: 'graph-layout' }, panel, stage));

    const detach = attachPanZoom(base, view, {
      onChange: changeView,
      onReset: resetView,
      onClick,
      onHover,
      onLeave,
      drag: axisHandler,
    });
    const stopObserving = onResize(stage, () => scheduleRender());
    const onTheme = () => {
      syncValues();
      render(false);
    };
    document.addEventListener('clover:themechange', onTheme);

    rebuildList();
    recompileNow();

    return {
      onShow: () => {
        active = true;
        scheduleRender();
        if (playing.size > 0 && !animFrame) {
          animLast = performance.now();
          animFrame = requestAnimationFrame(stepAnimation);
        }
      },
      onHide: () => {
        active = false;
        cancelAnimationFrame(animFrame);
        animFrame = 0;
      },
      destroy: () => {
        active = false;
        playing.clear();
        for (const refs of rowEls.values()) clearTimeout(refs.errorTimer);
        cancelAnimationFrame(frame);
        cancelAnimationFrame(animFrame);
        cancelAnimationFrame(hoverFrame);
        clearTimeout(settleTimer);
        clearTimeout(poiTimer);
        recompileLater.cancel();
        detach();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
