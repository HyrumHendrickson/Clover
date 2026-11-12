import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, press, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;

const { App } = await import('../js/core/app.js');
const { TOOL_LIST, TOOLS } = await import('../js/tools/index.js');
const { exportWorkspace, parseImport } = await import('../js/core/workspace.js');
const { store } = await import('../js/core/store.js');

const app = new App(elements);
app.init();

after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const panel = () => document.getElementById(`panel-${app.activeId}`);
const q = (selector, root = panel()) => root.querySelector(selector);
const qa = (selector, root = panel()) => [...root.querySelectorAll(selector)];

test('first run shows the launcher with one card per tool', () => {
  assert.equal(app.tabs.length, 0);
  assert.equal(elements.launcher.hidden, false);
  assert.equal(elements.launcher.querySelectorAll('.launch-card').length, TOOL_LIST.length);
  assert.equal(TOOL_LIST.length, 9);
});

test('every tool opens without errors, including two of the same kind', async () => {
  for (const tool of TOOL_LIST) {
    const tab = app.addTab({ type: tool.type });
    assert.ok(tab, `${tool.type} should open`);
    assert.equal(app.activeId, tab.id);
    assert.equal(panel().hidden, false);
    assert.equal(q('.panel-error'), null, `${tool.type} reported a mount error`);
    assert.ok(panel().children.length > 0);
  }
  await tick(60);
  assert.equal(app.tabs.length, TOOL_LIST.length);
  assert.equal(elements.launcher.hidden, true);

  const first = app.addTab({ type: 'matrix' });
  const second = app.addTab({ type: 'matrix' });
  assert.notEqual(first.title, second.title);
  assert.notEqual(first.id, second.id);
  assert.equal(app.tabs.filter((t) => t.type === 'matrix').length, 3);
  app.closeTab(first.id, { undo: false });
  app.closeTab(second.id, { undo: false });
  assert.equal(app.tabs.length, TOOL_LIST.length);
});

test('tab strip exposes tablist semantics and only one tab is selected', () => {
  const tabs = qa('[role=tab]', elements.tablist);
  assert.equal(tabs.length, TOOL_LIST.length);
  assert.equal(tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length, 1);
  assert.equal(tabs.filter((t) => t.tabIndex === 0).length, 1);
  const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  assert.equal(document.getElementById(selected.getAttribute('aria-controls')).getAttribute('role'), 'tabpanel');
});

test('switching tabs shows exactly one panel', () => {
  for (const tab of app.tabs) {
    app.activate(tab.id);
    const visible = [...elements.panels.querySelectorAll('.panel')].filter((p) => !p.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, `panel-${tab.id}`);
  }
});

test('keyboard navigation moves between tabs', () => {
  app.activate(app.tabs[0].id);
  const el = elements.tablist.querySelector('[aria-selected=true]');
  press(window, el, 'ArrowRight');
  assert.equal(app.activeId, app.tabs[1].id);
  press(window, elements.tablist.querySelector('[aria-selected=true]'), 'End');
  assert.equal(app.activeId, app.tabs.at(-1).id);
  press(window, elements.tablist.querySelector('[aria-selected=true]'), 'Home');
  assert.equal(app.activeId, app.tabs[0].id);
});

test('rename, duplicate, reorder, close and undo', () => {
  const tab = app.tabs.find((t) => t.type === 'complex');
  app.activate(tab.id);
  app.renameTab(tab.id);
  const input = elements.tablist.querySelector('.tab-rename');
  assert.ok(input);
  input.value = '  My function  ';
  press(window, input, 'Enter');
  assert.equal(tab.title, 'My function');
  assert.match(document.title, /My function/);

  app.duplicateTab(tab.id);
  const copyIndex = app.tabs.findIndex((t) => t.id === tab.id) + 1;
  const copy = app.tabs[copyIndex];
  assert.equal(copy.type, 'complex');
  assert.deepEqual(copy.state, tab.state);
  assert.notEqual(copy.state, tab.state, 'state must be cloned, not shared');

  app.moveTab(copy.id, 0);
  assert.equal(app.tabs[0].id, copy.id);

  const before = app.tabs.length;
  app.closeTab(copy.id);
  assert.equal(app.tabs.length, before - 1);
  const undo = document.querySelector('.toast-action');
  assert.ok(undo, 'closing offers undo');
  undo.click();
  assert.equal(app.tabs.length, before);
});

test('tab limit is enforced', () => {
  const extras = [];
  while (app.tabs.length < 24) extras.push(app.addTab({ type: 'graph' }, { activate: false }));
  assert.equal(app.addTab({ type: 'graph' }), null);
  assert.equal(app.tabs.length, 24);
  for (const tab of extras) app.closeTab(tab.id, { undo: false });
  assert.equal(app.tabs.length, TOOL_LIST.length + 1);
});

const MINUS = '\u2212';
const entries = (root) => qa('.mx-entry', root).map((e) => e.textContent);

test('matrix tool defines matrices and calculates with them on later lines', async () => {
  const tab = app.tabs.find((t) => t.type === 'matrix');
  app.activate(tab.id);
  await tick(160);
  const results = qa('.mx-result');
  assert.deepEqual(entries(results[0]), ['3', '0', '2', '4'], 'A+B, with A=[[2,1],[1,3]] and B=[[1,-1],[1,1]]');
  assert.deepEqual(entries(results[1]), ['3', `${MINUS}1`, '4', '2'], 'A*B');

  const cell = qa('input.mx-cell')[0];
  type(window, cell, '1/2');
  assert.equal(tab.state.lines[0].cells[0][0], '1/2');
  await tick(160);
  const product = qa('.mx-result')[1];
  assert.equal(
    qa('.mx-entry', product)[0].querySelectorAll('.mt-frac').length,
    1,
    'the entry 3/2 stays an exact fraction',
  );
  assert.equal(qa('.mx-entry .mt-num', product)[0].textContent, '3');

  type(window, cell, 'oops');
  await tick(160);
  assert.equal(cell.getAttribute('aria-invalid'), 'true');
  assert.match(q('.mx-matrix .mx-error').textContent, /cannot be read/);
  assert.match(qa('.mx-result .mx-error')[0].textContent, /A has an entry that cannot be read/);
  type(window, cell, '2');
  await tick(160);
  assert.equal(cell.getAttribute('aria-invalid'), 'false');
});

test('matrix tool reports dimension errors in plain words and can name results', async () => {
  const tab = app.tabs.find((t) => t.type === 'matrix');
  app.activate(tab.id);
  const field = qa('.mf-input')[0];
  type(window, field, 'A+[1,2,3]');
  await tick(160);
  assert.match(qa('.mx-result .mx-error')[0].textContent, /Cannot add a 2\u00d72 matrix and a 3\u00d71 matrix/);
  type(window, field, 'C = A*B');
  await tick(160);
  assert.equal(tab.state.lines[2].text, 'C = A*B');
  type(window, field, 'A+B');
  await tick(160);
});

test('typing matrix or vector on a line makes a grid, and its size can be set', async () => {
  const tab = app.tabs.find((t) => t.type === 'matrix');
  app.activate(tab.id);
  const before = tab.state.lines.length;
  const field = qa('.mf-input').at(-1);
  type(window, field, 'matrix');
  const made = tab.state.lines.at(-1);
  assert.equal(tab.state.lines.length, before, 'the typed line became the matrix');
  assert.equal(made.kind, 'matrix');
  assert.equal(made.name, 'C', 'the next free letter after A and B');
  assert.equal(made.cells.length, 2);

  const [r, c] = qa('.mx-size', qa('.mx-matrix').at(-1));
  assert.ok(r && c, 'rows and columns can be set');
  r.value = '3';
  r.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.lines.at(-1).cells.length, 3);
  const [, c2] = qa('.mx-size', qa('.mx-matrix').at(-1));
  c2.value = '4';
  c2.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(tab.state.lines.at(-1).cells[0].length, 4);
  assert.equal(qa('input.mx-cell', qa('.mx-matrix').at(-1)).length, 12, 'a 3 by 4 grid');

  const add = qa('button', panel()).find((b) => b.textContent === 'Vector');
  add.click();
  const vector = tab.state.lines.at(-1);
  assert.equal(vector.name, 'u');
  assert.deepEqual([vector.cells.length, vector.cells[0].length], [3, 1]);
  await tick(160);
});

test('matrix tool state survives a round trip and upgrades the old layout', () => {
  const tab = app.tabs.find((t) => t.type === 'matrix');
  const json = JSON.stringify(exportWorkspace({ activeId: tab.id, tabs: [tab] }));
  const restored = parseImport(json, TOOLS, () => 'x');
  assert.deepEqual(restored.tabs[0].state, TOOLS.matrix.normalize(tab.state));

  const old = TOOLS.matrix.normalize({
    mode: 'mv',
    m: 2,
    n: 2,
    p: 2,
    A: [
      ['2', '1'],
      ['1', '3'],
    ],
    x: ['1', '1'],
    view: { cx: 0, cy: 0, radius: 7 },
  });
  assert.deepEqual(
    old.lines.map((l) => (l.kind === 'matrix' ? l.name : l.text)),
    ['A', 'x', 'A*x'],
  );
  assert.deepEqual(old.lines[1].cells, [['1'], ['1']]);
});

test('complex tool compiles, reports errors, and keeps the last good function', async () => {
  const tab = app.tabs.find((t) => t.type === 'complex');
  app.activate(tab.id);
  const input = q('input');
  type(window, input, 'z^3 - 1');
  press(window, input, 'Enter');
  assert.equal(tab.state.expr, 'z^3 - 1');
  type(window, input, 'sin(');
  press(window, input, 'Enter');
  assert.ok(q('.field-status').textContent.length > 0);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(tab.state.expr, 'z^3 - 1', 'invalid input must not replace the saved expression');
  press(window, input, 'Enter');
  type(window, input, 'gamma(z)');
  press(window, input, 'Enter');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  await tick(80);
  const preset = qa('.chip').find((c) => c.textContent === 'sin z');
  preset.click();
  assert.equal(tab.state.expr, 'sin(z)');
});

test('vector field tool validates both components', async () => {
  const tab = app.tabs.find((t) => t.type === 'vector');
  app.activate(tab.id);
  const [p, qInput] = qa('input[type=text]');
  type(window, p, 'x +');
  press(window, p, 'Enter');
  assert.match(q('.field-status').textContent, /^P:/);
  type(window, p, 'y');
  type(window, qInput, 'nope(1)');
  press(window, qInput, 'Enter');
  assert.match(q('.field-status').textContent, /^Q:/);
  type(window, qInput, '-x');
  press(window, qInput, 'Enter');
  assert.equal(tab.state.p, 'y');
  assert.equal(tab.state.q, '-x');
  await tick(80);
  qa('.chip')
    .find((c) => c.textContent === 'Saddle')
    .click();
  assert.equal(tab.state.p, 'x');
  assert.equal(tab.state.q, '-y');
  assert.deepEqual(tab.state.seeds, []);
});

test('python tool runs code in a sandboxed iframe and validates messages', async () => {
  const tab = app.tabs.find((t) => t.type === 'python');
  app.activate(tab.id);
  assert.equal(qa('.chip').length, 9);
  assert.equal(q('iframe'), null, 'nothing runs until the user presses Run');

  const editor = q('textarea');
  type(window, editor, 'import turtle\nprint("hi")\n');
  assert.equal(tab.state.code, 'import turtle\nprint("hi")\n');
  assert.ok(q('.tok-keyword'), 'syntax highlighting is applied');
  assert.match(q('.py-gutter').textContent, /1\n2\n3/);

  const run = qa('button').find((b) => b.textContent.trim() === 'Run');
  run.click();
  const frame = q('iframe');
  assert.ok(frame, 'Run creates the runner frame');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts', 'runner must not get allow-same-origin');
  assert.match(frame.getAttribute('src'), /runner\/index\.html$/);

  const posted = [];
  frame.contentWindow.postMessage = (message) => posted.push(message);
  const send = (data, source = frame.contentWindow) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source }));

  send({ type: 'stdout', text: 'ignored before ready?' });
  send({ type: 'ready' });
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0], { type: 'run', code: 'import turtle\nprint("hi")\n' });

  send({ type: 'stdout', text: 'hello\n' });
  send({ type: 'error', message: 'NameError: name x is not defined on line 1' });
  assert.match(q('.py-console').textContent, /hello/);
  assert.match(q('.py-console .py-error').textContent, /NameError/);

  send({ type: 'stdout', text: 'from an impostor' }, window);
  assert.doesNotMatch(q('.py-console').textContent, /impostor/);
  send({ type: 'snapshot', dataUrl: 'javascript:alert(1)' });

  const stop = qa('button').find((b) => b.textContent.trim() === 'Stop');
  run.click();
  assert.ok(!stop.disabled);
  stop.click();
  assert.equal(q('iframe'), null, 'Stop removes the runner frame');
  assert.match(q('.py-console').textContent, /Stopped/);
});

test('workspace persists and restores across page loads', () => {
  app.persistNow();
  const saved = store.loadWorkspace();
  assert.equal(saved.tabs.length, app.tabs.length);
  assert.deepEqual(
    saved.tabs.map((t) => t.type),
    app.tabs.map((t) => t.type),
  );
  assert.ok(saved.tabs.every((t) => t.state && typeof t.title === 'string'));
});

test('importing a file adds a tab and rejects bad files with a message', async () => {
  const file = (text) => ({ size: text.length, text: async () => text });
  const before = app.tabs.length;
  const tab = app.tabs.find((t) => t.type === 'vector');
  const shared = JSON.stringify({
    format: 'clover',
    version: 1,
    kind: 'tab',
    tab: { type: 'vector', title: 'Shared field', state: { ...tab.state, p: 'x*y', q: 'x-y' } },
  });
  await app.importFile(file(shared));
  assert.equal(app.tabs.length, before + 1);
  const added = app.tabs.at(-1);
  assert.equal(added.title, 'Shared field');
  assert.equal(added.state.p, 'x*y');

  await app.importFile(file('{"format":"other"}'));
  assert.match([...document.querySelectorAll('.toast-error')].at(-1).textContent, /not a Clover file/);
  assert.equal(app.tabs.length, before + 1);
});

test('importing a workspace offers replace or add, and replace can be undone', async () => {
  const file = (text) => ({ size: text.length, text: async () => text });
  const data = JSON.stringify({
    format: 'clover',
    version: 1,
    kind: 'workspace',
    workspace: {
      activeIndex: 1,
      tabs: [
        { type: 'complex', title: 'A', state: {} },
        { type: 'python', title: 'B', state: { code: 'print(1)' } },
      ],
    },
  });
  const before = app.snapshot();
  const pending = app.importFile(file(data));
  await tick(10);
  const dialog = document.querySelector('dialog');
  assert.ok(dialog, 'a choice dialog is shown when a workspace already exists');
  assert.match(dialog.textContent, /never runs automatically/);
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Replace workspace').click();
  await pending;
  assert.deepEqual(
    app.tabs.map((t) => t.title),
    ['A', 'B'],
  );
  assert.equal(app.tabs[1].id, app.activeId);
  document.querySelector('.toast-action').click();
  assert.equal(app.tabs.length, before.tabs.length);
});

test('theme toggles and notifies tools', () => {
  let events = 0;
  document.addEventListener('clover:themechange', () => (events += 1));
  const start = document.documentElement.dataset.theme;
  elements.themeButton.click();
  assert.notEqual(document.documentElement.dataset.theme, start);
  assert.equal(events, 1);
  assert.ok(['light', 'dark'].includes(store.loadTheme()));
});

test('help dialog opens', async () => {
  elements.helpButton.click();
  await tick(5);
  const dialog = document.querySelector('dialog');
  assert.match(dialog.textContent, /Saving and sharing/);
  dialog.querySelector('button').click();
});

test('every tool state normalises hostile input to a safe default', () => {
  const hostile = [
    null,
    undefined,
    42,
    'str',
    [],
    { __proto__: null, x: 1 },
    { expr: 5, p: {}, code: [], view: 'bad', mode: 'zzz', m: 999, A: 'no' },
  ];
  for (const tool of TOOL_LIST) {
    for (const raw of hostile) {
      const state = tool.normalize(raw);
      assert.ok(state && typeof state === 'object', `${tool.type} normalize(${JSON.stringify(raw)})`);
      assert.doesNotThrow(() => JSON.stringify(state));
      assert.deepEqual(tool.normalize(state), state, `${tool.type} normalize must be idempotent`);
    }
  }
});
