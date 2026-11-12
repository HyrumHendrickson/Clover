/**
 * Canvas drawing for the linear algebra tab. `plan` comes from `planFor`; `t` runs from 0 to 1 and says how far
 * the matrix has been applied (the identity at 0, the whole matrix at 1).
 */
import { applyMatrix, interpolate, project3, turnAndScale } from './linviz.js';
import { drawArrow, drawGrid, niceStep } from './viewport.js';

const FONT = '12px ui-sans-serif, system-ui, sans-serif';

function label(ctx, text, x, y, colors, { align = 'left' } = {}) {
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = colors.bg;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colors.ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const fmt = (x) => (Math.abs(x) < 1e-10 ? '0' : Number(x.toPrecision(4)).toString());
export const vectorText = (v) => `(${v.map(fmt).join(', ')})`;

function dot(ctx, x, y, color, r = 5) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Where the tip of a draggable 2D vector is on screen, for hit testing. */
export const tipOf2 = (view, plan) =>
  plan.kind === 'vector' && plan.dim === 2 ? view.toScreen(plan.v[0], plan.v[1]) : null;

export function draw2D(ctx, view, colors, plan, t) {
  drawGrid(ctx, view, colors, { halo: colors.bg });
  const to = (p) => view.toScreen(p[0], p[1]);
  const [ox, oy] = to([0, 0]);

  if (plan.kind === 'vector') {
    const [x, y] = to(plan.v);
    ctx.save();
    ctx.strokeStyle = colors.grid;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, oy);
    ctx.lineTo(x, y);
    ctx.lineTo(ox, y);
    ctx.stroke();
    ctx.restore();
    drawArrow(ctx, ox, oy, x, y, { color: colors.a, width: 3, head: 12 });
    dot(ctx, x, y, colors.a);
    label(ctx, `${plan.label} = ${vectorText(plan.v)}`, x + 10, y - 10, colors);
    return;
  }

  const M = interpolate(plan.A, t);
  const image = (p) => to(applyMatrix(M, p));

  // The unit square, and the grid it came from and became.
  const reach = Math.min(40, Math.ceil(view.radius * Math.max(1, view.width / view.height)) + 2);
  const step = Math.max(1, Math.round(niceStep(view.radius * 2) / 1));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.a;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  for (let i = -reach; i <= reach; i += step) {
    const [ax, ay] = image([i, -reach]);
    const [bx, by] = image([i, reach]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    const [cx, cy] = image([-reach, i]);
    const [dx, dy] = image([reach, i]);
    ctx.moveTo(cx, cy);
    ctx.lineTo(dx, dy);
  }
  ctx.stroke();
  ctx.restore();

  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(image);
  ctx.save();
  ctx.fillStyle = colors.b;
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.b;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Eigen-directions: the lines the matrix only stretches.
  for (const { value, direction } of plan.eigen) {
    const far = view.radius * 4;
    const [ax, ay] = to([-direction[0] * far, -direction[1] * far]);
    const [bx, by] = to([direction[0] * far, direction[1] * far]);
    ctx.save();
    ctx.strokeStyle = colors.c;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.restore();
    const [lx, ly] = to([direction[0] * view.radius * 0.8, direction[1] * view.radius * 0.8]);
    label(ctx, `\u03bb = ${fmt(value)}`, lx + 6, ly - 8, colors);
  }

  if (plan.kind === 'transform') {
    const [e1x, e1y] = image([1, 0]);
    const [e2x, e2y] = image([0, 1]);
    drawArrow(ctx, ox, oy, e1x, e1y, { color: colors.accent, width: 3, head: 11 });
    drawArrow(ctx, ox, oy, e2x, e2y, { color: colors.ink, width: 3, head: 11 });
    label(ctx, 'A e\u2081', e1x + 8, e1y - 8, colors);
    label(ctx, 'A e\u2082', e2x + 8, e2y - 8, colors);
    return;
  }

  // apply: x and what the matrix does to it.
  const x = plan.x;
  const moved = applyMatrix(M, x);
  const [xx, xy] = to(x);
  const [mx, my] = to(moved);
  drawArrow(ctx, ox, oy, xx, xy, { color: colors.a, width: 3, head: 11, dash: [7, 4] });
  drawArrow(ctx, ox, oy, mx, my, { color: colors.accent, width: 3.5, head: 12 });
  dot(ctx, xx, xy, colors.a, 4);
  label(ctx, `x = ${vectorText(x)}`, xx + 10, xy + (xy < my ? -12 : 12), colors);
  label(ctx, `${t >= 0.999 ? 'A x' : 'M x'} = ${vectorText(moved)}`, mx + 10, my + (my <= xy ? -12 : 12), colors);

  // The turn, as an arc between the two directions.
  const full = applyMatrix(plan.A, x);
  const { degrees } = turnAndScale(x, full);
  if (degrees !== null && Math.abs(degrees) > 0.5) {
    const a0 = -Math.atan2(x[1], x[0]);
    const a1 = -Math.atan2(moved[1], moved[0]);
    const r = Math.min(46, 0.25 * Math.hypot(xx - ox, xy - oy) + 16);
    ctx.save();
    ctx.strokeStyle = colors.b;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    ctx.arc(ox, oy, r, a0, a1, delta < 0);
    ctx.stroke();
    ctx.restore();
  }
}

/** Describe a plan in words: used under the picture and as its text alternative. */
export function describePlan(plan) {
  if (plan.kind === 'none') return plan.message;
  const dim = plan.dim;
  if (plan.kind === 'vector') {
    const length = Math.hypot(...plan.v);
    const angle =
      dim === 2
        ? ` It points ${fmt((Math.atan2(plan.v[1], plan.v[0]) * 180) / Math.PI)}\u00b0 from the positive x axis.`
        : '';
    return `${plan.label} = ${vectorText(plan.v)}. Its length is ${fmt(length)}.${angle}`;
  }
  const detText = dim === 2 ? det2(plan.A) : det3(plan.A);
  const flips = detText < 0 ? ' It flips orientation.' : '';
  const area = dim === 2 ? 'Areas' : 'Volumes';
  const det = `det = ${fmt(detText)}. ${area} are multiplied by ${fmt(Math.abs(detText))}.${flips}`;
  const eig = plan.eigen.length
    ? ` Directions that are only stretched: ${plan.eigen.map((e) => `\u03bb = ${fmt(e.value)} along ${vectorText(e.direction)}`).join('; ')}.`
    : ' It has no real eigenvectors, so every direction is turned.';
  if (plan.kind === 'transform') return `${det}${eig}`;
  const y = applyMatrix(plan.A, plan.x);
  let move;
  if (dim === 2) {
    const { degrees, scale } = turnAndScale(plan.x, y);
    move =
      degrees === null
        ? 'The zero vector stays where it is.'
        : `Rotated ${fmt(Math.abs(degrees))}\u00b0 ${degrees < 0 ? 'clockwise' : degrees > 0 ? 'counterclockwise' : '(not at all)'} and scaled by ${fmt(scale)}.`;
  } else {
    const lx = Math.hypot(...plan.x);
    move = lx < 1e-12 ? 'The zero vector stays where it is.' : `Its length is scaled by ${fmt(Math.hypot(...y) / lx)}.`;
  }
  return `${plan.label}: x = ${vectorText(plan.x)} goes to ${vectorText(y)}. ${move} ${det}${eig}`;
}

const det2 = (A) => A[0][0] * A[1][1] - A[0][1] * A[1][0];
const det3 = (A) =>
  A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
  A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
  A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

export function draw3D(ctx, width, height, colors, plan, t, { yaw, pitch, radius }) {
  const scale = Math.min(width, height) / (2 * radius);
  const to = (p) => {
    const [x, y] = project3(p, yaw, pitch);
    return [width / 2 + x * scale, height / 2 - y * scale];
  };
  const line = (a, b, color, w = 1, dash = null, alpha = 1) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = alpha;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(...to(a));
    ctx.lineTo(...to(b));
    ctx.stroke();
    ctx.restore();
  };
  const arrow = (p, color, w = 3) => drawArrow(ctx, ...to([0, 0, 0]), ...to(p), { color, width: w, head: 11 });

  const reach = Math.ceil(radius);
  for (let i = -reach; i <= reach; i += 1) {
    line([i, -reach, 0], [i, reach, 0], colors.grid, 1, null, 0.7);
    line([-reach, i, 0], [reach, i, 0], colors.grid, 1, null, 0.7);
  }
  for (const [axis, name] of [
    [[1, 0, 0], 'x'],
    [[0, 1, 0], 'y'],
    [[0, 0, 1], 'z'],
  ]) {
    const far = axis.map((c) => c * reach);
    line(
      axis.map((c) => -c * reach),
      far,
      colors.axis,
      1.5,
    );
    const [lx, ly] = to(far);
    label(ctx, name, lx + 6, ly, colors);
  }

  if (plan.kind === 'vector') {
    const [px, py, pz] = plan.v;
    line(plan.v, [px, py, 0], colors.axis, 1, [4, 4]);
    line([px, py, 0], [px, 0, 0], colors.axis, 1, [4, 4]);
    line([px, py, 0], [0, py, 0], colors.axis, 1, [4, 4]);
    arrow(plan.v, colors.a);
    const [lx, ly] = to(plan.v);
    label(ctx, `${plan.label} = ${vectorText(plan.v)}`, lx + 10, ly - 10, colors);
    return pz;
  }

  const M = interpolate(plan.A, t);
  const cube = [];
  for (let i = 0; i < 8; i += 1) cube.push(applyMatrix(M, [i & 1, (i >> 1) & 1, (i >> 2) & 1]));
  for (let i = 0; i < 8; i += 1) {
    for (const bit of [1, 2, 4]) if (!(i & bit)) line(cube[i], cube[i | bit], colors.b, 1.5);
  }
  const columns = [0, 1, 2].map((j) => M.map((row) => row[j]));
  [colors.accent, colors.ink, colors.c].forEach((color, j) => arrow(columns[j], color, 2.5));
  for (const { value, direction } of plan.eigen) {
    const far = radius * 2;
    line(
      direction.map((c) => -c * far),
      direction.map((c) => c * far),
      colors.c,
      1.5,
      [6, 5],
    );
    const [lx, ly] = to(direction.map((c) => c * radius * 0.7));
    label(ctx, `\u03bb = ${fmt(value)}`, lx + 6, ly - 8, colors);
  }
  if (plan.kind === 'apply') {
    const moved = applyMatrix(M, plan.x);
    arrow(plan.x, colors.a);
    arrow(moved, colors.accent, 3.5);
    const [xx, xy] = to(plan.x);
    const [mx, my] = to(moved);
    label(ctx, `x = ${vectorText(plan.x)}`, xx + 10, xy - 10, colors);
    label(ctx, `${t >= 0.999 ? 'A x' : 'M x'} = ${vectorText(moved)}`, mx + 10, my + 12, colors);
  }
  return 0;
}
