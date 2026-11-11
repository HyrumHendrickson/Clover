/**
 * Points of interest on y = f(x): intercepts, extrema, and intersections.
 * All searches are numeric over a visible interval and tolerate gaps and poles.
 */

const MAX_POINTS = 40;

function bisect(f, a, b, fa) {
  let [lo, hi, flo] = [a, b, fa];
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return NaN;
    if (fm === 0) return mid;
    if (Math.sign(fm) === Math.sign(flo)) [lo, flo] = [mid, fm];
    else hi = mid;
    if (hi - lo <= 1e-15 * Math.max(1, Math.abs(lo))) break;
  }
  return (lo + hi) / 2;
}

function sample(f, lo, hi, n) {
  const xs = new Array(n + 1);
  const ys = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) {
    xs[i] = lo + ((hi - lo) * i) / n;
    ys[i] = f(xs[i]);
  }
  return { xs, ys };
}

const tolerance = (lo, hi) => (hi - lo) * 1e-9;

function addUnique(list, x, tol) {
  if (!list.some((v) => Math.abs(v - x) <= tol)) list.push(x);
}

/** Zeros of f where it changes sign (crossings through zero, not poles). */
export function findRoots(f, lo, hi, { samples = 1600 } = {}) {
  if (!(hi > lo)) return [];
  const { xs, ys } = sample(f, lo, hi, samples);
  const tol = tolerance(lo, hi);
  const roots = [];
  for (let i = 0; i < samples && roots.length < MAX_POINTS; i += 1) {
    const [ya, yb] = [ys[i], ys[i + 1]];
    if (!Number.isFinite(ya)) continue;
    if (ya === 0) {
      addUnique(roots, xs[i], tol);
      continue;
    }
    if (!Number.isFinite(yb) || Math.sign(ya) === Math.sign(yb)) continue;
    const x = bisect(f, xs[i], xs[i + 1], ya);
    if (!Number.isFinite(x)) continue;
    // At a pole the value grows as the interval shrinks; a root's value shrinks.
    const fx = f(x);
    if (Math.abs(fx) <= Math.min(Math.abs(ya), Math.abs(yb))) addUnique(roots, x, tol);
  }
  const last = ys[samples];
  if (last === 0) addUnique(roots, xs[samples], tol);
  return roots;
}

/** Minimise sign * f on [a, b] by golden-section search. */
function golden(f, a, b, sign) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let [lo, hi] = [a, b];
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = sign * f(c);
  let fd = sign * f(d);
  for (let i = 0; i < 100; i += 1) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = sign * f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = sign * f(d);
    }
    if (hi - lo < 1e-13 * Math.max(1, Math.abs(lo))) break;
  }
  const x = (lo + hi) / 2;
  return { x, y: f(x) };
}

/** Local minima and maxima of f, found where the sampled slope changes sign. */
export function findExtrema(f, lo, hi, { samples = 1600 } = {}) {
  if (!(hi > lo)) return [];
  const { xs, ys } = sample(f, lo, hi, samples);
  const tol = tolerance(lo, hi) * 100;
  const found = [];
  for (let i = 1; i < samples && found.length < MAX_POINTS; i += 1) {
    const [a, b, c] = [ys[i - 1], ys[i], ys[i + 1]];
    if (![a, b, c].every(Number.isFinite)) continue;
    const up = b - a;
    const down = c - b;
    if (up * down >= 0) continue;
    const isMax = up > 0;
    const best = golden(f, xs[i - 1], xs[i + 1], isMax ? -1 : 1);
    if (!Number.isFinite(best.y)) continue;
    // A pole or jump pushes the "extremum" far beyond the sampled values; reject it.
    const hiY = Math.max(a, b, c);
    const loY = Math.min(a, b, c);
    const range = hiY - loY;
    if (best.y > hiY + range || best.y < loY - range) continue;
    if (found.some((p) => Math.abs(p.x - best.x) <= tol)) continue;
    found.push({ x: best.x, y: best.y, type: isMax ? 'max' : 'min' });
  }
  return found;
}

/** Intersections of two functions: zeros of f - g, reported at (x, f(x)). */
export function findIntersections(f, g, lo, hi, options) {
  const diff = (x) => f(x) - g(x);
  const xs = findRoots(diff, lo, hi, options);
  const tol = tolerance(lo, hi);
  for (const e of findExtrema(diff, lo, hi, options)) {
    // Tangent contact: the difference touches zero without changing sign.
    if (Math.abs(e.y) <= 1e-9 * Math.max(1, Math.abs(f(e.x)))) addUnique(xs, e.x, tol * 100);
  }
  return xs.map((x) => ({ x, y: f(x) })).filter((p) => Number.isFinite(p.y));
}

/**
 * Points of interest of f over [lo, hi]: x-intercepts (including tangent ones),
 * the y-intercept, extrema, and intersections with the other functions.
 * @returns {{ x: number, y: number, type: 'root' | 'yint' | 'max' | 'min' | 'cross' }[]}
 */
export function pointsOfInterest(f, others, lo, hi) {
  if (!(hi > lo)) return [];
  const zero = (hi - lo) * 1e-8;
  // Numerical search leaves residue such as 1.5e-8 for 0; snap it before comparing or showing.
  const clean = (v) => (Math.abs(v) < zero ? 0 : Number(v.toPrecision(10)));
  const tol = (hi - lo) * 1e-7;
  const out = [];
  const push = (p) => {
    const q = { ...p, x: clean(p.x), y: clean(p.y) };
    if (out.length >= MAX_POINTS) return;
    if (out.some((o) => Math.abs(o.x - q.x) <= tol && Math.abs(o.y - q.y) <= tol * 10)) return;
    out.push(q);
  };
  for (const x of findRoots(f, lo, hi)) push({ x, y: 0, type: 'root' });
  for (const e of findExtrema(f, lo, hi)) push(Math.abs(e.y) < zero ? { x: e.x, y: 0, type: 'root' } : e);
  if (lo <= 0 && hi >= 0) {
    const y0 = f(0);
    if (Number.isFinite(y0)) push({ x: 0, y: y0, type: 'yint' });
  }
  for (const g of others) {
    for (const p of findIntersections(f, g, lo, hi)) push({ ...p, type: 'cross' });
  }
  return out.sort((a, b) => a.x - b.x);
}
