import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, press, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;

// Record drawing calls per canvas so rendering can be asserted.
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
const { parseImport } = await import('../js/core/workspace.js');
const { store } = await import('../js/core/store.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const graph = TOOLS.graph;
const tab = app.addTab({ type: 'graph' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (selector) => panel().querySelector(selector);
const qa = (selector) => [...panel().querySelectorAll(selector)];
const inputs = () => qa('.gr-input');
const settle = () => tick(260);
const button = (label) => qa('button').find((b) => b.getAttribute('aria-label') === label);
const canvases = () => [q('canvas.plot-canvas:not(.plot-passive)'), q('canvas.plot-passive')];
const count = (canvas, name) => (logs.get(canvas)?.[name] ?? []).length;

async function enter(index, text) {
  type(window, inputs()[index], text);
  await settle();
}

test('a new graph starts with one empty row and draws the grid', async () => {
  assert.equal(inputs().length, 1);
  assert.equal(tab.state.rows.length, 1);
  assert.equal(q('.gr-panel').getAttribute('aria-label'), 'Expressions');
  await settle();
  const [base] = canvases();
  assert.ok(count(base, 'fillRect') > 0, 'the background is painted');
  assert.ok(count(base, 'stroke') > 0, 'grid lines are stroked');
});

test('typing an expression plots it and saves it', async () => {
  const [base] = canvases();
  const before = count(base, 'stroke');
  await enter(0, 'y = x^2');
  assert.equal(tab.state.rows[0].text, 'y = x^2');
  assert.equal(q('.gr-error').hidden, true);
  assert.equal(q('.gr-row').dataset.kind, 'explicit');
  assert.ok(count(base, 'stroke') > before, 'the curve is stroked');
  assert.equal(q('.gr-dot').disabled, false);
});

test('bad input shows a specific error, and fixing it clears the error', async () => {
  await enter(0, 'y = sin(');
  assert.match(q('.gr-error').textContent, /ended unexpectedly/);
  assert.equal(inputs()[0].getAttribute('aria-invalid'), 'true');
  assert.equal(q('.gr-row').dataset.kind, 'error');
  await enter(0, 'y = sin(x)');
  assert.equal(q('.gr-error').hidden, true);
  assert.equal(inputs()[0].hasAttribute('aria-invalid'), false);
});

test('Enter adds a row, arrows move between rows, Backspace on an empty row removes it', async () => {
  press(window, inputs()[0], 'Enter');
  assert.equal(inputs().length, 2);
  assert.equal(document.activeElement, inputs()[1]);
  assert.equal(tab.state.rows.length, 2);
  press(window, inputs()[1], 'ArrowUp');
  assert.equal(document.activeElement, inputs()[0]);
  press(window, inputs()[0], 'ArrowDown');
  assert.equal(document.activeElement, inputs()[1]);
  press(window, inputs()[1], 'Backspace');
  assert.equal(inputs().length, 1);
  assert.equal(document.activeElement, inputs()[0]);
  press(window, inputs()[0], 'Backspace');
  assert.equal(inputs().length, 1, 'the last row is never removed by Backspace');
});

test('a number becomes a slider that drives other rows', async () => {
  press(window, inputs()[0], 'Enter');
  await enter(1, 'a = 1');
  assert.equal(qa('.gr-slider')[1].hidden, false);
  assert.equal(qa('.gr-slider')[0].hidden, true);
  press(window, inputs()[1], 'Enter');
  await enter(2, 'y = a * x');
  const range = qa('.gr-range')[1];
  assert.equal(range.min, '-10');
  assert.equal(range.max, '10');
  range.value = '3';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(inputs()[1].value, 'a = 3');
  assert.equal(tab.state.rows[1].text, 'a = 3');
  const rowValue = (i) => qa('.gr-row')[i].querySelector('.gr-value');
  assert.equal(rowValue(1).hidden, true, 'a slider shows its control, not its value');
  assert.equal(qa('.gr-row')[2].querySelector('.gr-error').hidden, true);
});

test('slider limits can be edited and invalid limits are explained', async () => {
  const min = qa('.gr-slider')[1].querySelector('.gr-bound');
  min.value = '0';
  min.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.rows[1].min, '0');
  assert.equal(qa('.gr-range')[1].min, '0');
  min.value = '50';
  min.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(qa('.gr-error')[1].textContent, /minimum must be below/);
  min.value = '';
  min.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.rows[1].min, '');
});

test('the play button animates a slider and stops again', async () => {
  const play = qa('.gr-play')[1];
  play.click();
  assert.equal(play.getAttribute('aria-pressed'), 'true');
  const start = tab.state.rows[1].text;
  await tick(150);
  play.click();
  assert.equal(play.getAttribute('aria-pressed'), 'false');
  const stopped = tab.state.rows[1].text;
  await tick(120);
  assert.equal(tab.state.rows[1].text, stopped, 'no movement after stopping');
  assert.match(start, /^a = /);
});

test('undefined letters offer sliders that insert definitions above', async () => {
  press(window, inputs()[2], 'Enter');
  await enter(3, 'y = b*x + c');
  const add = qa('.gr-add-slider')[3];
  assert.equal(add.hidden, false);
  assert.match(add.textContent, /Add sliders for b, c/);
  const rows = tab.state.rows.length;
  add.click();
  assert.equal(tab.state.rows.length, rows + 2);
  assert.deepEqual(
    tab.state.rows.slice(3, 5).map((r) => r.text),
    ['b = 1', 'c = 1'],
  );
  await settle();
  assert.equal(qa('.gr-add-slider').filter((b) => !b.hidden).length, 0);
});

test('rows can be hidden, recoloured and deleted', async () => {
  const row = tab.state.rows[0];
  const dot = qa('.gr-dot')[0];
  dot.click();
  assert.equal(row.hidden, true);
  assert.equal(dot.getAttribute('aria-pressed'), 'false');
  dot.click();
  assert.equal(row.hidden, false);
  const color = row.color;
  button('Change colour of expression 1').click();
  assert.equal(row.color, (color + 1) % 6);
  const before = tab.state.rows.length;
  button('Delete expression 1').click();
  assert.equal(tab.state.rows.length, before - 1);
});

test('notes are stored but not graphed', async () => {
  const add = qa('button').find((b) => b.textContent === 'Add note');
  add.click();
  const note = tab.state.rows.at(-1);
  assert.equal(note.kind, 'note');
  type(window, inputs().at(-1), 'y = x is just text here');
  assert.equal(note.text, 'y = x is just text here');
  await settle();
  assert.equal(qa('.gr-row').at(-1).dataset.kind, 'note');
});

test('derived values are shown for expressions without x or y', async () => {
  qa('button')
    .find((b) => b.textContent.includes('Add expression'))
    .click();
  await enter(inputs().length - 1, 'total([1...10])');
  const rows = qa('.gr-row');
  assert.equal(rows.at(-1).querySelector('.gr-value').textContent, '= 55');
});

test('settings change the saved state and the angle unit', async () => {
  const toggle = button('Graph settings');
  assert.equal(q('.gr-settings').hidden, true);
  toggle.click();
  assert.equal(q('.gr-settings').hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const [grid] = qa('.gr-settings input[type=checkbox]');
  grid.checked = false;
  grid.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.grid, false);
  grid.checked = true;
  grid.dispatchEvent(new window.Event('change', { bubbles: true }));

  const last = inputs().length - 1;
  await enter(last, 'sin(90)');
  const valueOf = () => qa('.gr-value').at(-1).textContent;
  assert.equal(valueOf(), '= 0.8939966636');
  const angle = q('select[aria-label="Angle unit"]');
  angle.value = 'deg';
  angle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.angle, 'deg');
  assert.equal(valueOf(), '= 1');
  press(window, q('.gr-settings'), 'Escape');
  assert.equal(q('.gr-settings').hidden, true);
});

test('the window can be set exactly, and rejects an empty one', async () => {
  if (q('.gr-settings').hidden) button('Graph settings').click();
  const [xmin, xmax, ymin, ymax] = ['x minimum', 'x maximum', 'y minimum', 'y maximum'].map((l) =>
    q(`input[aria-label="${l}"]`),
  );
  xmin.value = '0';
  xmax.value = '2pi';
  ymin.value = '-2';
  ymax.value = '2';
  qa('button')
    .find((b) => b.textContent === 'Apply')
    .click();
  assert.ok(Math.abs(tab.state.view.xspan - 2 * Math.PI) < 1e-9);
  assert.equal(tab.state.view.yspan, 4);
  xmax.value = '-1';
  qa('button')
    .find((b) => b.textContent === 'Apply')
    .click();
  assert.equal(xmax.getAttribute('aria-invalid'), 'true');
  assert.ok(Math.abs(tab.state.view.xspan - 2 * Math.PI) < 1e-9, 'the view is unchanged');
});

test('zoom, reset and square buttons update the saved view', () => {
  const span = tab.state.view.xspan;
  button('Zoom in').click();
  assert.ok(tab.state.view.xspan < span);
  button('Zoom out').click();
  assert.ok(Math.abs(tab.state.view.xspan - span) < 1e-9);
  button('Reset view').click();
  assert.equal(tab.state.view.xspan, 960 / 48, 'back to a square 20-unit-wide window scaled to the canvas');
  button('Make axes square').click();
  assert.ok(Math.abs(tab.state.view.xspan / tab.state.view.yspan - 960 / 640) < 1e-9);
});

test('clicking a curve selects it and finds its points of interest', async () => {
  await enter(0, 'y = x^2 - 4');
  button('Reset view').click();
  await settle();
  const [base, overlay] = canvases();
  const fire = (type, x, y) => {
    const event = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    base.dispatchEvent(event);
  };
  // 960x640 canvas, 48 px per unit: the point (2, 0) is at (576, 320).
  const arcs = count(overlay, 'arc');
  fire('pointerdown', 576, 320);
  fire('pointerup', 576, 320);
  assert.ok(qa('.gr-row')[0].classList.contains('is-selected'));
  await tick(300);
  assert.ok(count(overlay, 'arc') > arcs, 'intercept and minimum dots are drawn on the overlay');
  fire('pointerdown', 100, 100);
  fire('pointerup', 100, 100);
  assert.equal(qa('.gr-row')[0].classList.contains('is-selected'), false);
});

test('rows are capped and the user is told', async () => {
  while (tab.state.rows.length < 60) {
    qa('button')
      .find((b) => b.textContent.includes('Add expression'))
      .click();
  }
  qa('button')
    .find((b) => b.textContent.includes('Add expression'))
    .click();
  assert.equal(tab.state.rows.length, 60);
  assert.ok(document.querySelector('.toast'), 'a message explains why nothing was added');
});

test('state survives a save and reload', () => {
  app.persistNow();
  const saved = store.loadWorkspace();
  const entry = saved.tabs.find((t) => t.id === tab.id);
  const restored = graph.normalize(JSON.parse(JSON.stringify(entry.state)));
  assert.deepEqual(restored, tab.state);
});

/* ------------------------------------------------------------ normalisation */

test('hostile state is repaired, bounded and idempotent', () => {
  const hostile = [
    null,
    undefined,
    7,
    'x',
    [],
    {},
    { rows: 'no' },
    { rows: [null, 4, 'a', {}, { id: '../x', text: 5, color: 99, hidden: 'yes', min: {}, tmax: 'x'.repeat(100) }] },
    { rows: Array.from({ length: 500 }, () => ({ id: 'same', text: 'y=x\nz'.repeat(300) })) },
    { rows: [{ id: 'r1' }, { id: 'r1' }, { id: 'r2' }, {}], view: { cx: 'a', xspan: -1 }, angle: 'turns', grid: 0 },
  ];
  for (const raw of hostile) {
    const state = graph.normalize(raw);
    assert.ok(state.rows.length >= 1 && state.rows.length <= 60);
    assert.equal(new Set(state.rows.map((r) => r.id)).size, state.rows.length, 'ids are unique');
    for (const row of state.rows) {
      assert.match(row.id, /^[A-Za-z0-9_-]{1,24}$/);
      assert.ok(row.text.length <= 500 && !/[\r\n]/.test(row.text));
      assert.ok(row.color >= 0 && row.color < 6);
      assert.ok(row.tmax.length <= 40);
    }
    assert.ok(['rad', 'deg'].includes(state.angle));
    assert.deepEqual(graph.normalize(state), state, 'normalize is idempotent');
  }
  assert.equal(graph.normalize({ rows: [{ id: 'r1' }, { id: 'r1' }] }).rows[1].id, 'r2');
});

/* ---------------------------------------------------------------- migration */

test('Desmos tabs from format version 1 become graphs and keep their link as a note', () => {
  const file = (graphId) =>
    JSON.stringify({
      format: 'clover',
      version: 1,
      kind: 'tab',
      tab: { type: 'desmos', title: 'Desmos', state: { product: 'calculator', graphId } },
    });
  const withLink = parseImport(file('abc123xyz'), TOOLS, () => 'id').tab;
  assert.equal(withLink.type, 'graph');
  assert.equal(withLink.title, 'Graphing', 'the old default title is replaced');
  assert.equal(withLink.state.rows[0].kind, 'note');
  assert.match(withLink.state.rows[0].text, /desmos\.com\/calculator\/abc123xyz$/);
  assert.equal(withLink.state.rows[1].text, '');
  const noLink = parseImport(file(''), TOOLS, () => 'id').tab;
  assert.equal(noLink.state.rows.length, 1);
  assert.equal(noLink.state.rows[0].text, '');
  const hostile = parseImport(file('"><script>alert(1)</script>'), TOOLS, () => 'id').tab;
  assert.equal(hostile.state.rows.length, 1, 'an invalid id is dropped, not copied');
  const renamed = JSON.parse(file('abc'));
  renamed.tab.title = 'My graph';
  assert.equal(parseImport(JSON.stringify(renamed), TOOLS, () => 'id').tab.title, 'My graph');
  assert.throws(() => parseImport(file('x').replace('"version":1', '"version":5'), TOOLS, () => 'id'), /newer version/);
});
