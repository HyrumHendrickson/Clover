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
  assert.equal(state.cols.length, 4);
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
  click(byText('Load an example'));
  await settle();
  assert.equal(tab.state.cols[0].name, 'Hours');
  assert.equal(cell('Count'), '10');
  assert.equal(cell('Mean'), '5.5');
  assert.equal(cell('Median'), '5.5');
  assert.equal(cell('Outliers'), 'none');
});

test('typing a value updates the summary', async () => {
  const area = qa('.st-area')[0];
  type(window, area, '1\n2\n3\n4\nabc\n100');
  await settle();
  assert.deepEqual(tab.state.cols[0].cells, ['1', '2', '3', '4', 'abc', '100']);
  assert.equal(cell('Count'), '5');
  assert.equal(cell('Outliers'), '100');
  assert.match(q('.st-results').textContent, /1 entry was not a number/);
});

test('pasting from a spreadsheet spreads across columns', async () => {
  const area = qa('.st-area')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => '1\t2\n2\t4.1\n3\t5.9\n4\t8.2\n5\t9.8' };
  area.dispatchEvent(event);
  await settle();
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(tab.state.cols[1].cells, ['2', '4.1', '5.9', '8.2', '9.8']);
  assert.equal(tab.state.cols[0].cells.length, 5);
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
