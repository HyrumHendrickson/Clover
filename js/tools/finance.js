import {
  MAX_FIELD,
  amountOf,
  callout,
  chartPane,
  firstProblem,
  grid,
  inputKit,
  legend,
  modeButtons,
  note,
  numberOf,
  pick,
  table,
  text,
  tiles,
  valueRange,
} from '../core/calcui.js';
import { debounce, h, onResize } from '../core/dom.js';
import {
  COMPOUNDING,
  FREQUENCIES,
  doublingTime,
  effectiveRate,
  growth,
  internalRates,
  loanSchedule,
  npv,
  payback,
  paymentCount,
  perYear,
  requiredContribution,
  savingsSeries,
  solveLumpSum,
  yearlyRows,
} from '../lib/finance.js';
import { formatNumber } from '../lib/graph/values.js';
import { fitCanvas } from '../lib/viewport.js';

const MAX_FLOWS = 60;
const MAX_FLOWS_TEXT = 600;

const MODES = [
  ['compound', 'Compound interest'],
  ['goal', 'Savings goal'],
  ['loan', 'Loan payments'],
  ['tvm', 'Present and future value'],
  ['flows', 'NPV and IRR'],
];
const TIMING = [
  ['end', 'End of each period'],
  ['start', 'Start of each period'],
];
const SOLVE = [
  ['fv', 'Future value'],
  ['pv', 'Present value'],
  ['rate', 'Interest rate'],
  ['years', 'Number of years'],
];
const LOAN_FREQUENCIES = FREQUENCIES.filter(([key]) => key !== 'daily');

const DEFAULTS = {
  compound: {
    principal: '1000',
    rate: '5',
    years: '10',
    compounding: 'monthly',
    contribution: '100',
    frequency: 'monthly',
    timing: 'end',
    inflation: '0',
  },
  goal: {
    target: '100000',
    start: '0',
    rate: '5',
    years: '20',
    compounding: 'monthly',
    frequency: 'monthly',
    timing: 'end',
  },
  loan: { amount: '250000', rate: '6.5', years: '30', frequency: 'monthly', extra: '0' },
  tvm: { solve: 'fv', pv: '1000', fv: '2000', rate: '5', years: '10', compounding: 'annual' },
  flows: { rate: '10', cashflows: '-1000, 300, 400, 500, 200' },
};

/** Which fields of each section are selections, and from what. */
const CHOICES = {
  compound: { compounding: COMPOUNDING, frequency: FREQUENCIES, timing: TIMING },
  goal: { compounding: COMPOUNDING, frequency: FREQUENCIES, timing: TIMING },
  loan: { frequency: LOAN_FREQUENCIES },
  tvm: { solve: SOLVE, compounding: COMPOUNDING },
  flows: {},
};

/* ------------------------------------------------------------------- state */

function normalizeSection(name, raw) {
  const given = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS[name])) {
    const list = CHOICES[name][key];
    if (list) out[key] = pick(given[key], list, fallback);
    else out[key] = text(given[key], key === 'cashflows' ? MAX_FLOWS_TEXT : MAX_FIELD, fallback);
  }
  return out;
}

const normalize = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: pick(r.mode, MODES, 'compound'),
    compound: normalizeSection('compound', r.compound),
    goal: normalizeSection('goal', r.goal),
    loan: normalizeSection('loan', r.loan),
    tvm: normalizeSection('tvm', r.tvm),
    flows: normalizeSection('flows', r.flows),
  };
};

/* ----------------------------------------------------------------- display */

/** An amount with thousands separators and two decimals. */
export function money(value) {
  if (!Number.isFinite(value)) return 'undefined';
  if (Math.abs(value) >= 1e15) return formatNumber(value, 6);
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A rate given as a decimal, shown as a percent. */
export const percent = (rate) => `${formatNumber(rate * 100, 6)}%`;

/** A length of time in years, as years and months. */
export function duration(years) {
  if (!Number.isFinite(years)) return 'undefined';
  const months = Math.round(years * 12);
  if (months >= 12000) return `${formatNumber(years, 6)} years`;
  const whole = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (whole > 0) parts.push(`${whole} ${whole === 1 ? 'year' : 'years'}`);
  if (rest > 0 || whole === 0) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}

const labelOf = (list, key) => list.find(([k]) => k === key)?.[1] ?? '';

const yearCell = (year) => formatNumber(year, 4);

/* -------------------------------------------------------------------- tool */

export default {
  type: 'finance',
  name: 'Finance',
  description: 'Compound interest, savings goals, loan payments, present and future value, and NPV and IRR.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const left = width * 0.12;
    const right = width * 0.9;
    const base = height * 0.82;
    const top = height * 0.16;
    const curve = (t) => base - (base - top) * ((Math.exp(2.2 * t) - 1) / (Math.exp(2.2) - 1));
    const line = (fn, color) => {
      ctx.beginPath();
      for (let i = 0; i <= 40; i += 1) {
        const t = i / 40;
        const x = left + (right - left) * t;
        if (i === 0) ctx.moveTo(x, fn(t));
        else ctx.lineTo(x, fn(t));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    };
    line((t) => base - (base - curve(0.55)) * t, colors.b);
    line(curve, colors.a);
  },

  mount(root, ctx) {
    const state = ctx.state;

    const modeBar = h('div', { class: 'btn-group st-modes', role: 'group', 'aria-label': 'What to calculate' });
    const controls = h('div', { class: 'st-controls' });
    const results = h('div', { class: 'st-results', 'aria-live': 'polite' });
    const pane = chartPane('Chart of the result');
    const key = h('div', { class: 'calc-key' });
    const output = h('div', { class: 'st-output' }, h('div', { class: 'st-charts' }, pane.canvas, key), results);

    const save = () => ctx.save();
    const refreshLater = debounce(() => refresh(), 200);
    const { textInput, areaInput, choice } = inputKit({
      save,
      refresh: () => refresh(),
      refreshSoon: () => refreshLater(),
      rebuild: () => buildControls(),
    });

    /* ----------------------------------------------------------- results */

    const fail = (message) => ({ out: [note(message)], spec: null, colors: [] });

    function compound() {
      const c = state.compound;
      const principal = amountOf(c.principal);
      const pmt = amountOf(c.contribution);
      const rate = numberOf(c.rate) / 100;
      const years = numberOf(c.years);
      const inflation = amountOf(c.inflation) / 100;
      const n = perYear(c.compounding);
      const m = perYear(c.frequency, FREQUENCIES);
      const due = c.timing === 'start';
      const problem = firstProblem([
        [!(principal >= 0), 'Enter a starting amount of 0 or more, or leave it blank for none.'],
        [!Number.isFinite(pmt), 'Enter the contribution as a number, or leave it blank for none.'],
        [!(rate > -1 && rate <= 10), 'Enter the interest rate as a percent from -99 to 1000, like 5 for 5%.'],
        [!(years > 0 && years <= 100), 'Enter a number of years above 0 and up to 100.'],
        [!(inflation > -1), 'Enter inflation as a percent above -100, or leave it blank.'],
      ]);
      if (problem) return fail(problem);

      const plan = { principal, rate, n, pmt, m, due };
      const series = savingsSeries(plan, years);
      const last = series.at(-1);
      const rows = [];
      if (pmt !== 0) rows.push(['Contributions made', String(paymentCount(m, years, due))]);
      const doubling = doublingTime(rate, n);
      if (principal > 0 && Number.isFinite(doubling))
        rows.push(['Years for the starting amount to double', formatNumber(doubling, 5)]);
      if (inflation !== 0)
        rows.push(['Final balance in today\u2019s money', money(last.balance / (1 + inflation) ** years)]);

      const balances = series.map((r) => [r.year, r.balance]);
      const paid = series.map((r) => [r.year, r.paid]);
      const spec = {
        x: [0, years],
        y: valueRange([...balances, ...paid].map((p) => p[1])),
        xLabel: '',
        yLabel: 'Balance by year',
        layers: [
          { kind: 'line', pts: paid, role: 'fit' },
          { kind: 'line', pts: balances, role: 'curve' },
        ],
      };
      return {
        out: [
          tiles([
            ['Final balance', money(last.balance)],
            ['Total put in', money(last.paid)],
            ['Interest earned', money(last.interest)],
            ['Effective annual rate', percent(effectiveRate(rate, n))],
          ]),
          rows.length > 0 ? table(rows) : null,
          h(
            'details',
            { class: 'st-more' },
            h('summary', {}, 'Year by year'),
            grid(
              ['Year', 'Put in', 'Interest', 'Balance'],
              series.map((r) => [yearCell(r.year), money(r.paid), money(r.interest), money(r.balance)]),
            ),
          ),
        ],
        spec,
        description: `Balance over ${formatNumber(years, 4)} years, ending at ${money(last.balance)}.`,
        colors: [
          ['a', 'Balance'],
          ['b', 'Total put in'],
        ],
      };
    }

    function goal() {
      const g = state.goal;
      const target = numberOf(g.target);
      const start = amountOf(g.start);
      const rate = numberOf(g.rate) / 100;
      const years = numberOf(g.years);
      const n = perYear(g.compounding);
      const m = perYear(g.frequency, FREQUENCIES);
      const due = g.timing === 'start';
      const problem = firstProblem([
        [!(target > 0), 'Enter a goal above 0.'],
        [!(start >= 0), 'Enter a starting amount of 0 or more, or leave it blank for none.'],
        [!(rate > -1 && rate <= 10), 'Enter the interest rate as a percent from -99 to 1000, like 5 for 5%.'],
        [!(years > 0 && years <= 100), 'Enter a number of years above 0 and up to 100.'],
      ]);
      if (problem) return fail(problem);

      const required = requiredContribution({ target, start, rate, n, m, years, due });
      if (!Number.isFinite(required)) return fail('No contribution fits those values. Check the rate and the years.');
      const series = savingsSeries({ principal: start, rate, n, pmt: required, m, due }, years);
      const last = series.at(-1);
      const out = [
        tiles([
          [`Contribution, ${labelOf(FREQUENCIES, g.frequency).toLowerCase()}`, money(required)],
          ['Total put in', money(last.paid)],
          ['Interest earned', money(last.interest)],
          ['Final balance', money(last.balance)],
        ]),
      ];
      if (required === 0)
        out.push(callout('The starting amount alone grows past the goal, so no contributions are needed.', true));
      out.push(
        table([
          ['Contributions made', String(paymentCount(m, years, due))],
          ['Effective annual rate', percent(effectiveRate(rate, n))],
        ]),
      );
      const balances = series.map((r) => [r.year, r.balance]);
      return {
        out,
        spec: {
          x: [0, years],
          y: valueRange([...balances.map((p) => p[1]), target]),
          xLabel: '',
          yLabel: 'Balance by year',
          layers: [
            { kind: 'hline', y: target },
            { kind: 'line', pts: balances, role: 'curve' },
          ],
        },
        description: `Balance growing to the goal of ${money(target)} over ${formatNumber(years, 4)} years.`,
        colors: [
          ['a', 'Balance'],
          ['axis', 'Goal'],
        ],
      };
    }

    function loan() {
      const l = state.loan;
      const amount = numberOf(l.amount);
      const rate = numberOf(l.rate) / 100;
      const years = numberOf(l.years);
      const extra = amountOf(l.extra);
      const m = perYear(l.frequency, FREQUENCIES);
      const problem = firstProblem([
        [!(amount > 0), 'Enter a loan amount above 0.'],
        [!(rate >= 0 && rate <= 1), 'Enter the interest rate as a percent from 0 to 100, like 6.5.'],
        [!(years > 0 && years <= 60), 'Enter a term above 0 and up to 60 years.'],
        [Math.round(years * m) < 1, 'The term is shorter than one payment. Lengthen it or pay more often.'],
        [!(extra >= 0), 'Enter the extra payment as 0 or more, or leave it blank for none.'],
      ]);
      if (problem) return fail(problem);

      const base = loanSchedule({ amount, rate, years, m });
      const plan = extra > 0 ? loanSchedule({ amount, rate, years, m, extra }) : base;
      const tileRows = [
        [extra > 0 ? 'Payment with extra' : 'Payment', money(base.payment + extra)],
        ['Total interest', money(plan.totalInterest)],
        ['Total paid', money(plan.totalPaid)],
        ['Time to pay off', duration(plan.rows.length / m)],
      ];
      const rows = [['Payments made', String(plan.rows.length)]];
      if (extra > 0) {
        rows.unshift(['Regular payment', money(base.payment)]);
        rows.push(['Interest saved', money(base.totalInterest - plan.totalInterest)]);
        rows.push(['Time saved', duration((base.rows.length - plan.rows.length) / m)]);
      }

      let running = 0;
      const owed = [[0, amount]];
      const interest = [[0, 0]];
      for (const row of plan.rows) {
        running += row.interest;
        owed.push([row.period / m, row.balance]);
        interest.push([row.period / m, running]);
      }
      const yearly = yearlyRows(plan.rows, m);
      return {
        out: [
          tiles(tileRows),
          table(rows),
          h(
            'details',
            { class: 'st-more' },
            h('summary', {}, 'Year by year'),
            grid(
              ['Year', 'Interest', 'Principal', 'Balance'],
              yearly.map((r) => [String(r.year), money(r.interest), money(r.principal), money(r.balance)]),
            ),
          ),
        ],
        spec: {
          x: [0, plan.rows.length / m],
          y: valueRange([amount, running]),
          xLabel: '',
          yLabel: 'Amount by year',
          layers: [
            { kind: 'line', pts: interest, role: 'fit' },
            { kind: 'line', pts: owed, role: 'curve' },
          ],
        },
        description: `Loan balance falling to zero over ${duration(plan.rows.length / m)}.`,
        colors: [
          ['a', 'Balance still owed'],
          ['b', 'Interest paid so far'],
        ],
      };
    }

    function valueTime() {
      const t = state.tvm;
      const n = perYear(t.compounding);
      const pv = numberOf(t.pv);
      const fv = numberOf(t.fv);
      const rate = numberOf(t.rate) / 100;
      const years = numberOf(t.years);
      const needs = (name) => t.solve !== name;
      const problem = firstProblem([
        [needs('pv') && !Number.isFinite(pv), 'Enter the present value as a number.'],
        [needs('fv') && !Number.isFinite(fv), 'Enter the future value as a number.'],
        [
          needs('rate') && !(rate > -1 && rate <= 10),
          'Enter the interest rate as a percent from -99 to 1000, like 5 for 5%.',
        ],
        [needs('years') && !(years > 0 && years <= 1000), 'Enter a number of years above 0 and up to 1000.'],
      ]);
      if (problem) return fail(problem);

      const answer = solveLumpSum(t.solve, { pv, fv, rate, n, years });
      if (!Number.isFinite(answer)) {
        const reasons = {
          rate: 'No rate takes the present value to the future value. They need the same sign, and the years must be above 0.',
          years:
            'The money never reaches that value at this rate. A growing amount needs a rate above 0; a shrinking one, below 0.',
        };
        return fail(reasons[t.solve] ?? 'Those values have no answer. Check each one.');
      }
      const solved = {
        pv: t.solve === 'pv' ? answer : pv,
        fv: t.solve === 'fv' ? answer : fv,
        rate: t.solve === 'rate' ? answer : rate,
        years: t.solve === 'years' ? answer : years,
      };
      const headline = {
        fv: ['Future value', money(answer)],
        pv: ['Present value', money(answer)],
        rate: ['Interest rate', percent(answer)],
        years: ['Time needed', duration(answer)],
      }[t.solve];
      const factor = growth(solved.rate, n, solved.years);
      const rows = [
        ['Present value', money(solved.pv)],
        ['Future value', money(solved.fv)],
        ['Interest rate, nominal', percent(solved.rate)],
        ['Compounding', labelOf(COMPOUNDING, t.compounding)],
        ['Years', formatNumber(solved.years, 6)],
        ['Effective annual rate', percent(effectiveRate(solved.rate, n))],
        ['Growth factor', formatNumber(factor, 6)],
      ];
      const pts = [];
      for (let i = 0; i <= 120; i += 1) {
        const time = (solved.years * i) / 120;
        pts.push([time, solved.pv * growth(solved.rate, n, time)]);
      }
      return {
        out: [tiles([headline, ['Effective annual rate', percent(effectiveRate(solved.rate, n))]]), table(rows)],
        spec: {
          x: [0, solved.years],
          y: valueRange(
            pts.map((p) => p[1]),
            false,
          ),
          xLabel: '',
          yLabel: 'Value by year',
          layers: [{ kind: 'line', pts, role: 'curve' }],
        },
        description: `Value growing from ${money(solved.pv)} to ${money(solved.fv)} over ${formatNumber(solved.years, 4)} years.`,
        colors: [['a', 'Value of the money']],
      };
    }

    function cashFlows() {
      const f = state.flows;
      const rate = numberOf(f.rate) / 100;
      const tokens = f.cashflows.split(/[\s,;]+/).filter((token) => token !== '');
      if (tokens.length < 2)
        return fail(
          'Enter at least two cash flows, separated by commas, starting with period 0. Example: -1000, 300, 400, 500.',
        );
      if (tokens.length > MAX_FLOWS) return fail(`Use at most ${MAX_FLOWS} cash flows.`);
      const flows = tokens.map((token) => numberOf(token));
      const bad = flows.findIndex((v) => !Number.isFinite(v));
      if (bad >= 0) return fail(`Could not read "${tokens[bad]}" as a number. Separate cash flows with commas.`);
      if (!(rate > -1 && rate <= 10))
        return fail('Enter the discount rate as a percent from -99 to 1000, like 10 for 10%.');

      const value = npv(rate, flows);
      const roots = internalRates(flows);
      const repaid = payback(flows);
      const out = [
        tiles([
          ['NPV', money(value)],
          ['IRR', roots.length > 0 ? percent(roots[0]) : 'None'],
          ['Payback', repaid === null ? 'Not repaid' : `${formatNumber(repaid, 4)} periods`],
          ['Sum of cash flows', money(flows.reduce((a, b) => a + b, 0))],
        ]),
      ];
      if (roots.length > 1)
        out.push(
          callout(
            `Several rates give an NPV of zero: ${roots.map(percent).join(', ')}. The IRR is not unique when cash flows change sign more than once.`,
          ),
        );
      else if (roots.length === 0)
        out.push(
          note(
            'There is no internal rate of return between -99% and 1000%. The flows need at least one negative and one positive amount.',
          ),
        );
      const rows = [
        ['Discount rate per period', percent(rate)],
        ['Periods after the first', String(flows.length - 1)],
      ];
      if (flows[0] < 0) rows.push(['Profitability index', formatNumber((value - flows[0]) / -flows[0], 6)]);
      out.push(table(rows));

      const anchor = roots[0] ?? rate;
      const lo = Math.max(-0.9, Math.min(0, rate, anchor * 1.5));
      const hi = Math.max(0.2, rate * 1.2, anchor * 1.5);
      const pts = [];
      for (let i = 0; i <= 120; i += 1) {
        const r = lo + ((hi - lo) * i) / 120;
        pts.push([r * 100, npv(r, flows)]);
      }
      const layers = [
        { kind: 'hline', y: 0 },
        { kind: 'line', pts, role: 'curve' },
      ];
      if (roots.length > 0) layers.push({ kind: 'vline', x: roots[0] * 100, label: `IRR ${percent(roots[0])}` });
      return {
        out,
        spec: {
          x: [lo * 100, hi * 100],
          y: valueRange([0, ...pts.map((p) => p[1])], false),
          xLabel: '',
          yLabel: 'NPV by discount rate (%)',
          layers,
        },
        description: `Net present value as the discount rate changes${roots.length > 0 ? `, crossing zero at ${percent(roots[0])}` : ''}.`,
        colors: [['a', 'NPV']],
      };
    }

    function refresh() {
      refreshLater.cancel();
      const compute = { compound, goal, loan, tvm: valueTime, flows: cashFlows }[state.mode];
      const { out, spec, description, colors } = compute();
      results.replaceChildren(...out.filter(Boolean));
      key.replaceChildren(...(colors.length > 0 ? [legend(colors)] : []));
      output.classList.toggle('calc-no-chart', spec === null);
      pane.show(spec, description);
    }

    /* ---------------------------------------------------------- controls */

    function buildModes() {
      modeBar.replaceChildren(
        ...modeButtons(MODES, state.mode, (next) => {
          state.mode = next;
          save();
          buildModes();
          buildControls();
          refresh();
        }),
      );
    }

    function buildControls() {
      const s = state[state.mode];
      const rate = (label = 'Annual interest rate (%)') => textInput(label, s, 'rate');
      const parts = {
        compound: () => [
          textInput('Starting amount', s, 'principal'),
          rate(),
          textInput('Years', s, 'years'),
          choice('Interest compounds', s, 'compounding', COMPOUNDING),
          textInput('Regular contribution', s, 'contribution'),
          choice('Contribution frequency', s, 'frequency', FREQUENCIES),
          choice('Contributions are made', s, 'timing', TIMING),
          textInput('Inflation rate (%)', s, 'inflation'),
        ],
        goal: () => [
          textInput('Goal amount', s, 'target'),
          textInput('Starting amount', s, 'start'),
          rate(),
          textInput('Years', s, 'years'),
          choice('Interest compounds', s, 'compounding', COMPOUNDING),
          choice('Contribution frequency', s, 'frequency', FREQUENCIES),
          choice('Contributions are made', s, 'timing', TIMING),
        ],
        loan: () => [
          textInput('Loan amount', s, 'amount'),
          rate(),
          textInput('Term in years', s, 'years'),
          choice('Payment frequency', s, 'frequency', LOAN_FREQUENCIES),
          textInput('Extra payment each period', s, 'extra'),
        ],
        tvm: () => [
          choice('Solve for', s, 'solve', SOLVE, { rebuilds: true }),
          s.solve === 'pv' ? null : textInput('Present value', s, 'pv'),
          s.solve === 'fv' ? null : textInput('Future value', s, 'fv'),
          s.solve === 'rate' ? null : rate(),
          s.solve === 'years' ? null : textInput('Years', s, 'years'),
          choice('Interest compounds', s, 'compounding', COMPOUNDING),
        ],
        flows: () => [
          rate('Discount rate per period (%)'),
          areaInput('Cash flows, one per period, starting with period 0', s, 'cashflows', {
            max: MAX_FLOWS_TEXT,
            rows: 3,
            placeholder: '-1000, 300, 400, 500',
          }),
        ],
      };
      controls.replaceChildren(...parts[state.mode]().filter(Boolean));
    }

    /* ------------------------------------------------------------ layout */

    const stage = h(
      'div',
      { class: 'calc-stage' },
      h('section', { class: 'st-options', 'aria-label': 'Calculation' }, modeBar, controls),
      output,
    );
    root.classList.add('tool', 'calc-tool');
    root.append(stage);

    const stopObserving = onResize(stage, () => pane.repaintSoon());

    buildModes();
    buildControls();
    refresh();

    return {
      onShow: () => {
        pane.activate(true);
        refresh();
      },
      onHide: () => pane.activate(false),
      destroy: () => {
        refreshLater.cancel();
        stopObserving();
        pane.destroy();
      },
    };
  },
};
