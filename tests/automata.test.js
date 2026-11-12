import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './support/dom.js';
import { startRunner } from './support/runner-harness.js';
import {
  History,
  asciiGrid,
  countStates,
  decodeCells,
  encodeCells,
  lineCells,
  paintedState,
  previewColors,
  randomGrid,
  resizeGrid,
} from '../js/lib/automata.js';
import { AUTOMATA_PRESETS } from '../js/lib/automata-presets.js';

test('grids survive encoding, and bad saved text is refused', () => {
  const cells = Uint8Array.from([0, 1, 2, 15, 7, 3]);
  assert.equal(encodeCells(cells), '012f73');
  assert.deepEqual([...decodeCells('012f73', 6)], [...cells]);
  assert.equal(decodeCells('012f7', 6), null);
  assert.equal(decodeCells('01zf73', 6), null);
  assert.equal(decodeCells(5, 6), null);
});

test('painting flips a cell with the brush colour back to empty', () => {
  assert.equal(paintedState(0, 1), 1);
  assert.equal(paintedState(1, 1), 0);
  assert.equal(paintedState(2, 1), 1);
});

test('lines between cells have no gaps and include both ends', () => {
  const line = lineCells(0, 0, 5, 2);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [5, 2]);
  for (let i = 1; i < line.length; i += 1) {
    assert.ok(Math.abs(line[i][0] - line[i - 1][0]) <= 1 && Math.abs(line[i][1] - line[i - 1][1]) <= 1);
  }
});

test('random fill respects weights, ascii placement clips, resize keeps the corner', () => {
  const all = randomGrid(10, 10, [0, 1]);
  assert.ok(all.every((v) => v === 1));
  assert.deepEqual(countStates(randomGrid(10, 10, [1, 0, 0]), 3), [100, 0, 0]);
  const art = asciiGrid(4, 4, ['##', '##'], { '#': 2 }, { left: 3, top: 3 });
  assert.equal(art[15], 2);
  assert.equal(countStates(art, 3)[2], 1);
  const small = resizeGrid(Uint8Array.from([1, 2, 3, 4]), 2, 2, 3, 1);
  assert.deepEqual([...small], [1, 2, 0]);
});

test('history keeps only the newest grids', () => {
  const history = new History(3);
  for (let i = 0; i < 5; i += 1) history.push([i]);
  assert.equal(history.size, 3);
  assert.deepEqual([...history.pop()], [4]);
  assert.deepEqual([...history.pop()], [3]);
});

test('colours are previewed from the rule text without running it', () => {
  assert.deepEqual(previewColors('COLORS = ["#112233", \'#445566\', "#778899"]'), ['#112233', '#445566', '#778899']);
  assert.deepEqual(previewColors('x = 1'), ['#ffffff', '#1b1f1d']);
  assert.deepEqual(previewColors('COLORS = ["red", "blue"]'), ['#ffffff', '#1b1f1d']);
});

/* Every shipped rule has to load and step in the real runner. */
for (const preset of AUTOMATA_PRESETS) {
  test(`preset "${preset.id}" loads and runs in the runner`, async () => {
    const runner = startRunner();
    try {
      const ready = await runner.ask({ type: 'ca-load', code: preset.code }, ['ca-ready', 'ca-error']);
      assert.equal(ready.type, 'ca-ready', ready.message);
      const states = ready.colors.length;
      const cells = preset.start(preset.width, preset.height);
      assert.ok(
        cells.every((v) => v < states),
        'the starting pattern only uses states the rule defines',
      );
      const reply = await runner.ask({ type: 'ca-step', cells, width: preset.width, height: preset.height, steps: 2 }, [
        'ca-result',
        'ca-error',
      ]);
      assert.equal(reply.type, 'ca-result', reply.message);
      assert.equal(reply.cells.length, cells.length);
    } finally {
      runner.close();
    }
  });
}

test('Conway rules: a blinker oscillates and a block stays', async () => {
  const preset = AUTOMATA_PRESETS.find((p) => p.id === 'life');
  const runner = startRunner();
  try {
    await runner.ask({ type: 'ca-load', code: preset.code }, ['ca-ready']);
    const grid = asciiGrid(8, 8, ['.#.', '.#.', '.#.'], { '#': 1 }, { left: 2, top: 2 });
    const one = await runner.ask({ type: 'ca-step', cells: grid, width: 8, height: 8, steps: 1 }, ['ca-result']);
    assert.notDeepEqual([...one.cells], [...grid]);
    const two = await runner.ask({ type: 'ca-step', cells: grid, width: 8, height: 8, steps: 2 }, ['ca-result']);
    assert.deepEqual([...two.cells], [...grid]);
    const block = asciiGrid(8, 8, ['##', '##'], { '#': 1 });
    const same = await runner.ask({ type: 'ca-step', cells: block, width: 8, height: 8, steps: 3 }, ['ca-result']);
    assert.deepEqual([...same.cells], [...block]);
  } finally {
    runner.close();
  }
});

test('forest fire: fire burns out, spreads to a neighbouring tree, and a tree needs a flame to burn', async () => {
  const preset = AUTOMATA_PRESETS.find((p) => p.id === 'forest-fire');
  const runner = startRunner();
  try {
    const code = preset.code.replace('GROWTH = 0.01', 'GROWTH = 0.0').replace('LIGHTNING = 0.0003', 'LIGHTNING = 0.0');
    await runner.ask({ type: 'ca-load', code }, ['ca-ready']);
    const grid = asciiGrid(8, 8, ['TTT', 'TFT', 'TTT'], { T: 1, F: 2 });
    const next = await runner.ask({ type: 'ca-step', cells: grid, width: 8, height: 8, steps: 1 }, ['ca-result']);
    const at = (x, y) => next.cells[y * 8 + x];
    assert.equal(at(3, 3), 0, 'the burning cell is now bare');
    assert.equal(at(3, 2), 2, 'the tree above catches fire');
    assert.equal(at(2, 2), 1, 'a diagonal tree does not');
  } finally {
    runner.close();
  }
});

/* The tab itself. */

const env = installDom();
const { window, document, elements } = env;
const { App } = await import('../js/core/app.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

test('automata tab: painting, step controls, and the sandboxed frame', async () => {
  const tab = app.addTab({ type: 'automata' });
  const panel = document.getElementById(`panel-${tab.id}`);
  const q = (s) => panel.querySelector(s);
  const qa = (s) => [...panel.querySelectorAll(s)];
  assert.equal(q('iframe'), null, 'no rule runs until the person asks');
  assert.equal(qa('.ca-brush').length, 2);
  const button = (label) => qa('button').find((b) => b.textContent.trim() === label);
  assert.ok(button('Play') && button('Step') && button('Step back') && button('Clear'));
  assert.equal(button('Step back').disabled, true, 'nothing to go back to yet');

  button('Clear').click();
  assert.equal(tab.state.cells.replace(/0/g, ''), '');
  const canvas = q('.ca-canvas');
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: tab.state.width * 10,
    height: tab.state.height * 10,
  });
  canvas.setPointerCapture = () => {};
  const pointer = (type, x, y) => {
    const event = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
    canvas.dispatchEvent(event);
  };
  pointer('pointerdown', 25, 15);
  pointer('pointerup', 25, 15);
  assert.equal(tab.state.cells[1 * tab.state.width + 2], '1', 'click paints the cell under the pointer');
  pointer('pointerdown', 25, 15);
  pointer('pointerup', 25, 15);
  assert.equal(tab.state.cells[1 * tab.state.width + 2], '0', 'clicking it again clears it');

  button('Step').click();
  const frame = q('iframe');
  assert.ok(frame, 'Step starts the runner');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data, source = frame.contentWindow) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source }));
  send({ type: 'ready' });
  assert.equal(posted[0].type, 'ca-load');
  send({ type: 'ca-ready', colors: ['#ffffff', '#000000'], names: ['Dead', 'Alive'], wrap: true, edge: 0 }, window);
  assert.equal(posted.length, 1, 'messages from anything but the frame are ignored');
  send({ type: 'ca-ready', colors: ['#ffffff', '#000000'], names: ['Dead', 'Alive'], wrap: true, edge: 0 });
  await tick(10);
  assert.equal(posted[1].type, 'ca-step');
  assert.equal(posted[1].width * posted[1].height, posted[1].cells.length);
  const next = new Uint8Array(posted[1].cells.length);
  next[0] = 1;
  send({ type: 'ca-result', cells: next });
  await tick(10);
  assert.match(q('.ca-info').textContent, /Generation 1/);
  assert.equal(button('Step back').disabled, false);
  button('Step back').click();
  assert.match(q('.ca-info').textContent, /Generation 0/);

  button('Step').click();
  await tick(10);
  send({ type: 'ca-error', message: 'rule returned 9 for the cell at column 1, row 1.' });
  await tick(10);
  assert.match(q('.ca-console').textContent, /rule returned 9/);
});

test('automata tab: loading a preset replaces the rule and the grid', () => {
  const tab = app.tabs.find((t) => t.type === 'automata');
  const panel = document.getElementById(`panel-${tab.id}`);
  const chip = [...panel.querySelectorAll('.chip')].find((c) => c.textContent === 'Forest fire');
  chip.click();
  assert.match(tab.state.code, /LIGHTNING/);
  assert.equal(tab.state.width, 64);
  assert.equal(panel.querySelectorAll('.ca-brush').length, 3);
});

test('automata state normalises hostile input', async () => {
  const { default: automata } = await import('../js/tools/automata.js');
  const state = automata.normalize({ width: 9999, height: -4, cells: 'zz', code: 5, speed: 'fast' });
  assert.ok(state.width <= 100 && state.height >= 8);
  assert.equal(state.cells.length, state.width * state.height);
  assert.deepEqual(automata.normalize(state), state);
});
