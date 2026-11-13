/**
 * Time-value-of-money arithmetic for the Finance tool. Pure functions, no DOM access.
 *
 * Rates are decimals (0.05 is 5 percent a year). `n` is compounding periods per year, with `Infinity` meaning
 * continuous compounding; `m` is payments per year. Contributions go in at the end of each period unless `due`
 * is true, in which case they go in at the start.
 */

/** Payment and compounding frequencies as [key, label, periods per year]. */
export const FREQUENCIES = [
  ['annual', 'Annually', 1],
  ['semiannual', 'Twice a year', 2],
  ['quarterly', 'Quarterly', 4],
  ['monthly', 'Monthly', 12],
  ['biweekly', 'Every two weeks', 26],
  ['weekly', 'Weekly', 52],
  ['daily', 'Daily', 365],
];

/** Compounding choices: every frequency, plus continuous compounding. */
export const COMPOUNDING = [...FREQUENCIES, ['continuous', 'Continuously', Infinity]];

/** Periods per year for a frequency key, or NaN if the key is unknown. */
export function perYear(key, list = COMPOUNDING) {
  const row = list.find(([k]) => k === key);
  return row ? row[2] : NaN;
}

/** Growth factor of 1 unit over `t` years at nominal annual `rate` compounded `n` times a year. */
export const growth = (rate, n, t) => (n === Infinity ? Math.exp(rate * t) : (1 + rate / n) ** (n * t));

/** The rate that, compounded once a year, gives the same growth as `rate` compounded `n` times. */
export const effectiveRate = (rate, n) => growth(rate, n, 1) - 1;

/** Years for money to double at nominal `rate`, or NaN when it never does. */
export function doublingTime(rate, n) {
  const factor = growth(rate, n, 1);
  return factor > 1 ? Math.LN2 / Math.log(factor) : NaN;
}

/** How many payments of `m` a year have been made after `years`. */
export function paymentCount(m, years, due = false) {
  const total = years * m;
  return Math.max(0, due ? Math.ceil(total - 1e-9) : Math.floor(total + 1e-9));
}

/**
 * Value after `years` of `pmt` paid `m` times a year, with money growing at `rate` compounded `n` times a year.
 * The payment period and the compounding period need not match.
 */
export function annuityValue(pmt, rate, n, m, years, due = false) {
  const k = paymentCount(m, years, due);
  if (k === 0) return 0;
  const g = growth(rate, n, 1 / m);
  const sum = Math.abs(g - 1) < 1e-12 ? k : (g ** k - 1) / (g - 1);
  return pmt * sum * g ** (years * m - k) * (due ? g : 1);
}

/**
 * Balance of a savings account over time.
 * @param {{ principal: number, rate: number, n: number, pmt: number, m: number, due?: boolean }} plan
 * @param {number} years
 */
export function balanceAt(plan, years) {
  const { principal, rate, n, pmt, m, due = false } = plan;
  const paid = principal + pmt * paymentCount(m, years, due);
  const balance = principal * growth(rate, n, years) + annuityValue(pmt, rate, n, m, years, due);
  return { balance, paid };
}

/** Balance at the end of each year (and at the end, if `years` is not whole). Always starts at year 0. */
export function savingsSeries(plan, years) {
  const rows = [];
  for (let year = 0; year < years; year += 1) rows.push({ year, ...balanceAt(plan, year) });
  rows.push({ year: years, ...balanceAt(plan, years) });
  return rows.map((row) => ({ ...row, interest: row.balance - row.paid }));
}

/** Contribution per payment needed to grow `start` to `target`. Zero when the start alone is enough. */
export function requiredContribution({ target, start, rate, n, m, years, due = false }) {
  const unit = annuityValue(1, rate, n, m, years, due);
  if (!(unit > 0)) return NaN;
  return Math.max(0, (target - start * growth(rate, n, years)) / unit);
}

/**
 * Solve a lump-sum problem for one unknown: `fv`, `pv`, `rate`, or `years`. Returns NaN when no answer exists,
 * for example a rate for money that changes sign.
 */
export function solveLumpSum(unknown, { pv, fv, rate, n, years }) {
  switch (unknown) {
    case 'fv':
      return pv * growth(rate, n, years);
    case 'pv':
      return fv / growth(rate, n, years);
    case 'rate': {
      const ratio = fv / pv;
      if (!(ratio > 0) || !(years > 0)) return NaN;
      return n === Infinity ? Math.log(ratio) / years : n * (ratio ** (1 / (n * years)) - 1);
    }
    case 'years': {
      const ratio = fv / pv;
      if (!(ratio > 0)) return NaN;
      const perYearGrowth = n === Infinity ? rate : n * Math.log(1 + rate / n);
      return perYearGrowth === 0 ? NaN : Math.log(ratio) / perYearGrowth;
    }
    default:
      return NaN;
  }
}

/**
 * The payment schedule of a loan paid `m` times a year. `extra` is added to every payment.
 * @returns {{ payment: number, rows: { period: number, interest: number, principal: number, balance: number }[],
 *   totalInterest: number, totalPaid: number }}
 */
export function loanSchedule({ amount, rate, years, m, extra = 0 }) {
  const periods = Math.round(years * m);
  const i = rate / m;
  const payment = i === 0 ? amount / periods : (amount * i) / (1 - (1 + i) ** -periods);
  const rows = [];
  let balance = amount;
  let totalInterest = 0;
  for (let period = 1; period <= periods && balance > 1e-9 * amount; period += 1) {
    const interest = balance * i;
    const principal = period === periods ? balance : Math.min(balance, payment + extra - interest);
    if (!(principal > 0)) break;
    balance = period === periods ? 0 : balance - principal;
    totalInterest += interest;
    rows.push({ period, interest, principal, balance });
  }
  return { payment, rows, totalInterest, totalPaid: amount + totalInterest };
}

/** Sum a loan schedule into one row per year. */
export function yearlyRows(rows, m) {
  const years = [];
  for (const row of rows) {
    const index = Math.ceil(row.period / m) - 1;
    years[index] ??= { year: index + 1, interest: 0, principal: 0, balance: 0 };
    years[index].interest += row.interest;
    years[index].principal += row.principal;
    years[index].balance = row.balance;
  }
  return years;
}

/** Net present value of `flows`, the first at period 0, discounted at `rate` per period. */
export const npv = (rate, flows) => flows.reduce((sum, flow, t) => sum + flow / (1 + rate) ** t, 0);

/**
 * Internal rates of return: every rate per period, from -99 percent up to 1000 percent, where the NPV changes sign.
 * Cash flows that change sign once have at most one; more sign changes can give several.
 */
export function internalRates(flows) {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return [];
  const roots = [];
  const step = 0.005;
  let lo = -0.99;
  let fLo = npv(lo, flows);
  for (let rate = lo + step; rate <= 10 + 1e-9; rate += step) {
    const fHi = npv(rate, flows);
    if (fLo === 0) roots.push(lo);
    else if (fLo * fHi < 0) {
      let a = lo;
      let b = rate;
      for (let i = 0; i < 100; i += 1) {
        const mid = (a + b) / 2;
        if (npv(a, flows) * npv(mid, flows) <= 0) b = mid;
        else a = mid;
      }
      roots.push((a + b) / 2);
    }
    lo = rate;
    fLo = fHi;
  }
  return roots;
}

/** Periods until the running total of `flows` first reaches zero, interpolated within the period. Null if never. */
export function payback(flows) {
  if (!(flows[0] < 0)) return null;
  let total = flows[0];
  for (let t = 1; t < flows.length; t += 1) {
    const before = total;
    total += flows[t];
    if (total >= 0) return t - 1 + -before / flows[t];
  }
  return null;
}
