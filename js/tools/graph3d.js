import { downloadBlob, h, onResize, slugify, uid } from '../core/dom.js';
import { createExprList, emptyRow, normalizeRows } from '../core/exprlist.js';
import { icon } from '../core/icons.js';
import { evaluateNumber } from '../lib/expr.js';
import { rowColor } from '../lib/graph/draw.js';
import { isHidden } from '../lib/graph/rows.js';
import { GraphEvalError, formatNumber } from '../lib/graph/values.js';
import { Camera, DEFAULT_CAMERA, PRESET_VIEWS, normalizeCamera } from '../lib/graph3d/camera.js';
import {
  Box,
  curveSegments,
  implicitTriangles,
  paramSurfaceTriangles,
  pointDots,
  surfaceTriangles,
} from '../lib/graph3d/mesh.js';
import { Graph3DModel, isPoint3Value } from '../lib/graph3d/model.js';
import { renderScene } from '../lib/graph3d/render.js';
import { sidebarToggle } from '../lib/graph/chrome.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_ROWS = 40;
const DEFAULT_BOUNDS = [-5, 5, -5, 5, -5, 5];
const MAX_BOUND = 1e6;
const MIN_SPAN = 1e-6;

/** Samples per axis for each kind of plot while the scene is moving (draft) and once it settles (full). */
const QUALITY = {
  draft: { surface: 24, implicit: 18, curve: 220, psurface: 22 },
  full: { surface: 64, implicit: 40, curve: 900, psurface: 56 },
};

const SYNTAX = [
  ['Surfaces', 'z = sin(x) cos(y)    f(x, y) = x^2 - y^2'],
  ['Implicit surfaces', 'x^2 + y^2 + z^2 = 9    x^2 + y^2 = z^2'],
  ['Space curves', '(cos(t), sin(t), t/4) {0 <= t <= 12}'],
  ['Parametric surfaces', '(u cos(v), u sin(v), u) {0 <= u <= 3}'],
  ['Points', '(1, 2, 3)    [(0, 0, 0), (1, 1, 1)]'],
  ['Lists', 'z = [1, 2, 3]x draws three surfaces'],
  ['Sliders', 'a = 1, then use a in other rows'],
  ['Restrictions', 'z = x + y {x > 0}'],
];

const SAMPLE = 'z = sin(x) * cos(y)';

/* ------------------------------------------------------------------- state */

function normalizeBounds(raw) {
  if (!Array.isArray(raw) || raw.length !== 6) return [...DEFAULT_BOUNDS];
  const out = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const lo = raw[axis * 2];
    const hi = raw[axis * 2 + 1];
    const ok =
      typeof lo === 'number' &&
      typeof hi === 'number' &&
      Number.isFinite(lo) &&
      Number.isFinite(hi) &&
      Math.abs(lo) <= MAX_BOUND &&
      Math.abs(hi) <= MAX_BOUND &&
      hi - lo >= MIN_SPAN;
    out.push(ok ? lo : DEFAULT_BOUNDS[axis * 2], ok ? hi : DEFAULT_BOUNDS[axis * 2 + 1]);
  }
  return out;
}

function normalize(raw) {
  const rows = normalizeRows(raw?.rows, { max: MAX_ROWS, structured: true });
  if (rows.length === 0) rows.push({ ...emptyRow('r1', 1), text: SAMPLE });
  return {
    rows,
    camera: normalizeCamera(raw?.camera),
    bounds: normalizeBounds(raw?.bounds),
    grid: raw?.grid !== false,
    numbers: raw?.numbers !== false,
    wire: raw?.wire === true,
    angle: raw?.angle === 'deg' ? 'deg' : 'rad',
  };
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/* ---------------------------------------------------------------- geometry */

/**
 * Build the geometry of one plot at a quality tier. Returns `{ tris, segs, dots }`
 * (any may be absent) in unit space. Throws GraphEvalError for problems to show on the row.
 */
export function buildGeometry(plot, box, tier) {
  const q = QUALITY[tier];
  switch (plot.type) {
    case 'surface':
      return { tris: surfaceTriangles(plot.raw, box, { n: q.surface, mask: plot.mask }) };
    case 'implicit3':
      return { tris: implicitTriangles(plot.F, box, { n: q.implicit, mask: plot.mask }) };
    case 'psurface':
      return {
        tris: paramSurfaceTriangles(plot.at, plot.domainU(), plot.domainV(), box, { n: q.psurface, mask: plot.mask }),
      };
    case 'curve3':
      return { segs: curveSegments(plot.at, plot.domain(), box, { samples: q.curve, mask: plot.mask }) };
    case 'points3': {
      const value = plot.get();
      return isPoint3Value(value) ? { dots: pointDots(value, box) } : {};
    }
    default:
      return {};
  }
}

/* -------------------------------------------------------------------- tool */

export default {
  type: 'graph3d',
  name: '3D graphing',
  description: 'Graph surfaces, space curves, parametric surfaces, implicit surfaces, and points. Drag to orbit.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    const camera = new Camera({ yaw: 0.7, pitch: 0.55, zoom: 1.15 }, width, height);
    const box = new Box([-3, 3, -3, 3, -1.2, 1.2]);
    const wave = (x, y) => Math.sin(Math.hypot(x, y) * 1.7) * Math.exp(-Math.hypot(x, y) / 5) * 1.6;
    const tris = surfaceTriangles(wave, box, { n: 22 });
    renderScene(ctx, camera, box, [{ id: 'p', color: colors.a, tris }], {
      colors,
      grid: true,
      numbers: false,
      fast: true,
    });
  },

  mount(root, ctx) {
    const state = ctx.state;
    const model = new Graph3DModel();
    const camera = new Camera(state.camera, 1, 1);
    let active = false;
    let frame = 0;
    let settleTimer = 0;
    let fastPending = false;
    let renderErrors = new Map();
    /** @type {Map<string, { tris?: number[], segs?: number[], dots?: number[] }>} */
    let geometry = new Map();
    let geometryTier = null;
    let geometryDirty = true;
    let geometryBounds = '';

    /* ------------------------------------------------------------ elements */

    const base = h('canvas', {
      class: 'plot-canvas g3-canvas',
      role: 'img',
      tabindex: 0,
      'aria-label':
        '3D graph. Drag to orbit, shift-drag or right-drag to pan, scroll or pinch to zoom. Arrow keys orbit, shift with arrows pans, plus and minus zoom, 0 resets the view.',
    });
    const status = h('p', { class: 'g3-status', hidden: true, role: 'status' });
    const readout = h('div', { class: 'plot-readout g3-readout', hidden: true, 'aria-hidden': 'true' });
    const marker = h('span', { class: 'g3-marker', hidden: true, 'aria-hidden': 'true' });

    /* ------------------------------------------------------------ geometry */

    function rebuildGeometry(tier) {
      const box = new Box(state.bounds);
      const next = new Map();
      const errors = new Map();
      for (const row of state.rows) {
        const plot = model.info(row.id)?.plot;
        if (row.kind === 'note' || isHidden(state.rows, row) || !plot) continue;
        try {
          next.set(row.id, buildGeometry(plot, box, tier));
        } catch (error) {
          if (!(error instanceof GraphEvalError)) throw error;
          errors.set(row.id, error.message);
        }
      }
      geometry = next;
      geometryTier = tier;
      geometryDirty = false;
      geometryBounds = state.bounds.join('|');
      setRenderErrors(errors);
    }

    function setRenderErrors(errors) {
      const before = JSON.stringify([...renderErrors]);
      renderErrors = errors;
      if (before !== JSON.stringify([...errors])) rows.syncAll();
    }

    /* ------------------------------------------------------------ rendering */

    function render({ fast = false, tier = 'full' } = {}) {
      const { ctx: g, width, height } = fitCanvas(base);
      if (width <= 1 || height <= 1) return;
      camera.resize(width, height);
      const needed = fast ? 'draft' : tier;
      const stale = geometryDirty || geometryBounds !== state.bounds.join('|');
      if (stale || (needed === 'full' && geometryTier !== 'full')) rebuildGeometry(needed);

      const dark = isDark();
      const items = [];
      for (const row of state.rows) {
        const mesh = geometry.get(row.id);
        if (!mesh || isHidden(state.rows, row) || row.kind === 'note') continue;
        items.push({ id: row.id, color: rowColor(row.color, dark), ...mesh });
      }
      const result = renderScene(g, camera, new Box(state.bounds), items, {
        colors: themeColors(root),
        grid: state.grid,
        numbers: state.numbers,
        wire: state.wire,
        fast,
      });
      const empty = items.length === 0 && state.rows.every((r) => r.kind !== 'table' && (r.text ?? '').trim() === '');
      status.hidden = !empty;
      status.textContent = empty ? 'Type an expression, like z = x^2 - y^2' : '';
      return result;
    }

    /** Draw soon. `moving` renders quickly now and in full once input settles. */
    function scheduleRender(moving = false) {
      fastPending = fastPending || moving;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const quick = fastPending;
        fastPending = false;
        render({ fast: quick });
        if (quick) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => render({ fast: false }), 180);
        }
      });
    }

    /* ---------------------------------------------------------------- rows */

    function recompileNow() {
      model.update(state.rows, { angle: state.angle });
      geometryDirty = true;
      rows.syncAll();
      scheduleRender(true);
    }

    const rows = createExprList({
      structured: true,
      rows: state.rows,
      model,
      ctx,
      maxRows: MAX_ROWS,
      placeholder: 'Type an expression, like z = x^2 - y^2',
      onChange: recompileNow,
      onSlider: () => {
        geometryDirty = true;
        scheduleRender(true);
      },
      onVisual: () => {
        geometryDirty = true;
        scheduleRender();
      },
      renderErrors: () => renderErrors,
      isActive: () => active,
    });

    /* -------------------------------------------------------------- camera */

    function changeCamera({ keep = false } = {}) {
      state.camera = camera.toJSON();
      ctx.save();
      if (!keep) syncViewControls();
      scheduleRender(true);
    }

    const resetView = () => {
      camera.set(DEFAULT_CAMERA);
      changeCamera();
    };

    const pointers = new Map();
    let dragMode = null;
    let pinchDistance = 0;
    const local = (event) => {
      const rect = base.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const onDown = (event) => {
      base.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 1) {
        dragMode = event.shiftKey || event.button === 2 || event.button === 1 ? 'pan' : 'orbit';
        base.classList.add('is-grabbing');
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        dragMode = 'pinch';
      }
    };
    /* Hovering shows the point of a surface under the pointer, with its coordinates, like Desmos. */
    let hoverFrame = 0;
    function pickSurface(px, py) {
      const box = new Box(state.bounds);
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const c = [0, 0, 0];
      let best = null;
      for (const row of state.rows) {
        const tris = geometry.get(row.id)?.tris;
        if (!tris || isHidden(state.rows, row)) continue;
        for (let i = 0; i + 8 < tris.length; i += 9) {
          camera.project(tris[i], tris[i + 1], tris[i + 2], a);
          camera.project(tris[i + 3], tris[i + 4], tris[i + 5], b);
          camera.project(tris[i + 6], tris[i + 7], tris[i + 8], c);
          const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
          if (Math.abs(d) < 1e-9) continue;
          const wa = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / d;
          const wb = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / d;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const depth = wa * a[2] + wb * b[2] + wc * c[2];
          if (best && depth >= best.depth) continue;
          best = {
            depth,
            row,
            u: [0, 1, 2].map((k) => wa * tris[i + k] + wb * tris[i + 3 + k] + wc * tris[i + 6 + k]),
          };
        }
      }
      return best && { ...best, world: best.u.map((u, k) => box.world(k, u)) };
    }
    function clearHover() {
      cancelAnimationFrame(hoverFrame);
      marker.hidden = true;
      readout.hidden = true;
    }
    function hoverAt(event) {
      if (event.pointerType === 'touch' || pointers.size > 0) return;
      const [x, y] = local(event);
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const hit = pickSurface(x, y);
        if (!hit) {
          clearHover();
          return;
        }
        const [px, py] = camera.project(hit.u[0], hit.u[1], hit.u[2], [0, 0, 0]);
        marker.hidden = false;
        marker.style.left = `${px}px`;
        marker.style.top = `${py}px`;
        marker.style.borderColor = rowColor(hit.row.color, isDark());
        readout.hidden = false;
        readout.textContent = `(${hit.world.map((v) => formatNumber(v, 4)).join(', ')})`;
      });
    }
    const onMove = (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) {
        hoverAt(event);
        return;
      }
      clearHover();
      const [x, y] = local(event);
      pointers.set(event.pointerId, [x, y]);
      if (dragMode === 'orbit') {
        camera.orbit(x - previous[0], y - previous[1]);
        changeCamera({ keep: true });
      } else if (dragMode === 'pan') {
        camera.pan(x - previous[0], y - previous[1]);
        changeCamera({ keep: true });
      } else if (dragMode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinchDistance > 0 && distance > 0) camera.zoomBy(distance / pinchDistance);
        pinchDistance = distance;
        changeCamera({ keep: true });
      }
    };
    const onUp = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size === 0) {
        dragMode = null;
        base.classList.remove('is-grabbing');
      } else if (pointers.size === 1) {
        dragMode = 'orbit';
      }
    };
    const onWheel = (event) => {
      event.preventDefault();
      camera.zoomBy(Math.exp(-event.deltaY * 0.0016));
      changeCamera({ keep: true });
    };
    const onKeyDown = (event) => {
      const step = event.shiftKey ? 24 : 12;
      let handled = true;
      if (event.key === 'ArrowLeft') event.shiftKey ? camera.pan(-step, 0) : camera.orbit(-step, 0);
      else if (event.key === 'ArrowRight') event.shiftKey ? camera.pan(step, 0) : camera.orbit(step, 0);
      else if (event.key === 'ArrowUp') event.shiftKey ? camera.pan(0, -step) : camera.orbit(0, -step);
      else if (event.key === 'ArrowDown') event.shiftKey ? camera.pan(0, step) : camera.orbit(0, step);
      else if (event.key === '+' || event.key === '=') camera.zoomBy(1.15);
      else if (event.key === '-' || event.key === '_') camera.zoomBy(1 / 1.15);
      else if (event.key === '0') camera.set(DEFAULT_CAMERA);
      else handled = false;
      if (handled) {
        event.preventDefault();
        changeCamera();
      }
    };
    base.style.touchAction = 'none';
    base.addEventListener('pointerdown', onDown);
    base.addEventListener('pointermove', onMove);
    base.addEventListener('pointerup', onUp);
    base.addEventListener('pointercancel', onUp);
    base.addEventListener('pointerleave', clearHover);
    base.addEventListener('wheel', onWheel, { passive: false });
    base.addEventListener('keydown', onKeyDown);
    base.addEventListener('dblclick', resetView);
    base.addEventListener('contextmenu', (event) => event.preventDefault());

    /* ------------------------------------------------------------ settings */

    const boundInputs = ['xmin', 'xmax', 'ymin', 'ymax', 'zmin', 'zmax'].map((name) =>
      h('input', {
        class: 'input gr-bound',
        type: 'text',
        'aria-label': `${name[0]} ${name.slice(1) === 'min' ? 'minimum' : 'maximum'}`,
      }),
    );

    function syncBounds() {
      state.bounds.forEach((value, i) => {
        if (document.activeElement !== boundInputs[i]) boundInputs[i].value = formatNumber(value, 6);
      });
    }

    function applyBounds() {
      const values = boundInputs.map((el) => evaluateNumber(el.value));
      const next = normalizeBounds(values);
      const valid = values.every((v, i) => v === next[i]);
      for (const el of boundInputs) el.toggleAttribute('aria-invalid', !valid);
      if (!valid) {
        ctx.notify('Enter numbers where each minimum is below its maximum.', 'error');
        return;
      }
      state.bounds = next;
      geometryDirty = true;
      ctx.save();
      scheduleRender(true);
    }

    const check = (text, key, after = () => {}) => {
      const box = h('input', {
        type: 'checkbox',
        checked: state[key],
        onchange: () => {
          state[key] = box.checked;
          ctx.save();
          after();
          scheduleRender();
        },
      });
      return h('label', { class: 'check' }, box, h('span', {}, text));
    };
    const perspectiveBox = h('input', {
      type: 'checkbox',
      checked: camera.perspective,
      onchange: () => {
        camera.perspective = perspectiveBox.checked;
        changeCamera({ keep: true });
      },
    });
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

    const field = (text, el) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, text), el);
    const bounds = h(
      'div',
      { class: 'gr-bounds g3-bounds' },
      field('x from', boundInputs[0]),
      field('to', boundInputs[1]),
      field('y from', boundInputs[2]),
      field('to', boundInputs[3]),
      field('z from', boundInputs[4]),
      field('to', boundInputs[5]),
      h('button', { class: 'btn btn-small', type: 'button', onclick: applyBounds }, 'Apply'),
    );
    for (const el of boundInputs) {
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') applyBounds();
      });
    }
    const settings = h(
      'div',
      {
        class: 'gr-settings',
        id: `g3-settings-${uid('s')}`,
        hidden: true,
        role: 'group',
        'aria-label': '3D graph settings',
      },
      check('Grid', 'grid'),
      check('Axis numbers', 'numbers'),
      check('Mesh lines', 'wire'),
      h('label', { class: 'check' }, perspectiveBox, h('span', {}, 'Perspective')),
      field('Angles', angle),
      bounds,
    );
    const settingsButton = h(
      'button',
      {
        class: 'btn btn-icon',
        type: 'button',
        'aria-label': '3D graph settings',
        'aria-expanded': 'false',
        'aria-controls': settings.id,
        title: 'Settings',
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

    const preset = h(
      'select',
      {
        class: 'select g3-preset',
        'aria-label': 'Preset view',
        onchange: () => {
          const view = PRESET_VIEWS[preset.value];
          if (view) {
            camera.set({ ...camera.toJSON(), ...view, panX: 0, panY: 0 });
            changeCamera();
          }
          preset.value = '';
        },
      },
      h('option', { value: '' }, 'View'),
      h('option', { value: 'iso' }, 'Isometric'),
      h('option', { value: 'top' }, 'Top'),
      h('option', { value: 'front' }, 'Front'),
      h('option', { value: 'side' }, 'Side'),
    );

    function syncViewControls() {
      perspectiveBox.checked = camera.perspective;
    }

    function saveImage() {
      render({ fast: false });
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      out.getContext('2d').drawImage(base, 0, 0);
      out.toBlob((blob) => {
        if (blob) downloadBlob(`${slugify(ctx.title(), '3d-graph')}.png`, blob);
      }, 'image/png');
    }

    const iconButton = (name, label, onclick) =>
      h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
    const tools = h(
      'div',
      { class: 'gr-tools', role: 'group', 'aria-label': 'View' },
      settingsButton,
      iconButton('zoom-in', 'Zoom in', () => {
        camera.zoomBy(1.25);
        changeCamera();
      }),
      iconButton('zoom-out', 'Zoom out', () => {
        camera.zoomBy(1 / 1.25);
        changeCamera();
      }),
      iconButton('home', 'Reset view', resetView),
      iconButton('image', 'Save image', saveImage),
    );

    const panel = h(
      'aside',
      { class: 'gr-panel', 'aria-label': 'Expressions' },
      rows.el,
      h(
        'div',
        { class: 'gr-add' },
        h('button', { class: 'btn', type: 'button', onclick: () => rows.addRow() }, icon('plus', 14), 'Add expression'),
        h(
          'button',
          { class: 'btn btn-quiet', type: 'button', onclick: () => rows.addRow(null, { kind: 'note' }) },
          'Add note',
        ),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => rows.addTable() }, 'Add table'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => rows.addFolder() }, 'Add folder'),
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
    const stage = h(
      'div',
      { class: 'gr-stage plot-body g3-stage' },
      base,
      marker,
      readout,
      status,
      sidebarToggle(),
      tools,
      h('div', { class: 'g3-views' }, preset),
      settings,
    );

    root.classList.add('tool', 'graph-tool', 'graph3d-tool');
    root.append(h('div', { class: 'graph-layout' }, panel, stage));

    const stopObserving = onResize(stage, () => scheduleRender());
    const onTheme = () => {
      rows.syncAll();
      render({ fast: false });
    };
    document.addEventListener('clover:themechange', onTheme);

    recompileNow();
    syncBounds();

    return {
      onShow: () => {
        active = true;
        scheduleRender();
        rows.resume();
      },
      onHide: () => {
        active = false;
        rows.pause();
      },
      destroy: () => {
        active = false;
        rows.destroy();
        cancelAnimationFrame(frame);
        clearTimeout(settleTimer);
        stopObserving();
        base.removeEventListener('wheel', onWheel);
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
