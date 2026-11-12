import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};
const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const tab = app.addTab({
  type: 'matrix',
  state: {
    lines: [
      {
        id: 'a',
        kind: 'matrix',
        name: 'A',
        cells: [
          ['0', '-1'],
          ['1', '0'],
        ],
      },
      { id: 'x', kind: 'matrix', name: 'x', cells: [['2'], ['0']] },
      { id: 'p', kind: 'expr', text: 'A*x' },
      {
        id: 'm',
        kind: 'matrix',
        name: 'S',
        cells: [
          ['2', '1'],
          ['1', '2'],
        ],
      },
      { id: 'e', kind: 'expr', text: 'eig(S)' },
      { id: 'v', kind: 'matrix', name: 'v', cells: [['1'], ['2'], ['3']] },
    ],
  },
});
const panel = document.getElementById(`panel-${tab.id}`);
const q = (s) => panel.querySelector(s);
const line = (id) => panel.querySelector(`[data-id="${id}"]`);
const select = (id) => {
  line(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};

test('the tab is called Linear algebra but keeps its saved type', () => {
  assert.equal(TOOLS.matrix.name, 'Linear algebra');
  assert.equal(tab.type, 'matrix');
});

test('clicking a vector line draws the vector and says where it points', async () => {
  await tick(20);
  assert.match(q('.mx-caption').textContent, /Click a line|^$/);
  select('x');
  assert.equal(line('x').classList.contains('is-selected'), true);
  assert.match(q('.mx-legend').textContent, /x = \(2, 0\)/);
  assert.match(q('.mx-caption').textContent, /Length 2, pointing 0\u00b0 from the x axis\./);
  assert.match(q('.mx-more-text').textContent, /x = \(2, 0\)\. Its length is 2\./);
  assert.match(q('canvas').getAttribute('aria-label'), /Drawing\. x = \(2, 0\)/);
  assert.equal(q('.mx-viz-controls').hidden, true, 'a plain vector has nothing to apply');
});

test('clicking A*x shows the turn and the scale, with a slider to apply A gradually', () => {
  select('p');
  assert.equal(line('x').classList.contains('is-selected'), false);
  assert.match(q('.mx-caption').textContent, /Rotated 90\u00b0 counterclockwise and scaled by 1\./);
  assert.equal(q('.mx-viz-controls').hidden, false);
  const slider = q('.mx-slider');
  slider.value = '0.5';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(q('.mx-viz-controls').hidden, false);
});

test('clicking a matrix describes the determinant and its eigenvectors', () => {
  select('m');
  assert.match(q('.mx-caption').textContent, /Areas are multiplied by 3\./);
  const text = q('.mx-more-text').textContent;
  assert.match(text, /det = 3\./);
  assert.match(text, /\u03bb = 3 along/);
  assert.match(text, /\u03bb = 1 along/);
  select('a');
  assert.match(q('.mx-more-text').textContent, /no real eigenvectors/);
});

test('eig(S) lists each eigenvalue with its eigenvector, and 3D vectors can be drawn', () => {
  const eigs = [...line('e').querySelectorAll('.mx-eig')].map((el) => el.textContent);
  assert.equal(eigs.length, 2);
  assert.match(eigs[0], /\u03bb = 3, eigenvector \(1, 1\)/);
  assert.match(eigs[1], /\u03bb = 1, eigenvector \(1, -1\)/);
  select('v');
  assert.match(q('.mx-legend').textContent, /v = \(1, 2, 3\)/);
  assert.match(q('.mx-caption').textContent, /Length 3\.742\./);
});

test('editing an entry redraws the selected line', async () => {
  select('x');
  const input = line('x').querySelector('input.mx-cell');
  input.value = '5';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(200);
  assert.match(q('.mx-legend').textContent, /x = \(5, 0\)/);
});

test('the sheet and the picture share the width, with no fixed cap that leaves a gap between them', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/matrix.css', import.meta.url), 'utf8');
  const rule = (selector) => css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[2] ?? '';
  assert.match(rule('.mx-lines'), /width:\s*100%/);
  assert.match(rule('.mx-help'), /width:\s*100%/);
  assert.doesNotMatch(css, /min\(780px/);
  assert.match(
    rule('.mx-body'),
    /grid-template-columns:[^;]*minmax\(0,\s*1fr\)/,
    'the picture column takes what is left',
  );
});
