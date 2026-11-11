import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { drawGrid, fitCanvas, View } from '../lib/viewport.js';

export const PRODUCTS = [
  { id: 'calculator', label: 'Graphing' },
  { id: 'geometry', label: 'Geometry' },
  { id: '3d', label: '3D' },
  { id: 'scientific', label: 'Scientific' },
  { id: 'fourfunction', label: 'Four function' },
  { id: 'matrix', label: 'Matrix' },
];

const HOSTS = new Set(['www.desmos.com', 'desmos.com']);
const PATH = /^\/(calculator|geometry|3d|scientific|fourfunction|matrix)(?:\/([A-Za-z0-9_-]{1,40}))?\/?$/;
const GRAPH_ID = /^[A-Za-z0-9_-]{0,40}$/;

/**
 * Validate a Desmos link. Only https links to desmos.com calculators are accepted,
 * and only the product and graph id are kept (query strings and fragments are dropped).
 * @returns {{ product: string, graphId: string } | null}
 */
export function parseDesmosLink(text) {
  let url;
  try {
    url = new URL(String(text).trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
  const match = PATH.exec(url.pathname);
  if (!match) return null;
  return { product: match[1], graphId: match[2] ?? '' };
}

export function desmosUrl({ product, graphId }) {
  return `https://www.desmos.com/${product}${graphId ? `/${graphId}` : ''}`;
}

const normalize = (raw) => {
  const product = PRODUCTS.some((p) => p.id === raw?.product) ? raw.product : 'calculator';
  const graphId = typeof raw?.graphId === 'string' && GRAPH_ID.test(raw.graphId) ? raw.graphId : '';
  return { product, graphId };
};

export default {
  type: 'desmos',
  name: 'Desmos',
  description: 'The Desmos graphing, geometry, 3D, and scientific calculators, embedded.',
  defaultState: () => ({ product: 'calculator', graphId: '' }),
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
    const status = h('p', { class: 'field-status', role: 'status' });
    const frame = h('iframe', {
      class: 'desmos-frame',
      title: 'Desmos calculator',
      loading: 'lazy',
      allow: 'fullscreen',
      referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox:
        'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads allow-modals',
    });
    const productSelect = h(
      'select',
      {
        class: 'select',
        'aria-label': 'Calculator type',
        onchange: () => {
          state.product = productSelect.value;
          state.graphId = '';
          linkInput.value = '';
          status.textContent = '';
          load();
          ctx.save();
        },
      },
      PRODUCTS.map((p) => h('option', { value: p.id }, p.label)),
    );
    const linkInput = h('input', {
      class: 'input input-wide',
      type: 'url',
      inputmode: 'url',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Saved graph link, e.g. https://www.desmos.com/calculator/abc123',
      'aria-label': 'Saved Desmos graph link',
      onkeydown: (event) => {
        if (event.key === 'Enter') openLink();
      },
    });
    const external = h(
      'a',
      {
        class: 'btn btn-quiet',
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'Open in Desmos (new tab)',
        title: 'Open in Desmos',
      },
      icon('external'),
    );

    function load() {
      const url = desmosUrl(state);
      frame.src = url;
      external.href = url;
      productSelect.value = state.product;
    }

    function openLink() {
      const text = linkInput.value.trim();
      if (text === '') {
        state.graphId = '';
        status.textContent = '';
      } else {
        const parsed = parseDesmosLink(text);
        if (!parsed) {
          status.textContent = 'Enter a link such as https://www.desmos.com/calculator/abc123.';
          status.classList.add('is-error');
          return;
        }
        state.product = parsed.product;
        state.graphId = parsed.graphId;
        status.textContent = parsed.graphId ? 'Graph link saved with this tab.' : '';
      }
      status.classList.remove('is-error');
      load();
      ctx.save();
    }

    linkInput.value = state.graphId ? desmosUrl(state) : '';

    root.classList.add('tool', 'desmos-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Calculator'), productSelect),
        h('div', { class: 'field field-grow' }, linkInput),
        h('button', { class: 'btn', type: 'button', onclick: openLink }, 'Open link'),
        h(
          'button',
          {
            class: 'btn btn-quiet',
            type: 'button',
            'aria-label': 'Reload calculator',
            title: 'Reload',
            onclick: () => {
              frame.src = desmosUrl(state);
            },
          },
          icon('reset'),
        ),
        external,
      ),
      h(
        'p',
        { class: 'tool-note' },
        'Desmos does not let other sites read a graph. To keep one, use Share in Desmos, then paste the link above. Clover saves the link with this tab and in exported files.',
        ' ',
        status,
      ),
      h('div', { class: 'tool-body tool-body-flush' }, frame),
    );
    load();
    return {};
  },
};
