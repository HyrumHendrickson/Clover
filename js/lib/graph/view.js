/**
 * Viewport for the graphing tool.
 *
 * Unlike `lib/viewport.js`, the two axes scale independently, so a plot can be
 * stretched along one axis the way Desmos allows. The view keeps its centre and
 * pixels-per-unit on each axis; when the canvas resizes, the scale is kept and
 * more or less of the plane is shown.
 */

export const MIN_SPAN = 1e-9;
export const MAX_SPAN = 1e9;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class GraphView {
  /**
   * @param {{ cx?: number, cy?: number, xspan?: number, yspan?: number }} saved
   *   `xspan` and `yspan` are the units across the width and height. A `yspan`
   *   of 0 means "square": the y scale is made equal to the x scale.
   */
  constructor(saved = {}, width = 1, height = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.cx = 0;
    this.cy = 0;
    this.sx = 1;
    this.sy = 1;
    this.set(saved);
  }

  set({ cx = 0, cy = 0, xspan = 20, yspan = 0 } = {}) {
    const safe = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    this.cx = safe(cx, 0);
    this.cy = safe(cy, 0);
    const xs = clamp(safe(xspan, 20), MIN_SPAN, MAX_SPAN);
    this.sx = this.width / xs;
    const ys = safe(yspan, 0);
    this.sy = ys > 0 ? this.height / clamp(ys, MIN_SPAN, MAX_SPAN) : this.sx;
    this.limit();
  }

  /** Keep both scales inside the supported range. */
  limit() {
    const lo = (n) => n / MAX_SPAN;
    const hi = (n) => n / MIN_SPAN;
    this.sx = clamp(this.sx, lo(this.width), hi(this.width));
    this.sy = clamp(this.sy, lo(this.height), hi(this.height));
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.limit();
  }

  get xspan() {
    return this.width / this.sx;
  }

  get yspan() {
    return this.height / this.sy;
  }

  toScreenX(x) {
    return this.width / 2 + (x - this.cx) * this.sx;
  }

  toScreenY(y) {
    return this.height / 2 - (y - this.cy) * this.sy;
  }

  toWorldX(px) {
    return this.cx + (px - this.width / 2) / this.sx;
  }

  toWorldY(py) {
    return this.cy - (py - this.height / 2) / this.sy;
  }

  toScreen(x, y) {
    return [this.toScreenX(x), this.toScreenY(y)];
  }

  toWorld(px, py) {
    return [this.toWorldX(px), this.toWorldY(py)];
  }

  bounds() {
    return {
      xmin: this.toWorldX(0),
      xmax: this.toWorldX(this.width),
      ymin: this.toWorldY(this.height),
      ymax: this.toWorldY(0),
    };
  }

  panBy(dx, dy) {
    this.cx -= dx / this.sx;
    this.cy += dy / this.sy;
  }

  /** Zoom both axes about a screen point, which stays fixed. */
  zoomAt(px, py, factor) {
    this.zoomAxes(px, py, factor, factor);
  }

  /** Zoom one axis ('x' or 'y') about a screen point. */
  zoomAxisAt(axis, px, py, factor) {
    if (axis === 'x') this.zoomAxes(px, py, factor, 1);
    else this.zoomAxes(px, py, 1, factor);
  }

  zoomAxes(px, py, fx, fy) {
    if (!(fx > 0) || !(fy > 0)) return;
    const wx = this.toWorldX(px);
    const wy = this.toWorldY(py);
    this.sx *= fx;
    this.sy *= fy;
    this.limit();
    this.cx = wx - (px - this.width / 2) / this.sx;
    this.cy = wy + (py - this.height / 2) / this.sy;
  }

  /** Show exactly [xmin, xmax] by [ymin, ymax]. Returns false for an empty or invalid window. */
  setBounds(xmin, xmax, ymin, ymax) {
    const ok = [xmin, xmax, ymin, ymax].every(Number.isFinite) && xmax > xmin && ymax > ymin;
    if (!ok) return false;
    this.set({ cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, xspan: xmax - xmin, yspan: ymax - ymin });
    return true;
  }

  /** Make one unit the same length on both axes, keeping the centre and showing at least what was visible. */
  makeSquare() {
    const scale = Math.min(this.sx, this.sy);
    this.sx = scale;
    this.sy = scale;
    this.limit();
  }

  toJSON() {
    return { cx: this.cx, cy: this.cy, xspan: this.xspan, yspan: this.yspan };
  }
}

/** Sanitise a persisted view. `yspan` 0 means square. */
export function normalizeGraphView(raw, fallback) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const num = (value, def) => (typeof value === 'number' && Number.isFinite(value) ? value : def);
  const span = (value, def) => clamp(num(value, def), MIN_SPAN, MAX_SPAN);
  const ys = num(v.yspan, fallback.yspan);
  return {
    cx: num(v.cx, fallback.cx),
    cy: num(v.cy, fallback.cy),
    xspan: span(v.xspan, fallback.xspan),
    yspan: ys > 0 ? span(ys, fallback.yspan || 20) : 0,
  };
}

/**
 * Choose grid spacing for an axis. Returns the major step (1, 2, or 5 times a
 * power of ten, about `targetPx` apart) and how many minor divisions to draw.
 */
export function axisTicks(span, pixels, targetPx = 80) {
  const raw = Math.max(span, MIN_SPAN) * (targetPx / Math.max(pixels, 1));
  const power = Number(`1e${Math.floor(Math.log10(raw))}`);
  const m = raw / power;
  let mantissa = 10;
  if (m < 1.5) mantissa = 1;
  else if (m < 3.5) mantissa = 2;
  else if (m < 7.5) mantissa = 5;
  return { step: Number((mantissa * power).toPrecision(12)), minorDiv: mantissa === 2 ? 4 : 5 };
}
