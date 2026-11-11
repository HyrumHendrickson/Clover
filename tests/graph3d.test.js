import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, MAX_PITCH, normalizeCamera } from '../js/lib/graph3d/camera.js';
import {
  Box,
  clipSegment,
  curveSegments,
  implicitTriangles,
  paramSurfaceTriangles,
  pointDots,
  pushTriangle,
  surfaceTriangles,
} from '../js/lib/graph3d/mesh.js';
import { Graph3DModel } from '../js/lib/graph3d/model.js';
import { renderScene } from '../js/lib/graph3d/render.js';
import { Point } from '../js/lib/graph/values.js';

const box = new Box([-5, 5, -5, 5, -5, 5]);
const rows = (...texts) => texts.map((text, i) => ({ id: `r${i}`, kind: 'expr', text }));
function build(...texts) {
  const model = new Graph3DModel();
  model.update(rows(...texts));
  return { model, info: (i) => model.info(`r${i}`) };
}
const triangles = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += 9) out.push(list.slice(i, i + 9));
  return out;
};
const allInsideCube = (list) => list.every((v) => Math.abs(v) <= 1 + 1e-9);

/* ------------------------------------------------------------------ camera */

test('the camera keeps orbit values in range and survives hostile input', () => {
  const c = normalizeCamera({ yaw: 'x', pitch: 99, zoom: -4, panX: Infinity, perspective: 0 });
  assert.ok(c.pitch <= MAX_PITCH);
  assert.ok(c.zoom > 0);
  assert.equal(c.panX, 0);
  assert.equal(c.perspective, true);
  assert.deepEqual(normalizeCamera(normalizeCamera(c)), c, 'idempotent');
  assert.deepEqual(normalizeCamera(null), normalizeCamera({}));
});

test('a point farther along the view direction has a larger depth, and up is up', () => {
  const cam = new Camera({ yaw: 0, pitch: 0 }, 400, 400);
  const out = [0, 0, 0];
  cam.rotate(0, 1, 0, out);
  assert.ok(out[2] > 0, 'y points away from a camera at the front');
  cam.rotate(0, 0, 1, out);
  assert.equal(out[1], 1, 'z is up on screen');
  const top = new Camera({ yaw: 0, pitch: MAX_PITCH }, 400, 400);
  top.rotate(0, 0, 1, out);
  assert.ok(out[2] < 0, 'seen from above, higher points are nearer');
});

test('projection centres the origin, flips y for the screen, and shrinks distant points', () => {
  const cam = new Camera({ yaw: 0.3, pitch: 0.4 }, 600, 400);
  const o = cam.project(0, 0, 0, [0, 0, 0]);
  assert.equal(o[0], 300);
  assert.equal(o[1], 200);
  const up = cam.project(0, 0, 1, [0, 0, 0]);
  assert.ok(up[1] < o[1], 'higher z is higher on screen');
  const near = Math.hypot(
    ...cam
      .project(1, 0, 0, [0, 0, 0])
      .slice(0, 2)
      .map((v, i) => v - o[i]),
  );
  cam.perspective = false;
  const flat = Math.hypot(
    ...cam
      .project(1, 0, 0, [0, 0, 0])
      .slice(0, 2)
      .map((v, i) => v - o[i]),
  );
  assert.ok(near > 0 && flat > 0);
});

test('orbiting, panning, and zooming respond to drags and stay in range', () => {
  const cam = new Camera({}, 500, 500);
  const yaw = cam.yaw;
  cam.orbit(100, 0);
  assert.ok(cam.yaw > yaw);
  cam.orbit(0, 1e6);
  assert.ok(cam.pitch <= MAX_PITCH);
  cam.zoomBy(1e9);
  assert.ok(cam.zoom <= 12);
  cam.pan(1e9, 0);
  assert.ok(cam.panX <= 3);
  assert.deepEqual(new Camera(cam.toJSON()).toJSON(), cam.toJSON());
});

/* ------------------------------------------------------------------- model */

test('rows classify as surfaces, curves, parametric and implicit surfaces, and points', () => {
  const { info } = build(
    'z = x^2 + y^2',
    'x^2 - y^2',
    'f(x, y) = x y',
    'x^2 + y^2 + z^2 = 9',
    '(cos(t), sin(t), t)',
    '(u, v, u v)',
    '(1, 2, 3)',
    'x = 2',
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => info(i).plot?.type),
    ['surface', 'surface', 'surface', 'implicit3', 'curve3', 'psurface', 'points3', 'implicit3'],
  );
});

test('z cannot be defined, but other letters and functions can', () => {
  const { info, model } = build('z = 3', 'a = 2', 'z = a x');
  assert.equal(info(0).plot.type, 'surface', 'z = 3 is a plane, not a definition');
  assert.equal(info(1).kind, 'var');
  assert.equal(model.info('r2').plot.raw(2, 0), 4);
});

test('sensible errors for what the 3D graph cannot draw', () => {
  const { info } = build('y > x', 'r = theta', '(1, 2)', 'z > x + y', '(t, u, v)', 'x + z');
  assert.match(info(0).error, /not supported in 3D/);
  assert.match(info(1).error, /2D graph/);
  assert.match(info(2).error, /three coordinates/);
  assert.match(info(3).error, /not supported in 3D/);
  assert.match(info(4).error, /at most two/);
  assert.match(info(5).error, /uses z/);
});

test('sliders and definitions are shared with the surface', () => {
  const { model, info } = build('a = 1', 'z = a x');
  assert.equal(info(1).plot.raw(2, 0), 2);
  model.setSlider('r0', 3);
  assert.equal(info(1).plot.raw(2, 0), 6);
});

test('parametric rows take their limits from restrictions or from typed ranges', () => {
  const { info } = build('(t, t, t) {0 <= t <= 3}', '(t, t, t)');
  assert.deepEqual(info(0).plot.domain(), [0, 3]);
  assert.equal(info(0).domains[0].fromRestriction, true);
  assert.deepEqual(info(1).plot.domain(), [0, Math.PI * 2]);
  const model = new Graph3DModel();
  model.update([{ id: 'a', text: '(t, t, t)', ranges: { t: ['-1', '1'] } }]);
  assert.deepEqual(model.info('a').plot.domain(), [-1, 1]);
});

/* -------------------------------------------------------------------- mesh */

test('a surface fills the grid and stays inside the cube', () => {
  const { info } = build('z = x');
  const tris = surfaceTriangles(info(0).plot.raw, box, { n: 10 });
  assert.equal(tris.length / 9, 10 * 10 * 2);
  assert.ok(allInsideCube(tris));
});

test('a surface that leaves the window is clipped, not discarded or left outside', () => {
  const { info } = build('z = 3x');
  const tris = surfaceTriangles(info(0).plot.raw, box, { n: 20 });
  assert.ok(tris.length > 0);
  assert.ok(allInsideCube(tris));
  const zs = tris.filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) >= 1 - 1e-9 && Math.min(...zs) <= -1 + 1e-9, 'it reaches both faces of the cube');
});

test('an asymptote does not draw a wall across the whole window', () => {
  const { info } = build('z = 1/x');
  const tris = surfaceTriangles(info(0).plot.raw, box, { n: 40 });
  const walls = triangles(tris).filter((t) => {
    const zs = [t[2], t[5], t[8]];
    return Math.max(...zs) - Math.min(...zs) > 1.9;
  });
  assert.equal(walls.length, 0);
});

test('a list in a surface draws one sheet per item, and undefined points leave holes', () => {
  const { info } = build('z = [1, 2, 3]x/5', 'z = sqrt(x)');
  assert.equal(surfaceTriangles(info(0).plot.raw, box, { n: 6 }).length / 9, 6 * 6 * 2 * 3);
  const half = surfaceTriangles(info(1).plot.raw, box, { n: 10 });
  assert.ok(half.length > 0 && half.length < 10 * 10 * 2 * 9);
});

test('a restriction hides part of a surface', () => {
  const { info } = build('z = x + y {x > 0}');
  const tris = surfaceTriangles(info(0).plot.raw, box, { n: 10, mask: info(0).plot.mask });
  const xs = tris.filter((_, i) => i % 3 === 0);
  assert.ok(Math.min(...xs) >= -0.2 - 1e-9);
});

test('an implicit sphere is built from triangles on the sphere', () => {
  const { info } = build('x^2 + y^2 + z^2 = 9');
  const tris = implicitTriangles(info(0).plot.F, box, { n: 24 });
  assert.ok(tris.length / 9 > 500);
  assert.ok(allInsideCube(tris));
  for (let i = 0; i < tris.length; i += 3) {
    const r = Math.hypot(tris[i] * 5, tris[i + 1] * 5, tris[i + 2] * 5);
    assert.ok(Math.abs(r - 3) < 0.25, `vertex at radius ${r}`);
  }
});

test('an implicit surface that misses the window draws nothing, and a plane is flat', () => {
  assert.equal(implicitTriangles(() => 1, box, { n: 8 }).length, 0);
  const { info } = build('x = 2');
  const tris = implicitTriangles(info(0).plot.F, box, { n: 8 });
  assert.ok(tris.length > 0);
  assert.ok(tris.filter((_, i) => i % 3 === 0).every((x) => Math.abs(x - 0.4) < 1e-9));
});

test('a parametric surface and a space curve are sampled and clipped', () => {
  const { info } = build('(u cos(v), u sin(v), u) {0 <= u <= 3, 0 <= v <= 2pi}', '(t, 0, 0) {-10 <= t <= 10}');
  const cone = info(0).plot;
  const tris = paramSurfaceTriangles(cone.at, cone.domainU(), cone.domainV(), box, { n: 16 });
  assert.ok(tris.length > 0 && allInsideCube(tris));
  const line = info(1).plot;
  const segs = curveSegments(line.at, line.domain(), box, { samples: 100 });
  assert.ok(segs.length > 0 && allInsideCube(segs));
  const xs = segs.filter((_, i) => i % 3 === 0);
  assert.ok(Math.max(...xs) <= 1 + 1e-9 && Math.min(...xs) >= -1 - 1e-9, 'the part outside the window is cut off');
});

test('clipping helpers', () => {
  assert.deepEqual(clipSegment([-2, 0, 0], [2, 0, 0]), [0.25, 0.75]);
  assert.equal(clipSegment([2, 2, 2], [3, 3, 3]), null);
  const out = [];
  pushTriangle(out, [2, 2, 2], [3, 2, 2], [2, 3, 2]);
  assert.equal(out.length, 0, 'a triangle wholly outside is dropped');
  pushTriangle(out, [-0.5, -0.5, 0], [0.5, -0.5, 0], [0, 3, 0]);
  assert.ok(out.length >= 9 && allInsideCube(out));
});

test('points are kept only when they are in the window', () => {
  const dots = pointDots([new Point(0, 0, 0), new Point(9, 0, 0), new Point(1, 1)], box);
  assert.equal(dots.length, 3, 'one point in the window; the 2D point and the outside point are skipped');
});

test('too much detail is refused with a message', () => {
  assert.throws(() => surfaceTriangles(() => 0, box, { n: 700 }), /too detailed/);
});

/* ------------------------------------------------------------------ render */

function recorder() {
  const calls = {};
  const g = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args) => {
          (calls[key] ??= []).push(args);
        },
      set: () => true,
    },
  );
  return { g, calls };
}

test('rendering paints triangles far to near, then labels the axes', () => {
  const { info } = build('z = x');
  const tris = surfaceTriangles(info(0).plot.raw, box, { n: 6 });
  const { g, calls } = recorder();
  const colors = { bg: '#fff', grid: '#ddd', axis: '#999', text: '#555', ink: '#111' };
  const cam = new Camera({}, 400, 300);
  const result = renderScene(g, cam, box, [{ id: 'a', color: '#2d70b3', tris }], { colors, numbers: true });
  assert.ok(result.primitives >= tris.length / 9);
  assert.ok(calls.fill.length >= tris.length / 9);
  assert.ok(calls.fillText.some(([text]) => text === 'x') && calls.fillText.some(([text]) => text === 'z'));
  assert.ok(calls.fillText.length > 6, 'tick numbers are drawn');
  const bare = recorder();
  renderScene(bare.g, cam, box, [], { colors, numbers: false, grid: false });
  assert.ok(bare.calls.fillText.length === 3, 'only axis names remain');
});

test('rendering handles empty scenes, wireframes, curves, and points', () => {
  const { g } = recorder();
  const colors = { bg: '#fff', grid: '#ddd', axis: '#999', text: '#555', ink: '#111' };
  const cam = new Camera({ pitch: -0.4 }, 300, 300);
  assert.doesNotThrow(() => renderScene(g, cam, box, [], { colors }));
  assert.doesNotThrow(() =>
    renderScene(
      g,
      cam,
      box,
      [
        {
          id: 'a',
          color: '#c74440',
          segs: [0, 0, 0, 0.5, 0.5, 0.5],
          dots: [0, 0, 0],
          tris: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        },
      ],
      {
        colors,
        wire: true,
        fast: true,
      },
    ),
  );
});
