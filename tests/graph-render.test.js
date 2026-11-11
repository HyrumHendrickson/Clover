import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExtrema, findIntersections, findRoots, pointsOfInterest } from '../js/lib/graph/analysis.js';
import { nearestOnPaths, nearestOnSegments } from '../js/lib/graph/hit.js';
import {
  contourPaths,
  contourSegments,
  rasterRegion,
  sampleExplicit,
  sampleParam,
  samplePolar,
} from '../js/lib/graph/sample.js';
import { GraphView, axisTicks, normalizeGraphView } from '../js/lib/graph/view.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} should be within ${tol} of ${b}`);
const view = () => new GraphView({ cx: 0, cy: 0, xspan: 20, yspan: 0 }, 800, 600);

/* --------------------------------------------------------------------- view */

test('a square default view has equal scales and the expected window', () => {
  const v = view();
  assert.equal(v.sx, 40);
  assert.equal(v.sy, 40);
  assert.deepEqual(v.bounds(), { xmin: -10, xmax: 10, ymin: -7.5, ymax: 7.5 });
});

test('screen and world coordinates round-trip', () => {
  const v = new GraphView({ cx: 3, cy: -2, xspan: 7, yspan: 11 }, 500, 400);
  for (const [px, py] of [
    [0, 0],
    [123, 321],
    [500, 400],
  ]) {
    const [x, y] = v.toWorld(px, py);
    const [qx, qy] = v.toScreen(x, y);
    close(qx, px, 1e-9);
    close(qy, py, 1e-9);
  }
});

test('zoom keeps the point under the pointer fixed, and one axis can zoom alone', () => {
  const v = new GraphView({ cx: 1, cy: 2, xspan: 10, yspan: 0 }, 500, 400);
  const [wx, wy] = v.toWorld(123, 321);
  v.zoomAt(123, 321, 2.5);
  const [ax, ay] = v.toWorld(123, 321);
  close(ax, wx);
  close(ay, wy);
  const sy = v.sy;
  v.zoomAxisAt('x', 50, 50, 2);
  assert.equal(v.sy, sy);
  close(v.sx, sy * 2);
  v.zoomAt(0, 0, -1);
  close(v.sx, sy * 2);
});

test('bounds, square, resize and JSON behave', () => {
  const v = view();
  assert.equal(v.setBounds(0, 10, -1, 1), true);
  assert.deepEqual(v.bounds(), { xmin: 0, xmax: 10, ymin: -1, ymax: 1 });
  assert.equal(v.setBounds(5, 5, 0, 1), false);
  assert.equal(v.setBounds(NaN, 5, 0, 1), false);
  v.makeSquare();
  assert.equal(v.sx, v.sy);
  const scale = v.sx;
  v.resize(1000, 700);
  assert.equal(v.sx, scale, 'resizing keeps the scale and shows more of the plane');
  const saved = JSON.parse(JSON.stringify(v));
  const again = new GraphView(saved, 1000, 700);
  close(again.sx, v.sx, 1e-9);
  close(again.sy, v.sy, 1e-9);
});

test('extreme zoom is clamped', () => {
  const v = view();
  v.zoomAt(400, 300, 1e30);
  assert.ok(v.xspan >= 1e-9 * 0.999);
  v.zoomAt(400, 300, 1e-60);
  assert.ok(v.xspan <= 1e9 * 1.001);
});

test('saved views are sanitised', () => {
  const fallback = { cx: 0, cy: 0, xspan: 20, yspan: 0 };
  assert.deepEqual(normalizeGraphView(null, fallback), fallback);
  const odd = normalizeGraphView({ cx: 'a', cy: Infinity, xspan: -5, yspan: NaN }, fallback);
  assert.equal(odd.cx, 0);
  assert.equal(odd.cy, 0);
  assert.ok(odd.xspan > 0);
  assert.equal(odd.yspan, 0);
  assert.deepEqual(normalizeGraphView(odd, fallback), odd, 'idempotent');
});

test('grid spacing is 1, 2 or 5 times a power of ten', () => {
  assert.deepEqual(axisTicks(20, 800), { step: 2, minorDiv: 4 });
  assert.equal(axisTicks(0.003, 800).step, 0.0002);
  assert.equal(axisTicks(1e6, 800).step, 100000);
  for (const span of [0.7, 3, 17, 450, 9e4]) {
    const { step } = axisTicks(span, 800);
    const m = step / 10 ** Math.floor(Math.log10(step));
    assert.ok(
      [1, 2, 5].some((k) => Math.abs(m - k) < 1e-9),
      `${step}`,
    );
  }
});

/* ---------------------------------------------------------------- sampling */

test('a parabola is one path lying on the curve', () => {
  const v = view();
  const paths = sampleExplicit((x) => x * x, null, v);
  assert.equal(paths.length, 1);
  const p = paths[0];
  for (let k = 0; k < p.length; k += 2) {
    const x = v.toWorldX(p[k]);
    if (Math.abs(x) < 3.5) close(v.toWorldY(p[k + 1]), x * x, 1e-9);
  }
});

test('asymptotes and steps break the line; steep lines do not', () => {
  const v = view();
  assert.equal(sampleExplicit(Math.tan, null, v).length, 7, 'six poles in [-10, 10]');
  assert.equal(sampleExplicit((x) => 1 / x, null, v).length, 2);
  assert.equal(sampleExplicit((x) => 1000 * x, null, v).length, 1);
  assert.equal(sampleExplicit(Math.floor, null, v).length, 21);
  assert.equal(sampleExplicit((x) => Math.sign(x), null, v).length, 2);
});

test('curves start where they become defined', () => {
  const v = view();
  const sqrt = sampleExplicit(Math.sqrt, null, v)[0];
  close(sqrt[0], 400, 0.01);
  const restricted = sampleExplicit(
    (x) => x,
    (x) => x > 1,
    v,
  )[0];
  close(v.toWorldX(restricted[0]), 1, 0.001);
  assert.deepEqual(
    sampleExplicit(() => NaN, null, v),
    [],
  );
  assert.deepEqual(
    sampleExplicit(() => Infinity, null, v),
    [],
  );
});

test('x = f(y) is sampled along the vertical', () => {
  const v = view();
  const paths = sampleExplicit((y) => y * y, null, v, { vertical: true });
  assert.equal(paths.length, 1);
  const p = paths[0];
  const k = Math.floor(p.length / 4) * 2;
  const y = v.toWorldY(p[k + 1]);
  close(v.toWorldX(p[k]), y * y, 1e-9);
});

test('parametric and polar curves close up and respect domains', () => {
  const v = view();
  const circle = sampleParam(
    (t, out) => {
      out[0] = 5 * Math.cos(t);
      out[1] = 5 * Math.sin(t);
    },
    null,
    [0, 2 * Math.PI],
    v,
  );
  assert.equal(circle.length, 1);
  const c = circle[0];
  close(Math.hypot(c[0] - c.at(-2), c[1] - c.at(-1)), 0, 1e-6);
  for (let k = 0; k < c.length; k += 2) close(Math.hypot(v.toWorldX(c[k]), v.toWorldY(c[k + 1])), 5, 0.02);
  assert.deepEqual(
    sampleParam(() => {}, null, [1, 0], v),
    [],
  );
  assert.deepEqual(
    sampleParam(() => {}, null, [NaN, 1], v),
    [],
  );
  const rose = samplePolar((t) => 4 * Math.cos(3 * t), null, [0, Math.PI], v);
  assert.equal(rose.length, 1);
  const masked = samplePolar(
    (t) => t,
    (t) => t > 3,
    [0, 6],
    v,
  );
  assert.equal(masked.length, 1);
  const first = masked[0];
  close(Math.hypot(v.toWorldX(first[0]), v.toWorldY(first[1])), 3, 0.2);
});

test('a parametric curve with a pole is split instead of joined across it', () => {
  const v = view();
  const paths = sampleParam(
    (t, out) => {
      out[0] = 1 / t;
      out[1] = t;
    },
    null,
    [-3, 3],
    v,
  );
  assert.ok(paths.length >= 2);
});

/* ----------------------------------------------------------------- contours */

test('a circle is one closed path within a hundredth of a unit', () => {
  const v = view();
  const paths = contourPaths((x, y) => x * x + y * y - 25, v);
  assert.equal(paths.length, 1);
  const p = paths[0];
  assert.deepEqual([p[0], p[1]], [p.at(-2), p.at(-1)], 'closed');
  for (let k = 0; k < p.length; k += 2) close(Math.hypot(v.toWorldX(p[k]), v.toWorldY(p[k + 1])), 5, 0.01);
});

test('poles are not drawn as curves', () => {
  const v = view();
  const paths = contourPaths((x, y) => x * y - 1, v);
  assert.equal(paths.length, 2, 'the two branches of a hyperbola');
  for (const p of paths) {
    for (let k = 0; k + 3 < p.length; k += 2) assert.ok(Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]) < 8);
  }
  const tan = contourSegments((x, y) => y - Math.tan(x), v);
  for (let k = 0; k < tan.length; k += 4) assert.ok(Math.abs(tan[k + 1] - tan[k + 3]) < 20);
});

test('crossing curves resolve both branches', () => {
  const v = view();
  const segs = contourSegments((x, y) => x * x - y * y, v);
  const near = (wx, wy) => {
    const [sx, sy] = v.toScreen(wx, wy);
    return nearestOnSegments(segs, sx, sy, 3) !== null;
  };
  assert.ok(near(3, 3) && near(3, -3) && near(-3, 3) && near(-3, -3));
  assert.ok(!near(3, 0));
});

test('a filter keeps only the allowed part of a curve', () => {
  const v = view();
  const all = contourSegments((x, y) => x * x + y * y - 25, v).length;
  const half = contourSegments((x, y) => x * x + y * y - 25, v, { filter: (x) => x > 0 }).length;
  assert.ok(half > all * 0.4 && half < all * 0.6);
});

test('the grid size is capped so huge canvases stay responsive', () => {
  const big = new GraphView({ cx: 0, cy: 0, xspan: 20, yspan: 0 }, 4000, 3000);
  let calls = 0;
  contourPaths(() => (calls += 1), big, { cell: 1, maxCells: 20000 });
  assert.ok(calls <= 20000 * 1.2, `${calls}`);
});

test('regions rasterise to the right area', () => {
  const v = view();
  const r = rasterRegion((x, y) => x * x + y * y < 25, v, { cell: 2, color: [1, 2, 3], alpha: 0.5 });
  close((r.filled * r.cell * r.cell) / (v.sx * v.sy), Math.PI * 25, 0.5);
  assert.equal(r.data.length, r.cols * r.rows * 4);
  const k = (Math.floor(r.rows / 2) * r.cols + Math.floor(r.cols / 2)) * 4;
  assert.deepEqual([...r.data.slice(k, k + 4)], [1, 2, 3, 128]);
  assert.equal(rasterRegion(() => false, v, { color: [0, 0, 0] }).filled, 0);
});

/* ----------------------------------------------------------------- analysis */

test('roots avoid poles and find sign changes', () => {
  assert.deepEqual(
    findRoots((x) => x * x - 1, -10, 10),
    [-1, 1],
  );
  assert.deepEqual(
    findRoots((x) => 1 / x, -5, 5),
    [],
  );
  assert.deepEqual(
    findRoots(Math.tan, -5, 5).map((r) => Number(r.toFixed(6))),
    [-3.141593, 0, 3.141593],
  );
  assert.deepEqual(
    findRoots((x) => x, 1, -1),
    [],
  );
});

test('extrema are accurate and poles are not extrema', () => {
  const [max, min] = findExtrema((x) => x ** 3 - 3 * x, -5, 5);
  close(max.x, -1, 1e-6);
  close(max.y, 2, 1e-9);
  assert.equal(max.type, 'max');
  close(min.x, 1, 1e-6);
  assert.equal(min.type, 'min');
  assert.deepEqual(findExtrema(Math.tan, -5, 5), []);
  assert.deepEqual(
    findExtrema((x) => x, -5, 5),
    [],
  );
});

test('intersections include tangent contact', () => {
  const pts = findIntersections(
    (x) => x,
    (x) => x * x,
    -5,
    5,
  );
  assert.deepEqual(
    pts.map((p) => [p.x, p.y]),
    [
      [0, 0],
      [1, 1],
    ],
  );
  const tangent = findIntersections(
    (x) => x * x,
    (x) => 0 * x,
    -5,
    5,
  );
  assert.equal(tangent.length, 1);
  close(tangent[0].x, 0, 1e-6);
});

test('points of interest are merged, snapped and sorted', () => {
  const pts = pointsOfInterest((x) => x * x - 4, [(x) => 2 * x - 1], -10, 10);
  assert.deepEqual(
    pts.map((p) => [p.x, p.y, p.type]),
    [
      [-2, 0, 'root'],
      [-1, -3, 'cross'],
      [0, -4, 'min'],
      [2, 0, 'root'],
      [3, 5, 'cross'],
    ],
  );
  assert.deepEqual(
    pointsOfInterest((x) => x * x, [], -5, 5),
    [{ x: 0, y: 0, type: 'root' }],
  );
  assert.deepEqual(
    pointsOfInterest((x) => x, [], 1, 1),
    [],
  );
});

/* --------------------------------------------------------------- hit tests */

test('nearest point queries respect the radius', () => {
  const paths = [[0, 0, 10, 0, 10, 10]];
  const hit = nearestOnPaths(paths, 5, 3, 5);
  assert.deepEqual([hit.x, hit.y, hit.dist], [5, 0, 3]);
  assert.equal(nearestOnPaths(paths, 5, 30, 5), null);
  assert.equal(nearestOnPaths([], 0, 0, 5), null);
  const seg = nearestOnSegments([0, 0, 4, 0, 0, 10, 4, 10], 2, 9, 3);
  assert.equal(seg.y, 10);
  assert.equal(nearestOnSegments([0, 0, 0, 0], 3, 4, 10).dist, 5, 'degenerate segments are points');
});
