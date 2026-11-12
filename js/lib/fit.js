/**
 * Least-squares fitting for the Stats tab and for `~` regressions in the graph.
 *
 * Models that are linear in their parameters (lines, polynomials, `a + b ln x`) are
 * solved exactly from the normal equations. Everything else uses Levenberg-Marquardt
 * with a numeric Jacobian, started from several guesses, and the best fit is kept.
 * Pure numeric code with no DOM.
 */

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Solve A x = b by Gaussian elimination with partial pivoting. Returns null if A is singular. */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14 * (1 + Math.abs(M[col][col]))) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j += 1) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Inverse of a small square matrix, or null if it is singular. */
export function invert(A) {
  const n = A.length;
  const cols = [];
  for (let j = 0; j < n; j += 1) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const x = solveLinear(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
}

/** Coefficient of determination: 1 - SSE / SST, which can be negative for a bad model. */
export function rSquared(ys, predicted) {
  const m = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sst = ys.reduce((a, y) => a + (y - m) ** 2, 0);
  const sse = ys.reduce((a, y, i) => a + (y - predicted[i]) ** 2, 0);
  return sst === 0 ? (sse === 0 ? 1 : NaN) : 1 - sse / sst;
}

/**
 * Fit y = sum of coef[k] * basis[k](x) by least squares.
 * @returns {{ coefs: number[], errors: number[] | null } | null}
 */
export function linearLeastSquares(xs, ys, basis) {
  const k = basis.length;
  if (xs.length < k) return null;
  const rows = xs.map((x) => basis.map((f) => f(x)));
  if (rows.some((r) => r.some((v) => !Number.isFinite(v)))) return null;
  const A = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
  );
  const b = Array.from({ length: k }, (_, i) => rows.reduce((s, r, n) => s + r[i] * ys[n], 0));
  const coefs = solveLinear(A, b);
  if (!coefs) return null;
  let errors = null;
  if (xs.length > k) {
    const sse = rows.reduce((s, r, n) => s + (ys[n] - dot(r, coefs)) ** 2, 0);
    const inv = invert(A);
    if (inv) errors = inv.map((row, i) => Math.sqrt(Math.max(0, (sse / (xs.length - k)) * row[i])));
  }
  return { coefs, errors };
}

/* ------------------------------------------------- Levenberg-Marquardt */

function jacobian(residuals, p, r0) {
  const cols = p.map((value, k) => {
    const h = 1e-6 * Math.max(1, Math.abs(value));
    const up = [...p];
    const down = [...p];
    up[k] += h;
    down[k] -= h;
    const a = residuals(up);
    const b = residuals(down);
    if (!a || !b) return null;
    return a.map((v, i) => (v - b[i]) / (2 * h));
  });
  if (cols.some((c) => c === null)) return null;
  return r0.map((_, i) => cols.map((c) => c[i]));
}

/**
 * Minimise the sum of squared `residuals(p)` starting from `p0`.
 * @param {(p: number[]) => number[] | null} residuals null or non-finite values mean "not defined here"
 * @returns {{ p: number[], cost: number } | null}
 */
export function levenbergMarquardt(residuals, p0, { maxIter = 120, tol = 1e-13 } = {}) {
  let p = [...p0];
  let r = residuals(p);
  if (!r || !r.every(Number.isFinite)) return null;
  let cost = dot(r, r);
  let lambda = 1e-3;
  for (let iter = 0; iter < maxIter; iter += 1) {
    const J = jacobian(residuals, p, r);
    if (!J) break;
    const m = p.length;
    const A = Array.from({ length: m }, (_, i) =>
      Array.from({ length: m }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0)),
    );
    const g = Array.from({ length: m }, (_, i) => J.reduce((s, row, n) => s + row[i] * r[n], 0));
    let improved = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const damped = A.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v || 1) : v)));
      const step = solveLinear(
        damped,
        g.map((v) => -v),
      );
      if (step) {
        const trial = p.map((v, i) => v + step[i]);
        const rt = residuals(trial);
        if (rt && rt.every(Number.isFinite)) {
          const ct = dot(rt, rt);
          if (ct < cost) {
            const gain = cost - ct;
            p = trial;
            r = rt;
            cost = ct;
            lambda = Math.max(lambda / 4, 1e-12);
            improved = true;
            if (gain <= tol * (cost + tol)) return { p, cost };
            break;
          }
        }
      }
      lambda *= 5;
    }
    if (!improved) break;
  }
  return { p, cost };
}

/** Try several starting points and keep the fit with the smallest squared error. */
export function fitLeastSquares(residuals, count, starts = null) {
  const guesses = starts ?? [1, 0.1, -1, 10, 0.5, -0.1].map((v) => new Array(count).fill(v));
  let best = null;
  for (const start of guesses) {
    const fit = levenbergMarquardt(residuals, start);
    if (fit && (!best || fit.cost < best.cost - 1e-15)) best = fit;
  }
  return best;
}

/* --------------------------------------------------------- named models */

/** The regression models the Stats tab offers. `needs` restricts the data they accept. */
export const MODELS = {
  linear: { name: 'Linear', form: 'y = a + bx', terms: 2 },
  quadratic: { name: 'Quadratic', form: 'y = a + bx + cx\u00b2', terms: 3 },
  cubic: { name: 'Cubic', form: 'y = a + bx + cx\u00b2 + dx\u00b3', terms: 4 },
  exponential: { name: 'Exponential', form: 'y = a\u00b7e^(bx)', terms: 2, needs: 'positive y' },
  power: { name: 'Power', form: 'y = a\u00b7x^b', terms: 2, needs: 'positive x and y' },
  logarithmic: { name: 'Logarithmic', form: 'y = a + b\u00b7ln(x)', terms: 2, needs: 'positive x' },
};

/**
 * Fit one of the named models to data.
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {keyof typeof MODELS} kind
 * @returns {{ kind: string, params: number[], errors: number[] | null, r2: number, r: number | null, predict: (x: number) => number,
 *   residuals: number[], n: number } | { error: string }}
 */
export function fitModel(xs, ys, kind) {
  const model = MODELS[kind];
  if (!model) return { error: 'Choose one of the listed models.' };
  const n = xs.length;
  if (n !== ys.length) return { error: 'The x and y columns need the same number of values.' };
  if (n < model.terms) return { error: `A ${model.name.toLowerCase()} fit needs at least ${model.terms} points.` };
  if (new Set(xs).size < 2) return { error: 'The x values are all the same, so no curve can be fit.' };

  let params;
  let errors = null;
  let predict;
  if (kind === 'linear' || kind === 'quadratic' || kind === 'cubic') {
    const degree = { linear: 1, quadratic: 2, cubic: 3 }[kind];
    // Centre and scale x so high powers stay well conditioned, then convert the coefficients back.
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) / n) || 1;
    const basis = Array.from({ length: degree + 1 }, (_, k) => (x) => ((x - mx) / sx) ** k);
    const fit = linearLeastSquares(xs, ys, basis);
    if (!fit) return { error: 'These points do not determine this curve. Try fewer terms or different data.' };
    params = expandPolynomial(fit.coefs, mx, sx);
    predict = (x) => params.reduce((s, c, k) => s + c * x ** k, 0);
    if (degree === 1 && fit.errors) {
      // Standard errors of the intercept and slope in the original coordinates.
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const sse = xs.reduce((a, x, i) => a + (ys[i] - predict(x)) ** 2, 0);
      const s2 = n > 2 ? sse / (n - 2) : NaN;
      errors = [Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)), Math.sqrt(s2 / sxx)];
    }
  } else if (kind === 'logarithmic') {
    if (xs.some((x) => !(x > 0))) return { error: 'A logarithmic fit needs every x to be positive.' };
    const fit = linearLeastSquares(xs, ys, [() => 1, (x) => Math.log(x)]);
    if (!fit) return { error: 'These points do not determine this curve.' };
    params = fit.coefs;
    errors = fit.errors;
    predict = (x) => params[0] + params[1] * Math.log(x);
  } else if (kind === 'exponential') {
    if (ys.some((y) => !(y > 0))) return { error: 'An exponential fit needs every y to be positive.' };
    const start = linearLeastSquares(xs, ys.map(Math.log), [() => 1, (x) => x]);
    const guess = start ? [Math.exp(start.coefs[0]), start.coefs[1]] : [1, 0.1];
    const fit = fitLeastSquares((p) => xs.map((x, i) => ys[i] - p[0] * Math.exp(p[1] * x)), 2, [guess]);
    if (!fit) return { error: 'The fit did not settle. Check the data, or try a different model.' };
    params = fit.p;
    predict = (x) => params[0] * Math.exp(params[1] * x);
  } else {
    if (xs.some((x) => !(x > 0)) || ys.some((y) => !(y > 0)))
      return { error: 'A power fit needs every x and y to be positive.' };
    const start = linearLeastSquares(xs.map(Math.log), ys.map(Math.log), [() => 1, (x) => x]);
    const guess = start ? [Math.exp(start.coefs[0]), start.coefs[1]] : [1, 1];
    const fit = fitLeastSquares((p) => xs.map((x, i) => ys[i] - p[0] * x ** p[1]), 2, [guess]);
    if (!fit) return { error: 'The fit did not settle. Check the data, or try a different model.' };
    params = fit.p;
    predict = (x) => params[0] * x ** params[1];
  }

  const fitted = xs.map(predict);
  const r2 = rSquared(ys, fitted);
  let r = null;
  if (kind === 'linear') r = Math.sign(params[1]) * Math.sqrt(Math.max(0, r2));
  return { kind, params, errors, r2, r, predict, residuals: ys.map((y, i) => y - fitted[i]), n };
}

/** Convert coefficients in z = (x - mx) / sx into coefficients of x. */
function expandPolynomial(coefs, mx, sx) {
  const out = new Array(coefs.length).fill(0);
  coefs.forEach((c, k) => {
    // c * ((x - mx) / sx)^k, expanded with the binomial theorem
    let binom = 1;
    for (let j = 0; j <= k; j += 1) {
      out[j] += (c / sx ** k) * binom * (-mx) ** (k - j);
      binom = (binom * (k - j)) / (j + 1);
    }
  });
  return out;
}
