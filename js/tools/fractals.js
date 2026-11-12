import { debounce, downloadBlob, h, onResize, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { FRACTALS, HOME, MAX_ITER, MIN_ITER, PALETTES, colorOf, computeRow } from '../lib/fractal.js';
import { attachPanZoom } from '../lib/interact.js';
import { View, fitCanvas, normalizeView } from '../lib/viewport.js';

const pick = (value, list, fallback) => (list.some(([key]) => key === value) ? value : fallback);
const num = (value, fallback, min, max) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const JULIA_DEFAULT = { cRe: -0.8, cIm: 0.156 };

const normalize = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = pick(r.kind, FRACTALS, 'mandelbrot');
  return {
    kind,
    view: normalizeView(r.view, HOME[kind]),
    iterations: Math.round(num(r.iterations, 200, MIN_ITER, MAX_ITER)),
    palette: pick(r.palette, PALETTES, 'forest'),
    power: Math.round(num(r.power, 2, 2, 8)),
    cRe: num(r.cRe, JULIA_DEFAULT.cRe, -2, 2),
    cIm: num(r.cIm, JULIA_DEFAULT.cIm, -2, 2),
  };
};

export default {
  type: 'fractals',
  name: 'Fractals',
  description:
    'Explore the Mandelbrot and Julia sets, the Burning Ship, the tricorn, and a Newton fractal. Pan and zoom without limit.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas) {
    const { ctx, width, height } = fitCanvas(canvas);
    const step = 3;
    const t = new Float32Array(Math.ceil(width / step));
    const g = new Uint8Array(t.length);
    const radius = 1.3;
    const scale = (2 * radius) / Math.min(width, height);
    for (let y = 0; y < height; y += step) {
      computeRow(
        'mandelbrot',
        { iterations: 60, cRe: 0, cIm: 0, power: 2 },
        -0.6 - (width / 2) * scale,
        scale * step,
        (height / 2 - y) * scale,
        t.length,
        t,
        g,
      );
      for (let i = 0; i < t.length; i += 1) {
        const [r, gr, b] = colorOf('mandelbrot', 'forest', t[i], 0, 60);
        ctx.fillStyle = `rgb(${r},${gr},${b})`;
        ctx.fillRect(i * step, y, step, step);
      }
    }
  },

  mount(root, ctx) {
    const state = ctx.state;
    const view = new View(state.view, 1, 1);
    const buffer = document.createElement('canvas');
    let active = false;
    let job = 0;
    let frame = 0;
    let picked = null;

    const canvas = h('canvas', {
      class: 'plot-canvas',
      role: 'img',
      tabindex: 0,
      'aria-label': 'Fractal. Drag to pan, scroll or pinch to zoom, double-click to reset, arrow keys to pan.',
    });
    const readout = h('div', { class: 'plot-readout', hidden: true });
    const caption = h('p', { class: 'tool-note' });

    /* ---------------------------------------------------------- rendering */

    function render() {
      cancelAnimationFrame(frame);
      if (!active) return;
      const job_ = (job += 1);
      const a = fitCanvas(canvas);
      view.resize(a.width, a.height);
      const params = { iterations: state.iterations, cRe: state.cRe, cIm: state.cIm, power: state.power };
      const passes = [8, 3, 1];
      let pass = 0;
      const run = () => {
        if (job_ !== job) return;
        const step = passes[pass];
        const w = Math.ceil(a.width / step);
        const hgt = Math.ceil(a.height / step);
        buffer.width = w;
        buffer.height = hgt;
        const bctx = buffer.getContext('2d');
        const image = bctx.createImageData(w, hgt);
        const t = new Float32Array(w);
        const g = new Uint8Array(w);
        const [x0, y0] = view.toWorld(0, 0);
        const dx = step / view.scale;
        let row = 0;
        const slice = () => {
          if (job_ !== job) return;
          const until = performance.now() + 12;
          while (row < hgt && performance.now() < until) {
            computeRow(state.kind, params, x0, dx, y0 - row * dx, w, t, g);
            for (let i = 0; i < w; i += 1) {
              const [r, gr, b] = colorOf(state.kind, state.palette, t[i], g[i], state.iterations);
              const at = (row * w + i) * 4;
              image.data[at] = r;
              image.data[at + 1] = gr;
              image.data[at + 2] = b;
              image.data[at + 3] = 255;
            }
            row += 1;
          }
          if (row < hgt) {
            frame = requestAnimationFrame(slice);
            return;
          }
          bctx.putImageData(image, 0, 0);
          a.ctx.imageSmoothingEnabled = step > 1;
          a.ctx.drawImage(buffer, 0, 0, a.width, a.height);
          pass += 1;
          if (pass < passes.length) frame = requestAnimationFrame(run);
        };
        slice();
      };
      run();
    }
    const renderLater = debounce(render, 40);
    const changed = () => {
      state.view = view.toJSON();
      ctx.save();
      renderLater();
    };

    /* ------------------------------------------------------------- pointer */

    const detach = attachPanZoom(canvas, view, {
      onChange: changed,
      onReset: () => {
        view.set(HOME[state.kind]);
        changed();
      },
      onHover: (x, y) => {
        const [wx, wy] = view.toWorld(x, y);
        readout.hidden = false;
        readout.textContent = `${wx.toPrecision(8)} ${wy < 0 ? '-' : '+'} ${Math.abs(wy).toPrecision(8)}i`;
      },
      onLeave: () => {
        readout.hidden = true;
      },
      onClick: (x, y) => {
        if (state.kind === 'julia' || state.kind === 'newton') return;
        const [wx, wy] = view.toWorld(x, y);
        picked = [wx, wy];
        juliaButton.disabled = false;
        caption.textContent = `Picked c = ${wx.toFixed(6)} ${wy < 0 ? '-' : '+'} ${Math.abs(wy).toFixed(6)}i. Press \u201cJulia set here\u201d to see its Julia set.`;
      },
    });

    /* ------------------------------------------------------------ controls */

    const field = (label, input) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
    const select = (label, list, key, onchange) => {
      const el = h(
        'select',
        {
          class: 'select',
          'aria-label': label,
          onchange: () => onchange(el.value),
        },
        list.map(([value, name]) => h('option', { value }, name)),
      );
      el.value = state[key];
      return el;
    };
    const kindSelect = select('Fractal', FRACTALS, 'kind', (value) => {
      state.kind = value;
      view.set(HOME[value]);
      state.view = view.toJSON();
      syncControls();
      ctx.save();
      render();
    });
    const paletteSelect = select('Colours', PALETTES, 'palette', (value) => {
      state.palette = value;
      ctx.save();
      render();
    });
    const numberInput = (label, key, { min, max, step, integer = false }) => {
      const el = h('input', {
        class: 'input',
        type: 'number',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(state[key]),
        'aria-label': label,
        oninput: () => {
          const v = Number(el.value);
          if (!Number.isFinite(v)) return;
          state[key] = integer ? Math.round(Math.min(max, Math.max(min, v))) : Math.min(max, Math.max(min, v));
          ctx.save();
          renderLater();
        },
      });
      return el;
    };
    const iterations = numberInput('Maximum iterations', 'iterations', {
      min: MIN_ITER,
      max: MAX_ITER,
      step: 50,
      integer: true,
    });
    const power = numberInput('Exponent', 'power', { min: 2, max: 8, step: 1, integer: true });
    const cRe = numberInput('Real part of c', 'cRe', { min: -2, max: 2, step: 0.01 });
    const cIm = numberInput('Imaginary part of c', 'cIm', { min: -2, max: 2, step: 0.01 });
    const juliaFields = h('span', { class: 'fr-julia' }, field('c real', cRe), field('c imaginary', cIm));
    const powerField = field('Exponent', power);
    const juliaButton = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        disabled: true,
        onclick: () => {
          if (!picked) return;
          state.cRe = Math.max(-2, Math.min(2, picked[0]));
          state.cIm = Math.max(-2, Math.min(2, picked[1]));
          cRe.value = String(state.cRe);
          cIm.value = String(state.cIm);
          kindSelect.value = 'julia';
          state.kind = 'julia';
          view.set(HOME.julia);
          state.view = view.toJSON();
          syncControls();
          ctx.save();
          render();
        },
      },
      'Julia set here',
    );
    const resetButton = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          view.set(HOME[state.kind]);
          changed();
        },
      },
      icon('home', 14),
      ' Reset view',
    );
    const saveButton = h(
      'button',
      {
        class: 'btn btn-icon',
        type: 'button',
        'aria-label': 'Save as PNG',
        title: 'Save as PNG',
        onclick: () =>
          canvas.toBlob((blob) => {
            if (blob) downloadBlob(`${slugify(state.kind, 'fractal')}.png`, blob);
          }, 'image/png'),
      },
      icon('image'),
    );

    function syncControls() {
      juliaFields.hidden = state.kind !== 'julia';
      powerField.hidden = state.kind === 'newton' || state.kind === 'ship' || state.kind === 'tricorn';
      iterations.closest('label').hidden = state.kind === 'newton';
      juliaButton.hidden = state.kind === 'julia' || state.kind === 'newton';
      caption.textContent =
        state.kind === 'newton'
          ? 'Each colour is one of the three cube roots of 1. Darker points took more steps to settle.'
          : state.kind === 'julia'
            ? 'Every point of the Mandelbrot set gives a different Julia set. Change c, or pick a point on the Mandelbrot set.'
            : 'Click a point to pick c, then press \u201cJulia set here\u201d. Zoom in with the wheel and raise the iterations to see finer detail.';
    }

    root.classList.add('tool', 'fractals-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        field('Fractal', kindSelect),
        field('Colours', paletteSelect),
        field('Iterations', iterations),
        powerField,
        juliaFields,
        juliaButton,
        resetButton,
        h('span', { class: 'tool-bar-spacer' }),
        saveButton,
      ),
      h('div', { class: 'tool-body plot-body' }, canvas, readout),
      h('div', { class: 'tool-footer' }, caption),
    );
    syncControls();

    const stopObserving = onResize(canvas, () => active && renderLater());
    const onTheme = () => active && render();
    document.addEventListener('clover:themechange', onTheme);

    return {
      onShow: () => {
        active = true;
        render();
      },
      onHide: () => {
        active = false;
        job += 1;
        cancelAnimationFrame(frame);
      },
      destroy: () => {
        active = false;
        job += 1;
        cancelAnimationFrame(frame);
        renderLater.cancel();
        stopObserving();
        detach();
        document.removeEventListener('clover:themechange', onTheme);
      },
    };
  },
};
