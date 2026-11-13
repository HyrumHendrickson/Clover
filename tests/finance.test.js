import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';
import {
  annuityValue,
  balanceAt,
  doublingTime,
  effectiveRate,
  growth,
  internalRates,
  loanSchedule,
  npv,
  payback,
  requiredContribution,
  savingsSeries,
  solveLumpSum,
  yearlyRows,
} from '../js/lib/finance.js';

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test('compound growth matches the textbook values', () => {
  near(1000 * growth(0.05, 1, 10), 1628.894627, 1e-6);
  near(1000 * growth(0.05, 12, 10), 1647.00949769, 1e-8);
  near(1000 * growth(0.05, Infinity, 10), 1648.7212707, 1e-8);
  near(effectiveRate(0.12, 12), 0.1268250301, 1e-9);
  near(doublingTime(0.07, 1), 10.2447683511, 1e-9);
  assert.ok(Number.isNaN(doublingTime(0, 1)));
});

test('regular contributions: ordinary annuity and annuity due', () => {
  near(annuityValue(100, 0.05, 12, 12, 10), 15528.2279446, 1e-6);
  near(annuityValue(100, 0.05, 12, 12, 10, true), 15592.9288943, 1e-6);
  near(annuityValue(100, 0, 12, 12, 10), 12000);
  assert.equal(annuityValue(100, 0.05, 12, 12, 0), 0);
});

test('contributions need not match the compounding period', () => {
  // Yearly deposits into an account that compounds monthly: the yearly growth is (1 + 0.06/12)^12.
  const g = (1 + 0.06 / 12) ** 12;
  near(annuityValue(1000, 0.06, 12, 1, 3), 1000 * (g ** 2 + g + 1), 1e-8);
  // Continuous compounding with monthly deposits.
  const c = Math.exp(0.06 / 12);
  near(annuityValue(10, 0.06, Infinity, 12, 1), 10 * ((c ** 12 - 1) / (c - 1)), 1e-8);
});

test('a part year of growth is counted after the last whole payment', () => {
  const years = 2.5;
  const g = growth(0.06, 1, 1);
  near(annuityValue(100, 0.06, 1, 1, years), 100 * (g + 1) * growth(0.06, 1, 0.5), 1e-9);
});

test('the savings series starts at zero and ends at the final balance', () => {
  const plan = { principal: 1000, rate: 0.05, n: 12, pmt: 100, m: 12 };
  const series = savingsSeries(plan, 10);
  assert.equal(series.length, 11);
  assert.deepEqual([series[0].year, series[0].balance, series[0].paid], [0, 1000, 1000]);
  near(series.at(-1).balance, 1000 * growth(0.05, 12, 10) + 15528.2279446, 1e-6);
  assert.equal(series.at(-1).paid, 13000);
  near(series.at(-1).interest, series.at(-1).balance - 13000, 1e-9);
  assert.deepEqual(balanceAt(plan, 10).paid, 13000);
  assert.equal(savingsSeries(plan, 2.5).at(-1).year, 2.5);
});

test('the contribution that reaches a goal, and zero when none is needed', () => {
  near(requiredContribution({ target: 100000, start: 0, rate: 0.05, n: 12, m: 12, years: 20 }), 243.2890725, 1e-6);
  const pmt = requiredContribution({ target: 50000, start: 5000, rate: 0.04, n: 4, m: 12, years: 15, due: true });
  const plan = { principal: 5000, rate: 0.04, n: 4, pmt, m: 12, due: true };
  near(balanceAt(plan, 15).balance, 50000, 1e-6);
  assert.equal(requiredContribution({ target: 100, start: 1000, rate: 0.05, n: 1, m: 12, years: 5 }), 0);
});

test('solving a lump sum for each unknown', () => {
  near(solveLumpSum('fv', { pv: 1000, rate: 0.05, n: 1, years: 10 }), 1628.894627, 1e-6);
  near(solveLumpSum('pv', { fv: 1628.894627, rate: 0.05, n: 1, years: 10 }), 1000, 1e-5);
  near(solveLumpSum('rate', { pv: 1000, fv: 2000, n: 1, years: 10 }), 0.0717734625, 1e-9);
  near(solveLumpSum('years', { pv: 1000, fv: 2000, rate: 0.07, n: 1 }), 10.2447683511, 1e-9);
  near(solveLumpSum('years', { pv: 1, fv: 2, rate: 0.05, n: Infinity }), Math.LN2 / 0.05, 1e-12);
  near(solveLumpSum('rate', { pv: 1, fv: Math.E, n: Infinity, years: 1 }), 1, 1e-12);
  assert.ok(Number.isNaN(solveLumpSum('rate', { pv: 1000, fv: -5, n: 1, years: 10 })));
  assert.ok(Number.isNaN(solveLumpSum('years', { pv: 1000, fv: 2000, rate: 0, n: 1 })));
  assert.ok(Number.isNaN(solveLumpSum('nothing', {})));
});

test('a 30-year mortgage pays off to the cent', () => {
  const loan = loanSchedule({ amount: 250000, rate: 0.065, years: 30, m: 12 });
  near(loan.payment, 1580.17, 0.005);
  assert.equal(loan.rows.length, 360);
  assert.equal(loan.rows.at(-1).balance, 0);
  near(loan.totalInterest, 360 * loan.payment - 250000, 1e-6);
  near(loan.rows[0].interest, 250000 * (0.065 / 12), 1e-9);
  near(
    loan.rows.reduce((sum, r) => sum + r.principal, 0),
    250000,
    1e-6,
  );
});

test('extra payments shorten the loan and save interest', () => {
  const base = loanSchedule({ amount: 250000, rate: 0.065, years: 30, m: 12 });
  const quicker = loanSchedule({ amount: 250000, rate: 0.065, years: 30, m: 12, extra: 200 });
  assert.ok(quicker.rows.length < base.rows.length);
  assert.ok(quicker.totalInterest < base.totalInterest);
  assert.equal(quicker.rows.at(-1).balance, 0);
  near(
    quicker.rows.reduce((sum, r) => sum + r.principal, 0),
    250000,
    1e-6,
  );
});

test('a loan with no interest splits the amount evenly', () => {
  const loan = loanSchedule({ amount: 1200, rate: 0, years: 1, m: 12 });
  assert.equal(loan.payment, 100);
  assert.equal(loan.totalInterest, 0);
  assert.equal(loan.rows.length, 12);
});

test('yearly rows add up the periods of each year', () => {
  const loan = loanSchedule({ amount: 10000, rate: 0.06, years: 3, m: 12 });
  const years = yearlyRows(loan.rows, 12);
  assert.equal(years.length, 3);
  near(
    years.reduce((sum, y) => sum + y.interest, 0),
    loan.totalInterest,
    1e-9,
  );
  assert.equal(years.at(-1).balance, 0);
  assert.equal(yearlyRows(loanSchedule({ amount: 1000, rate: 0.05, years: 2, m: 4 }).rows, 4).length, 2);
});

test('net present value, internal rate of return, and payback', () => {
  near(npv(0.1, [-1000, 600, 600]), 41.3223140496, 1e-9);
  near(internalRates([-1000, 0, 0, 1331])[0], 0.1, 1e-9);
  near(internalRates([-100, 110])[0], 0.1, 1e-9);
  near(internalRates([-1000, 300, 400, 500, 200])[0], 0.1532213788, 1e-9);
  near(npv(internalRates([-1000, 300, 400, 500, 200])[0], [-1000, 300, 400, 500, 200]), 0, 1e-6);
  assert.deepEqual(internalRates([100, 200]), []);
  assert.deepEqual(internalRates([-100, -200]), []);
  const several = internalRates([-100, 230, -132]);
  assert.equal(several.length, 2);
  near(several[0], 0.1, 1e-9);
  near(several[1], 0.2, 1e-9);
  near(payback([-1000, 300, 400, 500, 200]), 2.6, 1e-12);
  assert.equal(payback([-1000, 100]), null);
  assert.equal(payback([1000, 100]), null);
});

/* ---------------------------------------------------------------- the tab */

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};

const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { duration, money, percent } = await import('../js/tools/finance.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const finance = TOOLS.finance;
const tab = app.addTab({ type: 'finance' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const q = (s) => panel().querySelector(s);
const qa = (s) => [...panel().querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const mode = (name) => click(qa('.st-modes button').find((b) => b.textContent === name));
const input = (label) => qa('input, textarea, select').find((el) => el.getAttribute('aria-label') === label);
const tile = (label) =>
  qa('.st-tile')
    .find((t) => t.querySelector('.st-tile-label').textContent === label)
    ?.querySelector('.st-tile-value').textContent;
const settle = () => tick(260);

test('the finance tab is registered and opens on compound interest with a chart', () => {
  assert.equal(finance.name, 'Finance');
  assert.equal(tab.state.mode, 'compound');
  assert.equal(q('.panel-error'), null);
  assert.equal(q('canvas').hidden, false);
  assert.equal(tile('Total put in'), '13,000.00');
  assert.match(tile('Final balance'), /^17,175\.24$/);
});

test('editing a field updates the result and the saved state', async () => {
  type(window, input('Starting amount'), '2000');
  type(window, input('Regular contribution'), '');
  type(window, input('Annual interest rate (%)'), '5');
  type(window, input('Years'), '10');
  await settle();
  assert.equal(tab.state.compound.principal, '2000');
  assert.equal(tile('Total put in'), '2,000.00');
  assert.equal(tile('Final balance'), '3,294.02');
  assert.match(panel().textContent, /Year by year/);
});

test('a bad value gives a message that says how to fix it, and no chart', async () => {
  type(window, input('Years'), '0');
  await settle();
  assert.match(q('.st-note').textContent, /years above 0/);
  assert.equal(q('canvas').hidden, true);
  type(window, input('Years'), '10');
  await settle();
  assert.equal(q('.st-note'), null);
});

test('inflation shows the final balance in today\u2019s money', async () => {
  type(window, input('Inflation rate (%)'), '3');
  await settle();
  assert.match(panel().textContent, /Final balance in today.s money/);
  type(window, input('Inflation rate (%)'), '0');
  await settle();
});

test('savings goal finds the contribution', async () => {
  mode('Savings goal');
  type(window, input('Goal amount'), '100000');
  type(window, input('Starting amount'), '');
  type(window, input('Years'), '20');
  await settle();
  assert.equal(tile('Contribution, monthly'), '243.29');
  type(window, input('Starting amount'), '90000');
  await settle();
  assert.equal(tile('Contribution, monthly'), '0.00');
  assert.match(q('.st-callout').textContent, /no contributions are needed/);
});

test('loan payments, with extra payments', async () => {
  mode('Loan payments');
  assert.equal(tile('Payment'), '1,580.17');
  assert.equal(tile('Time to pay off'), '30 years');
  type(window, input('Extra payment each period'), '200');
  await settle();
  assert.equal(tile('Payment with extra'), '1,780.17');
  assert.match(panel().textContent, /Interest saved/);
  assert.match(panel().textContent, /Time saved/);
  assert.equal(qa('.calc-table tbody tr').length > 20, true);
  type(window, input('Loan amount'), '-5');
  await settle();
  assert.match(q('.st-note').textContent, /loan amount above 0/);
});

test('present and future value solves for the chosen unknown', async () => {
  mode('Present and future value');
  assert.equal(tile('Future value'), '1,628.89');
  assert.equal(input('Future value'), undefined);
  const solve = input('Solve for');
  solve.value = 'years';
  solve.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.ok(input('Future value'));
  assert.equal(input('Years'), undefined);
  type(window, input('Present value'), '1000');
  type(window, input('Future value'), '2000');
  type(window, input('Annual interest rate (%)'), '7');
  await settle();
  assert.equal(tile('Time needed'), '10 years 3 months');
  type(window, input('Annual interest rate (%)'), '0');
  await settle();
  assert.match(q('.st-note').textContent, /never reaches/);
  solve.value = 'rate';
  solve.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
});

test('NPV and IRR read the cash flows and flag problems', async () => {
  mode('NPV and IRR');
  assert.equal(tile('IRR'), '15.3221%');
  assert.equal(tile('Payback'), '2.6 periods');
  type(window, input('Cash flows, one per period, starting with period 0'), '-1000, 0, 0, 1331');
  type(window, input('Discount rate per period (%)'), '10');
  await settle();
  assert.equal(tile('NPV'), '0.00');
  assert.equal(tile('IRR'), '10%');
  type(window, input('Cash flows, one per period, starting with period 0'), '-100, 230, -132');
  await settle();
  assert.match(q('.st-callout').textContent, /Several rates/);
  type(window, input('Cash flows, one per period, starting with period 0'), '100, 200');
  await settle();
  assert.equal(tile('IRR'), 'None');
  type(window, input('Cash flows, one per period, starting with period 0'), '-100, abc');
  await settle();
  assert.match(q('.st-note').textContent, /Could not read "abc"/);
  type(window, input('Cash flows, one per period, starting with period 0'), '-100');
  await settle();
  assert.match(q('.st-note').textContent, /at least two cash flows/);
});

test('formatting helpers', () => {
  assert.equal(money(1234.5), '1,234.50');
  assert.equal(money(-0.001), '0.00');
  assert.equal(money(Number.NaN), 'undefined');
  assert.equal(percent(0.05), '5%');
  assert.equal(duration(0.5), '6 months');
  assert.equal(duration(1), '1 year');
  assert.equal(duration(2.25), '2 years 3 months');
  assert.equal(duration(Number.NaN), 'undefined');
});

test('finance state normalises hostile input and survives a reload', () => {
  const hostile = {
    mode: 'zzz',
    compound: { compounding: 'hourly', rate: 5, years: { a: 1 } },
    flows: { cashflows: 7 },
    tvm: [],
  };
  const state = finance.normalize(hostile);
  assert.equal(state.mode, 'compound');
  assert.equal(state.compound.compounding, 'monthly');
  assert.equal(state.compound.years, '10');
  assert.equal(state.flows.cashflows, '-1000, 300, 400, 500, 200');
  assert.deepEqual(finance.normalize(state), state);
  assert.equal(finance.normalize({ flows: { cashflows: 'x'.repeat(5000) } }).flows.cashflows.length, 600);
  assert.equal(finance.normalize({ compound: { rate: '1\n2' } }).compound.rate, '1 2');
});
