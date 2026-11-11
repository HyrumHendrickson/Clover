import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divCurl, traceStreamline, typicalMagnitude } from '../js/lib/field.js';
import { View } from '../js/lib/viewport.js';
import { compileReal } from '../js/lib/expr.js';

const field = (p, q) => [compileReal(p, ['x', 'y']), compileReal(q, ['x', 'y'])];
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('divergence and curl of standard fields', () => {
  const [rp, rq] = field('-y', 'x');
  const rot = divCurl(rp, rq, 0.3, 0.7, 1e-4);
  near(rot.div, 0);
  near(rot.curl, 2);
  const [sp, sq] = field('x', 'y');
  const src = divCurl(sp, sq, -1, 2, 1e-4);
  near(src.div, 2);
  near(src.curl, 0);
  const [gp, gq] = field('x^2', 'x*y');
  near(divCurl(gp, gq, 2, 3, 1e-4).div, 2 * 2 + 2, 1e-5);
});

test('streamlines of a rotation field stay on a circle and close', () => {
  const [P, Q] = field('-y', 'x');
  const pts = traceStreamline(P, Q, 2, 0, {
    step: 0.02,
    maxSteps: 3000,
    bounds: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
  });
  for (const [x, y] of pts) near(Math.hypot(x, y), 2, 1e-4);
  assert.ok(pts.length > 100 && pts.length < 3000, 'orbit should close before the step limit');
  const last = pts[pts.length - 1];
  near(last[0], 2, 1e-9);
});

test('streamlines stop at stagnation points and view bounds', () => {
  const [P, Q] = field('x', 'y');
  const out = traceStreamline(P, Q, 0.5, 0.5, { step: 0.05, bounds: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 } });
  const [x, y] = out[out.length - 1];
  assert.ok(Math.abs(x) <= 3 && Math.abs(y) <= 3);
  const [zp, zq] = field('0', '0');
  assert.equal(
    traceStreamline(zp, zq, 1, 1, { step: 0.1, bounds: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 } }).length,
    1,
  );
});

test('backward integration retraces the flow in reverse', () => {
  const [P, Q] = field('1', '0');
  const back = traceStreamline(P, Q, 0, 0, {
    step: -0.1,
    maxSteps: 10,
    bounds: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 },
  });
  near(back[back.length - 1][0], -1, 1e-9);
});

test('typicalMagnitude ignores singularities', () => {
  const view = new View({ radius: 2 }, 400, 400);
  const [P, Q] = field('x/(x^2+y^2)', 'y/(x^2+y^2)');
  const m = typicalMagnitude(P, Q, view);
  assert.ok(Number.isFinite(m) && m > 0 && m < 10);
  const [ZP, ZQ] = field('0', '0');
  assert.ok(typicalMagnitude(ZP, ZQ, view) > 0);
});
