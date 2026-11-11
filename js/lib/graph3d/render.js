/**
 * Canvas rendering for the 3D graph: a software renderer using the painter's
 * algorithm. Triangles, curve segments, and points are projected, sorted from
 * far to near, and drawn with flat shading. Intersecting surfaces can show
 * small ordering artefacts along the seam; that is the cost of needing no GL.
 */
import { formatTick } from '../viewport.js';
import { axisTicks } from '../graph/view.js';
import { hexToRgb } from '../graph/draw.js';

const FONT = '12px ui-sans-serif, system-ui, sans-serif';
const LIGHT = normalize([-0.35, 0.45, -0.82]);

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

const SHADE_LEVELS = 24;

/** A cache of fill styles per item colour and brightness level. */
function shadeTable(hex) {
  const [r, g, b] = hexToRgb(hex);
  const table = [];
  for (let level = 0; level <= SHADE_LEVELS; level += 1) {
    const k = 0.42 + (0.72 * level) / SHADE_LEVELS;
    const mix = (c) => Math.round(Math.min(255, k > 1 ? c + (255 - c) * (k - 1) * 0.9 : c * k));
    table.push(`rgb(${mix(r)},${mix(g)},${mix(b)})`);
  }
  return table;
}

/**
 * Draw the whole scene.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {import('./camera.js').Camera} camera
 * @param {{ lo: number[], hi: number[] }} box graph window (world units)
 * @param {{ id: string, color: string, tris?: ArrayLike<number>, segs?: ArrayLike<number>, dots?: ArrayLike<number> }[]} items
 * @param {{ colors: object, grid?: boolean, numbers?: boolean, wire?: boolean, fast?: boolean }} options
 */
export function renderScene(g, camera, box, items, options) {
  const { colors, grid = true, numbers = true, wire = false, fast = false } = options;
  const { width, height } = camera;
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, width, height);

  drawFrame(g, camera, box, colors, { grid, numbers });

  /* Collect primitives. */
  let count = 0;
  for (const item of items) {
    count += (item.tris?.length ?? 0) / 9 + (item.segs?.length ?? 0) / 6 + (item.dots?.length ?? 0) / 3;
  }
  const axisSegs = [];
  addAxes(axisSegs, box);
  count += axisSegs.length / 6;

  const kind = new Uint8Array(count); // 0 triangle, 1 segment, 2 dot, 3 axis
  const owner = new Uint16Array(count);
  const xs = new Float32Array(count * 3);
  const ys = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const shade = new Uint8Array(count);
  let n = 0;
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const c = [0, 0, 0];
  const va = [0, 0, 0];
  const vb = [0, 0, 0];
  const vc = [0, 0, 0];

  items.forEach((item, index) => {
    const tris = item.tris ?? [];
    for (let i = 0; i + 8 < tris.length; i += 9) {
      camera.project(tris[i], tris[i + 1], tris[i + 2], a);
      camera.project(tris[i + 3], tris[i + 4], tris[i + 5], b);
      camera.project(tris[i + 6], tris[i + 7], tris[i + 8], c);
      camera.rotate(tris[i], tris[i + 1], tris[i + 2], va);
      camera.rotate(tris[i + 3], tris[i + 4], tris[i + 5], vb);
      camera.rotate(tris[i + 6], tris[i + 7], tris[i + 8], vc);
      const ux = vb[0] - va[0];
      const uy = vb[1] - va[1];
      const uz = vb[2] - va[2];
      const wx = vc[0] - va[0];
      const wy = vc[1] - va[1];
      const wz = vc[2] - va[2];
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-14) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      const lit = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      kind[n] = 0;
      owner[n] = index;
      xs[n * 3] = a[0];
      xs[n * 3 + 1] = b[0];
      xs[n * 3 + 2] = c[0];
      ys[n * 3] = a[1];
      ys[n * 3 + 1] = b[1];
      ys[n * 3 + 2] = c[1];
      depth[n] = (a[2] + b[2] + c[2]) / 3;
      shade[n] = Math.round(lit * SHADE_LEVELS);
      n += 1;
    }
    const segs = item.segs ?? [];
    for (let i = 0; i + 5 < segs.length; i += 6) {
      camera.project(segs[i], segs[i + 1], segs[i + 2], a);
      camera.project(segs[i + 3], segs[i + 4], segs[i + 5], b);
      kind[n] = 1;
      owner[n] = index;
      xs[n * 3] = a[0];
      xs[n * 3 + 1] = b[0];
      ys[n * 3] = a[1];
      ys[n * 3 + 1] = b[1];
      depth[n] = (a[2] + b[2]) / 2 - 0.03;
      n += 1;
    }
    const dots = item.dots ?? [];
    for (let i = 0; i + 2 < dots.length; i += 3) {
      camera.project(dots[i], dots[i + 1], dots[i + 2], a);
      kind[n] = 2;
      owner[n] = index;
      xs[n * 3] = a[0];
      ys[n * 3] = a[1];
      depth[n] = a[2] - 0.05;
      n += 1;
    }
  });
  for (let i = 0; i + 5 < axisSegs.length; i += 6) {
    camera.project(axisSegs[i], axisSegs[i + 1], axisSegs[i + 2], a);
    camera.project(axisSegs[i + 3], axisSegs[i + 4], axisSegs[i + 5], b);
    kind[n] = 3;
    owner[n] = 0;
    xs[n * 3] = a[0];
    xs[n * 3 + 1] = b[0];
    ys[n * 3] = a[1];
    ys[n * 3 + 1] = b[1];
    depth[n] = (a[2] + b[2]) / 2;
    n += 1;
  }

  /* Far to near. */
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;
  order.sort((i, j) => depth[j] - depth[i]);

  const tables = items.map((item) => shadeTable(item.color));
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const edge = wire ? colors.ink : null;
  for (let o = 0; o < n; o += 1) {
    const i = order[o];
    const k = i * 3;
    switch (kind[i]) {
      case 0: {
        const fill = tables[owner[i]][shade[i]];
        g.beginPath();
        g.moveTo(xs[k], ys[k]);
        g.lineTo(xs[k + 1], ys[k + 1]);
        g.lineTo(xs[k + 2], ys[k + 2]);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        if (wire) {
          g.globalAlpha = 0.35;
          g.lineWidth = 0.7;
          g.strokeStyle = edge;
          g.stroke();
          g.globalAlpha = 1;
        } else if (!fast) {
          g.lineWidth = 0.8;
          g.strokeStyle = fill;
          g.stroke();
        }
        break;
      }
      case 1:
        g.beginPath();
        g.moveTo(xs[k], ys[k]);
        g.lineTo(xs[k + 1], ys[k + 1]);
        g.lineWidth = 3;
        g.strokeStyle = items[owner[i]].color;
        g.stroke();
        break;
      case 2:
        g.beginPath();
        g.arc(xs[k], ys[k], 5, 0, Math.PI * 2);
        g.fillStyle = items[owner[i]].color;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = colors.bg;
        g.stroke();
        break;
      default:
        g.beginPath();
        g.moveTo(xs[k], ys[k]);
        g.lineTo(xs[k + 1], ys[k + 1]);
        g.lineWidth = 1.6;
        g.strokeStyle = colors.axis;
        g.stroke();
    }
  }
  g.restore();
  drawLabels(g, camera, box, colors, { numbers });
  return { primitives: n };
}

/** The three axes through the origin (or the nearest point of the window), as unit-space segments. */
function addAxes(out, box) {
  const at = (axis) => {
    const zero = box.unit(axis, Math.min(Math.max(0, box.lo[axis]), box.hi[axis]));
    return Math.min(1, Math.max(-1, zero));
  };
  const [ox, oy, oz] = [at(0), at(1), at(2)];
  out.push(-1, oy, oz, 1, oy, oz, ox, -1, oz, ox, 1, oz, ox, oy, -1, ox, oy, 1);
}

/* ------------------------------------------------------------------- frame */

const SIGNS = [-1, 1];

/** Pick the plane of each axis that is farther from the eye (where the grid goes) and the nearer one. */
function planes(camera) {
  const out = [];
  const v = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const depthOf = (s) => {
      const p = [0, 0, 0];
      p[axis] = s;
      return camera.rotate(p[0], p[1], p[2], v)[2];
    };
    const [d0, d1] = [depthOf(-1), depthOf(1)];
    out.push({ far: d0 > d1 ? -1 : 1, near: d0 > d1 ? 1 : -1 });
  }
  return out;
}

function ticksFor(box, axis, camera) {
  const span = box.hi[axis] - box.lo[axis];
  const { step } = axisTicks(span, camera.scale * 2, 64);
  const values = [];
  const first = Math.ceil(box.lo[axis] / step - 1e-9);
  const last = Math.floor(box.hi[axis] / step + 1e-9);
  if (last - first > 60) return { step, values };
  for (let i = first; i <= last; i += 1) values.push(i * step);
  return { step, values };
}

function drawFrame(g, camera, box, colors, { grid }) {
  const pl = planes(camera);
  const pt = [0, 0, 0];
  const line = (x0, y0, z0, x1, y1, z1) => {
    camera.project(x0, y0, z0, pt);
    g.moveTo(pt[0], pt[1]);
    camera.project(x1, y1, z1, pt);
    g.lineTo(pt[0], pt[1]);
  };
  g.save();
  g.lineWidth = 1;
  g.lineCap = 'butt';

  if (grid) {
    g.strokeStyle = colors.grid;
    g.beginPath();
    const tx = ticksFor(box, 0, camera).values.map((v) => box.unit(0, v));
    const ty = ticksFor(box, 1, camera).values.map((v) => box.unit(1, v));
    const tz = ticksFor(box, 2, camera).values.map((v) => box.unit(2, v));
    const fz = pl[2].far;
    const fx = pl[0].far;
    const fy = pl[1].far;
    for (const u of tx) {
      line(u, -1, fz, u, 1, fz); // floor
      line(u, fy, -1, u, fy, 1); // wall at the far y
    }
    for (const u of ty) {
      line(-1, u, fz, 1, u, fz);
      line(fx, u, -1, fx, u, 1); // wall at the far x
    }
    for (const u of tz) {
      line(-1, fy, u, 1, fy, u);
      line(fx, -1, u, fx, 1, u);
    }
    g.stroke();
  }

  // The cube's twelve edges.
  g.strokeStyle = colors.axis;
  g.globalAlpha = 0.55;
  g.beginPath();
  for (const s of SIGNS) {
    for (const t of SIGNS) {
      line(-1, s, t, 1, s, t);
      line(s, -1, t, s, 1, t);
      line(s, t, -1, s, t, 1);
    }
  }
  g.stroke();
  g.restore();
}

/** Axis names and tick numbers, outside the cube so surfaces never hide them. */
function drawLabels(g, camera, box, colors, { numbers }) {
  const pl = planes(camera);
  const centre = camera.project(0, 0, 0, [0, 0, 0]);
  const pt = [0, 0, 0];
  const place = (x, y, z, text, push = 14, align = 'center') => {
    camera.project(x, y, z, pt);
    let dx = pt[0] - centre[0];
    let dy = pt[1] - centre[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    g.textAlign = align;
    g.fillText(text, pt[0] + dx * push, pt[1] + dy * push);
  };
  const nearY = pl[1].near;
  const nearX = pl[0].near;
  const floor = -1;

  // The vertical edge farthest to the left on screen carries the z numbers.
  let left = null;
  for (const sx of SIGNS) {
    for (const sy of SIGNS) {
      camera.project(sx, sy, 0, pt);
      if (left === null || pt[0] < left.px) left = { px: pt[0], sx, sy };
    }
  }

  g.save();
  g.font = FONT;
  g.textBaseline = 'middle';
  g.fillStyle = colors.text;
  if (numbers) {
    const tx = ticksFor(box, 0, camera);
    for (const v of tx.values) place(box.unit(0, v), nearY, floor, formatTick(v, tx.step));
    const ty = ticksFor(box, 1, camera);
    for (const v of ty.values) place(nearX, box.unit(1, v), floor, formatTick(v, ty.step));
    const tz = ticksFor(box, 2, camera);
    for (const v of tz.values) place(left.sx, left.sy, box.unit(2, v), formatTick(v, tz.step), 12, 'right');
  }
  g.font = 'italic 600 15px ui-serif, Georgia, serif';
  g.fillStyle = colors.ink;
  place(0, nearY, floor, 'x', numbers ? 40 : 22);
  place(nearX, 0, floor, 'y', numbers ? 40 : 22);
  place(left.sx, left.sy, 0, 'z', numbers ? 44 : 22);
  g.restore();
}
