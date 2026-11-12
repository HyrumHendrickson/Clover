import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/lib/stats.js';
import { MODELS, fitModel, solveLinear, levenbergMarquardt } from '../js/lib/fit.js';

// Reference values were computed with SciPy and NumPy.
const near = (got, want, tol = 1e-9, what = '') =>
  assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what} got ${got}, want ${want}`);

test('normal distribution matches reference values', () => {
  for (const [x, want] of [
    [-3, 0.0227501319482],
    [-0.5, 0.2266273523769],
    [0, 0.308537538726],
    [1, 0.5],
    [1.96, 0.6843863034838],
    [4.2, 0.9452007083004],
  ])
    near(S.normalCdf(x, 1, 2), want, 1e-11, `cdf(${x})`);
  for (const [p, want] of [
    [1e-6, -4.7534243088229],
    [0.01, -2.3263478740408],
    [0.1, -1.2815515655446],
    [0.5, 0.0],
    [0.975, 1.9599639845401],
    [0.999999, 4.7534243088171],
  ])
    near(S.normalInv(p), want, 1e-9, `inv(${p})`);
  near(S.normalPdf(0), 0.3989422804014327, 1e-14);
  assert.equal(S.normalInv(0), -Infinity);
  assert.ok(Number.isNaN(S.normalInv(1.5)));
});

test('t and chi-square distributions match reference values', () => {
  for (const [t, df, want] of [
    [2, 10, 0.9633059826146],
    [-1.5, 3, 0.1152919326224],
    [0.3, 1, 0.5927735790777],
    [5, 30, 0.9999883516573],
    [-8, 2.5, 0.0038283220655],
  ])
    near(S.tCdf(t, df), want, 1e-10, `t(${t}, ${df})`);
  for (const [p, df, want] of [
    [0.975, 10, 2.2281388519863],
    [0.9, 3, 1.6377443536962],
    [0.995, 25, 2.787435813677],
  ])
    near(S.tInv(p, df), want, 1e-8, `tinv(${p}, ${df})`);
  for (const [x, df, want] of [
    [3.84, 1, 0.9499564787513],
    [10, 4, 0.9595723180055],
    [0.5, 7, 0.0005535186096],
    [40, 20, 0.9950045876917],
  ])
    near(S.chiSqCdf(x, df), want, 1e-10, `chi(${x}, ${df})`);
});

test('discrete distributions match reference values', () => {
  for (const [k, n, p, want] of [
    [3, 10, 0.3, 0.266827932],
    [0, 5, 0.5, 0.03125],
    [50, 100, 0.5, 0.0795892373872],
  ])
    near(S.binomPmf(k, n, p), want, 1e-10, `binom pmf ${k}`);
  for (const [k, n, p, want] of [
    [3, 10, 0.3, 0.6496107184],
    [4, 5, 0.5, 0.96875],
    [55, 100, 0.5, 0.8643734879631],
  ])
    near(S.binomCdf(k, n, p), want, 1e-10, `binom cdf ${k}`);
  for (const [k, l, want] of [
    [0, 2, 0.1353352832366],
    [5, 5, 0.1754673697679],
    [12, 7.5, 0.0365754419355],
  ])
    near(S.poissonPmf(k, l), want, 1e-10, `poisson pmf ${k}`);
  for (const [k, l, want] of [
    [0, 2, 0.1353352832366],
    [5, 5, 0.6159606548331],
    [12, 7.5, 0.9573341324607],
  ])
    near(S.poissonCdf(k, l), want, 1e-10, `poisson cdf ${k}`);
  for (const [x, want] of [
    [0.1, 2.2527126517342],
    [0.5, 0.5723649429247],
    [1, 0.0],
    [2.5, 0.2846828704729],
    [10, 12.8018274800815],
    [171, 706.5730622457875],
  ])
    near(S.lgamma(x), want, 1e-10, `lgamma(${x})`);
  near(S.geometricCdf(3, 0.25), 1 - 0.75 ** 3, 1e-14);
});

test('every distribution builds, rejects bad parameters, and has a CDF that rises to 1', () => {
  for (const [key, spec] of Object.entries(S.DISTRIBUTIONS)) {
    const params = Object.fromEntries(spec.params.map((p) => [p.key, p.value]));
    const dist = spec.make(params);
    assert.ok(dist, `${key} accepts its defaults`);
    const [lo, hi] = dist.range;
    near(dist.cdf(hi + 1e6), 1, 1e-6, `${key} cdf at +inf`);
    assert.ok(dist.cdf(lo - 1e6) <= 1e-6, `${key} cdf at -inf`);
    const mid = S.inverseCdf(dist, spec.discrete, 0.5);
    assert.ok(dist.cdf(mid) >= 0.5 - 1e-9, `${key} median is where the CDF reaches 0.5`);
    assert.equal(spec.make(Object.fromEntries(spec.params.map((p) => [p.key, -1]))), null, `${key} rejects -1`);
  }
});

test('descriptive statistics', () => {
  const data = [1, 5, 5, 10, 13];
  [0.25, 0.5, 0.9].forEach((q, i) => near(S.quantile(data, q), [5.0, 5.0, 11.8][i], 1e-12));
  const s = S.summarize([2, 3, 3, 5, 6, 7, 8, 40]);
  assert.equal(s.n, 8);
  assert.equal(s.median, 5.5);
  assert.deepEqual(s.modes, [3]);
  assert.deepEqual(s.outliers, [40], 'values beyond 1.5 IQR are outliers');
  near(S.stdev([2, 4, 4, 4, 5, 5, 7, 9], true), 2, 1e-12);
  assert.equal(S.summarize([]), null);
  assert.equal(S.summarize(['x', NaN]), null, 'non-numbers are ignored');
  assert.deepEqual(S.modes([1, 2, 3]), []);
  near(S.meanAbsoluteDeviation([1, 2, 3, 4, 5]), 1.2, 1e-12);
  near(S.correlation([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 7, 7]), 0.8874119674649424, 1e-12);
  near(S.spearman([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 7, 7]), 0.8696565534786727, 1e-12);
  assert.deepEqual(S.ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('histogram bins align to multiples of the width', () => {
  const bins = S.histogramBins([0.5, 1.2, 1.9, 2.0, 5], 1);
  assert.deepEqual(
    bins.map((b) => b.count),
    [1, 2, 1, 0, 0, 1],
  );
  assert.equal(bins[0].start, 0);
  assert.deepEqual(S.histogramBins([], 1), []);
  assert.deepEqual(S.histogramBins([1, 2], 0), []);
  assert.ok(S.suggestedBinWidth([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) > 0);
});

test('significance tests match reference p-values', () => {
  const a = [2.1, 3.4, 1.9, 5.0, 4.4, 3.8];
  const b = [1.0, 2.2, 3.1, 0.9, 2.5];
  near(S.tTest(a, { mu0: 3 }).two, 0.43012145686550557, 1e-10);
  const welch = S.tTestTwo(a, b);
  near(welch.two, 0.050904447000567045, 1e-9);
  near(welch.score, 2.2520241284206146, 1e-10);
  const gof = S.chiSqGof([30, 20, 25, 25]);
  near(gof.p, 0.5724067044708798, 1e-10);
  near(gof.score, 2.0, 1e-10);
  const ind = S.chiSqIndependence([
    [10, 20],
    [30, 15],
  ]);
  near(ind.p, 0.0045863920802535025, 1e-10);
  near(ind.score, 8.035714285714285, 1e-10);
  const z = S.zTest({ n: 36, mean: 52 }, { sigma: 6, mu0: 50 });
  near(z.score, 2, 1e-12);
  near(z.two, 0.0455002638963584, 1e-10);
  near(z.ci.lower, 52 - 1.959963984540054, 1e-8);
  const prop = S.zPropTest(45, 80, { p0: 0.5 });
  near(prop.score, (0.5625 - 0.5) / Math.sqrt(0.25 / 80), 1e-12);
  assert.ok(S.zPropTestTwo(30, 100, 45, 100).two < 0.05);
  assert.equal(S.tTest([1], {}), null, 'one value is not enough');
  assert.equal(S.tTest([2, 2, 2], {}), null, 'no spread gives no t statistic');
  assert.equal(S.chiSqIndependence([[1, 2]]), null);
  assert.equal(S.chiSqGof([5]), null);
  assert.equal(S.zTest([1, 2], { sigma: 0 }), null);
});

test('regression models match NumPy and SciPy', () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  const near3 = (got, want, tol) => got.forEach((g, i) => near(g, want[i], tol, `param ${i}`));
  const lin = fitModel(xs, [2.2, 3.9, 6.1, 8.3, 9.8, 12.4, 13.9, 16.2], 'linear');
  near3(lin.params, [0.07857142857142459, 2.0047619047619047], 1e-12);
  near(lin.r2, 0.9981134838041177, 1e-12);
  near(lin.r, Math.sqrt(lin.r2), 1e-12);
  assert.equal(lin.errors.length, 2);
  near3(
    fitModel(xs, [2.25, 4.1, 6.55, 9.100000000000001, 11.05, 14.200000000000001, 16.35, 19.4], 'quadratic').params,
    [0.13214285714285498, 1.972619047619048, 0.05357142857142863],
    1e-9,
  );
  near3(
    fitModel(xs, [2.26, 4.18, 6.82, 9.740000000000002, 12.3, 16.36, 19.78, 24.52], 'cubic').params,
    [0.20714285714285388, 1.8945887445887453, 0.07402597402597388, 0.00848484848484847],
    1e-9,
  );
  near3(
    fitModel(xs, [2.7, 3.9, 6.2, 9.5, 14.1, 22.8, 33.0, 51.0], 'exponential').params,
    [1.7683372962830026, 0.42005640724783677],
    1e-6,
  );
  near3(
    fitModel(xs, [2.1, 5.6, 10.4, 16.2, 23.3, 31.5, 41.0, 50.6], 'power').params,
    [1.716029639339105, 1.6273832999247513],
    1e-6,
  );
  near3(
    fitModel(xs, [1.0, 2.3, 3.1, 3.6, 4.1, 4.3, 4.8, 5.0], 'logarithmic').params,
    [0.979674232098063, 1.920166773801982],
    1e-10,
  );
  for (const kind of Object.keys(MODELS)) assert.ok(MODELS[kind].form.startsWith('y ='));
});

test('regressions explain themselves when they cannot run', () => {
  assert.match(fitModel([1, 1, 1], [1, 2, 3], 'linear').error, /same/);
  assert.match(fitModel([1, 2], [1, 2], 'quadratic').error, /at least 3/);
  assert.match(fitModel([1, 2, 3], [1, -2, 3], 'exponential').error, /positive/);
  assert.match(fitModel([-1, 2, 3], [1, 2, 3], 'logarithmic').error, /positive/);
  assert.match(fitModel([1, 2, 3], [1, 2], 'linear').error, /same number/);
  assert.match(fitModel([1, 2, 3], [1, 2, 3], 'spline').error, /listed models/);
});

test('linear algebra helpers and Levenberg-Marquardt', () => {
  assert.deepEqual(
    solveLinear(
      [
        [2, 0],
        [0, 4],
      ],
      [2, 8],
    ),
    [1, 2],
  );
  assert.equal(
    solveLinear(
      [
        [1, 2],
        [2, 4],
      ],
      [1, 2],
    ),
    null,
    'a singular system has no unique solution',
  );
  // y = 3 sin(0.5 x) + 1 recovered from exact samples
  const xs = Array.from({ length: 30 }, (_, i) => i * 0.4);
  const ys = xs.map((x) => 3 * Math.sin(0.5 * x) + 1);
  const fit = levenbergMarquardt((p) => xs.map((x, i) => ys[i] - (p[0] * Math.sin(p[1] * x) + p[2])), [2.5, 0.45, 0.8]);
  near(fit.p[0], 3, 1e-6);
  near(fit.p[1], 0.5, 1e-6);
  near(fit.p[2], 1, 1e-6);
  assert.equal(
    levenbergMarquardt(() => [NaN], [1]),
    null,
    'an undefined start is reported, not looped on',
  );
});
