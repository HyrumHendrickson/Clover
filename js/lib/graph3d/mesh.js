/**
 * Turning 3D plots into geometry. Everything works in unit space, where the
 * graph window is the cube [-1, 1]^3, and is pure so it is unit tested without
 * a canvas.
 *
 *  - surfaceTriangles    z = f(x, y) on a grid, with asymptote filtering
 *  - paramSurfaceTriangles   (x(u,v), y(u,v), z(u,v))
 *  - implicitTriangles   F(x, y, z) = 0 by marching tetrahedra
 *  - curveSegments       (x(t), y(t), z(t)), clipped to the cube
 *
 * Triangles are flat arrays of nine numbers each, segments six.
 */
import { GraphEvalError } from '../graph/values.js';

export const MAX_TRIANGLES = 160000;
export const MAX_SURFACE_LANES = 12;

/** The graph window: `[xmin, xmax, ymin, ymax, zmin, zmax]`. */
export class Box {
  constructor(bounds) {
    this.lo = [bounds[0], bounds[2], bounds[4]];
    this.hi = [bounds[1], bounds[3], bounds[5]];
  }

  /** World value to unit space along axis a (0, 1, or 2). */
  unit(a, v) {
    return ((v - this.lo[a]) / (this.hi[a] - this.lo[a])) * 2 - 1;
  }

  /** Unit space back to the world. */
  world(a, u) {
    return this.lo[a] + ((u + 1) / 2) * (this.hi[a] - this.lo[a]);
  }
}

const EPS = 1e-9;

const tooMany = () =>
  new GraphEvalError('This graph is too detailed to draw. Narrow the window or simplify the expression.');

/* ---------------------------------------------------------------- clipping */

const inside = (p) => Math.abs(p[0]) <= 1 + EPS && Math.abs(p[1]) <= 1 + EPS && Math.abs(p[2]) <= 1 + EPS;

/** Clip a convex polygon (arrays of [x, y, z]) to the unit cube, one plane at a time. */
function clipPolygon(poly) {
  let current = poly;
  for (let axis = 0; axis < 3; axis += 1) {
    for (const side of [1, -1]) {
      if (current.length === 0) return current;
      const next = [];
      for (let i = 0; i < current.length; i += 1) {
        const a = current[i];
        const b = current[(i + 1) % current.length];
        const da = 1 - side * a[axis];
        const db = 1 - side * b[axis];
        if (da >= 0) next.push(a);
        if (da >= 0 !== db >= 0) {
          const t = da / (da - db);
          next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
      current = next;
    }
  }
  return current;
}

/** Append a triangle to `out`, clipped to the cube. */
export function pushTriangle(out, a, b, c) {
  if (inside(a) && inside(b) && inside(c)) {
    out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    return;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if ((a[axis] > 1 && b[axis] > 1 && c[axis] > 1) || (a[axis] < -1 && b[axis] < -1 && c[axis] < -1)) {
      return;
    }
  }
  const poly = clipPolygon([a, b, c]);
  for (let i = 1; i + 1 < poly.length; i += 1) {
    const p = poly[0];
    const q = poly[i];
    const r = poly[i + 1];
    out.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
  }
}

/** Clip a segment to the unit cube; returns [t0, t1] along it or null. */
export function clipSegment(a, b) {
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = b[axis] - a[axis];
    for (const side of [1, -1]) {
      const p = side * d;
      const q = 1 - side * a[axis];
      if (Math.abs(p) < 1e-15) {
        if (q < 0) return null;
      } else {
        const t = q / p;
        if (p < 0) {
          if (t > t1) return null;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return null;
          if (t < t1) t1 = t;
        }
      }
    }
  }
  return [t0, t1];
}

/* ---------------------------------------------------------------- surfaces */

const safeCall = (fn, ...args) => {
  try {
    return fn(...args);
  } catch (error) {
    if (!(error instanceof GraphEvalError)) throw error;
    return NaN;
  }
};

const scalarOf = (v, what) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  throw new GraphEvalError(`${what} must be a single number at each point.`);
};

/**
 * Triangles for z = f(x, y) over the box. `f` may return a list at a point, in
 * which case one surface is drawn per item, as in `z = [1, 2, 3]x`.
 *
 * @param {(x: number, y: number) => number | number[]} f
 * @param {Box} box
 * @param {{ n?: number, mask?: ((x: number, y: number, z: number) => boolean) | null }} [options]
 * @returns {number[]} flat triangles in unit space
 */
export function surfaceTriangles(f, box, { n = 56, mask = null } = {}) {
  const stride = n + 1;
  const raw = new Array(stride * stride);
  let lanes = 1;
  const xs = new Float64Array(stride);
  const ys = new Float64Array(stride);
  for (let i = 0; i <= n; i += 1) {
    xs[i] = box.lo[0] + ((box.hi[0] - box.lo[0]) * i) / n;
    ys[i] = box.lo[1] + ((box.hi[1] - box.lo[1]) * i) / n;
  }
  for (let j = 0; j <= n; j += 1) {
    for (let i = 0; i <= n; i += 1) {
      const v = safeCall(f, xs[i], ys[j]);
      raw[j * stride + i] = v;
      if (Array.isArray(v) && v.length > lanes) lanes = v.length;
    }
  }
  if (lanes > MAX_SURFACE_LANES) {
    throw new GraphEvalError(`A list can graph at most ${MAX_SURFACE_LANES} surfaces at once; this one has ${lanes}.`);
  }
  if (n * n * 2 * lanes > MAX_TRIANGLES) throw tooMany();

  const out = [];
  const z = new Float64Array(stride * stride);
  const ux = new Float64Array(stride);
  const uy = new Float64Array(stride);
  for (let i = 0; i <= n; i += 1) {
    ux[i] = (2 * i) / n - 1;
    uy[i] = (2 * i) / n - 1;
  }
  const zSpan = box.hi[2] - box.lo[2];
  for (let lane = 0; lane < lanes; lane += 1) {
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        const v = raw[j * stride + i];
        let value;
        if (Array.isArray(v)) value = lane < v.length ? scalarOf(v[lane], 'A surface z = ...') : NaN;
        else value = lane === 0 ? scalarOf(v, 'A surface z = ...') : NaN;
        if (mask && Number.isFinite(value) && !safeCall(mask, xs[i], ys[j], value)) value = NaN;
        z[j * stride + i] = value;
      }
    }
    const tri = (p, q, r) => {
      const zp = z[p.k];
      const zq = z[q.k];
      const zr = z[r.k];
      if (!(Number.isFinite(zp) && Number.isFinite(zq) && Number.isFinite(zr))) return;
      const hi = Math.max(zp, zq, zr);
      const lo = Math.min(zp, zq, zr);
      // A sheet that spans the whole height between neighbours is an asymptote, not a surface.
      if (hi > box.hi[2] && lo < box.lo[2]) return;
      const to = (c, zz) => [ux[c.i], uy[c.j], ((zz - box.lo[2]) / zSpan) * 2 - 1];
      pushTriangle(out, to(p, zp), to(q, zq), to(r, zr));
    };
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const a = { i, j, k: j * stride + i };
        const b = { i: i + 1, j, k: j * stride + i + 1 };
        const c = { i: i + 1, j: j + 1, k: (j + 1) * stride + i + 1 };
        const d = { i, j: j + 1, k: (j + 1) * stride + i };
        tri(a, b, c);
        tri(a, c, d);
      }
    }
    if (out.length / 9 > MAX_TRIANGLES) throw tooMany();
  }
  return out;
}

/**
 * Triangles for a parametric surface. `at(u, v, out)` writes [x, y, z] into `out`.
 *
 * @param {(u: number, v: number, out: number[]) => void} at
 * @param {[number, number]} du parameter range of u
 * @param {[number, number]} dv parameter range of v
 */
export function paramSurfaceTriangles(at, du, dv, box, { n = 48, mask = null } = {}) {
  if (!(Number.isFinite(du[0]) && Number.isFinite(du[1]) && Number.isFinite(dv[0]) && Number.isFinite(dv[1]))) {
    return [];
  }
  if (n * n * 2 > MAX_TRIANGLES) throw tooMany();
  const stride = n + 1;
  const pts = new Float64Array(stride * stride * 3);
  const tmp = [0, 0, 0];
  for (let j = 0; j <= n; j += 1) {
    const v = dv[0] + ((dv[1] - dv[0]) * j) / n;
    for (let i = 0; i <= n; i += 1) {
      const u = du[0] + ((du[1] - du[0]) * i) / n;
      tmp[0] = NaN;
      tmp[1] = NaN;
      tmp[2] = NaN;
      safeCall(at, u, v, tmp);
      const k = (j * stride + i) * 3;
      const ok = Number.isFinite(tmp[0]) && Number.isFinite(tmp[1]) && Number.isFinite(tmp[2]);
      if (ok && mask && !safeCall(mask, u, v)) {
        pts[k] = NaN;
      } else {
        pts[k] = ok ? box.unit(0, tmp[0]) : NaN;
      }
      pts[k + 1] = ok ? box.unit(1, tmp[1]) : NaN;
      pts[k + 2] = ok ? box.unit(2, tmp[2]) : NaN;
    }
  }
  const out = [];
  const at3 = (i, j) => {
    const k = (j * stride + i) * 3;
    return Number.isFinite(pts[k]) ? [pts[k], pts[k + 1], pts[k + 2]] : null;
  };
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = at3(i, j);
      const b = at3(i + 1, j);
      const c = at3(i + 1, j + 1);
      const d = at3(i, j + 1);
      if (a && b && c) pushTriangle(out, a, b, c);
      if (a && c && d) pushTriangle(out, a, c, d);
    }
  }
  if (out.length / 9 > MAX_TRIANGLES) throw tooMany();
  return out;
}

/* ---------------------------------------------------------------- implicit */

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
/** Six tetrahedra around the cube diagonal 0-6. */
const TETS = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];
const POLE = 1e7;

/**
 * Triangles for F(x, y, z) = 0 by marching tetrahedra.
 *
 * @param {(x: number, y: number, z: number) => number} F
 * @param {Box} box
 * @param {{ n?: number, mask?: ((x: number, y: number, z: number) => boolean) | null }} [options]
 */
export function implicitTriangles(F, box, { n = 40, mask = null } = {}) {
  const stride = n + 1;
  const vals = new Float64Array(stride * stride * stride);
  const xs = new Float64Array(stride);
  const ys = new Float64Array(stride);
  const zs = new Float64Array(stride);
  for (let i = 0; i <= n; i += 1) {
    xs[i] = box.lo[0] + ((box.hi[0] - box.lo[0]) * i) / n;
    ys[i] = box.lo[1] + ((box.hi[1] - box.lo[1]) * i) / n;
    zs[i] = box.lo[2] + ((box.hi[2] - box.lo[2]) * i) / n;
  }
  for (let k = 0; k <= n; k += 1) {
    for (let j = 0; j <= n; j += 1) {
      for (let i = 0; i <= n; i += 1) {
        const v = safeCall(F, xs[i], ys[j], zs[k]);
        vals[(k * stride + j) * stride + i] = Number.isFinite(v) ? v : NaN;
      }
    }
  }
  const out = [];
  const cv = new Float64Array(8);
  const unit = (i) => (2 * i) / n - 1;
  const vert = (ci, i, j, k) => {
    const c = CORNERS[ci];
    return [i + c[0], j + c[1], k + c[2]];
  };
  const edge = (pa, va, pb, vb) => {
    const t = va / (va - vb);
    return [unit(pa[0] + (pb[0] - pa[0]) * t), unit(pa[1] + (pb[1] - pa[1]) * t), unit(pa[2] + (pb[2] - pa[2]) * t)];
  };
  const keep = (a, b, c) => {
    if (!mask) return true;
    const cx = box.world(0, (a[0] + b[0] + c[0]) / 3);
    const cy = box.world(1, (a[1] + b[1] + c[1]) / 3);
    const cz = box.world(2, (a[2] + b[2] + c[2]) / 3);
    return safeCall(mask, cx, cy, cz) === true;
  };
  const emit = (a, b, c) => {
    if (keep(a, b, c)) out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };

  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        let lo = Infinity;
        let hi = -Infinity;
        let bad = false;
        for (let c = 0; c < 8; c += 1) {
          const o = CORNERS[c];
          const v = vals[((k + o[2]) * stride + (j + o[1])) * stride + (i + o[0])];
          cv[c] = v;
          if (Number.isNaN(v)) bad = true;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (bad || lo > 0 || hi < 0) continue;
        if (Math.abs(lo) > POLE && Math.abs(hi) > POLE) continue;
        for (const tet of TETS) {
          const v = [cv[tet[0]], cv[tet[1]], cv[tet[2]], cv[tet[3]]];
          const p = tet.map((ci) => vert(ci, i, j, k));
          const neg = [];
          const pos = [];
          for (let m = 0; m < 4; m += 1) (v[m] < 0 ? neg : pos).push(m);
          if (neg.length === 0 || pos.length === 0) continue;
          if (neg.length === 1 || pos.length === 1) {
            const [lone, others] = neg.length === 1 ? [neg[0], pos] : [pos[0], neg];
            emit(
              edge(p[lone], v[lone], p[others[0]], v[others[0]]),
              edge(p[lone], v[lone], p[others[1]], v[others[1]]),
              edge(p[lone], v[lone], p[others[2]], v[others[2]]),
            );
          } else {
            const [a, b] = neg;
            const [c, d] = pos;
            const ac = edge(p[a], v[a], p[c], v[c]);
            const ad = edge(p[a], v[a], p[d], v[d]);
            const bd = edge(p[b], v[b], p[d], v[d]);
            const bc = edge(p[b], v[b], p[c], v[c]);
            emit(ac, ad, bd);
            emit(ac, bd, bc);
          }
        }
        if (out.length / 9 > MAX_TRIANGLES) throw tooMany();
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ curves */

/**
 * Segments for a space curve. `at(t, out)` writes [x, y, z] into `out`.
 *
 * @param {[number, number]} domain parameter range
 * @returns {number[]} flat segments [x0, y0, z0, x1, y1, z1, ...] in unit space
 */
export function curveSegments(at, domain, box, { samples = 800, mask = null } = {}) {
  const [t0, t1] = domain;
  if (!(Number.isFinite(t0) && Number.isFinite(t1))) return [];
  const out = [];
  const tmp = [0, 0, 0];
  let prev = null;
  for (let s = 0; s <= samples; s += 1) {
    const t = t0 + ((t1 - t0) * s) / samples;
    tmp[0] = NaN;
    tmp[1] = NaN;
    tmp[2] = NaN;
    safeCall(at, t, tmp);
    const ok = Number.isFinite(tmp[0]) && Number.isFinite(tmp[1]) && Number.isFinite(tmp[2]);
    const shown = ok && (!mask || safeCall(mask, t) === true);
    const cur = shown ? [box.unit(0, tmp[0]), box.unit(1, tmp[1]), box.unit(2, tmp[2])] : null;
    if (prev && cur) {
      const clip = clipSegment(prev, cur);
      if (clip) {
        const lerp = (a, b, f) => a + (b - a) * f;
        out.push(
          lerp(prev[0], cur[0], clip[0]),
          lerp(prev[1], cur[1], clip[0]),
          lerp(prev[2], cur[2], clip[0]),
          lerp(prev[0], cur[0], clip[1]),
          lerp(prev[1], cur[1], clip[1]),
          lerp(prev[2], cur[2], clip[1]),
        );
      }
    }
    prev = cur;
  }
  return out;
}

/** Points of a 3D point value (a point or a list of points) that lie in the box, as unit-space triples. */
export function pointDots(value, box, limit = 5000) {
  const list = Array.isArray(value) ? value : [value];
  const out = [];
  for (const p of list.slice(0, limit)) {
    if (!p || typeof p !== 'object' || p.z === undefined) continue;
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) continue;
    const u = [box.unit(0, p.x), box.unit(1, p.y), box.unit(2, p.z)];
    if (inside(u)) out.push(u[0], u[1], u[2]);
  }
  return out;
}
