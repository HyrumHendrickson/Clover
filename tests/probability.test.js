import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';
import {
  MAX_COUNT,
  bayes,
  combinations,
  discreteSummary,
  eventProbabilities,
  formatCount,
  parseOutcomes,
  permutations,
} from '../js/lib/probability.js';

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test('permutations and combinations, with and without repeats', () => {
  assert.equal(permutations(10, 3), 720n);
  assert.equal(permutations(10, 3, true), 1000n);
  assert.equal(permutations(5, 0), 1n);
  assert.equal(permutations(3, 5), 0n);
  assert.equal(permutations(0, 0, true), 1n);
  assert.equal(combinations(10, 3), 120n);
  assert.equal(combinations(10, 3, true), 220n);
  assert.equal(combinations(52, 5), 2598960n);
  assert.equal(combinations(5, 0), 1n);
  assert.equal(combinations(5, 5), 1n);
  assert.equal(combinations(3, 5), 0n);
  assert.equal(combinations(0, 0, true), 1n);
  assert.equal(combinations(0, 2, true), 0n);
  assert.equal(combinations(6, 2, true), 21n);
});

test('counts stay exact when they are huge, and bad input is refused', () => {
  const big = combinations(1000, 500);
  assert.equal(big.toString().length, 300);
  assert.equal(big.toString().slice(0, 7), '2702882');
  assert.equal(combinations(1000, 500), combinations(1000, 500));
  assert.equal(permutations(MAX_COUNT, MAX_COUNT).toString().length, 2568);
  for (const bad of [-1, 1.5, Number.NaN, MAX_COUNT + 1, Infinity]) {
    assert.equal(combinations(bad, 2), null);
    assert.equal(permutations(5, bad), null);
  }
});

test('Pascal rule holds for combinations', () => {
  for (let n = 1; n < 30; n += 1) {
    for (let r = 1; r < n; r += 1)
      assert.equal(combinations(n, r), combinations(n - 1, r - 1) + combinations(n - 1, r));
  }
});

test('counts are shown with separators, then in scientific form', () => {
  assert.equal(formatCount(2598960n), '2,598,960');
  assert.equal(formatCount(0n), '0');
  assert.equal(formatCount(999999999999999n), '999,999,999,999,999');
  assert.equal(formatCount(combinations(1000, 500)), '2.702882 \u00d7 10^299');
});

test('two events: union, conditionals, and independence', () => {
  const r = eventProbabilities({ pa: 0.5, pb: 0.4, pab: 0.2 });
  assert.equal(r.valid, true);
  near(r.union, 0.7);
  near(r.aOnly, 0.3);
  near(r.bOnly, 0.2);
  near(r.neither, 0.3);
  near(r.aGivenB, 0.5);
  near(r.bGivenA, 0.4);
  assert.equal(r.independent, true);
  assert.equal(eventProbabilities({ pa: 0.5, pb: 0.4, pab: 0.3 }).independent, false);
  const exclusive = eventProbabilities({ pa: 0.3, pb: 0.3, pab: 0 });
  near(exclusive.union, 0.6);
  assert.equal(exclusive.independent, false);
  assert.ok(Number.isNaN(eventProbabilities({ pa: 0.3, pb: 0, pab: 0 }).aGivenB));
});

test('two events: impossible combinations are named', () => {
  assert.deepEqual(eventProbabilities({ pa: 0.9, pb: 0.9, pab: 0.1 }), {
    valid: false,
    reason: 'range',
    lower: 0.8,
    upper: 0.9,
  });
  assert.equal(eventProbabilities({ pa: 0.2, pb: 0.4, pab: 0.3 }).reason, 'range');
  assert.equal(eventProbabilities({ pa: 1.2, pb: 0.4, pab: 0.3 }).reason, 'probability');
  assert.equal(eventProbabilities({ pa: Number.NaN, pb: 0.4, pab: 0.3 }).reason, 'probability');
  // Rounding error at the edge is forgiven.
  assert.equal(eventProbabilities({ pa: 0.1 + 0.2, pb: 0.5, pab: 0.3 }).valid, true);
});

test('Bayes theorem: the classic screening example', () => {
  const r = bayes({ prior: 0.01, sensitivity: 0.9, falsePositive: 0.05 });
  near(r.evidence, 0.0585);
  near(r.posterior, 0.009 / 0.0585);
  near(r.posteriorWithout, 0.001 / 0.9415);
  near(r.hit + r.miss + r.falseAlarm + r.clear, 1);
  assert.equal(bayes({ prior: 2, sensitivity: 0.9, falsePositive: 0.05 }), null);
  assert.ok(Number.isNaN(bayes({ prior: 0.5, sensitivity: 0, falsePositive: 0 }).posterior));
});

test('outcomes are parsed, merged, and sorted', () => {
  const { pairs, error } = parseOutcomes('3, 1/4\n1, 0.5\n3 0.25');
  assert.equal(error, null);
  assert.deepEqual(pairs, [
    [1, 0.5],
    [3, 0.5],
  ]);
  assert.match(parseOutcomes('').error, /at least one outcome/);
  assert.match(parseOutcomes('1, 2, 3').error, /value and a probability/);
  assert.match(parseOutcomes('x, 0.5').error, /value in "x, 0.5"/);
  assert.match(parseOutcomes('1, 1.5').error, /between 0 and 1/);
  assert.match(parseOutcomes('1\n'.repeat(201)).error, /at most 200/);
  assert.equal(parseOutcomes('1, 1/2; 2, 1/2').pairs.length, 2);
});

test('expected value and variance of a fair die', () => {
  const { pairs } = parseOutcomes('1,1/6\n2,1/6\n3,1/6\n4,1/6\n5,1/6\n6,1/6');
  const s = discreteSummary(pairs);
  near(s.total, 1);
  near(s.mean, 3.5);
  near(s.variance, 35 / 12);
  near(s.sd, Math.sqrt(35 / 12));
});

/* ---------------------------------------------------------------- the tab */

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};

const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { countFormula } = await import('../js/tools/probability.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const probability = TOOLS.probability;
const tab = app.addTab({ type: 'probability' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (s) => panel().querySelector(s);
const qa = (s) => [...panel().querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const mode = (name) => click(qa('.st-modes button').find((b) => b.textContent === name));
const input = (label) => qa('input, textarea, select').find((el) => el.getAttribute('aria-label') === label);
const choose = (label, value) => {
  const select = input(label);
  select.value = value;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const tile = (label) =>
  qa('.st-tile')
    .find((t) => t.querySelector('.st-tile-label').textContent === label)
    ?.querySelector('.st-tile-value').textContent;
const row = (label) => qa('.st-table th').find((th) => th.textContent === label)?.nextSibling?.textContent;
const settle = () => tick(260);

test('the probability tab is registered and opens on counting', () => {
  assert.equal(probability.name, 'Probability');
  assert.equal(tab.state.mode, 'counting');
  assert.equal(q('.panel-error'), null);
  assert.equal(tile('Selections'), '120');
  assert.equal(row('Formula'), 'C(10, 3) = 10! / (3! \u00d7 7!)');
  assert.equal(q('.st-output').classList.contains('calc-no-chart'), true);
});

test('counting follows the order and repeat choices', async () => {
  choose('Order', 'yes');
  await settle();
  assert.equal(tile('Arrangements'), '720');
  choose('Repeats', 'yes');
  await settle();
  assert.equal(tile('Arrangements'), '1,000');
  choose('Order', 'no');
  await settle();
  assert.equal(tile('Selections'), '220');
  choose('Repeats', 'no');
  type(window, input('Items to choose from, n'), '52');
  type(window, input('Items chosen, r'), '5');
  await settle();
  assert.equal(tile('Selections'), '2,598,960');
  assert.match(row('Chance of one particular outcome, if all are equally likely'), /^1 in 2,598,960$/);
  type(window, input('Items to choose from, n'), '1000');
  type(window, input('Items chosen, r'), '500');
  await settle();
  assert.equal(tile('Selections'), '2.702882 \u00d7 10^299');
  assert.equal(row('Exact value').length, 300);
  type(window, input('Items chosen, r'), '2000');
  await settle();
  assert.match(q('.st-note').textContent, /whole number from 0 to 1000/);
  type(window, input('Items to choose from, n'), '3');
  type(window, input('Items chosen, r'), '5');
  await settle();
  assert.match(q('.st-note').textContent, /cannot choose more items/);
  assert.equal(tile('Selections'), '0');
});

test('counting formulas', () => {
  assert.equal(countFormula(10, 3, true, false), 'P(10, 3) = 10! / 7!');
  assert.equal(countFormula(10, 3, true, true), '10^3');
  assert.equal(countFormula(10, 3, false, true), 'C(10 + 3 \u2212 1, 3) = 12! / (3! \u00d7 9!)');
  assert.equal(countFormula(3, 5, false, false), 'C(3, 5) = 0');
});

test('two events: independence, and the other ways to relate A and B', async () => {
  mode('Two events');
  assert.equal(tile('P(A or B)'), '0.7');
  assert.equal(tile('P(A and B)'), '0.2');
  assert.match(q('.st-callout').textContent, /are independent/);
  assert.equal(qa('.calc-bar').length, 4);
  choose('How A and B relate', 'exclusive');
  await settle();
  assert.equal(tile('P(A or B)'), '0.9');
  assert.equal(tile('P(A given B)'), '0');
  assert.match(q('.st-callout').textContent, /not independent/);
  choose('How A and B relate', 'joint');
  type(window, input('P(A and B)'), '0.3');
  await settle();
  assert.equal(tile('P(A or B)'), '0.6');
  assert.equal(tile('P(A given B)'), '0.75');
  type(window, input('P(A and B)'), '0.45');
  await settle();
  assert.match(q('.st-note').textContent, /P\(A and B\) must be between 0 and 0.4/);
  choose('How A and B relate', 'cond');
  type(window, input('P(A given B)'), '0.5');
  await settle();
  assert.equal(tile('P(A and B)'), '0.2');
  type(window, input('P(A given B)'), '1');
  await settle();
  assert.equal(tile('P(A and B)'), '0.4');
  type(window, input('P(A)'), '0.3');
  await settle();
  assert.match(q('.st-note').textContent, /P\(A given B\) must be between 0 and 0.75/);
  type(window, input('P(A)'), '2');
  await settle();
  assert.match(q('.st-note').textContent, /from 0 to 1/);
  type(window, input('P(A)'), '1/2');
  await settle();
});

test('Bayes theorem tab', async () => {
  mode('Bayes\u2019 theorem');
  assert.equal(tile('P(H given E)'), '0.153846');
  assert.equal(tile('P(E)'), '0.0585');
  assert.match(q('.st-callout').textContent, /from 1% to 15.385%/);
  assert.equal(row('H but not E'), '10');
  type(window, input('Sensitivity, P(E given H)'), '0');
  type(window, input('False positive rate, P(E given not H)'), '0');
  await settle();
  assert.match(q('.st-note').textContent, /evidence cannot happen/);
  type(window, input('Sensitivity, P(E given H)'), '1.5');
  await settle();
  assert.match(q('.st-note').textContent, /from 0 to 1/);
});

test('repeated trials: exactly, at most, at least, between, with a chart', async () => {
  mode('Repeated trials');
  assert.equal(tile('P(X = 5)'), '0.246094');
  assert.equal(q('canvas').hidden, false);
  assert.equal(q('.st-output').classList.contains('calc-no-chart'), false);
  assert.equal(tile('Mean, n \u00d7 p'), '5');
  choose('Find the probability of', 'atmost');
  await settle();
  assert.equal(tile('P(X \u2264 5)'), '0.623047');
  choose('Find the probability of', 'atleast');
  await settle();
  assert.equal(tile('P(X \u2265 5)'), '0.623047');
  choose('Find the probability of', 'between');
  type(window, input('From, successes'), '4');
  type(window, input('To, successes'), '6');
  await settle();
  assert.equal(tile('P(4 \u2264 X \u2264 6)'), '0.65625');
  type(window, input('To, successes'), '3');
  await settle();
  assert.match(q('.st-note').textContent, /upper number of successes/);
  type(window, input('Trials, n'), '0');
  await settle();
  assert.match(q('.st-note').textContent, /whole number from 1 to 5000/);
  type(window, input('Trials, n'), '10');
  type(window, input('To, successes'), '10');
  type(window, input('Probability of success, p'), '1');
  await settle();
  assert.equal(row('Chance of at least one success'), '1');
});

test('random variable tab: expected value of a die, and bad tables', async () => {
  mode('Random variable');
  assert.equal(tile('Expected value'), '3.5');
  assert.equal(tile('Variance'), '2.91667');
  assert.equal(tile('Outcomes'), '6');
  assert.equal(q('canvas').hidden, false);
  type(window, input('Outcomes: one "value, probability" per line'), '0, 0.5\n10, 0.25');
  await settle();
  assert.match(q('.st-note').textContent, /add to 0.75/);
  type(window, input('Outcomes: one "value, probability" per line'), '0, 0.5\n10, 0.5');
  await settle();
  assert.equal(tile('Expected value'), '5');
  assert.equal(tile('Standard deviation'), '5');
  assert.equal(tab.state.variable.outcomes, '0, 0.5\n10, 0.5');
});

test('probability state normalises hostile input and keeps line breaks in outcomes', () => {
  const state = probability.normalize({
    mode: 'nope',
    counting: { order: 'maybe', n: 5 },
    events: { link: {} },
    trials: { kind: 'sometimes', n: ['x'] },
    variable: { outcomes: '1, 1/2\n2, 1/2' },
  });
  assert.equal(state.mode, 'counting');
  assert.equal(state.counting.order, 'no');
  assert.equal(state.counting.n, '10');
  assert.equal(state.events.link, 'independent');
  assert.equal(state.trials.kind, 'exactly');
  assert.equal(state.variable.outcomes, '1, 1/2\n2, 1/2');
  assert.deepEqual(probability.normalize(state), state);
  assert.equal(probability.normalize({ variable: { outcomes: 'x'.repeat(9000) } }).variable.outcomes.length, 4000);
});
