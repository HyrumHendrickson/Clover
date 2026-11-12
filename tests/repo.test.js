import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('statistics charts sit in the page flow instead of covering the control panel', async () => {
  const css = await read('css/tools.css');
  const rule = /\.st-canvas\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  // .plot-canvas is position: absolute; inset: 0, which stretches a chart over the whole tab.
  assert.match(rule, /position:\s*static/);
});

test('the licence is the GPL version 2, matching Maxima', async () => {
  const licence = await read('LICENSE');
  assert.match(licence, /GNU GENERAL PUBLIC LICENSE\s+Version 2, June 1991/);
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.license, 'GPL-2.0-only');
});
