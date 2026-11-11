/**
 * Turning plots into screen geometry. Everything here is pure and works in
 * CSS pixels, so it is unit tested without a canvas.
 *
 *  - sampleExplicit   y = f(x) or x = f(y), with asymptote and gap detection
 *  - sampleParam      parametric and polar curves, refined where they bend
 *  - contourSegments  implicit curves f(x, y) = 0 by marching squares
 *  - rasterRegion     inequality shading
 */

const CLAMP = 1e6;
const clampPx = (v) => (v > CLAMP ? CLAMP : v < -CLAMP ? -CLAMP : v);

/** A jump of more than this many pixels between neighbouring samples is examined. */
const JUMP = 2;

/**
 * Sample a function of one variable into polylines.
 *
 * Samples one pixel apart. Where neighbouring values jump, the interval is
 * bisected: a steep but continuous curve (y = 1000x) converges and stays
 * joined, while an asymptote (tan x, 1/x) or a step (floor x) does not and
 * becomes a gap. Where the function stops being defined, the edge is located
 * to sub-pixel accuracy so curves such as sqrt(x) start where they should.
 *
 * @param {(u: number) => number} f value at a world coordinate
 * @param {((x: number, y: number) => boolean) | null} mask restriction, given world x and y
 * @param {import('./view.js').GraphView} view
 * @param {{ vertical?: boolean, step?: number }} [options] vertical: x = f(y)
 * @returns {number[][]} polylines as flat [x0, y0, x1, y1, ...] screen coordinates
 */
export function sampleExplicit(f, mask, view, { vertical = false, step = 1 } = {}) {
  const length = vertical ? view.height : view.width;
  const worldOf = vertical ? (p) => view.toWorldY(p) : (p) => view.toWorldX(p);
  const screenOf = vertical ? (v) => view.toScreenX(v) : (v) => view.toScreenY(v);

  const valueAt = (p) => {
    const u = worldOf(p);
    const v = f(u);
    if (!Number.isFinite(v)) return NaN;
    if (mask && !(vertical ? mask(v, u) : mask(u, v))) return NaN;
    return clampPx(screenOf(v));
  };

  const paths = [];
  let cur = null;
  const add = (p, s) => {
    if (vertical) cur.push(s, p);
    else cur.push(p, s);
  };
  const flush = () => {
    if (cur && cur.length >= 4) paths.push(cur);
    cur = null;
  };

  /** Find where the function becomes undefined between a defined and an undefined pixel. */
  const edge = (definedP, undefinedP) => {
    let lo = definedP;
    let hi = undefinedP;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (Number.isNaN(valueAt(mid))) hi = mid;
      else lo = mid;
    }
    return { p: lo, s: valueAt(lo) };
  };

  /** Does the curve join up between two samples, or is there a break? */
  const continuous = (pa, sa, pb, sb) => {
    let [a, sA, b, sB] = [pa, sa, pb, sb];
    for (let i = 0; i < 32; i += 1) {
      const m = (a + b) / 2;
      const sm = valueAt(m);
      if (Number.isNaN(sm)) return false;
      const d1 = Math.abs(sm - sA);
      const d2 = Math.abs(sB - sm);
      if (Math.max(d1, d2) < 1) return true;
      if (d1 >= d2) [b, sB] = [m, sm];
      else [a, sA] = [m, sm];
    }
    return false;
  };

  let prevP = 0;
  let prevS = NaN;
  let prevOk = false;
  const first = -step;
  for (let p = first; p <= length + step + 1e-9; p += step) {
    const s = valueAt(p);
    const ok = !Number.isNaN(s);
    if (ok) {
      if (prevOk) {
        if (Math.abs(s - prevS) > JUMP && !continuous(prevP, prevS, p, s)) {
          flush();
          cur = [];
        }
        add(p, s);
      } else {
        cur = [];
        if (p > first) {
          const e = edge(p, p - step);
          if (e.p < p) add(e.p, e.s);
        }
        add(p, s);
      }
    } else if (prevOk) {
      const e = edge(prevP, p);
      if (e.p > prevP) add(e.p, e.s);
      flush();
    }
    prevOk = ok;
    prevP = p;
    prevS = s;
  }
  flush();
  return paths;
}

/**
 * Sample a parametric curve (x(t), y(t)) into polylines.
 * Segments longer than a few pixels are subdivided where the curve bends, within an evaluation budget.
 *
 * @param {(t: number, out: number[]) => void} at writes x and y into `out`
 * @param {((t: number) => boolean) | null} mask
 * @param {[number, number]} domain [tmin, tmax]
 */
export function sampleParam(at, mask, domain, view, { samples = 1200, budget = 80000 } = {}) {
  const [t0, t1] = domain;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 > t0)) return [];
  const out = [0, 0];
  const breakDistance = 4 * Math.max(view.width, view.height);
  let evaluations = 0;

  /** Screen position at t, or false when undefined or restricted away. */
  const place = (t, store) => {
    evaluations += 1;
    if (mask && !mask(t)) return false;
    at(t, out);
    if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) return false;
    store[0] = clampPx(view.toScreenX(out[0]));
    store[1] = clampPx(view.toScreenY(out[1]));
    return true;
  };

  const paths = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.length >= 4) paths.push(cur);
    cur = null;
  };

  const refine = (ta, xa, ya, tb, xb, yb, depth) => {
    const dist = Math.hypot(xb - xa, yb - ya);
    if (dist <= 6 || depth >= 12 || evaluations > budget) {
      if (depth >= 12 && dist > breakDistance) {
        flush();
        cur = [xb, yb];
      } else {
        cur.push(xb, yb);
      }
      return;
    }
    const tm = (ta + tb) / 2;
    const m = [0, 0];
    if (!place(tm, m)) {
      flush();
      cur = [xb, yb];
      return;
    }
    // Distance of the midpoint from the chord decides whether the curve bends here.
    const deviation = Math.abs((xb - xa) * (ya - m[1]) - (xa - m[0]) * (yb - ya)) / dist;
    if (dist > 40 || deviation > 0.25) {
      refine(ta, xa, ya, tm, m[0], m[1], depth + 1);
      refine(tm, m[0], m[1], tb, xb, yb, depth + 1);
    } else {
      cur.push(xb, yb);
    }
  };

  let prev = null;
  let prevT = t0;
  for (let i = 0; i <= samples; i += 1) {
    const t = i === samples ? t1 : t0 + ((t1 - t0) * i) / samples;
    const here = [0, 0];
    if (place(t, here)) {
      if (prev) refine(prevT, prev[0], prev[1], t, here[0], here[1], 0);
      else cur = [here[0], here[1]];
      prev = here;
    } else {
      flush();
      prev = null;
    }
    prevT = t;
  }
  flush();
  return paths;
}

/** Sample a polar curve r = f(theta). Negative r is drawn on the opposite side, as usual. */
export function samplePolar(f, mask, domain, view, options) {
  const at = (theta, out) => {
    const r = f(theta);
    if (!Number.isFinite(r) || (mask && !mask(theta, r))) {
      out[0] = NaN;
      out[1] = NaN;
      return;
    }
    out[0] = r * Math.cos(theta);
    out[1] = r * Math.sin(theta);
  };
  return sampleParam(at, null, domain, view, { samples: 2400, ...options });
}

/* ------------------------------------------------------------ marching squares */

// Corner bits: 1 = top-left, 2 = top-right, 4 = bottom-right, 8 = bottom-left.
// Edges: 0 = top, 1 = right, 2 = bottom, 3 = left.
const CASES = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  null,
  [[0, 2]],
  [[3, 2]],
  [[3, 2]],
  [[0, 2]],
  null,
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
];
const SADDLE_5 = {
  positive: [
    [0, 1],
    [3, 2],
  ],
  negative: [
    [3, 0],
    [1, 2],
  ],
};
const SADDLE_10 = {
  positive: [
    [3, 0],
    [1, 2],
  ],
  negative: [
    [0, 1],
    [3, 2],
  ],
};

/**
 * Trace the curve F(x, y) = 0 as polylines.
 *
 * F is evaluated on a grid of `cell` pixels; each cell whose corners differ in
 * sign gets a segment between linearly interpolated crossings, and segments that
 * share a crossing are joined into continuous paths (so dashes and joins look
 * right). A crossing where |F| is larger than at either corner is a pole (as in
 * 1/x), not a root, and is dropped.
 *
 * @param {(x: number, y: number) => number} F
 * @param {import('./view.js').GraphView} view
 * @param {{ cell?: number, filter?: ((x: number, y: number) => boolean) | null, maxCells?: number }} [options]
 *   filter keeps only segments whose midpoint (world coordinates) passes
 * @returns {number[][]} flat [x0, y0, x1, y1, ...] polylines in screen pixels
 */
export function contourPaths(F, view, { cell = 3, filter = null, maxCells = 250000 } = {}) {
  let c = cell;
  const { width, height } = view;
  while ((Math.ceil(width / c) + 2) * (Math.ceil(height / c) + 2) > maxCells) c += 1;
  const cols = Math.ceil(width / c) + 2;
  const rows = Math.ceil(height / c) + 2;
  const xs = new Float64Array(cols);
  const ys = new Float64Array(rows);
  for (let i = 0; i < cols; i += 1) xs[i] = view.toWorldX((i - 1) * c);
  for (let j = 0; j < rows; j += 1) ys[j] = view.toWorldY((j - 1) * c);
  const vals = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) vals[j * cols + i] = F(xs[i], ys[j]);
  }

  // Each grid edge has one id, so the two cells sharing an edge agree on its crossing.
  const index = new Map();
  const px = [];
  const py = [];
  const nextA = [];
  const nextB = [];
  const link = (a, b) => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (nextA[from] === -1) nextA[from] = to;
      else nextB[from] = to;
    }
  };

  const crossing = (edge, i, j) => {
    let i0 = i;
    let j0 = j;
    let i1 = i;
    let j1 = j;
    let id;
    if (edge === 0) {
      i1 = i + 1;
      id = (j * cols + i) * 2;
    } else if (edge === 1) {
      i0 = i + 1;
      i1 = i + 1;
      j1 = j + 1;
      id = (j * cols + i + 1) * 2 + 1;
    } else if (edge === 2) {
      j0 = j + 1;
      j1 = j + 1;
      i1 = i + 1;
      id = ((j + 1) * cols + i) * 2;
    } else {
      j1 = j + 1;
      id = (j * cols + i) * 2 + 1;
    }
    const known = index.get(id);
    if (known !== undefined) return known;
    const va = vals[j0 * cols + i0];
    const vb = vals[j1 * cols + i1];
    const t = va / (va - vb);
    const x = (i0 - 1) * c + (i1 - i0) * c * t;
    const y = (j0 - 1) * c + (j1 - j0) * c * t;
    const fc = F(view.toWorldX(x), view.toWorldY(y));
    if (!(Math.abs(fc) <= Math.max(Math.abs(va), Math.abs(vb)))) {
      index.set(id, -2);
      return -2;
    }
    const k = px.length;
    px.push(x);
    py.push(y);
    nextA.push(-1);
    nextB.push(-1);
    index.set(id, k);
    return k;
  };

  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const tl = vals[j * cols + i];
      const tr = vals[j * cols + i + 1];
      const br = vals[(j + 1) * cols + i + 1];
      const bl = vals[(j + 1) * cols + i];
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(br) || Number.isNaN(bl)) continue;
      const bits = (tl > 0 ? 1 : 0) | (tr > 0 ? 2 : 0) | (br > 0 ? 4 : 0) | (bl > 0 ? 8 : 0);
      let pairs = CASES[bits];
      if (pairs === null) {
        const centre = (tl + tr + br + bl) / 4 > 0 ? 'positive' : 'negative';
        pairs = (bits === 5 ? SADDLE_5 : SADDLE_10)[centre];
      }
      for (const [ea, eb] of pairs) {
        const a = crossing(ea, i, j);
        const b = crossing(eb, i, j);
        if (a < 0 || b < 0) continue;
        if (filter && !filter(view.toWorldX((px[a] + px[b]) / 2), view.toWorldY((py[a] + py[b]) / 2))) continue;
        link(a, b);
      }
    }
  }

  const paths = [];
  const seen = new Uint8Array(px.length);
  const follow = (start) => {
    const path = [];
    let prev = -1;
    let at = start;
    while (at !== -1 && !seen[at]) {
      seen[at] = 1;
      path.push(px[at], py[at]);
      const next = nextA[at] !== prev && nextA[at] !== -1 ? nextA[at] : nextB[at];
      prev = at;
      at = next !== prev ? next : -1;
    }
    return { path, end: at };
  };
  // Open curves first, from their ends; what remains is closed loops.
  for (let k = 0; k < px.length; k += 1) {
    if (seen[k] || nextB[k] !== -1 || nextA[k] === -1) continue;
    const { path } = follow(k);
    if (path.length >= 4) paths.push(path);
  }
  for (let k = 0; k < px.length; k += 1) {
    if (seen[k] || nextA[k] === -1) continue;
    const { path, end } = follow(k);
    if (end !== -1) path.push(px[end], py[end]);
    else path.push(path[0], path[1]);
    if (path.length >= 4) paths.push(path);
  }
  return paths;
}

/** The same curve as independent [x0, y0, x1, y1, ...] segments. */
export function contourSegments(F, view, options) {
  const segs = [];
  for (const path of contourPaths(F, view, options)) {
    for (let k = 0; k + 3 < path.length; k += 2) segs.push(path[k], path[k + 1], path[k + 2], path[k + 3]);
  }
  return segs;
}

/* ------------------------------------------------------------------ regions */

/**
 * Evaluate an inequality region on a grid and return RGBA pixels.
 * @param {(x: number, y: number) => boolean} region
 * @param {{ cell?: number, color: [number, number, number], alpha?: number, maxCells?: number }} options
 */
export function rasterRegion(region, view, { cell = 2, color, alpha = 0.3, maxCells = 600000 }) {
  let c = cell;
  while (Math.ceil(view.width / c) * Math.ceil(view.height / c) > maxCells) c += 1;
  const cols = Math.ceil(view.width / c);
  const rows = Math.ceil(view.height / c);
  const data = new Uint8ClampedArray(cols * rows * 4);
  const a = Math.round(alpha * 255);
  let filled = 0;
  for (let j = 0; j < rows; j += 1) {
    const y = view.toWorldY((j + 0.5) * c);
    for (let i = 0; i < cols; i += 1) {
      if (!region(view.toWorldX((i + 0.5) * c), y)) continue;
      const k = (j * cols + i) * 4;
      data[k] = color[0];
      data[k + 1] = color[1];
      data[k + 2] = color[2];
      data[k + 3] = a;
      filled += 1;
    }
  }
  return { cols, rows, cell: c, data, filled };
}
