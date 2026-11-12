import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};

const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { equationText, graphEquation } = await import('../js/tools/stats.js');
const chart = await import('../js/lib/statchart.js');
const { DISTRIBUTIONS } = await import('../js/lib/stats.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const stats = TOOLS.stats;
const tab = app.addTab({ type: 'stats' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const qa = (s) => [...panel().querySelectorAll(s)];
const q = (s) => panel().querySelector(s);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const byText = (text) => qa('button').find((b) => b.textContent.trim() === text);
const change = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const cell = (label) => qa('.st-table th').find((th) => th.textContent === label)?.nextSibling?.textContent;
const settle = () => tick(260);

test('the stats tab is registered and opens with two empty columns', () => {
  assert.equal(stats.name, 'Statistics');
  assert.equal(tab.state.cols.length, 2);
  assert.match(q('.st-results').textContent, /Enter some numbers/);
});

test('hostile state is repaired, not trusted', () => {
  const state = stats.normalize({
    cols: [{ name: 'x'.repeat(100), cells: [1, null, { a: 1 }, 'y'.repeat(100)] }, 5, null, {}, {}, {}, {}],
    mode: 'regress',
    describe: { col: 99, chart: 'pie', bin: 1.2345678901234567e19 },
    regress: { x: -1, y: 'a', model: '__proto__' },
    dist: { kind: 'constructor', params: { mean: 'nope', evil: 1 }, shade: 7 },
    tests: { kind: 'x', tail: 'sideways', col: 3.5 },
  });
  assert.equal(state.cols.length, 5, 'non-objects are dropped and empty objects become columns');
  assert.equal(state.cols[0].name.length, 20);
  assert.ok(state.cols[0].cells.every((c) => typeof c === 'string' && c.length <= 24));
  assert.equal(state.describe.chart, 'histogram');
  assert.equal(state.regress.model, 'linear');
  assert.equal(state.dist.kind, 'normal');
  assert.deepEqual(Object.keys(state.dist.params), ['mean', 'sd'], 'unknown parameters are dropped');
  assert.equal(state.tests.tail, 'two');
  assert.deepEqual(stats.normalize(state), state);
  for (const kind of Object.keys(DISTRIBUTIONS)) {
    assert.deepEqual(
      Object.keys(stats.normalize({ dist: { kind } }).dist.params),
      DISTRIBUTIONS[kind].params.map((p) => p.key),
    );
  }
});

test('an example fills the columns and the summary appears', async () => {
  click(byText('Example'));
  await settle();
  assert.equal(tab.state.cols[0].name, 'Hours');
  assert.equal(cell('Count'), '10');
  assert.equal(cell('Mean'), '5.5');
  assert.equal(cell('Median'), '5.5');
  assert.equal(cell('Outliers'), 'none');
});

test('typing into the grid updates the summary and grows the sheet', async () => {
  click(byText('Clear'));
  const cells = () => qa('.st-cell');
  const before = qa('.st-grid tbody tr').length;
  const first = (n) => qa(`.st-grid tbody tr:nth-child(${n}) .st-cell`)[0];
  ['1', '2', '3', '4', 'abc', '100'].forEach((v, i) => type(window, first(i + 1), v));
  await settle();
  assert.deepEqual(tab.state.cols[0].cells.slice(0, 6), ['1', '2', '3', '4', 'abc', '100']);
  assert.equal(cell('Count'), '5');
  assert.equal(cell('Outliers'), '100');
  assert.match(q('.st-results').textContent, /1 entry was not a number/);
  assert.ok(cells().length >= before * 2, 'there are cells for every row and column');
  type(window, first(before), '7');
  assert.equal(qa('.st-grid tbody tr').length, before + 1, 'typing in the last row adds another');
});

test('arrow keys and Enter move between cells', () => {
  const rows = qa('.st-grid tbody tr');
  const at = (r, c) => rows[r].querySelectorAll('.st-cell')[c];
  const key = (el, name) =>
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  at(0, 0).focus();
  key(at(0, 0), 'Enter');
  assert.equal(document.activeElement, at(1, 0));
  key(at(1, 0), 'ArrowUp');
  assert.equal(document.activeElement, at(0, 0));
  at(0, 0).setSelectionRange(1, 1);
  key(at(0, 0), 'ArrowRight');
  assert.equal(document.activeElement, at(0, 1));
});

test('pasting from a spreadsheet fills cells from the one that was pasted into', async () => {
  const target = qa('.st-grid tbody tr:nth-child(1) .st-cell')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => '1\t2\n2\t4.1\n3\t5.9\n4\t8.2\n5\t9.8' };
  target.dispatchEvent(event);
  await settle();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(tab.state.cols[1].cells.slice(0, 5), ['2', '4.1', '5.9', '8.2', '9.8']);
  assert.deepEqual(tab.state.cols[0].cells.slice(0, 5), ['1', '2', '3', '4', '5']);
});

test('a pasted block with a header row names the columns', async () => {
  const target = qa('.st-grid tbody tr:nth-child(1) .st-cell')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => 'Dose,Response\n1,2\n2,4.1\n3,5.9\n4,8.2\n5,9.8' };
  target.dispatchEvent(event);
  event.clipboardData = { getData: () => 'Dose\tResponse\n1\t2\n2\t4.1\n3\t5.9\n4\t8.2\n5\t9.8' };
  const tabbed = new window.Event('paste', { bubbles: true, cancelable: true });
  tabbed.clipboardData = event.clipboardData;
  target.dispatchEvent(tabbed);
  await settle();
  assert.deepEqual(
    tab.state.cols.slice(0, 2).map((c) => c.name),
    ['Dose', 'Response'],
  );
  assert.deepEqual(tab.state.cols[1].cells.slice(0, 5), ['2', '4.1', '5.9', '8.2', '9.8']);
  assert.equal(tab.state.cols[0].cells[0], '1', 'the header row is not data');
});

test('a plain single value pastes normally', () => {
  const target = qa('.st-grid tbody tr:nth-child(1) .st-cell')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => '42' };
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

const upload = async (name, body, size = body.length) => {
  const input = q('.st-file');
  const file = { name, size, text: async () => body };
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);
};

test('uploading a CSV replaces the data, uses its header, and reports what loaded', async () => {
  await upload('scores.csv', 'Hours,Score,Group\n1,50,a\n2,60,b\n3,71,a\n4,79,b\n');
  await settle();
  assert.deepEqual(
    tab.state.cols.map((c) => c.name),
    ['Hours', 'Score', 'Group'],
  );
  assert.deepEqual(tab.state.cols[1].cells, ['50', '60', '71', '79']);
  assert.equal(tab.state.cols[0].cells.length, 4);
  assert.match(
    [...document.querySelectorAll('.toast')].at(-1).textContent,
    /Loaded 4 rows and 3 columns from scores\.csv/,
  );
  assert.equal(cell('Count'), '4');
  assert.equal(cell('Mean'), '2.5');
});

test('a CSV without a header gets numbered columns, and extra columns are cut', async () => {
  await upload('raw.csv', '1,2,3,4,5,6,7,8,9,10\n2,3,4,5,6,7,8,9,10,11\n');
  assert.equal(tab.state.cols.length, 8);
  assert.equal(tab.state.cols[0].name, 'Column 1');
  assert.deepEqual(tab.state.cols[0].cells, ['1', '2']);
  assert.match([...document.querySelectorAll('.toast')].at(-1).textContent, /left out/);
});

test('an empty or oversized upload is refused in words', async () => {
  const before = JSON.stringify(tab.state.cols);
  await upload('empty.csv', '\n\n');
  assert.match([...document.querySelectorAll('.toast-error')].at(-1).textContent, /no rows/);
  await upload('big.csv', 'a,b\n1,2', 5_000_000);
  assert.match([...document.querySelectorAll('.toast-error')].at(-1).textContent, /over 1 MB/);
  assert.equal(JSON.stringify(tab.state.cols), before, 'nothing changed');
});

test('the text view edits the same data as CSV', async () => {
  click(byText('Edit as text'));
  const area = q('.st-csv');
  assert.match(area.value, /^Column 1,Column 2,/);
  type(window, area, 'height,weight\n1.5,50\n1.6,56\n1.7,63\n1.8,70\n1.9,79');
  await settle();
  assert.deepEqual(
    tab.state.cols.map((c) => c.name),
    ['height', 'weight'],
  );
  assert.deepEqual(tab.state.cols[1].cells, ['50', '56', '63', '70', '79']);
  assert.equal(cell('Count'), '5');
  click(byText('Back to grid'));
  assert.equal(qa('.st-csv').length, 0);
  assert.equal(qa('.st-grid tbody tr:nth-child(2) .st-cell')[1].value, '56');
});

test('the data can be downloaded as CSV', () => {
  const urls = [];
  const original = globalThis.URL.createObjectURL;
  globalThis.URL.createObjectURL = (blob) => (urls.push(blob), 'blob:test');
  const clicked = [];
  const anchorClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function click() {
    clicked.push(this.download);
  };
  click(byText('Download'));
  window.HTMLAnchorElement.prototype.click = anchorClick;
  globalThis.URL.createObjectURL = original;
  assert.equal(urls.length, 1);
  assert.equal(urls[0].type, 'text/csv');
  assert.match(clicked[0], /\.csv$/);
});

test('the regression data is restored for the tests that follow', async () => {
  click(byText('Clear'));
  const target = qa('.st-grid tbody tr:nth-child(1) .st-cell')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => '1\t2\n2\t4.1\n3\t5.9\n4\t8.2\n5\t9.8' };
  target.dispatchEvent(event);
  await settle();
  assert.deepEqual(tab.state.cols[1].cells.slice(0, 5), ['2', '4.1', '5.9', '8.2', '9.8']);
});

test('regression reports the fit and offers the equation for the Graphing tool', async () => {
  click(byText('Regression'));
  await settle();
  assert.equal(tab.state.mode, 'regress');
  assert.match(cell('Equation'), /^y = /);
  assert.equal(cell('Points used'), '5');
  assert.match(cell('Parameter b'), /1\.9\d* ±/);
  assert.ok(Number(cell('R²')) > 0.99);
  assert.ok(cell('Correlation r'));
  change(
    qa('select').find((s) => s.getAttribute('aria-label') === 'Model'),
    'quadratic',
  );
  await settle();
  assert.ok(cell('Parameter c'), 'a quadratic has a third parameter');
  const box = qa('input[type="checkbox"]')[0];
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(q('canvas[aria-label="Residual plot"]').hidden, false);
});

test('regression says why it cannot run', async () => {
  change(
    qa('select').find((s) => s.getAttribute('aria-label') === 'Model'),
    'exponential',
  );
  change(
    qa('select').find((s) => s.getAttribute('aria-label') === 'x column'),
    '1',
  );
  change(
    qa('select').find((s) => s.getAttribute('aria-label') === 'y column'),
    '1',
  );
  await settle();
  assert.match(q('.st-results').textContent, /different columns/);
});

test('distributions give probabilities, moments, and inverse values', async () => {
  click(byText('Distributions'));
  await settle();
  assert.equal(cell('Mean'), '0');
  assert.equal(cell('Probability'), '0.682689');
  const p = qa('input').find((i) => i.getAttribute('aria-label') === 'Inverse: probability p');
  type(window, p, '0.975');
  await settle();
  assert.match(cell('Value with probability 0.975 below it'), /^1\.9599/);
  const kind = qa('select').find((s) => s.getAttribute('aria-label') === 'Distribution');
  change(kind, 'binomial');
  await settle();
  assert.equal(tab.state.dist.kind, 'binomial');
  assert.deepEqual(Object.keys(tab.state.dist.params), ['n', 'p']);
  assert.equal(cell('Mean'), '3');
  type(
    window,
    qa('input').find((i) => i.getAttribute('aria-label') === 'Trials'),
    '-4',
  );
  await settle();
  assert.match(q('.st-results').textContent, /outside what this distribution allows/);
});

test('tests report a statistic, degrees of freedom, and a p-value', async () => {
  click(byText('Tests'));
  await settle();
  assert.equal(tab.state.mode, 'tests');
  assert.equal(q('canvas.st-canvas').hidden, false, 'a test charts where its statistic falls');
  assert.match(q('.st-hyp').textContent, /H₀: μ = 0/);
  assert.match(q('.st-callout').textContent, /α = 0\.05/);
  assert.ok(cell('Statistic'));
  assert.equal(cell('Degrees of freedom'), '4');
  const kind = qa('select').find((s) => s.getAttribute('aria-label') === 'Test');
  change(kind, 'prop1');
  await settle();
  assert.match(q('.st-results').textContent, /Enter whole numbers/);
  type(
    window,
    qa('input').find((i) => i.getAttribute('aria-label') === 'Successes'),
    '45',
  );
  type(
    window,
    qa('input').find((i) => i.getAttribute('aria-label') === 'Sample size'),
    '80',
  );
  await settle();
  assert.ok(Number(cell('Statistic')) > 1.1 && Number(cell('Statistic')) < 1.2);
  change(kind, 'gof');
  await settle();
  assert.ok(cell('Chi-square') || /at least two/.test(q('.st-results').textContent));
});

/* ------------------------------------------------------------------ charts */

test('chart specs describe the data without needing a canvas', () => {
  const hist = chart.histogramSpec([1, 2, 2, 3, 3, 3], 1);
  assert.equal(hist.layers[0].bars.length, 3);
  assert.deepEqual(
    hist.layers[0].bars.map((b) => b.count),
    [1, 2, 3],
  );
  const density = chart.histogramSpec([1, 2, 2, 3, 3, 3], 1, true);
  const area = density.layers[0].bars.reduce((s, b) => s + b.y * (b.x1 - b.x0), 0);
  assert.ok(Math.abs(area - 1) < 1e-12, 'a density histogram has total area 1');
  const box = chart.boxplotSpec([1, 2, 3, 4, 5, 100]).layers[0];
  assert.deepEqual(box.outliers, [100]);
  assert.equal(box.high, 5);
  assert.equal(chart.dotplotSpec([1, 1, 1, 2], 1).y[1], 4);
  const scatter = chart.scatterSpec([1, 2, 3], [2, 4, 6], (x) => 2 * x);
  assert.equal(scatter.layers.at(-1).kind, 'points');
  assert.ok(scatter.layers[0].pts.length > 100);
  assert.equal(chart.histogramSpec([], 1), null);
  assert.equal(chart.boxplotSpec([]), null);
  const normal = DISTRIBUTIONS.normal.make({ mean: 0, sd: 1 });
  const dist = chart.distributionSpec(normal, false, { from: -1, to: 1 });
  assert.equal(dist.layers[0].kind, 'area');
  const binom = chart.distributionSpec(DISTRIBUTIONS.binomial.make({ n: 5, p: 0.5 }), true, { from: 2, to: 3 });
  assert.equal(binom.layers[0].bars.filter((b) => b.shaded).length, 2);
});

test('equations come out readable, and in a form the graphing language accepts', () => {
  assert.equal(equationText('linear', [1, -2]), 'y = 1 - 2x');
  assert.equal(equationText('quadratic', [0, 1, 3]), 'y = 0 + 1x + 3x²');
  assert.equal(graphEquation('power', [2, 0.5]), 'y = 2x^(0.5)');
});
