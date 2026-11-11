import { debounce, downloadBlob, h, onResize, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { MODES, renderRows } from '../lib/domain.js';
import { ExpressionError, compileComplex } from '../lib/expr.js';
import { attachPanZoom } from '../lib/interact.js';
import { View, drawGrid, fitCanvas, normalizeView } from '../lib/viewport.js';

const DEFAULT_EXPR = '(z^2 - 1) / (z^2 + 1)';
const DEFAULT_VIEW = { cx: 0, cy: 0, radius: 3 };
const QUALITIES = { draft: 'Draft', standard: 'Standard', high: 'Fine' };
const MODE_LABELS = { phase: 'Phase', magnitude: 'Phase and magnitude', enhanced: 'Enhanced contours' };
const CAPTIONS = {
  phase: 'Hue is the argument of f(z): red on the positive real axis, advancing counter-clockwise.',
  magnitude: 'Hue is arg f(z). Brightness is |f(z)|: zeros are black and poles are white.',
  enhanced: 'Hue is arg f(z). Each step in brightness marks a doubling of |f(z)|, so level curves are visible.',
};
const PRESETS = [
  ['z\u00b2', 'z^2'],
  ['z\u00b3 \u2212 1', 'z^3 - 1'],
  ['(z\u00b2 \u2212 1)/(z\u00b2 + 1)', '(z^2 - 1) / (z^2 + 1)'],
  ['sin z', 'sin(z)'],
  ['tan z', 'tan(z)'],
  ['1/z', '1/z'],
  ['e^(1/z)', 'exp(1/z)'],
  ['log z', 'log(z)'],
  ['\u221az', 'sqrt(z)'],
  ['\u0393(z)', 'gamma(z)'],
  ['z^z', 'z^z'],
];

const normalize = (raw) => ({
  expr: typeof raw?.expr === 'string' && raw.expr.trim() && raw.expr.length <= 200 ? raw.expr : DEFAULT_EXPR,
  mode: MODES.includes(raw?.mode) ? raw.mode : 'enhanced',
  quality: Object.hasOwn(QUALITIES, raw?.quality) ? raw.quality : 'standard',
  grid: raw?.grid !== false,
  view: normalizeView(raw?.view, DEFAULT_VIEW),
});

const sig = (x) => {
  if (!Number.isFinite(x)) return x > 0 ? '\u221e' : x < 0 ? '\u2212\u221e' : 'undefined';
  if (x === 0) return '0';
  const text = Number(x.toPrecision(4)).toString();
  return (text.startsWith('-') ? `\u2212${text.slice(1)}` : text).replace('e+', 'e');
};

const formatComplex = (re, im) => {
  if (Number.isNaN(re) || Number.isNaN(im)) return 'undefined';
  if (!Number.isFinite(re) || !Number.isFinite(im)) return '\u221e';
  return `${sig(re)} ${im < 0 ? '\u2212' : '+'} ${sig(Math.abs(im))}i`;
};

const OVERLAY_COLORS = { grid: 'rgba(0,0,0,0.16)', axis: 'rgba(0,0,0,0.55)', text: '#101410' };

export default {
  type: 'complex',
  name: 'Complex functions',
  description: 'Colour the complex plane by the phase and magnitude of f(z). Pan, zoom, and probe values.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas) {
    const { ctx, width, height } = fitCanvas(canvas);
    const s = 0.5;
    const rw = Math.max(1, Math.ceil(width * s));
    const rh = Math.max(1, Math.ceil(height * s));
    const buffer = document.createElement('canvas');
    buffer.width = rw;
    buffer.height = rh;
    const bctx = buffer.getContext('2d');
    const image = bctx.createImageData(rw, rh);
    const view = new View({ cx: 0, cy: 0, radius: 1.7 }, width, height);
    renderRows({
      data: image.data,
      rw,
      s,
      width,
      height,
      cx: 0,
      cy: 0,
      scale: view.scale,
      f: compileComplex('z^3 - 1'),
      mode: 'enhanced',
      rowStart: 0,
      rowEnd: rh,
    });
    bctx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, 0, 0, width, height);
  },

  mount(root, ctx) {
    const state = ctx.state;
    const view = new View(state.view, 1, 1);
    const buffer = document.createElement('canvas');
    let f = null;
    let job = 0;
    let frame = 0;
    let hoverFrame = 0;

    const bg = h('canvas', { class: 'plot-canvas', 'aria-hidden': 'true' });
    const fg = h('canvas', {
      class: 'plot-canvas plot-top',
      role: 'img',
      tabindex: 0,
      'aria-label':
        'Domain colouring of f(z). Drag to pan, scroll or pinch to zoom, double-click to reset, arrow keys to pan.',
    });
    const readout = h('div', { class: 'plot-readout', hidden: true });
    const error = h('p', { class: 'field-status', role: 'alert', id: 'cx-error-hint' });
    const caption = h('p', { class: 'tool-note' });
    const input = h('input', {
      class: 'input input-wide input-mono',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      value: state.expr,
      'aria-label': 'f of z',
      'aria-describedby': 'cx-error-hint',
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          applyNow.cancel();
          apply();
        }
      },
      oninput: () => applyNow(),
    });

    function setError(message) {
      error.textContent = message;
      error.classList.toggle('is-error', Boolean(message));
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    function apply() {
      const text = input.value;
      try {
        f = compileComplex(text);
        setError('');
        state.expr = text;
        ctx.save();
        schedule();
      } catch (e) {
        if (!(e instanceof ExpressionError)) throw e;
        setError(e.position === null ? e.message : `${e.message} (character ${e.position + 1})`);
      }
    }
    const applyNow = debounce(apply, 350);

    /* -------------------------------------------------------------- rendering */

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(startRender);
    }

    function startRender() {
      const id = (job += 1);
      const { ctx: g, width, height, dpr } = fitCanvas(bg);
      if (width <= 1 || height <= 1) return;
      view.resize(width, height);
      drawOverlay();
      if (!f) {
        g.clearRect(0, 0, width, height);
        return;
      }
      const target = { draft: 0.5, standard: 1, high: Math.min(dpr, 2) }[state.quality] ?? 1;
      const passes = target > 0.25 ? [0.2, target] : [target];
      const bctx = buffer.getContext('2d');
      let pass = 0;
      let rw = 0;
      let rh = 0;
      let s = 1;
      let image = null;
      let row = 0;

      const begin = () => {
        s = passes[pass];
        rw = Math.max(1, Math.ceil(width * s));
        rh = Math.max(1, Math.ceil(height * s));
        buffer.width = rw;
        buffer.height = rh;
        image = bctx.createImageData(rw, rh);
        row = 0;
      };

      const step = () => {
        if (id !== job) return;
        const start = row;
        const t0 = performance.now();
        while (row < rh && performance.now() - t0 < 12) {
          const end = Math.min(rh, row + 4);
          renderRows({
            data: image.data,
            rw,
            s,
            width,
            height,
            cx: view.cx,
            cy: view.cy,
            scale: view.scale,
            f,
            mode: state.mode,
            rowStart: row,
            rowEnd: end,
          });
          row = end;
        }
        if (row > start) {
          bctx.putImageData(image, 0, 0, 0, start, rw, row - start);
          g.imageSmoothingEnabled = true;
          g.drawImage(buffer, 0, start, rw, row - start, 0, start / s, width, (row - start) / s);
        }
        if (row < rh) {
          frame = requestAnimationFrame(step);
        } else if ((pass += 1) < passes.length) {
          begin();
          frame = requestAnimationFrame(step);
        }
      };
      begin();
      step();
    }

    function drawOverlay() {
      const { ctx: g, width, height } = fitCanvas(fg);
      g.clearRect(0, 0, width, height);
      if (state.grid) drawGrid(g, view, OVERLAY_COLORS, { grid: true, labels: true, halo: 'rgba(255,255,255,0.88)' });
      // Hue legend: a ring showing arg f(z) from 0 (red) around to 2*pi.
      const cx = width - 38;
      const cy = height - 38;
      if (width > 160 && height > 160) {
        g.save();
        g.lineWidth = 9;
        for (let a = 0; a < 360; a += 3) {
          g.beginPath();
          g.strokeStyle = `hsl(${a} 80% 55%)`;
          const t0 = (-a * Math.PI) / 180;
          g.arc(cx, cy, 20, t0, t0 - (4 * Math.PI) / 180, true);
          g.stroke();
        }
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#101410';
        g.fillText('arg', cx, cy);
        g.restore();
      }
    }

    function probe(px, py) {
      if (!f) return;
      const [x, y] = view.toWorld(px, py);
      const [re, im] = f(x, y);
      const mag = Math.hypot(re, im);
      const angle = (Math.atan2(im, re) * 180) / Math.PI;
      readout.hidden = false;
      readout.replaceChildren(
        h('span', {}, `z = ${formatComplex(x, y)}`),
        h('span', {}, `f(z) = ${formatComplex(re, im)}`),
        h('span', {}, `|f| = ${sig(mag)}   arg = ${Number.isFinite(angle) ? `${sig(angle)}\u00b0` : 'undefined'}`),
      );
    }

    /* --------------------------------------------------------------- controls */

    const modeSelect = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Colouring',
        onchange: () => {
          state.mode = modeSelect.value;
          caption.textContent = CAPTIONS[state.mode];
          ctx.save();
          schedule();
        },
      },
      MODES.map((m) => h('option', { value: m }, MODE_LABELS[m])),
    );
    modeSelect.value = state.mode;
    caption.textContent = CAPTIONS[state.mode];

    const qualitySelect = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Detail',
        onchange: () => {
          state.quality = qualitySelect.value;
          ctx.save();
          schedule();
        },
      },
      Object.entries(QUALITIES).map(([value, label]) => h('option', { value }, label)),
    );
    qualitySelect.value = state.quality;

    const gridBox = h('input', {
      type: 'checkbox',
      checked: state.grid,
      onchange: () => {
        state.grid = gridBox.checked;
        ctx.save();
        drawOverlay();
      },
    });

    const changeView = () => {
      state.view = view.toJSON();
      ctx.save();
      schedule();
    };
    const resetView = () => {
      view.set(DEFAULT_VIEW);
      changeView();
    };
    const zoom = (factor) => {
      view.zoomAt(view.width / 2, view.height / 2, factor);
      changeView();
    };

    function saveImage() {
      const out = document.createElement('canvas');
      out.width = bg.width;
      out.height = bg.height;
      const g = out.getContext('2d');
      g.drawImage(bg, 0, 0);
      g.drawImage(fg, 0, 0);
      out.toBlob((blob) => {
        if (blob) downloadBlob(`${slugify(state.expr, 'complex-function')}.png`, blob);
      }, 'image/png');
    }

    const presetRow = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Example functions' },
      PRESETS.map(([label, expr]) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            onclick: () => {
              input.value = expr;
              applyNow.cancel();
              apply();
            },
          },
          label,
        ),
      ),
    );

    root.classList.add('tool', 'complex-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        h('label', { class: 'field field-grow' }, h('span', { class: 'field-label' }, 'f(z) ='), input),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Colouring'), modeSelect),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Detail'), qualitySelect),
        h('label', { class: 'check' }, gridBox, h('span', {}, 'Axes')),
        h(
          'div',
          { class: 'btn-group', role: 'group', 'aria-label': 'View' },
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': 'Zoom out',
              title: 'Zoom out',
              onclick: () => zoom(0.7),
            },
            '\u2212',
          ),
          h(
            'button',
            {
              class: 'btn btn-icon',
              type: 'button',
              'aria-label': 'Zoom in',
              title: 'Zoom in',
              onclick: () => zoom(1.4),
            },
            '+',
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
      h('div', { class: 'tool-body plot-body' }, bg, fg, readout),
      h('div', { class: 'tool-footer' }, caption),
    );

    const detach = attachPanZoom(fg, view, {
      onChange: changeView,
      onReset: resetView,
      onHover: (x, y) => {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = requestAnimationFrame(() => probe(x, y));
      },
      onLeave: () => {
        readout.hidden = true;
      },
    });
    const stopObserving = onResize(bg, schedule);
    const onTheme = () => drawOverlay();
    document.addEventListener('clover:themechange', onTheme);

    apply();

    return {
      onShow: schedule,
      onHide: () => {
        job += 1;
        cancelAnimationFrame(frame);
      },
      destroy: () => {
        job += 1;
        cancelAnimationFrame(frame);
        cancelAnimationFrame(hoverFrame);
        applyNow.cancel();
        detach();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
