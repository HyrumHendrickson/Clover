/**
 * Statistics: descriptive summaries, probability distributions, correlation, and
 * significance tests. Pure numeric code with no DOM, so it is unit tested in Node.
 *
 * Special functions (the log-gamma function and the regularised incomplete gamma
 * and beta functions) follow the series and continued fractions in Numerical
 * Recipes; they are accurate to about 1e-12, which is more than a plot needs.
 */

const EPS = 1e-15;
const TINY = 1e-300;

/* ------------------------------------------------------- special functions */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function, for x > 0. */
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised lower incomplete gamma function P(a, x). */
export function gammaP(a, x) {
  if (!(x > 0)) return 0;
  if (!Number.isFinite(x)) return 1;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}

/** Upper incomplete gamma by continued fraction (Lentz), for x >= a + 1. */
function gammaQcf(a, x) {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaCf(x, a, b)) / a;
  return 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x, a, b) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/** The error function. */
export function erf(x) {
  const p = gammaP(0.5, x * x);
  return x < 0 ? -p : p;
}

/** Natural log of n choose k. */
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/* ------------------------------------------------------------ distributions */

export const normalPdf = (x, mean = 0, sd = 1) =>
  Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));

export function normalCdf(x, mean = 0, sd = 1) {
  const z = (x - mean) / (sd * Math.SQRT2);
  return 0.5 * (1 + erf(z));
}

/** Inverse of the standard normal CDF: Acklam's rational approximation, refined with one Halley step. */
export function normalInv(p, mean = 0, sd = 1) {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x -= u / (1 + (x * u) / 2);
  return mean + sd * x;
}

export function tCdf(t, df) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const tail = 0.5 * betaI(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

export const tPdf = (t, df) =>
  Math.exp(
    lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (t * t) / df),
  );

export const chiSqCdf = (x, df) => (x <= 0 ? 0 : gammaP(df / 2, x / 2));

export function chiSqPdf(x, df) {
  if (x < 0) return 0;
  if (x === 0) return df === 2 ? 0.5 : df < 2 ? Infinity : 0;
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - lgamma(df / 2));
}

export function binomPmf(k, n, p) {
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  return 1 - betaI(p, Math.floor(k) + 1, n - Math.floor(k));
}

export const poissonPmf = (k, lambda) =>
  !Number.isInteger(k) || k < 0 ? 0 : Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1));

export const poissonCdf = (k, lambda) => (k < 0 ? 0 : 1 - gammaP(Math.floor(k) + 1, lambda));

export const geometricPmf = (k, p) => (!Number.isInteger(k) || k < 1 ? 0 : p * (1 - p) ** (k - 1));

export const geometricCdf = (k, p) => (k < 1 ? 0 : 1 - (1 - p) ** Math.floor(k));

/**
 * Distribution descriptions. Each has `pdf` (the density, or the mass function for a
 * discrete one), `cdf`, `mean`, `sd`, a plotting `range`, and `params` to edit.
 * `make(params)` returns null when the parameters are not valid.
 */
export const DISTRIBUTIONS = {
  normal: {
    name: 'Normal',
    discrete: false,
    params: [
      { key: 'mean', label: 'Mean', value: 0 },
      { key: 'sd', label: 'Standard deviation', value: 1 },
    ],
    make: ({ mean, sd }) =>
      sd > 0
        ? {
            pdf: (x) => normalPdf(x, mean, sd),
            cdf: (x) => normalCdf(x, mean, sd),
            inv: (p) => normalInv(p, mean, sd),
            mean,
            sd,
            variance: sd * sd,
            range: [mean - 4.5 * sd, mean + 4.5 * sd],
          }
        : null,
  },
  t: {
    name: 'Student t',
    discrete: false,
    params: [{ key: 'df', label: 'Degrees of freedom', value: 10 }],
    make: ({ df }) =>
      df > 0
        ? {
            pdf: (x) => tPdf(x, df),
            cdf: (x) => tCdf(x, df),
            mean: df > 1 ? 0 : NaN,
            sd: df > 2 ? Math.sqrt(df / (df - 2)) : NaN,
            variance: df > 2 ? df / (df - 2) : NaN,
            range: [-6, 6],
          }
        : null,
  },
  chisq: {
    name: 'Chi-square',
    discrete: false,
    params: [{ key: 'df', label: 'Degrees of freedom', value: 4 }],
    make: ({ df }) =>
      df > 0
        ? {
            pdf: (x) => chiSqPdf(x, df),
            cdf: (x) => chiSqCdf(x, df),
            mean: df,
            sd: Math.sqrt(2 * df),
            variance: 2 * df,
            range: [0, df + 5 * Math.sqrt(2 * df) + 4],
          }
        : null,
  },
  uniform: {
    name: 'Uniform',
    discrete: false,
    params: [
      { key: 'a', label: 'Minimum', value: 0 },
      { key: 'b', label: 'Maximum', value: 1 },
    ],
    make: ({ a, b }) =>
      b > a
        ? {
            pdf: (x) => (x >= a && x <= b ? 1 / (b - a) : 0),
            cdf: (x) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
            inv: (p) => a + p * (b - a),
            mean: (a + b) / 2,
            sd: (b - a) / Math.sqrt(12),
            variance: (b - a) ** 2 / 12,
            range: [a - 0.25 * (b - a), b + 0.25 * (b - a)],
          }
        : null,
  },
  exponential: {
    name: 'Exponential',
    discrete: false,
    params: [{ key: 'rate', label: 'Rate', value: 1 }],
    make: ({ rate }) =>
      rate > 0
        ? {
            pdf: (x) => (x < 0 ? 0 : rate * Math.exp(-rate * x)),
            cdf: (x) => (x < 0 ? 0 : 1 - Math.exp(-rate * x)),
            inv: (p) => -Math.log(1 - p) / rate,
            mean: 1 / rate,
            sd: 1 / rate,
            variance: 1 / (rate * rate),
            range: [0, 6 / rate],
          }
        : null,
  },
  binomial: {
    name: 'Binomial',
    discrete: true,
    params: [
      { key: 'n', label: 'Trials', value: 10 },
      { key: 'p', label: 'Probability of success', value: 0.3 },
    ],
    make: ({ n, p }) =>
      Number.isInteger(n) && n >= 1 && n <= 5000 && p >= 0 && p <= 1
        ? {
            pdf: (k) => binomPmf(k, n, p),
            cdf: (k) => binomCdf(k, n, p),
            mean: n * p,
            sd: Math.sqrt(n * p * (1 - p)),
            variance: n * p * (1 - p),
            range: [0, n],
          }
        : null,
  },
  poisson: {
    name: 'Poisson',
    discrete: true,
    params: [{ key: 'lambda', label: 'Mean', value: 5 }],
    make: ({ lambda }) =>
      lambda > 0 && lambda <= 5000
        ? {
            pdf: (k) => poissonPmf(k, lambda),
            cdf: (k) => poissonCdf(k, lambda),
            mean: lambda,
            sd: Math.sqrt(lambda),
            variance: lambda,
            range: [0, Math.ceil(lambda + 5 * Math.sqrt(lambda) + 3)],
          }
        : null,
  },
  geometric: {
    name: 'Geometric',
    discrete: true,
    params: [{ key: 'p', label: 'Probability of success', value: 0.3 }],
    make: ({ p }) =>
      p > 0 && p <= 1
        ? {
            pdf: (k) => geometricPmf(k, p),
            cdf: (k) => geometricCdf(k, p),
            mean: 1 / p,
            sd: Math.sqrt(1 - p) / p,
            variance: (1 - p) / (p * p),
            range: [1, Math.ceil(6 / p) + 1],
          }
        : null,
  },
};

/** Inverse CDF of any distribution built by `make`, found by bisection when it has no closed form. */
export function inverseCdf(dist, discrete, p) {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (dist.inv) return dist.inv(p);
  let [lo, hi] = dist.range;
  if (discrete) {
    let k = Math.floor(lo);
    while (dist.cdf(k) < p && k < 1e6) k += 1;
    return k;
  }
  while (dist.cdf(lo) > p && lo > -1e12) lo = lo < 0 ? lo * 2 : lo - 1;
  while (dist.cdf(hi) < p && hi < 1e12) hi = hi > 0 ? hi * 2 : hi + 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (dist.cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------- descriptive */

const finite = (list) => list.filter((v) => typeof v === 'number' && Number.isFinite(v));
const sumOf = (list) => list.reduce((a, b) => a + b, 0);

export const mean = (list) => (list.length === 0 ? NaN : sumOf(list) / list.length);

/** Sample variance (divides by n - 1), or population variance with `population`. */
export function variance(list, population = false) {
  const n = list.length;
  if (n < (population ? 1 : 2)) return NaN;
  const m = mean(list);
  return sumOf(list.map((v) => (v - m) ** 2)) / (population ? n : n - 1);
}

export const stdev = (list, population = false) => Math.sqrt(variance(list, population));

/**
 * The p-th quantile by linear interpolation between order statistics (the common
 * "inclusive" definition, R type 7: position (n - 1)p in the sorted list).
 */
export function quantile(list, p) {
  if (list.length === 0 || !(p >= 0 && p <= 1)) return NaN;
  const sorted = [...list].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (list) => quantile(list, 0.5);

/** Values that occur most often. Empty when every value is unique. */
export function modes(list) {
  const counts = new Map();
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  if (top <= 1) return [];
  return [...counts]
    .filter(([, c]) => c === top)
    .map(([v]) => v)
    .sort((a, b) => a - b);
}

export function meanAbsoluteDeviation(list) {
  const m = mean(list);
  return mean(list.map((v) => Math.abs(v - m)));
}

export function covariance(xs, ys, population = false) {
  if (xs.length !== ys.length || xs.length < (population ? 1 : 2)) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  return sumOf(xs.map((x, i) => (x - mx) * (ys[i] - my))) / (population ? xs.length : xs.length - 1);
}

export function correlation(xs, ys) {
  const c = covariance(xs, ys);
  const d = stdev(xs) * stdev(ys);
  return d === 0 ? NaN : c / d;
}

/** Ranks with ties given their average rank. */
export function ranks(list) {
  const order = list.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(list.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export const spearman = (xs, ys) => correlation(ranks(xs), ranks(ys));

/**
 * Everything a summary table shows for a list of numbers. Non-numbers are ignored.
 * @returns {object | null} null when the list is empty
 */
export function summarize(raw) {
  const data = finite(raw);
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  return {
    n: data.length,
    sum: sumOf(data),
    sumSquares: sumOf(data.map((v) => v * v)),
    mean: mean(data),
    median: quantile(sorted, 0.5),
    modes: modes(data),
    min: sorted[0],
    q1,
    q3,
    max: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
    iqr,
    sd: stdev(data),
    sdp: stdev(data, true),
    variance: variance(data),
    mad: meanAbsoluteDeviation(data),
    lowFence,
    highFence,
    outliers: sorted.filter((v) => v < lowFence || v > highFence),
  };
}

/**
 * Bin values into intervals of `width`. Bins are aligned to multiples of the width, so
 * a width of 1 puts 2.5 in the bin from 2 to 3.
 * @returns {{ start: number, end: number, count: number }[]}
 */
export function histogramBins(raw, width) {
  const data = finite(raw);
  if (data.length === 0 || !(width > 0)) return [];
  const lo = Math.floor(Math.min(...data) / width);
  const hi = Math.floor(Math.max(...data) / width);
  if (hi - lo > 2000) return [];
  const bins = Array.from({ length: hi - lo + 1 }, (_, i) => ({
    start: (lo + i) * width,
    end: (lo + i + 1) * width,
    count: 0,
  }));
  for (const v of data) bins[Math.floor(v / width) - lo].count += 1;
  return bins;
}

/** A bin width of the "Freedman-Diaconis" kind, rounded to one or two significant figures. */
export function suggestedBinWidth(raw) {
  const data = finite(raw);
  if (data.length < 2) return 1;
  const iqr = quantile(data, 0.75) - quantile(data, 0.25);
  const range = Math.max(...data) - Math.min(...data);
  const raw1 = iqr > 0 ? (2 * iqr) / Math.cbrt(data.length) : range / Math.max(1, Math.ceil(Math.sqrt(data.length)));
  if (!(raw1 > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw1));
  const lead = raw1 / pow;
  const nice = lead < 1.5 ? 1 : lead < 3.5 ? 2 : lead < 7.5 ? 5 : 10;
  return nice * pow;
}

/* ------------------------------------------------------------------- tests */

/** Turn a statistic and its CDF into left, right, and two-sided p-values. */
function pValues(score, cdf) {
  const left = cdf(score);
  const right = 1 - left;
  return { left, right, two: Math.min(1, 2 * Math.min(left, right)) };
}

/** A confidence interval estimate +/- critical * stderr. */
const interval = (estimate, critical, stderr) => ({
  lower: estimate - critical * stderr,
  upper: estimate + critical * stderr,
});

/**
 * One-sample z-test of a mean with known population standard deviation.
 * `sample` is a list, or `{ n, mean }`.
 */
export function zTest(sample, { sigma, mu0 = 0, level = 0.95 }) {
  const n = Array.isArray(sample) ? sample.length : sample.n;
  const xbar = Array.isArray(sample) ? mean(sample) : sample.mean;
  if (!(n >= 1) || !(sigma > 0)) return null;
  const stderr = sigma / Math.sqrt(n);
  const score = (xbar - mu0) / stderr;
  return {
    name: 'One-sample z-test',
    estimate: xbar,
    stderr,
    score,
    dof: null,
    ...pValues(score, (z) => normalCdf(z)),
    ci: interval(xbar, normalInv(1 - (1 - level) / 2), stderr),
  };
}

/** One-sample t-test of a mean. `sample` is a list, or `{ n, mean, sd }`. */
export function tTest(sample, { mu0 = 0, level = 0.95 }) {
  const n = Array.isArray(sample) ? sample.length : sample.n;
  const xbar = Array.isArray(sample) ? mean(sample) : sample.mean;
  const s = Array.isArray(sample) ? stdev(sample) : sample.sd;
  if (!(n >= 2) || !(s >= 0) || s === 0) return null;
  const stderr = s / Math.sqrt(n);
  const score = (xbar - mu0) / stderr;
  const dof = n - 1;
  return {
    name: 'One-sample t-test',
    estimate: xbar,
    stderr,
    score,
    dof,
    ...pValues(score, (t) => tCdf(t, dof)),
    ci: interval(xbar, tInv(1 - (1 - level) / 2, dof), stderr),
  };
}

/** Welch's two-sample t-test of the difference of means (sample 1 minus sample 2). */
export function tTestTwo(a, b, { level = 0.95, diff0 = 0 } = {}) {
  const sa = Array.isArray(a) ? { n: a.length, mean: mean(a), sd: stdev(a) } : a;
  const sb = Array.isArray(b) ? { n: b.length, mean: mean(b), sd: stdev(b) } : b;
  if (!(sa.n >= 2 && sb.n >= 2)) return null;
  const va = (sa.sd * sa.sd) / sa.n;
  const vb = (sb.sd * sb.sd) / sb.n;
  const stderr = Math.sqrt(va + vb);
  if (!(stderr > 0)) return null;
  const estimate = sa.mean - sb.mean;
  const score = (estimate - diff0) / stderr;
  const dof = (va + vb) ** 2 / ((va * va) / (sa.n - 1) + (vb * vb) / (sb.n - 1));
  return {
    name: 'Two-sample t-test (Welch)',
    estimate,
    stderr,
    score,
    dof,
    ...pValues(score, (t) => tCdf(t, dof)),
    ci: interval(estimate, tInv(1 - (1 - level) / 2, dof), stderr),
  };
}

/** z-test of one proportion: `successes` out of `n`, against `p0`. */
export function zPropTest(successes, n, { p0 = 0.5, level = 0.95 } = {}) {
  if (!(n >= 1) || successes < 0 || successes > n || !(p0 > 0 && p0 < 1)) return null;
  const phat = successes / n;
  const stderr = Math.sqrt((p0 * (1 - p0)) / n);
  const score = (phat - p0) / stderr;
  const ciSe = Math.sqrt((phat * (1 - phat)) / n);
  return {
    name: 'One-proportion z-test',
    estimate: phat,
    stderr,
    score,
    dof: null,
    ...pValues(score, (z) => normalCdf(z)),
    ci: interval(phat, normalInv(1 - (1 - level) / 2), ciSe),
  };
}

/** z-test of the difference of two proportions, using the pooled estimate for the test. */
export function zPropTestTwo(x1, n1, x2, n2, { level = 0.95 } = {}) {
  if (!(n1 >= 1 && n2 >= 1) || x1 < 0 || x1 > n1 || x2 < 0 || x2 > n2) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const stderr = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (!(stderr > 0)) return null;
  const score = (p1 - p2) / stderr;
  const ciSe = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  return {
    name: 'Two-proportion z-test',
    estimate: p1 - p2,
    stderr,
    score,
    dof: null,
    ...pValues(score, (z) => normalCdf(z)),
    ci: interval(p1 - p2, normalInv(1 - (1 - level) / 2), ciSe),
  };
}

/** Inverse t CDF by bisection. */
export function tInv(p, df) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Chi-square goodness of fit of observed counts against expected counts (equal shares by default). */
export function chiSqGof(observed, expected = null) {
  const k = observed.length;
  if (k < 2 || observed.some((o) => !(o >= 0))) return null;
  const total = sumOf(observed);
  let exp = expected;
  if (exp === null) exp = observed.map(() => total / k);
  else if (exp.length === k) {
    const e = sumOf(exp);
    if (!(e > 0) || exp.some((v) => !(v > 0))) return null;
    exp = exp.map((v) => (v * total) / e);
  } else return null;
  const score = sumOf(observed.map((o, i) => (o - exp[i]) ** 2 / exp[i]));
  const dof = k - 1;
  return { name: 'Chi-square goodness of fit', score, dof, expected: exp, p: 1 - chiSqCdf(score, dof) };
}

/** Chi-square test of independence for a table of counts (an array of equal-length rows). */
export function chiSqIndependence(table) {
  const rows = table.length;
  const cols = table[0]?.length ?? 0;
  if (rows < 2 || cols < 2 || table.some((r) => r.length !== cols || r.some((v) => !(v >= 0)))) return null;
  const rowTotals = table.map(sumOf);
  const colTotals = Array.from({ length: cols }, (_, j) => sumOf(table.map((r) => r[j])));
  const total = sumOf(rowTotals);
  if (!(total > 0) || rowTotals.includes(0) || colTotals.includes(0)) return null;
  const expected = table.map((_, i) => colTotals.map((c) => (rowTotals[i] * c) / total));
  const score = sumOf(table.map((r, i) => sumOf(r.map((o, j) => (o - expected[i][j]) ** 2 / expected[i][j]))));
  const dof = (rows - 1) * (cols - 1);
  return { name: 'Chi-square test of independence', score, dof, expected, p: 1 - chiSqCdf(score, dof) };
}

/* ------------------------------------------------------------ shape and intervals */

/**
 * Skewness (adjusted Fisher-Pearson, G1) and excess kurtosis (G2) of a sample, the same definitions SciPy uses with
 * `bias=False`. Each is null when the sample is too small (3 values for skewness, 4 for kurtosis) or has no spread.
 */
export function shape(raw) {
  const data = finite(raw);
  const n = data.length;
  const s = stdev(data);
  if (n < 3 || !(s > 0)) return { skewness: null, kurtosis: null };
  const m = mean(data);
  const z = data.map((v) => (v - m) / s);
  const skewness = (n / ((n - 1) * (n - 2))) * sumOf(z.map((v) => v ** 3));
  const kurtosis =
    n < 4
      ? null
      : ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sumOf(z.map((v) => v ** 4)) -
        (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return { skewness, kurtosis };
}

/**
 * A t confidence interval for the mean of a sample.
 * @returns {{ mean: number, stderr: number, lower: number, upper: number, dof: number } | null} null for fewer than two values
 */
export function meanInterval(raw, level = 0.95) {
  const data = finite(raw);
  if (data.length < 2 || !(level > 0 && level < 1)) return null;
  const m = mean(data);
  const dof = data.length - 1;
  const stderr = stdev(data) / Math.sqrt(data.length);
  const crit = tInv(1 - (1 - level) / 2, dof);
  return { mean: m, stderr, lower: m - crit * stderr, upper: m + crit * stderr, dof };
}
