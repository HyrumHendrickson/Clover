import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PYTHON_PRESETS, findPreset } from '../js/tools/python-presets.js';
import { runPython } from './support/skulpt-harness.js';

const HALF = 320;
const MARGIN = 8;

test('preset ids are unique and lookups work', () => {
  const ids = PYTHON_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(findPreset('koch')?.label, 'Koch snowflake');
  assert.equal(findPreset('missing'), null);
});

for (const preset of PYTHON_PRESETS) {
  test(`preset "${preset.id}" runs in Skulpt and stays on the canvas`, async () => {
    const result = await runPython(preset.code);
    assert.ok(result.ok, result.error);
    assert.ok(result.stats.points.length > 50, 'expected the program to draw something');
    assert.ok(result.ms < 15000, `took ${result.ms}ms`);
    const { minX, maxX, minY, maxY } = result.bounds;
    assert.ok(minX > -HALF + MARGIN && maxX < HALF - MARGIN, `x range ${minX}..${maxX} leaves the canvas`);
    assert.ok(minY > -HALF + MARGIN && maxY < HALF - MARGIN, `y range ${minY}..${maxY} leaves the canvas`);
  });
}

test('print output and runtime errors are reported', async () => {
  const printed = await runPython('print("hello from turtle")');
  assert.ok(printed.ok);
  assert.match(printed.output, /hello from turtle/);
  const failed = await runPython('import turtle\nx = 1 / 0');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /ZeroDivisionError/);
  const syntax = await runPython('def broken(:\n  pass');
  assert.equal(syntax.ok, false);
});
