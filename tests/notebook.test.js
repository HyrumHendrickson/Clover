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

const notebook = TOOLS.notebook;
const STARTER = {
  cells: [
    {
      type: 'text',
      text: '# Untitled notebook\nNotes, calculations, and graphs share one set of definitions. Write math inside text with dollar signs, like $x^2 + 1$.',
    },
    { type: 'math', row: { id: 'r1', text: 'f(x) = x^2 - 2', color: 0 } },
    { type: 'math', row: { id: 'r2', text: 'f(3)', color: 1 } },
    { type: 'graph', rows: [{ id: 'r3', text: 'y = f(x)', color: 1 }] },
  ],
};
const tab = app.addTab({ type: 'notebook', state: STARTER });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (selector, root = panel()) => root.querySelector(selector);
const qa = (selector, root = panel()) => [...root.querySelectorAll(selector)];
const cells = () => qa('.nb-cell');
const settle = () => tick(300);
const addButton = (label) => qa('.nb-toolbar button').find((b) => b.textContent === label);

test('a new notebook has notes, calculations, and a graph', async () => {
  await settle();
  assert.equal(q('.panel-error'), null);
  assert.deepEqual(
    cells().map((c) => c.className.match(/nb-(text|math|graph)/)[1]),
    ['text', 'math', 'math', 'graph'],
  );
  assert.ok(q('.nb-text-view .md h1'), 'text renders as Markdown');
  assert.ok(q('.nb-text-view .nb-math-inline .mt-sup'), 'math inside text is typeset');
});

test('math cells share definitions: f(3) uses f from the cell above', async () => {
  const value = () => qa('.gr-value', cells()[2])[0].textContent;
  assert.equal(value(), '= 7');
  const def = qa('.gr-input', cells()[1])[0];
  type(window, def, 'f(x) = x^2 + 1');
  await settle();
  assert.equal(value(), '= 10');
  assert.equal(tab.state.cells[1].row.text, 'f(x) = x^2 + 1');
});

test('the graph cell draws what its rows say, using definitions from math cells', async () => {
  const canvas = q('canvas.nb-canvas');
  assert.ok((logs.get(canvas).stroke ?? []).length > 0, 'the curve y = f(x) is stroked');
  assert.equal(qa('.gr-error', cells()[3]).filter((e) => !e.hidden).length, 0);
  const input = qa('.gr-input', cells()[3])[0];
  type(window, input, 'y = g(x)');
  document.activeElement?.blur?.();
  input.blur();
  await settle();
  assert.equal(qa('.gr-row', cells()[3])[0].dataset.kind, 'explicit', 'g is not defined, so it multiplies: y = g x');
  type(window, input, 'y = f(x) + [0, 2]');
  await settle();
  assert.equal(qa('.gr-error', cells()[3]).filter((e) => !e.hidden).length, 0, 'a list draws two curves');
});

test('a slider in a math cell moves a graph cell', async () => {
  const input = qa('.gr-input', cells()[2])[0];
  type(window, input, 'a = 1');
  await settle();
  assert.ok(
    qa('.gr-slider', cells()[2]).some((s) => !s.hidden),
    'a number becomes a slider',
  );
  const g = qa('.gr-input', cells()[3])[0];
  type(window, g, 'y = a x');
  await settle();
  const before = logs.get(q('canvas.nb-canvas')).stroke.length;
  const range = qa('input[type=range]', cells()[2])[0];
  range.value = '4';
  range.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(tab.state.cells[2].row.text, 'a = 4');
  assert.ok(logs.get(q('canvas.nb-canvas')).stroke.length > before, 'the graph redraws');
});

test('a math row that draws a curve says where to see it', async () => {
  const input = qa('.gr-input', cells()[2])[0];
  type(window, input, 'y = x^2');
  await settle();
  assert.match(q('.gr-hint', cells()[2]).textContent, /graph cell/);
});

test('Enter in a math cell adds one below, and Backspace on an empty one removes it', async () => {
  const before = tab.state.cells.length;
  const input = qa('.gr-input', cells()[1])[0];
  input.focus();
  press(window, input, 'Enter');
  assert.equal(tab.state.cells.length, before + 1);
  assert.equal(tab.state.cells[2].type, 'math');
  assert.equal(tab.state.cells[2].row.text, '');
  const fresh = qa('.gr-input', cells()[2])[0];
  press(window, fresh, 'Backspace');
  assert.equal(tab.state.cells.length, before);
  await settle();
});

test('cells can be added, moved, and deleted, and ids stay unique', async () => {
  addButton('Text').click();
  assert.equal(tab.state.cells.at(-1).type, 'text');
  assert.equal(q('.nb-text-edit', cells().at(-1)).hidden, false, 'a new note opens for writing');
  addButton('Graph').click();
  assert.equal(tab.state.cells.at(-1).type, 'graph');
  const ids = tab.state.cells.flatMap((c) => [c.id, ...(c.row ? [c.row.id] : []), ...(c.rows ?? []).map((r) => r.id)]);
  assert.equal(new Set(ids).size, ids.length, 'cell and row ids are unique');

  const last = tab.state.cells.at(-1).id;
  const up = qa('button', cells().at(-1)).find((b) => b.title === 'Move up');
  up.click();
  assert.equal(tab.state.cells.at(-2).id, last);
  const del = qa('button', cells().at(-2)).find((b) => b.title === 'Delete cell');
  const count = tab.state.cells.length;
  del.click();
  assert.equal(tab.state.cells.length, count - 1);
  await settle();
});

test('a note is edited as Markdown and shown rendered', () => {
  const view = q('.nb-text-view');
  view.click();
  const editor = q('.nb-text-edit');
  assert.equal(editor.hidden, false);
  type(window, editor, '## Plan\nTry **this** and $y = x^2$.');
  assert.equal(tab.state.cells[0].text, '## Plan\nTry **this** and $y = x^2$.');
  editor.blur();
  assert.equal(q('.nb-text-view h2').textContent, 'Plan');
  assert.equal(q('.nb-text-view strong').textContent, 'this');
  assert.equal(q('.nb-text-view .mt-sup').textContent, '2');
});

test('the last cell can be deleted, leaving an empty notebook', async () => {
  while (tab.state.cells.length > 1) {
    qa('button', cells()[0])
      .find((b) => b.title === 'Delete cell')
      .click();
  }
  qa('button', cells()[0])
    .find((b) => b.title === 'Delete cell')
    .click();
  assert.equal(tab.state.cells.length, 0, 'deleting every cell leaves an empty notebook');
  await settle();
});

test('state normalises hostile input, keeps ids unique across cells, and limits graphs', () => {
  const graph = (id) => ({
    type: 'graph',
    id,
    rows: [
      { id: 'r1', text: 'y=x' },
      { id: 'r1', text: 'y=2x' },
    ],
  });
  const state = notebook.normalize({
    cells: [
      { type: 'nope' },
      null,
      { type: 'text', id: 'a', text: 'x'.repeat(10000) },
      { type: 'math', id: 'a', row: { id: 'r1', text: 'f(x)=1' } },
      ...Array.from({ length: 14 }, (_, i) => graph(`g${i}`)),
    ],
    angle: 'weird',
  });
  assert.equal(state.angle, 'rad');
  assert.ok(state.cells[0].text.length <= 4000);
  assert.equal(state.cells.filter((c) => c.type === 'graph').length, 10);
  const cellIds = state.cells.map((c) => c.id);
  assert.equal(new Set(cellIds).size, cellIds.length);
  const rowIds = state.cells.flatMap((c) => (c.row ? [c.row.id] : (c.rows ?? []).map((r) => r.id)));
  assert.equal(new Set(rowIds).size, rowIds.length, 'row ids are unique across the whole notebook');
  assert.deepEqual(notebook.normalize(state), state);
  assert.equal(notebook.normalize({ cells: [] }).cells.length, 0, 'an empty notebook stays empty');
});

test('a notebook survives export and import', () => {
  const json = JSON.stringify(exportWorkspace({ activeId: tab.id, tabs: [tab] }));
  const restored = parseImport(json, TOOLS, () => 'id');
  assert.equal(restored.tabs[0].type, 'notebook');
  assert.deepEqual(restored.tabs[0].state, notebook.normalize(tab.state));
});

const menuItems = () => [...document.querySelectorAll('.menu .menu-item')];
const embedCells = () => cells().filter((c) => c.classList.contains('nb-embed'));

function embed(label) {
  addButton('Embed a tool').click();
  const item = menuItems().find((b) => b.textContent === label);
  assert.ok(item, `${label} is in the menu`);
  item.click();
}

// The Python tool is offered as two notebook cell types instead, so that cells can share one session.
const embeddable = () => Object.values(TOOLS).filter((t) => t.type !== 'notebook' && t.type !== 'python');

test('the embed menu offers every tool except the notebook and Python, which have their own cells', () => {
  addButton('Embed a tool').click();
  const labels = menuItems().map((b) => b.textContent);
  assert.deepEqual(
    labels,
    embeddable().map((t) => t.name),
  );
  document.body.querySelector('.menu')?.remove();
});

test('any other tool can be embedded, and edits inside it are saved with the notebook', async () => {
  embed('Linear algebra');
  const cell = tab.state.cells.at(-1);
  assert.equal(cell.type, 'embed');
  assert.equal(cell.tool, 'matrix');
  assert.ok(cell.height >= 220 && cell.height <= 1000);
  const host = q('.nb-embed-host', cells().at(-1));
  assert.ok(
    host.querySelector('.matrix-tool') || host.classList.contains('matrix-tool'),
    'the tool is mounted inside the cell',
  );
  assert.equal(q('.panel-error'), null);

  const input = qa('input.mx-cell', host)[0];
  type(window, input, '7');
  assert.equal(cell.state.lines[0].cells[0][0], '7', 'the embedded tool writes into the cell state');
  await settle();
});

test('every embeddable tool opens inside a notebook without errors', async () => {
  while (tab.state.cells.length > 1)
    qa('button', cells()[0])
      .find((b) => b.title === 'Delete cell')
      .click();
  qa('button', cells()[0])
    .find((b) => b.title === 'Delete cell')
    .click();
  const names = embeddable().map((t) => t.name);
  for (const name of names) embed(name);
  assert.equal(embedCells().length, names.length);
  assert.deepEqual(
    tab.state.cells.filter((c) => c.type === 'embed').map((c) => c.tool),
    embeddable().map((t) => t.type),
  );
  assert.equal(qa('.nb-embed-error').length, 0);
  assert.equal(qa('.nb-embed-host').length, names.length);
  await settle();
});

test('moving a cell keeps embedded tools mounted rather than resetting them', async () => {
  const hosts = qa('.nb-embed-host');
  const last = qa('button', cells().at(-1)).find((b) => b.title === 'Move up');
  last.click();
  const after = qa('.nb-embed-host');
  assert.equal(after.length, hosts.length);
  for (const host of hosts) assert.ok(after.includes(host), 'each embedded tool is the same element as before');
  await settle();
});

test('a notebook limits embedded tools and never embeds a notebook', () => {
  const matrix = (id) => ({ type: 'embed', id, tool: 'matrix', height: 300 });
  const state = notebook.normalize({
    cells: [
      { type: 'embed', id: 'n', tool: 'notebook' },
      { type: 'embed', id: 'u', tool: 'nope' },
      { type: 'embed', id: 'p', tool: '__proto__' },
      { type: 'embed', id: 'c', tool: 'constructor' },
      { type: 'embed', id: 'big', tool: 'graph', height: 1e9, state: 'garbage' },
      { type: 'embed', id: 'small', tool: 'geometry', height: -5, state: { rows: 7 } },
      ...Array.from({ length: 20 }, (_, i) => matrix(`m${i}`)),
    ],
  });
  const embeds = state.cells.filter((c) => c.type === 'embed');
  assert.equal(embeds.length, 16, 'at most sixteen embedded tools');
  assert.deepEqual(
    embeds.slice(0, 2).map((c) => [c.tool, c.height]),
    [
      ['graph', 1000],
      ['geometry', 220],
    ],
    'heights are clamped',
  );
  assert.ok(!embeds.some((c) => ['notebook', 'nope', '__proto__', 'constructor'].includes(c.tool)));
  assert.ok(embeds[0].state.rows.length > 0, 'embedded state is normalised by its own tool');
  assert.deepEqual(notebook.normalize(state), state, 'normalising twice changes nothing');
});

test('embedded tools survive export and import', () => {
  const json = JSON.stringify(exportWorkspace({ activeId: tab.id, tabs: [tab] }));
  const restored = parseImport(json, TOOLS, () => 'id');
  const kinds = (state) => state.cells.filter((c) => c.type === 'embed').map((c) => [c.tool, JSON.stringify(c.state)]);
  assert.deepEqual(kinds(restored.tabs[0].state), kinds(notebook.normalize(tab.state)));
  assert.ok(kinds(restored.tabs[0].state).length > 0);
});

test('the launcher preview draws without errors', () => {
  const c = document.createElement('canvas');
  assert.doesNotThrow(() =>
    notebook.preview(c, { bg: '#fff', grid: '#ddd', axis: '#999', text: '#555', ink: '#111', a: '#2563eb' }),
  );
});

/* Python cells: one session shared by every code and canvas cell. */

test('Python cells share one sandboxed session and show output where each cell ran', async () => {
  while (tab.state.cells.length > 0) {
    const del = qa('button', cells()[0]).find((b) => b.title === 'Delete cell');
    del.click();
    if (tab.state.cells.length === 1 && tab.state.cells[0].type !== 'embed') break;
  }
  addButton('Python').click();
  addButton('Python canvas').click();
  const kinds = tab.state.cells.map((c) => c.type);
  assert.ok(kinds.includes('code') && kinds.includes('pycanvas'));
  assert.equal(q('iframe'), null, 'no Python runs until a cell is run');

  const codeCell = tab.state.cells.find((c) => c.type === 'code');
  const canvasCell = tab.state.cells.find((c) => c.type === 'pycanvas');
  const el = (cell) => q(`[data-cell="${cell.id}"]`);
  const run = (cell) =>
    qa('button', el(cell))
      .find((b) => b.textContent.trim() === 'Run')
      .click();

  run(codeCell);
  const frame = q('iframe');
  assert.ok(frame, 'running a cell starts the session');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data, source = frame.contentWindow) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source }));
  send({ type: 'ready' });
  assert.deepEqual(posted[0], { type: 'cell', id: codeCell.id, code: codeCell.code, canvas: false });

  send({ type: 'stdout', id: codeCell.id, text: '9\n' });
  send({ type: 'stdout', id: canvasCell.id, text: 'wrong cell\n' });
  send({ type: 'stdout', id: codeCell.id, text: 'from an impostor\n' }, window);
  assert.match(q('.nb-code-output', el(codeCell)).textContent, /^9/);
  assert.doesNotMatch(el(codeCell).textContent, /impostor|wrong cell/);

  run(canvasCell);
  assert.equal(posted.length, 1, 'the second cell waits for the first to finish');
  send({ type: 'cell-done', id: codeCell.id });
  assert.equal(posted[1].canvas, true, 'canvas cells ask for turtle drawing');
  assert.equal(posted[1].id, canvasCell.id);
  send({ type: 'frame', id: canvasCell.id, dataUrl: 'javascript:alert(1)' });
  assert.equal(q('.nb-code-image', el(canvasCell)).hidden, true, 'only PNG data URLs are shown');
  send({ type: 'frame', id: canvasCell.id, dataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(q('.nb-code-image', el(canvasCell)).hidden, false);
  send({ type: 'cell-error', id: canvasCell.id, message: 'NameError: name y is not defined on line 1' });
  assert.match(q('.nb-code-output .py-error', el(canvasCell)).textContent, /NameError/);

  const restart = qa('.nb-toolbar button').find((b) => b.textContent.includes('Restart Python'));
  restart.click();
  assert.equal(q('iframe'), null, 'restarting removes the frame, which forgets every variable');
});

test('Python cells are saved with the notebook and hostile cells are cleaned', () => {
  const state = notebook.normalize({
    cells: [
      { type: 'code', id: 'a', code: 'print(1)' },
      { type: 'pycanvas', id: 'b', code: 5 },
      ...Array.from({ length: 40 }, (_, i) => ({ type: 'code', id: `x${i}`, code: 'pass' })),
    ],
  });
  assert.equal(state.cells[0].code, 'print(1)');
  assert.equal(state.cells[1].code, '');
  assert.equal(state.cells.filter((c) => c.type === 'code' || c.type === 'pycanvas').length, 30);
  assert.deepEqual(notebook.normalize(state), state);
});
