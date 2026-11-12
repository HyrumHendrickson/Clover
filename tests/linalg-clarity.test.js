import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};
const { App } = await import('../js/core/app.js');
const { draw2D, draw3D, legendFor, summarizePlan } = await import('../js/lib/linvizdraw.js');
const { View } = await import('../js/lib/viewport.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const COLORS = {
  bg: '#fff',
  grid: '#ddd',
  axis: '#999',
  text: '#555',
  accent: '#2a2',
  a: '#22a',
  b: '#a62',
  c: '#72a',
  ink: '#111',
};
function recorder() {
  const counts = {};
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? () => ({ width: 5 })
          : (...args) => {
              counts[key] = (counts[key] ?? 0) + 1;
              return args[0];
            },
      set: () => true,
    },
  );
  return { ctx, counts };
}

const apply2 = {
  kind: 'apply',
  dim: 2,
  A: [
    [0, -1],
    [1, 0],
  ],
  x: [2, 1],
  eigen: [],
  label: 'A*x',
};
const apply3 = {
  kind: 'apply',
  dim: 3,
  A: [
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ],
  x: [1, 1, 1],
  eigen: [{ value: 2, direction: [0, 1, 0] }],
  label: 'A*x',
};

test('A*x is drawn plainly unless details are asked for', () => {
  const view = new View({ cx: 0, cy: 0, radius: 5 }, 400, 400);
  const plain = recorder();
  const full = recorder();
  draw2D(plain.ctx, view, COLORS, apply2, 1, { detail: false });
  draw2D(full.ctx, view, COLORS, apply2, 1, { detail: true });
  assert.ok(plain.counts.stroke < full.counts.stroke, 'fewer strokes without the deformed grid');
  assert.ok(!plain.counts.setLineDash || plain.counts.setLineDash <= full.counts.setLineDash);
  assert.ok(!plain.counts.fill || plain.counts.fill < full.counts.fill + 1);
  const plain3 = recorder();
  const full3 = recorder();
  draw3D(plain3.ctx, 400, 400, COLORS, apply3, 1, { yaw: 0.6, pitch: 0.4, radius: 5, detail: false });
  draw3D(full3.ctx, 400, 400, COLORS, apply3, 1, { yaw: 0.6, pitch: 0.4, radius: 5, detail: true });
  assert.ok(plain3.counts.stroke < full3.counts.stroke);
  const vector = recorder();
  assert.doesNotThrow(() =>
    draw2D(vector.ctx, view, COLORS, { kind: 'vector', dim: 2, v: [1, 2], label: 'v' }, 1, { detail: false }),
  );
});

test('summaries are one sentence and the legend carries the numbers', () => {
  assert.equal(summarizePlan(apply2), 'Rotated 90\u00b0 counterclockwise and scaled by 1.');
  assert.equal(
    summarizePlan({
      kind: 'transform',
      dim: 2,
      A: [
        [1, 2],
        [3, 4],
      ],
      eigen: [],
    }),
    'Areas are multiplied by 2 and orientation flips.',
  );
  assert.equal(
    summarizePlan({ kind: 'vector', dim: 2, v: [0, 3], label: 'v' }),
    'Length 3, pointing 90\u00b0 from the x axis.',
  );
  assert.equal(summarizePlan({ kind: 'none', message: 'hello' }), 'hello');
  assert.deepEqual(legendFor(apply2), [
    { role: 'x', text: 'x = (2, 1)' },
    { role: 'result', text: 'A x = (-1, 2)' },
  ]);
  assert.deepEqual(legendFor({ kind: 'transform' }), []);
});

const tab = app.addTab({ type: 'matrix', state: { lines: [] } });
const panel = document.getElementById(`panel-${tab.id}`);
const q = (s) => panel.querySelector(s);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

test('an example adds a matrix, a vector, and their product, and shows the product', async () => {
  const before = tab.state.lines.length;
  click([...panel.querySelectorAll('button')].find((b) => b.textContent === 'Examples'));
  const item = [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Rotate by 90'));
  click(item);
  await tick(30);
  assert.equal(tab.state.lines.length, before + 3);
  const added = tab.state.lines.slice(-3);
  assert.equal(added[2].text, `${added[0].name}*${added[1].name}`);
  assert.match(q('.mx-caption').textContent, /Rotated 90\u00b0 counterclockwise/);
  assert.equal(q('.mx-detail').hidden, false, 'a product offers the details toggle');
  assert.match(q('.mx-legend').textContent, /x = \(2, 1\).*A x = \(-1, 2\)/);
});

test('a second example picks fresh names, and details can be switched on', async () => {
  click([...panel.querySelectorAll('button')].find((b) => b.textContent === 'Examples'));
  click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Shear')));
  await tick(30);
  const names = tab.state.lines.filter((l) => l.kind === 'matrix').map((l) => l.name);
  assert.equal(new Set(names).size, names.length, 'names stay unique');
  const box = q('.mx-detail input');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(q('.mx-caption').textContent, /Rotated|scaled/);
});

test('an example that rotates by 45 degrees evaluates exactly enough to draw', async () => {
  click([...panel.querySelectorAll('button')].find((b) => b.textContent === 'Examples'));
  click([...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('45')));
  await tick(30);
  assert.match(q('.mx-caption').textContent, /Rotated 45\u00b0 counterclockwise and scaled by 1\./);
});
