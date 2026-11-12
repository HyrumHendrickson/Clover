import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRunner } from './support/runner-harness.js';

const output = (runner, id) =>
  runner.received
    .filter((m) => m.type === 'stdout' && m.id === id)
    .map((m) => m.text)
    .join('');

test('session cells share variables and functions, and an error does not erase them', async () => {
  const runner = startRunner();
  try {
    const run = (id, code, canvas = false) =>
      runner.ask({ type: 'cell', id, code, canvas }, ['cell-done', 'cell-error']);
    assert.equal((await run('a', 'x = 5\ndef f(n):\n    return n * x\nimport math')).type, 'cell-done');
    assert.equal((await run('b', 'print(f(3), math.floor(2.7))\ny = [i * i for i in range(4)]')).type, 'cell-done');
    assert.equal(output(runner, 'b').trim(), '15 2');
    assert.equal((await run('c', 'x = 7\nprint(f(2), y)')).type, 'cell-done');
    assert.equal(output(runner, 'c').trim(), '14 [0, 1, 4, 9]');
    const failed = await run('d', 'print(missing_name)');
    assert.equal(failed.type, 'cell-error');
    assert.match(failed.message, /NameError/);
    const syntax = await run('e', 'def broken(:\n  pass');
    assert.equal(syntax.type, 'cell-error');
    assert.equal((await run('f', 'print(x)')).type, 'cell-done');
    assert.equal(output(runner, 'f').trim(), '7');
    await runner.ask({ type: 'reset' }, ['reset-done']);
    const gone = await run('g', 'print(x)');
    assert.equal(gone.type, 'cell-error', 'reset forgets every variable');
  } finally {
    runner.close();
  }
});

test('canvas cells draw with turtle, send a frame, and can be run again', async () => {
  const runner = startRunner();
  try {
    const code =
      'import turtle\nt = turtle.Turtle()\nfor i in range(4):\n    t.forward(50)\n    t.left(90)\nturtle.done()';
    const run = (id) => runner.ask({ type: 'cell', id, code, canvas: true }, ['cell-done', 'cell-error']);
    const first = await run('c1');
    assert.equal(first.type, 'cell-done', first.message);
    const second = await run('c2');
    assert.equal(second.type, 'cell-done', second.message);
    const frames = runner.received.filter((m) => m.type === 'frame');
    assert.ok(frames.length >= 2);
    assert.match(frames[0].dataUrl, /^data:image\/png;base64,/);
  } finally {
    runner.close();
  }
});

test('messages with a bad shape are ignored', async () => {
  const runner = startRunner();
  try {
    runner.send({ type: 'cell', id: '../bad id', code: 'print(1)' });
    runner.send({ type: 'cell', id: 'ok', code: 42 });
    runner.send({ type: 'ca-step', cells: [0], width: 1000, height: 1, steps: 1 });
    runner.send('nonsense');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(
      runner.received.map((m) => m.type),
      ['ready'],
    );
  } finally {
    runner.close();
  }
});

const BLINKER = `
COLORS = ["#ffffff", "#000000"]
def rule(cell, neighbors):
    alive = sum(neighbors)
    if cell == 1 and (alive == 2 or alive == 3):
        return 1
    if cell == 0 and alive == 3:
        return 1
    return 0
`;

test('a cellular automaton rule loads, steps a blinker, and reports bad results', async () => {
  const runner = startRunner();
  try {
    const ready = await runner.ask({ type: 'ca-load', code: BLINKER }, ['ca-ready', 'ca-error']);
    assert.equal(ready.type, 'ca-ready', ready.message);
    assert.deepEqual(Array.from(ready.colors), ['#ffffff', '#000000']);
    assert.equal(ready.wrap, true);
    const grid = new Uint8Array(25);
    for (const i of [11, 12, 13]) grid[i] = 1;
    const result = await runner.ask({ type: 'ca-step', cells: grid, width: 5, height: 5, steps: 1 }, [
      'ca-result',
      'ca-error',
    ]);
    assert.equal(result.type, 'ca-result');
    assert.deepEqual(
      [...result.cells].flatMap((v, i) => (v ? [i] : [])),
      [7, 12, 17],
    );
    const two = await runner.ask({ type: 'ca-step', cells: grid, width: 5, height: 5, steps: 2 }, ['ca-result']);
    assert.deepEqual(
      [...two.cells].flatMap((v, i) => (v ? [i] : [])),
      [11, 12, 13],
    );

    const bad = await runner.ask({ type: 'ca-load', code: 'def rule(c, n):\n    return 9' }, ['ca-ready']);
    assert.equal(bad.type, 'ca-ready');
    const error = await runner.ask({ type: 'ca-step', cells: grid, width: 5, height: 5, steps: 1 }, [
      'ca-result',
      'ca-error',
    ]);
    assert.equal(error.type, 'ca-error');
    assert.match(error.message, /rule returned 9/);
  } finally {
    runner.close();
  }
});

test('rule loading explains missing or malformed definitions', async () => {
  const runner = startRunner();
  try {
    const missing = await runner.ask({ type: 'ca-load', code: 'x = 1' }, ['ca-ready', 'ca-error']);
    assert.match(missing.message, /Define a function named rule/);
    const colors = await runner.ask(
      { type: 'ca-load', code: 'COLORS = ["red", "blue"]\ndef rule(c, n):\n    return c' },
      ['ca-ready', 'ca-error'],
    );
    assert.match(colors.message, /must be written like "#1f5124"/);
    const syntax = await runner.ask({ type: 'ca-load', code: 'def rule(:' }, ['ca-ready', 'ca-error']);
    assert.equal(syntax.type, 'ca-error');
  } finally {
    runner.close();
  }
});

test('the LaTeX runner hides storage that a sandboxed frame cannot read, before it loads the engine', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../runner/latex.js', import.meta.url), 'utf8');
  const shim = source.indexOf("['caches', 'indexedDB']");
  assert.ok(shim > 0, 'caches and indexedDB are shadowed');
  assert.ok(shim < source.indexOf('vendor/siglum/engine.js'), 'the shim runs before the engine is imported');
});
