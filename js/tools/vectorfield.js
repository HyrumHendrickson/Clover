import { debounce, downloadBlob, h, onResize, prefersReducedMotion, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { PALETTE, palette } from '../lib/colors.js';
import { ExpressionError, compileReal } from '../lib/expr.js';
import { divCurl, traceStreamline, typicalMagnitude } from '../lib/field.js';
import { attachPanZoom } from '../lib/interact.js';
import { View, drawArrow, drawGrid, fitCanvas, niceStep, normalizeView, themeColors } from '../lib/viewport.js';

const DEFAULT_VIEW = { cx: 0, cy: 0, radius: 5 };
const MAX_SEEDS = 24;
const ARROW_STYLES = { uniform: 'Uniform length', scaled: 'Length by magnitude', off: 'No arrows' };

const PRESETS = [
  { label: 'Rotation', p: '-y', q: 'x' },
  { label: 'Saddle', p: 'x', q: '-y' },
  { label: 'Source', p: 'x', q: 'y' },
  { label: 'Sink', p: '-x', q: '-y' },
  { label: 'Vortex', p: '-y/(x^2+y^2)', q: 'x/(x^2+y^2)' },
  { label: 'Dipole', p: '(y^2-x^2)/(x^2+y^2)^2', q: '-2*x*y/(x^2+y^2)^2' },
  { label: 'Pendulum', p: 'y', q: '-sin(x)', radius: 6 },
  { label: 'Van der Pol', p: 'y', q: '(1-x^2)*y-x', radius: 4 },
  { label: 'Predator and prey', p: 'x*(1-y)', q: 'y*(x-1)', cx: 1.5, cy: 1.5, radius: 3 },
  { label: 'Shear flow', p: 'sin(y)', q: '0.3*cos(x)' },
];

const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (value, fallback) => (typeof value === 'string' && value.trim() && value.length <= 200 ? value : fallback);

const normalize = (raw) => ({
  p: text(raw?.p, '-y'),
  q: text(raw?.q, 'x'),
  arrows: Object.hasOwn(ARROW_STYLES, raw?.arrows) ? raw.arrows : 'uniform',
  heat: raw?.heat !== false,
  flow: raw?.flow !== false,
  grid: raw?.grid !== false,
  density: Math.min(80, Math.max(24, Math.round(num(raw?.density, 40)))),
  seeds: Array.isArray(raw?.seeds)
    ? raw.seeds
        .filter((s) => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]))
        .slice(-MAX_SEEDS)
        .map((s) => [s[0], s[1]])
    : [],
  view: normalizeView(raw?.view, DEFAULT_VIEW),
});

const sig = (x) => {
  if (!Number.isFinite(x)) return 'undefined';
  if (Math.abs(x) < 1e-12) return '0';
  const t = Number(x.toPrecision(4)).toString();
  return t.startsWith('-') ? `\u2212${t.slice(1)}` : t;
};

const rgba = (rgb, alpha) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;

export default {
  type: 'vector',
  name: 'Vector fields',
  description: 'Plot a planar field as arrows, magnitude shading, and animated flow. Click to trace trajectories.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    const view = new View({ cx: 0, cy: 0, radius: 2.4 }, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const field = (x, y) => [-y + 0.35 * x, x + 0.35 * y];
    const step = 0.55;
    for (let x = -7; x <= 7; x += step) {
      for (let y = -3; y <= 3; y += step) {
        const [a, b] = field(x, y);
        const m = Math.hypot(a, b) || 1;
        const [sx, sy] = view.toScreen(x, y);
        const len = step * view.scale * 0.62;
        const dx = (a / m) * len;
        const dy = (-b / m) * len;
        const [r, g, bl] = palette(m / (m + 2.2));
        drawArrow(ctx, sx - dx / 2, sy - dy / 2, sx + dx / 2, sy + dy / 2, {
          color: `rgb(${r},${g},${bl})`,
          width: 1.6,
          head: 6,
        });
      }
    }
  },

  mount(root, ctx) {
    const state = ctx.state;
    const view = new View(state.view, 1, 1);
    let P = null;
    let Q = null;
    let vref = 1;
    let active = false;
    let flowFrame = 0;
    let baseFrame = 0;
    let hoverFrame = 0;
    let particles = [];
    let flowColors = [];
    const heatBuffer = document.createElement('canvas');
    if (prefersReducedMotion()) state.flow = false;

    const base = h('canvas', {
      class: 'plot-canvas',
      role: 'img',
      tabindex: 0,
      'aria-label':
        'Vector field plot. Click to trace a trajectory. Drag to pan, scroll or pinch to zoom, arrow keys to pan.',
    });
    const flow = h('canvas', { class: 'plot-canvas plot-top plot-passive', 'aria-hidden': 'true' });
    const readout = h('div', { class: 'plot-readout', hidden: true });
    const error = h('p', { class: 'field-status', role: 'alert' });

    const inputP = h('input', {
      class: 'input input-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      value: state.p,
      'aria-label': 'P of x and y',
      oninput: () => applyLater(),
      onkeydown: (e) => e.key === 'Enter' && applyNow(),
    });
    const inputQ = h('input', {
      class: 'input input-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      value: state.q,
      'aria-label': 'Q of x and y',
      oninput: () => applyLater(),
      onkeydown: (e) => e.key === 'Enter' && applyNow(),
    });

    /* ---------------------------------------------------------------- compile */

    function apply() {
      try {
        const nextP = compileReal(inputP.value, ['x', 'y']);
        const nextQ = compileReal(inputQ.value, ['x', 'y']);
        P = nextP;
        Q = nextQ;
        state.p = inputP.value;
        state.q = inputQ.value;
        error.textContent = '';
        error.classList.remove('is-error');
        inputP.removeAttribute('aria-invalid');
        inputQ.removeAttribute('aria-invalid');
        ctx.save();
        renderBase();
        resetFlow();
      } catch (e) {
        if (!(e instanceof ExpressionError)) throw e;
        const which = (() => {
          try {
            compileReal(inputP.value, ['x', 'y']);
            return 'Q';
          } catch {
            return 'P';
          }
        })();
        error.textContent = `${which}: ${e.message}`;
        error.classList.add('is-error');
        (which === 'P' ? inputP : inputQ).setAttribute('aria-invalid', 'true');
      }
    }
    const applyLater = debounce(apply, 350);
    const applyNow = () => {
      applyLater.cancel();
      apply();
    };

    /* ------------------------------------------------------------- base layer */

    function scheduleBase() {
      cancelAnimationFrame(baseFrame);
      baseFrame = requestAnimationFrame(() => {
        renderBase();
        resetFlow();
      });
    }

    function drawHeat(g, width, height) {
      const hw = Math.max(1, Math.ceil(width / 4));
      const hh = Math.max(1, Math.ceil(height / 4));
      heatBuffer.width = hw;
      heatBuffer.height = hh;
      const bctx = heatBuffer.getContext('2d');
      const image = bctx.createImageData(hw, hh);
      const data = image.data;
      for (let row = 0; row < hh; row += 1) {
        for (let col = 0; col < hw; col += 1) {
          const [x, y] = view.toWorld(((col + 0.5) * width) / hw, ((row + 0.5) * height) / hh);
          const m = Math.hypot(P(x, y), Q(x, y));
          const i = (row * hw + col) * 4;
          if (!Number.isFinite(m)) continue;
          const c = palette(m / (m + vref));
          data[i] = c[0];
          data[i + 1] = c[1];
          data[i + 2] = c[2];
          data[i + 3] = 255;
        }
      }
      bctx.putImageData(image, 0, 0);
      g.save();
      g.globalAlpha = 0.4;
      g.imageSmoothingEnabled = true;
      g.drawImage(heatBuffer, 0, 0, width, height);
      g.restore();
    }

    function drawArrows(g, colors) {
      if (state.arrows === 'off') return;
      const { width, height } = view;
      const step = niceStep((state.density / view.scale) * 10);
      const stepPx = step * view.scale;
      const [xmin, ymax] = view.toWorld(0, 0);
      const [xmax, ymin] = view.toWorld(width, height);
      const i0 = Math.ceil(xmin / step);
      const i1 = Math.floor(xmax / step);
      const j0 = Math.ceil(ymin / step);
      const j1 = Math.floor(ymax / step);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 6000) return;
      for (let i = i0; i <= i1; i += 1) {
        for (let j = j0; j <= j1; j += 1) {
          const x = i * step;
          const y = j * step;
          const a = P(x, y);
          const b = Q(x, y);
          const m = Math.hypot(a, b);
          if (!Number.isFinite(m)) continue;
          const [sx, sy] = view.toScreen(x, y);
          if (!(m > 1e-12)) {
            g.fillStyle = colors.text;
            g.beginPath();
            g.arc(sx, sy, 2, 0, Math.PI * 2);
            g.fill();
            continue;
          }
          const t = m / (m + vref);
          const length = state.arrows === 'uniform' ? stepPx * 0.72 : Math.max(3, stepPx * 0.95 * t);
          const dx = (a / m) * (length / 2);
          const dy = (-b / m) * (length / 2);
          const c = palette(t);
          const color = state.heat ? colors.ink : `rgb(${c[0]},${c[1]},${c[2]})`;
          drawArrow(g, sx - dx, sy - dy, sx + dx, sy + dy, { color, width: 1.6, head: Math.min(8, length * 0.5) });
        }
      }
    }

    function drawTrajectories(g, colors) {
      if (state.seeds.length === 0) return;
      const margin = 24 / view.scale;
      const [xmin, ymax] = view.toWorld(0, 0);
      const [xmax, ymin] = view.toWorld(view.width, view.height);
      const bounds = { xmin: xmin - margin, xmax: xmax + margin, ymin: ymin - margin, ymax: ymax + margin };
      const step = 2 / view.scale;
      g.save();
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [x0, y0] of state.seeds) {
        const fwd = traceStreamline(P, Q, x0, y0, { step, bounds, maxSteps: 1000 });
        const bwd = traceStreamline(P, Q, x0, y0, { step: -step, bounds, maxSteps: 1000 });
        const path = [...bwd.slice(1).reverse(), ...fwd].map(([x, y]) => view.toScreen(x, y));
        g.lineWidth = 3.5;
        g.strokeStyle = colors.bg;
        g.globalAlpha = 0.85;
        g.beginPath();
        path.forEach(([sx, sy], k) => (k === 0 ? g.moveTo(sx, sy) : g.lineTo(sx, sy)));
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = 2;
        g.strokeStyle = colors.b;
        g.beginPath();
        path.forEach(([sx, sy], k) => (k === 0 ? g.moveTo(sx, sy) : g.lineTo(sx, sy)));
        g.stroke();
        // Chevrons point along the flow, every ~70 steps either side of the seed.
        const chevron = (a, b) => {
          const [ax, ay] = a;
          const [bx, by] = b;
          const len = Math.hypot(bx - ax, by - ay) || 1;
          const ux = (bx - ax) / len;
          const uy = (by - ay) / len;
          g.beginPath();
          g.moveTo(bx - ux * 6 - uy * 4, by - uy * 6 + ux * 4);
          g.lineTo(bx, by);
          g.lineTo(bx - ux * 6 + uy * 4, by - uy * 6 - ux * 4);
          g.stroke();
        };
        for (let k = 70; k < fwd.length; k += 70) chevron(view.toScreen(...fwd[k - 1]), view.toScreen(...fwd[k]));
        for (let k = 70; k < bwd.length; k += 70) chevron(view.toScreen(...bwd[k]), view.toScreen(...bwd[k - 1]));
        const [sx, sy] = view.toScreen(x0, y0);
        g.beginPath();
        g.arc(sx, sy, 4.5, 0, Math.PI * 2);
        g.fillStyle = colors.bg;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = colors.ink;
        g.stroke();
      }
      g.restore();
    }

    function renderBase() {
      const { ctx: g, width, height } = fitCanvas(base);
      if (width <= 1 || height <= 1) return;
      view.resize(width, height);
      const colors = themeColors();
      g.fillStyle = colors.bg;
      g.fillRect(0, 0, width, height);
      if (!P || !Q) return;
      vref = typicalMagnitude(P, Q, view);
      if (state.heat) drawHeat(g, width, height);
      if (state.grid) drawGrid(g, view, colors, { grid: true, labels: true });
      drawArrows(g, colors);
      drawTrajectories(g, colors);
      const dark = document.documentElement.dataset.theme === 'dark';
      flowColors = state.heat
        ? [dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,24,20,0.7)']
        : PALETTE.filter((_, k) => k % 16 === 15 || k === 0).map((c) => rgba(c, 0.9));
    }

    /* ------------------------------------------------------------------- flow */

    const respawn = (p) => {
      const [xmin, ymax] = view.toWorld(0, 0);
      const [xmax, ymin] = view.toWorld(view.width, view.height);
      p.x = xmin + Math.random() * (xmax - xmin);
      p.y = ymin + Math.random() * (ymax - ymin);
      p.age = 0;
      p.max = 50 + Math.random() * 130;
    };

    function resetFlow() {
      const { ctx: g, width, height } = fitCanvas(flow);
      g.clearRect(0, 0, width, height);
      const count = Math.round(Math.min(1200, Math.max(150, (width * height) / 1100)));
      particles = Array.from({ length: count }, () => {
        const p = { x: 0, y: 0, age: 0, max: 100 };
        respawn(p);
        p.age = Math.random() * p.max;
        return p;
      });
      syncFlow();
    }

    function stepFlow() {
      flowFrame = requestAnimationFrame(stepFlow);
      if (!P || !Q) return;
      const { ctx: g, width, height } = fitCanvas(flow);
      view.resize(width, height);
      const scale = view.scale;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(0, 0, width, height);
      g.globalCompositeOperation = 'source-over';
      g.lineWidth = 1.4;
      g.lineCap = 'round';
      const last = flowColors.length - 1;
      for (const p of particles) {
        const a = P(p.x, p.y);
        const b = Q(p.x, p.y);
        const m = Math.hypot(a, b);
        if (!(m > 1e-12) || !Number.isFinite(m)) {
          respawn(p);
          continue;
        }
        const speed = Math.max(0.25, Math.min(6, (1.6 * m) / vref));
        const nx = p.x + ((a / m) * speed) / scale;
        const ny = p.y + ((b / m) * speed) / scale;
        const [x0, y0] = view.toScreen(p.x, p.y);
        const [x1, y1] = view.toScreen(nx, ny);
        g.strokeStyle = flowColors[Math.min(last, Math.floor((m / (m + vref)) * (last + 1)))] ?? '#fff';
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        p.x = nx;
        p.y = ny;
        p.age += 1;
        if (p.age > p.max || x1 < -10 || x1 > width + 10 || y1 < -10 || y1 > height + 10) respawn(p);
      }
    }

    function syncFlow() {
      const shouldRun = active && state.flow && !document.hidden && P && Q;
      cancelAnimationFrame(flowFrame);
      if (shouldRun) {
        flowFrame = requestAnimationFrame(stepFlow);
      } else if (!state.flow) {
        const { ctx: g, width, height } = fitCanvas(flow);
        g.clearRect(0, 0, width, height);
      }
    }

    /* --------------------------------------------------------------- readouts */

    function probe(px, py) {
      if (!P || !Q) return;
      const [x, y] = view.toWorld(px, py);
      const a = P(x, y);
      const b = Q(x, y);
      const { div, curl } = divCurl(P, Q, x, y, view.radius * 1e-4);
      readout.hidden = false;
      readout.replaceChildren(
        h('span', {}, `(x, y) = (${sig(x)}, ${sig(y)})`),
        h('span', {}, `F = (${sig(a)}, ${sig(b)})   |F| = ${sig(Math.hypot(a, b))}`),
        h('span', {}, `div F = ${sig(div)}   curl F = ${sig(curl)}`),
      );
    }

    /* --------------------------------------------------------------- controls */

    const changeView = () => {
      state.view = view.toJSON();
      ctx.save();
      scheduleBase();
    };
    const resetView = () => {
      view.set(DEFAULT_VIEW);
      changeView();
    };

    const arrowSelect = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Arrows',
        onchange: () => {
          state.arrows = arrowSelect.value;
          ctx.save();
          renderBase();
        },
      },
      Object.entries(ARROW_STYLES).map(([value, label]) => h('option', { value }, label)),
    );
    arrowSelect.value = state.arrows;

    const check = (label, key, onChange) => {
      const box = h('input', {
        type: 'checkbox',
        checked: state[key],
        onchange: () => {
          state[key] = box.checked;
          ctx.save();
          onChange();
        },
      });
      return h('label', { class: 'check' }, box, h('span', {}, label));
    };

    const density = h('input', {
      class: 'range',
      type: 'range',
      min: '24',
      max: '80',
      step: '4',
      value: String(state.density),
      'aria-label': 'Arrow spacing',
      oninput: () => {
        state.density = Number(density.value);
        ctx.save();
        renderBase();
      },
    });

    function saveImage() {
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      const g = out.getContext('2d');
      g.drawImage(base, 0, 0);
      g.drawImage(flow, 0, 0);
      out.toBlob((blob) => {
        if (blob) downloadBlob(`${slugify(`${state.p}-${state.q}`, 'vector-field')}.png`, blob);
      }, 'image/png');
    }

    const presetRow = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Example fields' },
      PRESETS.map((preset) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            onclick: () => {
              inputP.value = preset.p;
              inputQ.value = preset.q;
              view.set({ cx: preset.cx ?? 0, cy: preset.cy ?? 0, radius: preset.radius ?? DEFAULT_VIEW.radius });
              state.view = view.toJSON();
              state.seeds = [];
              applyNow();
            },
          },
          preset.label,
        ),
      ),
    );

    root.classList.add('tool', 'vector-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        h('label', { class: 'field field-grow' }, h('span', { class: 'field-label' }, 'P(x, y) ='), inputP),
        h('label', { class: 'field field-grow' }, h('span', { class: 'field-label' }, 'Q(x, y) ='), inputQ),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Arrows'), arrowSelect),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Spacing'), density),
        check('Magnitude shading', 'heat', renderBase),
        check('Flow', 'flow', () => {
          resetFlow();
        }),
        check('Axes', 'grid', renderBase),
        h(
          'div',
          { class: 'btn-group', role: 'group', 'aria-label': 'View' },
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': 'Clear trajectories',
              title: 'Clear trajectories',
              onclick: () => {
                state.seeds = [];
                ctx.save();
                renderBase();
              },
            },
            icon('trash'),
          ),
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': 'Reset view',
              title: 'Reset view',
              onclick: resetView,
            },
            icon('reset'),
          ),
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': 'Save image',
              title: 'Save image',
              onclick: saveImage,
            },
            icon('image'),
          ),
        ),
      ),
      h('div', { class: 'tool-subbar' }, presetRow, error),
      h('div', { class: 'tool-body plot-body' }, base, flow, readout),
      h(
        'div',
        { class: 'tool-footer' },
        h(
          'p',
          { class: 'tool-note' },
          'Click the plot to trace a trajectory through that point. Drag to pan, scroll to zoom, double-click to reset.',
        ),
      ),
    );

    const detach = attachPanZoom(base, view, {
      onChange: changeView,
      onReset: resetView,
      onClick: (px, py) => {
        const [x, y] = view.toWorld(px, py);
        state.seeds = [...state.seeds, [Number(x.toPrecision(8)), Number(y.toPrecision(8))]].slice(-MAX_SEEDS);
        ctx.save();
        renderBase();
      },
      onHover: (x, y) => {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = requestAnimationFrame(() => probe(x, y));
      },
      onLeave: () => {
        readout.hidden = true;
      },
    });
    const stopObserving = onResize(base, scheduleBase);
    const onTheme = () => renderBase();
    const onVisibility = () => syncFlow();
    document.addEventListener('clover:themechange', onTheme);
    document.addEventListener('visibilitychange', onVisibility);

    apply();

    return {
      onShow: () => {
        active = true;
        scheduleBase();
      },
      onHide: () => {
        active = false;
        syncFlow();
      },
      destroy: () => {
        active = false;
        cancelAnimationFrame(flowFrame);
        cancelAnimationFrame(baseFrame);
        cancelAnimationFrame(hoverFrame);
        applyLater.cancel();
        detach();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  },
};
