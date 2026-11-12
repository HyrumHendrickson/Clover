import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, press, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;

const contexts = new WeakMap();
const logs = new WeakMap();
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  if (!contexts.has(this)) {
    const log = {};
    const target = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }),
      measureText: () => ({ width: 40 }),
    };
    logs.set(this, log);
    contexts.set(
      this,
      new Proxy(target, {
        get: (obj, key) => (key in obj ? obj[key] : (...args) => ((log[key] ??= []).push(args), undefined)),
        set: () => true,
      }),
    );
  }
  return contexts.get(this);
};
window.HTMLElement.prototype.setPointerCapture = () => {};

const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { parseImport, exportWorkspace } = await import('../js/core/workspace.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const graph3d = TOOLS.graph3d;
const tab = app.addTab({ type: 'graph3d' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (selector) => panel().querySelector(selector);
const qa = (selector) => [...panel().querySelectorAll(selector)];
const inputs = () => qa('.gr-input');
const canvas = () => q('canvas.g3-canvas');
const settle = () => tick(300);
const count = (name) => (logs.get(canvas())?.[name] ?? []).length;
const button = (label) => qa('button').find((b) => b.getAttribute('aria-label') === label);

async function enter(index, text) {
  type(window, inputs()[index], text);
  await settle();
}

test('a new 3D graph starts with an example surface and draws the cube and axes', async () => {
  await settle();
  assert.equal(q('.panel-error'), null);
  assert.equal(tab.state.rows.length, 1);
  assert.equal(inputs()[0].value, 'z = sin(x) * cos(y)');
  assert.ok(count('fill') > 100, 'the surface is drawn as triangles');
  const labels = (logs.get(canvas()).fillText ?? []).map(([text]) => text);
  assert.ok(labels.includes('x') && labels.includes('y') && labels.includes('z'));
});

test('rows show typeset math, with a raw field only while editing', async () => {
  const field = q('.mf');
  assert.ok(field.querySelector('.mf-display .mt'), 'typeset form is present');
  await enter(0, 'z = x^2 + y^2');
  assert.equal(q('.mf-display .mt-sup').textContent, '2');
  assert.equal(tab.state.rows[0].text, 'z = x^2 + y^2');
});

test('typing a Greek name turns it into the letter', async () => {
  const input = inputs()[0];
  type(window, input, 'z = sin(x) + theta');
  assert.equal(input.value, 'z = sin(x) + \u03b8');
  assert.equal(tab.state.rows[0].text, 'z = sin(x) + \u03b8');
  await settle();
  assert.match(q('.gr-error').textContent, /2D graph/, 'theta is for polar graphs, so the 3D graph explains');
  await enter(0, 'z = x^2 + y^2');
});

test('each kind of 3D row is accepted, and what is not drawable explains why', async () => {
  const add = button('Add expression') ?? qa('button').find((b) => b.textContent.includes('Add expression'));
  const texts = [
    'x^2 + y^2 + z^2 = 4',
    '(cos(t), sin(t), t/4) {0 <= t <= 12}',
    '(u cos(v), u sin(v), u) {0 <= u <= 2, 0 <= v <= 2pi}',
    '(1, 2, 3)',
    'f(x, y) = x y / 5',
    'z > x',
  ];
  for (const text of texts) {
    add.click();
    await tick(5);
    type(window, inputs().at(-1), text);
  }
  document.activeElement.blur(); // errors are held back while a row is being typed in
  await settle();
  const errors = qa('.gr-row').map((row) => row.querySelector('.gr-error').hidden);
  assert.deepEqual(errors, [true, true, true, true, true, true, false], 'only the inequality is an error');
  assert.match(qa('.gr-error').find((e) => !e.hidden).textContent, /not supported in 3D/);
  assert.equal(qa('.gr-row').at(-1).dataset.kind, 'error');
});

test('a list in a surface and a slider both work', async () => {
  const add = qa('button').find((b) => b.textContent.includes('Add expression'));
  add.click();
  await tick(5);
  type(window, inputs().at(-1), 'z = [1, 2]a x / 5');
  await settle();
  const row = qa('.gr-row').at(-1);
  assert.equal(row.querySelector('.gr-add-slider').hidden, false);
  row.querySelector('.gr-add-slider').click();
  await settle();
  const slider = qa('.gr-slider').find((s) => !s.hidden);
  assert.ok(slider, 'a slider for a appears');
  const range = slider.querySelector('input[type=range]');
  range.value = '3';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(
    tab.state.rows.find((r) => /^a = /.test(r.text)).text,
    'a = 3',
    'the slider writes its value into the row',
  );
});

test('dragging orbits, shift-dragging pans, the wheel zooms, and keys steer', async () => {
  const el = canvas();
  const before = { ...tab.state.camera };
  const pointer = (type, init) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, ...init }));
  pointer('pointerdown', { clientX: 100, clientY: 100 });
  pointer('pointermove', { clientX: 160, clientY: 130 });
  pointer('pointerup', { clientX: 160, clientY: 130 });
  assert.notEqual(tab.state.camera.yaw, before.yaw);
  assert.notEqual(tab.state.camera.pitch, before.pitch);

  const panX = tab.state.camera.panX;
  pointer('pointerdown', { clientX: 100, clientY: 100, shiftKey: true });
  pointer('pointermove', { clientX: 140, clientY: 100 });
  pointer('pointerup', { clientX: 140, clientY: 100 });
  assert.notEqual(tab.state.camera.panX, panX);

  const zoom = tab.state.camera.zoom;
  el.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }));
  assert.ok(tab.state.camera.zoom > zoom);
  press(window, el, '-');
  assert.ok(tab.state.camera.zoom < zoom * 1.5);

  press(window, el, '0');
  assert.equal(tab.state.camera.yaw, 0.65);
  assert.equal(tab.state.camera.zoom, 1);
  await settle();
});

test('preset views and the perspective switch change the camera', () => {
  const preset = q('.g3-preset');
  preset.value = 'top';
  preset.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.ok(tab.state.camera.pitch > 1.5);
  const perspective = qa('.gr-settings input[type=checkbox]').find(
    (box) => box.parentElement.textContent === 'Perspective',
  );
  perspective.checked = false;
  perspective.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.camera.perspective, false);
});

test('the window can be changed, and bad bounds are refused', async () => {
  button('3D graph settings').click();
  const [xmin, xmax] = qa('.g3-bounds input');
  type(window, xmin, '-2');
  xmax.value = '2pi';
  press(window, xmax, 'Enter');
  assert.deepEqual(tab.state.bounds.slice(0, 2), [-2, 2 * Math.PI]);
  xmax.value = '-9';
  press(window, xmax, 'Enter');
  assert.deepEqual(tab.state.bounds.slice(0, 2), [-2, 2 * Math.PI], 'an invalid window is not applied');
  assert.ok(document.querySelector('.toast'));
  xmax.value = '5';
  xmin.value = '-5';
  press(window, xmax, 'Enter');
  await settle();
});

test('state normalises hostile input and round-trips through export', () => {
  const state = graph3d.normalize({
    rows: [{ id: '../x', text: 5, color: 99 }, { id: 'a', text: 'z=x' }, { id: 'a', text: 'z=y' }, null],
    camera: { yaw: 'a', pitch: 50, zoom: 0 },
    bounds: [1, 1, 0, 0, 'a'],
    grid: 'no',
  });
  assert.equal(state.rows.length, 3);
  assert.equal(new Set(state.rows.map((r) => r.id)).size, 3, 'ids stay unique');
  assert.ok(state.rows.every((r) => typeof r.text === 'string' && r.color >= 0 && r.color < 6));
  assert.deepEqual(state.bounds, [-5, 5, -5, 5, -5, 5]);
  assert.ok(state.camera.pitch < 1.6 && state.camera.zoom > 0);
  assert.deepEqual(graph3d.normalize(state), state);
  const json = JSON.stringify(exportWorkspace({ activeId: tab.id, tabs: [tab] }));
  const restored = parseImport(json, TOOLS, () => 'id');
  assert.equal(restored.tabs[0].type, 'graph3d');
  assert.deepEqual(restored.tabs[0].state.bounds, tab.state.bounds);
  assert.equal(restored.tabs[0].state.rows[0].text, tab.state.rows[0].text);
});

test('the launcher preview draws without errors', () => {
  const c = document.createElement('canvas');
  assert.doesNotThrow(() =>
    graph3d.preview(c, { bg: '#fff', grid: '#ddd', axis: '#999', text: '#555', ink: '#111', a: '#2563eb' }),
  );
});

test('the 3D view buttons form one stack, the preset sits on the graph, and the sidebar can be hidden', () => {
  const labels = qa('.gr-tools button').map((b) => b.getAttribute('aria-label'));
  assert.equal(labels[0], '3D graph settings');
  assert.ok(labels.includes('Zoom in') && labels.includes('Reset view'));
  assert.equal(qa('.gr-tools select').length, 0, 'the preset is not in the stack');
  assert.ok(q('.g3-views select[aria-label="Preset view"]'));
  const layout = q('.graph-layout');
  q('.gr-sidebar-toggle').click();
  assert.equal(layout.classList.contains('is-collapsed'), true);
  q('.gr-sidebar-toggle').click();
  assert.equal(layout.classList.contains('is-collapsed'), false);
});
