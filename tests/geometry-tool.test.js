import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, press, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};

const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { exportWorkspace, parseImport } = await import('../js/core/workspace.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const geometry = TOOLS.geometry;
const tab = app.addTab({ type: 'geometry' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (s, root = panel()) => root.querySelector(s);
const qa = (s, root = panel()) => [...root.querySelectorAll(s)];
const inputs = () => qa('.geo-input');
const settle = () => tick(220);

test('a new figure proves the medians theorem and shows exact values', async () => {
  await settle();
  assert.equal(q('.panel-error'), null);
  const verdicts = qa('.geo-verdict').map((v) => v.textContent);
  assert.deepEqual(verdicts, ['Proved']);
  assert.match(qa('.geo-value')[0].textContent, /^Point \(-4, -2\)$|^Point \(\u22124, \u22122\)$/);
  assert.ok(
    qa('.geo-value').some((v) => /Point \(3, 3\/2\)/.test(v.textContent)),
    'midpoint of BC is exact',
  );
});

test('a false claim is refuted with a counterexample, and this-figure truth is separate', async () => {
  const last = inputs().at(-1);
  type(window, last, 'parallel(line(A, B), line(A, C))');
  await settle();
  const claim = qa('.geo-claim').at(-1);
  assert.match(claim.textContent, /Not true in general/);
  assert.match(claim.textContent, /false in this figure/i);
  assert.match(claim.textContent, /Counterexample: A = \(0, 0\)/);
  assert.equal(last.getAttribute('aria-invalid'), 'false');
});

test('moving a point changes only what is true here', async () => {
  const a = inputs()[1];
  const b = inputs()[2];
  const c = inputs()[3];
  type(window, last(), 'collinear(A, B, C)');
  type(window, a, 'A = (0, 0)');
  type(window, b, 'B = (2, 2)');
  type(window, c, 'C = (4, 4)');
  await settle();
  const claim = qa('.geo-claim').at(-1);
  assert.match(claim.textContent, /It happens to be true in this figure/);
  assert.match(claim.textContent, /Not true in general/);
  type(window, c, 'C = (4, 5)');
  await settle();
  assert.match(qa('.geo-claim').at(-1).textContent, /It is false in this figure/);
});

function last() {
  return inputs().at(-1);
}

test('errors say what to fix', async () => {
  type(window, last(), 'M = midpoint(A, Z)');
  await settle();
  assert.match(qa('.geo-error').at(-1).textContent, /"Z" is not defined/);
  assert.equal(last().getAttribute('aria-invalid'), 'true');
  type(window, last(), 'M = midpoint(A)');
  await settle();
  assert.match(qa('.geo-error').at(-1).textContent, /takes 2 arguments/);
});

test('Enter adds a line, Backspace on an empty line removes it, and the Add menu inserts templates', async () => {
  const before = tab.state.rows.length;
  press(window, last(), 'Enter');
  assert.equal(tab.state.rows.length, before + 1);
  press(window, last(), 'Backspace');
  assert.equal(tab.state.rows.length, before);

  qa('button')
    .find((b) => b.textContent === 'Add')
    .click();
  const item = [...document.querySelectorAll('.menu .menu-item')].find((b) => b.textContent === 'Free point');
  item.click();
  assert.match(tab.state.rows.at(-1).text, /^G = \(0, 0\)$/, 'the next unused letter');
  assert.equal(tab.state.rows.length, before + 1);
});

test('state normalises hostile input and ids stay unique', () => {
  const state = geometry.normalize({
    rows: [
      { id: 'a', text: 'A=(0,0)' },
      { id: 'a', text: 'B=(1,1)\nC=(2,2)' },
      null,
      { text: 5 },
      { id: '../x', text: 'x'.repeat(5000) },
    ],
    snap: 'weird',
    view: 'bad',
  });
  assert.equal(state.snap, '1/2');
  assert.equal(state.rows.length, 3);
  assert.equal(new Set(state.rows.map((r) => r.id)).size, 3);
  assert.ok(state.rows.every((r) => r.text.length <= 300 && !r.text.includes('\n')));
  assert.deepEqual(geometry.normalize(state), state);
  assert.ok(geometry.normalize({}).rows.length > 5, 'an empty figure gets the starter');
});

test('a figure survives export and import', () => {
  const json = JSON.stringify(exportWorkspace({ activeId: tab.id, tabs: [tab] }));
  const restored = parseImport(json, TOOLS, () => 'id');
  assert.deepEqual(restored.tabs[0].state, geometry.normalize(tab.state));
});

test('the launcher preview draws', () => {
  const c = document.createElement('canvas');
  assert.doesNotThrow(() =>
    geometry.preview(c, { bg: '#fff', grid: '#ddd', axis: '#999', text: '#555', ink: '#111', a: '#2563eb' }),
  );
});
