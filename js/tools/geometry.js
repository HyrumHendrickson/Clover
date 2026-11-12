import { debounce, h, onResize } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openMenu } from '../core/menu.js';
import { formatNode, formatRational, makeRational, parseLine, parseRational } from '../lib/geometry/dsl.js';
import { createChecker, describeExample, describeValue, drawable, REFERENCE } from '../lib/geometry/engine.js';
import { drawAxes, rowColor } from '../lib/graph/draw.js';
import { GraphView, normalizeGraphView } from '../lib/graph/view.js';
import { attachPanZoom } from '../lib/interact.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_ROWS = 60;
const MAX_TEXT = 300;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const SNAPS = ['1', '1/2', '1/4', '1/10'];
const DEFAULT_VIEW = { cx: 0, cy: 0, xspan: 18, yspan: 0 };
const GRAB = 14;
const SLIDE_STEPS = 16;

/* ------------------------------------------------------------------- state */

function normalize(raw) {
  const rows = [];
  const seen = new Set();
  let counter = 0;
  const fresh = () => {
    let id;
    do {
      counter += 1;
      id = `g${counter}`;
    } while (seen.has(id));
    return id;
  };
  const list = Array.isArray(raw?.rows) ? raw.rows.slice(0, MAX_ROWS) : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
    const id = typeof entry.id === 'string' && ID_PATTERN.test(entry.id) && !seen.has(entry.id) ? entry.id : fresh();
    seen.add(id);
    rows.push({ id, text: entry.text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) });
  }
  if (rows.length === 0) rows.push({ id: fresh(), text: '' });
  return {
    rows,
    snap: SNAPS.includes(raw?.snap) ? raw.snap : '1/2',
    view: normalizeGraphView(raw?.view, DEFAULT_VIEW),
  };
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/** Round to the nearest multiple of `step` (a { n, d } rational), as an exact rational. */
function snapTo(value, step) {
  const size = Number(step.n) / Number(step.d);
  const k = Math.round(value / size);
  return makeRational(BigInt(k) * step.n, step.d);
}

/* -------------------------------------------------------------------- tool */

export default {
  type: 'geometry',
  name: 'Geometry',
  description:
    'Construct figures in Euclidean geometry and check claims about them exactly. Proofs use exact algebra, never measured approximations.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const P = [
      [width * 0.2, height * 0.78],
      [width * 0.8, height * 0.78],
      [width * 0.42, height * 0.2],
    ];
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.ink;
    ctx.beginPath();
    P.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    ctx.strokeStyle = colors.a;
    [
      [P[0], mid(P[1], P[2])],
      [P[1], mid(P[0], P[2])],
      [P[2], mid(P[0], P[1])],
    ].forEach(([from, to]) => {
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    });
    ctx.fillStyle = colors.ink;
    for (const [x, y] of P) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  mount(root, ctx) {
    const state = ctx.state;
    const check = createChecker();
    const view = new GraphView(state.view, 1, 1);
    let sized = false;
    let active = false;
    let frame = 0;
    let result = { rows: [], normalized: true };
    /** Draggable points from the last draw: { index, x, y } in screen pixels. */
    let handles = [];
    let hover = -1;
    let dragging = -1;
    const rowEls = new Map();

    const list = h('ol', { class: 'geo-rows' });
    const canvas = h('canvas', {
      class: 'plot-canvas geo-canvas',
      role: 'img',
      tabindex: 0,
      'aria-label':
        'Figure. Drag a free point to move it, drag the background to pan, scroll or pinch to zoom, arrow keys to pan, plus and minus to zoom, 0 to reset. Every point can also be edited as text in the list.',
    });

    /* ------------------------------------------------------------ evaluate */

    const indexOfRow = (id) => state.rows.findIndex((r) => r.id === id);

    function evaluate() {
      result = check(state.rows.map((r) => r.text));
      state.rows.forEach((row, index) => syncRow(row, index));
      scheduleDraw();
    }
    const evaluateLater = debounce(evaluate, 140);

    /* ------------------------------------------------------------- statuses */

    function claimStatus(claim, normalized) {
      const lead = (text, cls) => h('strong', { class: `geo-verdict ${cls}` }, text);
      const here =
        claim.here === 'true'
          ? 'True in this figure.'
          : claim.here === 'false'
            ? 'False in this figure.'
            : claim.here === 'undefined'
              ? `Not defined in this figure${claim.hereMessage ? `: ${claim.hereMessage}` : '.'}`
              : '';
      if (claim.status === 'proved') {
        return h(
          'div',
          { class: 'geo-claim is-proved' },
          lead('Proved', 'is-proved'),
          ` Exact algebra shows this holds ${
            normalized
              ? 'for every position of the free points'
              : 'for every position of the free points, with the fixed points where you put them'
          }, wherever the construction is defined.`,
        );
      }
      if (claim.status === 'refuted') {
        return h(
          'div',
          { class: 'geo-claim is-refuted' },
          lead('Not true in general', 'is-refuted'),
          ` ${claim.here === 'true' ? 'It happens to be true in this figure. ' : claim.here === 'false' ? 'It is false in this figure. ' : ''}Counterexample: ${describeExample(claim.example)}.`,
        );
      }
      if (claim.status === 'unproved') {
        return h(
          'div',
          { class: 'geo-claim is-refuted' },
          lead('Not proved', 'is-refuted'),
          ` The algebra does not vanish, but no valid counterexample turned up either. ${here}`,
        );
      }
      return null;
    }

    function syncRow(row, index) {
      const refs = rowEls.get(row.id);
      if (!refs) return;
      const out = result.rows[index];
      const statement = out?.statement ?? parseLine(row.text);
      refs.li.dataset.kind = statement.kind;
      refs.input.setAttribute('aria-invalid', out?.error ? 'true' : 'false');
      refs.status.replaceChildren();
      let note = null;
      if (out?.error) {
        note = h('p', { class: 'geo-error', role: 'alert' }, out.error);
      } else if (statement.kind === 'claim' && out?.claim) {
        note = claimStatus(out.claim, result.normalized);
      } else if (statement.kind === 'assign' && out?.value) {
        const kind = out.value.type;
        const label =
          kind === 'point'
            ? 'Point'
            : kind === 'line'
              ? out.value.segment
                ? 'Segment on'
                : 'Line'
              : kind === 'circle'
                ? 'Circle'
                : 'Polygon';
        const text = describeValue(out.value);
        note = h('p', { class: 'geo-value' }, text ? `${label} ${text}` : label);
      }
      refs.status.hidden = note === null;
      if (note) refs.status.append(note);
      const color = out?.value && statement.kind === 'assign' ? rowColor(index, isDark()) : 'transparent';
      refs.dot.style.background = color;
    }

    /* ------------------------------------------------------------ row ops */

    function focusRow(id, atEnd = true) {
      const refs = rowEls.get(id);
      if (!refs) return;
      refs.input.focus();
      if (atEnd) refs.input.setSelectionRange(refs.input.value.length, refs.input.value.length);
    }

    function insertRow(text = '', afterId = null, { focus = true } = {}) {
      if (state.rows.length >= MAX_ROWS) {
        ctx.notify(`A figure can have up to ${MAX_ROWS} lines. Delete one to add another.`);
        return null;
      }
      const taken = new Set(state.rows.map((r) => r.id));
      let n = state.rows.length;
      let id;
      do {
        n += 1;
        id = `g${n}`;
      } while (taken.has(id));
      const row = { id, text };
      const at = afterId === null ? state.rows.length : indexOfRow(afterId) + 1;
      state.rows.splice(at, 0, row);
      rebuildRows();
      evaluate();
      ctx.save();
      if (focus) focusRow(id);
      return row;
    }

    function removeRow(id) {
      const index = indexOfRow(id);
      if (index < 0) return;
      state.rows.splice(index, 1);
      if (state.rows.length === 0) state.rows.push({ id: 'g1', text: '' });
      rebuildRows();
      evaluate();
      ctx.save();
      focusRow(state.rows[Math.max(0, index - 1)].id);
    }

    function onKey(event, row) {
      const index = indexOfRow(row.id);
      if (event.key === 'Enter') {
        event.preventDefault();
        evaluateLater.flush();
        insertRow('', row.id);
      } else if (event.key === 'ArrowDown' && state.rows[index + 1]) {
        event.preventDefault();
        focusRow(state.rows[index + 1].id);
      } else if (event.key === 'ArrowUp' && index > 0) {
        event.preventDefault();
        focusRow(state.rows[index - 1].id);
      } else if (event.key === 'Backspace' && row.text === '' && state.rows.length > 1) {
        event.preventDefault();
        removeRow(row.id);
      }
    }

    function buildRow(row, index) {
      const input = h('input', {
        class: 'input input-mono geo-input',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        autocapitalize: 'off',
        maxlength: String(MAX_TEXT),
        placeholder: 'A = (0, 0)   or   collinear(A, B, C)',
        'aria-label': `Line ${index + 1}`,
        value: row.text,
        oninput: () => {
          row.text = input.value.slice(0, MAX_TEXT);
          ctx.save();
          evaluateLater();
        },
        onblur: () => evaluateLater.flush(),
        onkeydown: (event) => onKey(event, row),
      });
      const dot = h('span', { class: 'geo-dot', 'aria-hidden': 'true' });
      const status = h('div', { class: 'geo-status', 'aria-live': 'polite', hidden: true });
      const remove = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon geo-remove',
          type: 'button',
          'aria-label': `Delete line ${index + 1}`,
          title: 'Delete line',
          onclick: () => removeRow(row.id),
        },
        icon('close', 14),
      );
      const li = h(
        'li',
        { class: 'geo-row', dataset: { id: row.id } },
        dot,
        h('div', { class: 'geo-main' }, input, status),
        remove,
      );
      rowEls.set(row.id, { li, input, status, dot });
      return li;
    }

    function rebuildRows() {
      rowEls.clear();
      list.replaceChildren(...state.rows.map(buildRow));
    }

    /* ---------------------------------------------------------- templates */

    const used = () =>
      new Set(state.rows.flatMap((r) => [...r.text.matchAll(/^\s*([\p{L}][\p{L}\p{N}_']*)\s*=/gu)].map((m) => m[1])));
    const nextName = (letters) => {
      const taken = used();
      return [...letters].find((l) => !taken.has(l)) ?? `${letters[0]}${taken.size}`;
    };
    const POINT = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';

    function addMenu(anchor) {
      const add = (text) => () => insertRow(text);
      openMenu(anchor, [
        { label: 'Free point', onSelect: () => insertRow(`${nextName(POINT)} = (0, 0)`) },
        { label: 'Midpoint', onSelect: () => insertRow(`${nextName(POINT)} = midpoint(A, B)`) },
        { label: 'Intersection', onSelect: () => insertRow(`${nextName(POINT)} = intersect(a, b)`) },
        { label: 'Foot of perpendicular', onSelect: () => insertRow(`${nextName(POINT)} = foot(C, c)`) },
        { label: 'Point on a line or circle', onSelect: () => insertRow(`${nextName(POINT)} = on(a)`) },
        { separator: true },
        { label: 'Segment', onSelect: () => insertRow(`${nextName(LOWER)} = segment(A, B)`) },
        { label: 'Line', onSelect: () => insertRow(`${nextName(LOWER)} = line(A, B)`) },
        { label: 'Perpendicular bisector', onSelect: () => insertRow(`${nextName(LOWER)} = perpbisector(A, B)`) },
        { label: 'Circle', onSelect: () => insertRow(`${nextName(LOWER)} = circle(O, A)`) },
        {
          label: 'Circle through three points',
          onSelect: () => insertRow(`${nextName(LOWER)} = circumcircle(A, B, C)`),
        },
        { separator: true },
        { label: 'Claim: collinear', onSelect: add('collinear(A, B, C)') },
        { label: 'Claim: concurrent', onSelect: add('concurrent(a, b, c)') },
        { label: 'Claim: parallel', onSelect: add('parallel(a, b)') },
        { label: 'Claim: perpendicular', onSelect: add('perpendicular(a, b)') },
        { label: 'Claim: concyclic', onSelect: add('concyclic(A, B, C, D)') },
        { label: 'Claim: equal lengths', onSelect: add('equal(length(A, B), length(C, D))') },
      ]);
    }

    /* ----------------------------------------------------------- drawing */

    function scheduleDraw() {
      if (frame || !active) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    }

    function lineEnds(item) {
      if (item.segment && item.via?.[0] && item.via?.[1]) return [item.via[0], item.via[1]];
      const { xmin, xmax, ymin, ymax } = view.bounds();
      const pad = Math.max(xmax - xmin, ymax - ymin);
      if (Math.abs(item.b) >= Math.abs(item.a)) {
        const y = (x) => (-item.c - item.a * x) / item.b;
        return [
          { x: xmin - pad, y: y(xmin - pad) },
          { x: xmax + pad, y: y(xmax + pad) },
        ];
      }
      const x = (y) => (-item.c - item.b * y) / item.a;
      return [
        { x: x(ymin - pad), y: ymin - pad },
        { x: x(ymax + pad), y: ymax + pad },
      ];
    }

    function draw() {
      if (!active) return;
      const { ctx: g, width, height } = fitCanvas(canvas);
      if (width <= 1 || height <= 1) return;
      view.resize(width, height);
      if (!sized) {
        view.set(state.view);
        sized = true;
      }
      const colors = themeColors();
      const dark = isDark();
      g.fillStyle = colors.bg;
      g.fillRect(0, 0, width, height);
      drawAxes(g, view, colors, { grid: true, minor: false, numbers: true });

      const items = [];
      result.rows.forEach((row, index) => {
        if (!row.value || row.statement.kind !== 'assign') return;
        const shape = drawable(row.value);
        if (shape) items.push({ shape, row, index, color: rowColor(index, dark) });
      });
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const { shape, color } of items) {
        if (shape.type === 'polygon') {
          const pts = shape.pts.filter(Boolean);
          if (pts.length < 3) continue;
          g.beginPath();
          pts.forEach((p, i) =>
            i === 0
              ? g.moveTo(view.toScreenX(p.x), view.toScreenY(p.y))
              : g.lineTo(view.toScreenX(p.x), view.toScreenY(p.y)),
          );
          g.closePath();
          g.globalAlpha = 0.12;
          g.fillStyle = color;
          g.fill();
          g.globalAlpha = 1;
          g.lineWidth = 2;
          g.strokeStyle = color;
          g.stroke();
        } else if (shape.type === 'circle') {
          g.beginPath();
          g.ellipse(
            view.toScreenX(shape.x),
            view.toScreenY(shape.y),
            shape.r * view.sx,
            shape.r * view.sy,
            0,
            0,
            Math.PI * 2,
          );
          g.lineWidth = 2;
          g.strokeStyle = color;
          g.stroke();
        } else if (shape.type === 'line') {
          const [p, q] = lineEnds(shape);
          if (![p?.x, p?.y, q?.x, q?.y].every(Number.isFinite)) continue;
          g.beginPath();
          g.moveTo(view.toScreenX(p.x), view.toScreenY(p.y));
          g.lineTo(view.toScreenX(q.x), view.toScreenY(q.y));
          g.lineWidth = 2;
          g.strokeStyle = color;
          g.stroke();
        }
      }
      handles = [];
      g.font = '600 14px ui-sans-serif, system-ui, sans-serif';
      for (const { shape, row, index, color } of items) {
        if (shape.type !== 'point' || !Number.isFinite(shape.x)) continue;
        const sx = view.toScreenX(shape.x);
        const sy = view.toScreenY(shape.y);
        const movable = row.free || (row.sliding && row.slide);
        if (movable) handles.push({ index, x: sx, y: sy });
        g.beginPath();
        g.arc(sx, sy, movable ? 6 : 4.5, 0, Math.PI * 2);
        g.fillStyle = color;
        g.fill();
        if (movable) {
          g.lineWidth = index === hover || index === dragging ? 3 : 1.5;
          g.strokeStyle = colors.bg;
          g.stroke();
        }
        g.fillStyle = colors.ink;
        g.fillText(row.name ?? '', sx + 8, sy - 8);
      }
    }

    /* ---------------------------------------------------------- dragging */

    const step = () => parseRational(state.snap) ?? makeRational(1n, 2n);

    function rewriteDragged(index, px, py) {
      const out = result.rows[index];
      const row = state.rows[index];
      const statement = parseLine(row.text);
      if (!out || statement.kind !== 'assign') return;
      const [wx, wy] = view.toWorld(px, py);
      let text = null;
      if (out.free) {
        const x = snapTo(wx, step());
        const y = snapTo(wy, step());
        text = `${statement.name} = (${formatRational(x)}, ${formatRational(y)})`;
      } else if (out.sliding && out.slide) {
        const t = slideParameter(out.slide, wx, wy);
        if (t === null) return;
        const target = statement.expr.args[0];
        text = `${statement.name} = on(${formatNode(target)}, ${formatRational(t)})`;
      }
      if (text === null || text === row.text) return;
      row.text = text;
      rowEls.get(row.id).input.value = text;
      ctx.save();
      evaluate();
    }

    /** The parameter that puts a sliding point nearest to a spot, snapped to sixteenths. */
    function slideParameter(target, wx, wy) {
      let t = null;
      if (target.type === 'line' && target.via?.[0] && target.via?.[1]) {
        const [A, B] = target.via;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        t = ((wx - A.x) * dx + (wy - A.y) * dy) / (dx * dx + dy * dy);
      } else if (target.type === 'line') {
        const s = target.a * target.a + target.b * target.b;
        const fx = (-target.a * target.c) / s;
        const fy = (-target.b * target.c) / s;
        t = ((wx - fx) * -target.b + (wy - fy) * target.a) / s;
      } else if (target.type === 'circle') {
        const v = [target.through.x - target.x, target.through.y - target.y];
        const w = [wx - target.x, wy - target.y];
        const angle = Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1]);
        t = Math.max(-64, Math.min(64, Math.tan(angle / 2)));
      }
      if (t === null || !Number.isFinite(t)) return null;
      return makeRational(BigInt(Math.round(t * SLIDE_STEPS)), BigInt(SLIDE_STEPS));
    }

    const nearest = (x, y) => {
      let best = null;
      let bestDistance = GRAB;
      for (const handle of handles) {
        const d = Math.hypot(handle.x - x, handle.y - y);
        if (d <= bestDistance) {
          best = handle;
          bestDistance = d;
        }
      }
      return best;
    };

    const changeView = () => {
      state.view = view.toJSON();
      ctx.save();
      scheduleDraw();
    };
    const detach = attachPanZoom(canvas, view, {
      onChange: changeView,
      onReset: () => {
        view.set(DEFAULT_VIEW);
        changeView();
      },
      onHover: (x, y) => {
        const near = nearest(x, y);
        const next = near ? near.index : -1;
        canvas.style.cursor = near ? 'grab' : '';
        if (next !== hover) {
          hover = next;
          scheduleDraw();
        }
      },
      onLeave: () => {
        hover = -1;
        scheduleDraw();
      },
      drag: {
        hitTest: (x, y) => nearest(x, y) !== null,
        start: (x, y) => {
          dragging = nearest(x, y)?.index ?? -1;
          canvas.style.cursor = 'grabbing';
        },
        move: (x, y) => {
          if (dragging >= 0) rewriteDragged(dragging, x, y);
        },
        end: () => {
          dragging = -1;
          canvas.style.cursor = '';
          scheduleDraw();
        },
      },
    });
    const stopObserving = onResize(canvas, scheduleDraw);
    const onTheme = () => {
      state.rows.forEach((row, index) => syncRow(row, index));
      scheduleDraw();
    };
    document.addEventListener('clover:themechange', onTheme);

    /* ------------------------------------------------------------ layout */

    const snap = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Snap free points to',
        onchange: () => {
          state.snap = SNAPS.includes(snap.value) ? snap.value : '1/2';
          ctx.save();
        },
      },
      ...SNAPS.map((value) => h('option', { value }, value === '1' ? 'Whole numbers' : `Multiples of ${value}`)),
    );
    snap.value = state.snap;

    const help = h(
      'details',
      { class: 'geo-help' },
      h('summary', {}, 'How this works'),
      h(
        'div',
        { class: 'geo-help-body' },
        h(
          'p',
          {},
          'Each line defines something or states a claim. Names are case sensitive. Free points are written (x, y) with exact numbers like 3, -1.5, or 3/4, and snap to the grid when you drag them.',
        ),
        h(
          'p',
          {},
          'A claim is proved only when exact algebra shows it holds for every position of the free points, and refuted only by an exact counterexample. Nothing is measured, so two lines are never called parallel because they look it. A claim that is true in the current figure but not in general is labelled that way.',
        ),
        h(
          'p',
          {},
          'Constructions are limited to ones that need no square roots: the other intersection of a line or circle through a known point, midpoints, perpendiculars, reflections, triangle centers, and the like. Angle bisectors and the incenter are not available because they need square roots.',
        ),
        ...Object.entries(REFERENCE).map(([group, entries]) =>
          h(
            'section',
            { class: 'geo-ref' },
            h('h3', {}, group[0].toUpperCase() + group.slice(1)),
            h('dl', {}, ...entries.flatMap(([code, text]) => [h('dt', {}, h('code', {}, code)), h('dd', {}, text)])),
          ),
        ),
      ),
    );

    const toolbar = h(
      'div',
      { class: 'tool-bar geo-bar', role: 'toolbar', 'aria-label': 'Geometry' },
      h(
        'button',
        { class: 'btn', type: 'button', 'aria-haspopup': 'menu', onclick: (event) => addMenu(event.currentTarget) },
        icon('plus', 16),
        'Add',
      ),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Snap'), snap),
      h('span', { class: 'tool-bar-spacer' }),
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

    root.classList.add('tool', 'geometry-tool');
    root.append(
      toolbar,
      h(
        'div',
        { class: 'tool-body geo-body' },
        h('div', { class: 'geo-side' }, list, help),
        h('div', { class: 'geo-stage plot-body' }, canvas),
      ),
    );

    rebuildRows();
    evaluate();

    return {
      onShow: () => {
        active = true;
        scheduleDraw();
      },
      onHide: () => {
        active = false;
      },
      destroy: () => {
        active = false;
        cancelAnimationFrame(frame);
        evaluateLater.cancel();
        detach();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
