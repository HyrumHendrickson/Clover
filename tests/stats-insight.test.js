import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};
const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { shape, meanInterval, DISTRIBUTIONS } = await import('../js/lib/stats.js');
const { conclusion, hypotheses, testDistribution } = await import('../js/lib/statsreport.js');
const { distributionSpec, testSpec } = await import('../js/lib/statchart.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('skewness, kurtosis, and the mean interval agree with SciPy', () => {
  const x = [2.1, 3.4, 1.9, 5.6, 4.4, 3.8, 9.2, 2.7];
  const s = shape(x);
  close(s.skewness, 1.5476922640262218);
  close(s.kurtosis, 2.642823100515592);
  const ci = meanInterval(x, 0.95);
  close(ci.lower, 2.146066025713983);
  close(ci.upper, 6.128933974286015);
  close(ci.stderr, 0.8421777679665633);
  assert.equal(ci.dof, 7);
  assert.deepEqual(shape([1, 2]), { skewness: null, kurtosis: null });
  assert.equal(shape([1, 2, 4]).kurtosis, null);
  assert.deepEqual(shape([3, 3, 3, 3]), { skewness: null, kurtosis: null });
  assert.equal(meanInterval([1], 0.95), null);
  assert.equal(meanInterval([1, 2], 2), null);
});

test('hypotheses and conclusions say only what the numbers show', () => {
  assert.deepEqual(hypotheses('t1', { tail: 'right', mu0: '5' }), {
    null: 'H\u2080: \u03bc = 5',
    alt: 'H\u2090: \u03bc > 5',
  });
  assert.match(hypotheses('t2', { tail: 'two' }).alt, /\u03bc\u2081 \u2260 \u03bc\u2082/);
  assert.match(hypotheses('indep', {}).null, /independent/);
  assert.equal(hypotheses('nope', {}).null, '');
  const small = conclusion(0.012, 0.05);
  assert.equal(small.reject, true);
  assert.match(small.text, /p = 0\.012.*below α = 0\.05\. Reject H₀/);
  const big = conclusion(0.31, 0.05);
  assert.equal(big.reject, false);
  assert.match(big.text, /Do not reject.*does not show H₀ is true/);
  assert.match(conclusion(0.00001, 0.05).text, /p < 0\.0001/);
  assert.match(conclusion(0.04, 7).text, /α = 0\.05/, 'a bad α falls back to 0.05');
  assert.equal(conclusion(1.5, 0.05), null);
  assert.equal(conclusion(NaN, 0.05), null);
});

test('the test chart shades the p-value region and marks the statistic', () => {
  const t = testDistribution('t1', { dof: 9 });
  const two = testSpec(t, 2.5, 'two');
  assert.equal(two.layers.filter((l) => l.kind === 'area').length, 2);
  assert.equal(two.layers.at(-1).kind, 'vline');
  assert.equal(two.layers.at(-1).x, 2.5);
  assert.equal(testSpec(t, 2.5, 'right').layers.filter((l) => l.kind === 'area').length, 1);
  const far = testSpec(t, 40, 'two');
  assert.ok(far.x[1] >= 41, 'the range grows to include a far-out statistic');
  const chi = testSpec(testDistribution('gof', { dof: 3 }), 12, 'two');
  assert.equal(chi.layers.filter((l) => l.kind === 'area').length, 1, 'chi-square has one tail');
  assert.ok(chi.x[1] > 12);
  assert.equal(testSpec(t, NaN, 'two'), null);
  assert.equal(testSpec({ family: 't', dof: -1, tails: true }, 1, 'two'), null);
});

test('a single shaded region still works, and bars take several', () => {
  const normal = DISTRIBUTIONS.normal.make({ mean: 0, sd: 1 });
  assert.equal(distributionSpec(normal, false, { from: -1, to: 1 }).layers.filter((l) => l.kind === 'area').length, 1);
  assert.equal(distributionSpec(normal, false, null).layers.length, 1);
  const bars = distributionSpec(DISTRIBUTIONS.binomial.make({ n: 5, p: 0.5 }), true, [
    { from: 0, to: 0 },
    { from: 5, to: 5 },
  ]);
  assert.equal(bars.layers[0].bars.filter((b) => b.shaded).length, 2);
});

const tab = app.addTab({ type: 'stats' });
const panel = document.getElementById(`panel-${tab.id}`);
const qa = (s) => [...panel.querySelectorAll(s)];
const q = (s) => panel.querySelector(s);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const byText = (text) => qa('button').find((b) => b.textContent.trim() === text);
const labelled = (label) => qa('input').find((i) => i.getAttribute('aria-label') === label);
const settle = () => tick(260);

test('the summary leads with tiles and an interval, with the full table folded away', async () => {
  click(byText('Load an example'));
  await settle();
  const tiles = qa('.st-tile-label').map((n) => n.textContent);
  assert.deepEqual(tiles, ['Count', 'Mean', 'Median', 'Standard deviation']);
  assert.match(q('.st-callout').textContent, /95% confidence interval for the mean: .* to .*9 degrees of freedom/);
  const more = q('details.st-more');
  assert.ok(more.querySelector('.st-table'));
  assert.ok([...more.querySelectorAll('th')].some((th) => th.textContent === 'Skewness'));
  assert.ok(byText('Copy results as text'));
});

test('regression predicts, and warns when the point is outside the data', async () => {
  click(byText('Regression'));
  await settle();
  assert.deepEqual(
    qa('.st-tile-label')
      .slice(0, 2)
      .map((n) => n.textContent),
    ['Fitted model', 'R\u00b2'],
  );
  type(window, labelled('Predict y at x'), '5.5');
  await settle();
  assert.match(q('.st-callout').textContent, /At x = 5\.5 the model predicts y = \d/);
  assert.doesNotMatch(q('.st-callout').textContent, /outside the data/);
  type(window, labelled('Predict y at x'), '50');
  await settle();
  assert.match(q('.st-callout').textContent, /outside the data/);
  type(window, labelled('Predict y at x'), 'abc');
  await settle();
  assert.match(q('.st-results').textContent, /Enter a number to predict at/);
});

test('a test states its hypotheses and a verdict, and α changes the verdict', async () => {
  click(byText('Tests'));
  await settle();
  const kindSelect = qa('select').find((s) => s.getAttribute('aria-label') === 'Test');
  kindSelect.value = 't1';
  kindSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  type(window, labelled('Hypothesised mean'), '5.5');
  await settle();
  assert.match(q('.st-hyp').textContent, /H₀: μ = 5\.5/);
  const verdict = () => q('.st-callout').textContent;
  assert.match(verdict(), /Do not reject/);
  type(window, labelled('Hypothesised mean'), '3');
  await settle();
  assert.match(verdict(), /Reject H₀/);
  assert.equal(q('.st-callout').classList.contains('is-significant'), true);
  type(window, labelled('Significance level α'), '0.000000001');
  await settle();
  assert.match(verdict(), /Do not reject/, 'a stricter α changes the verdict');
  assert.equal(q('canvas.st-canvas').hidden, false);
});

test('the new fields are repaired on load', () => {
  const state = TOOLS.stats.normalize({ regress: { predict: { a: 1 } }, tests: { alpha: 5 } });
  assert.equal(state.regress.predict, '');
  assert.equal(state.tests.alpha, '0.05');
  assert.deepEqual(TOOLS.stats.normalize(state), state);
  assert.equal(TOOLS.stats.normalize({ tests: { alpha: 'x'.repeat(99) } }).tests.alpha.length, 24);
});
