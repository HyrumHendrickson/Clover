/**
 * 2D viewport mathematics and canvas helpers shared by the plotting tools.
 *
 * A view is described by a centre and a "radius": half the shorter side of the
 * canvas, measured in world units. This keeps saved views meaningful on screens
 * of different sizes.
 */

const MIN_RADIUS = 1e-9;
const MAX_RADIUS = 1e9;

const clampRadius = (r) => Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, r));

export class View {
  constructor({ cx = 0, cy = 0, radius = 5 } = {}, width = 1, height = 1) {
    this.cx = Number.isFinite(cx) ? cx : 0;
    this.cy = Number.isFinite(cy) ? cy : 0;
    this.radius = clampRadius(Number.isFinite(radius) ? radius : 5);
    this.width = width;
    this.height = height;
  }

  /** Pixels per world unit. */
  get scale() {
    return Math.max(1, Math.min(this.width, this.height)) / (2 * this.radius);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  toScreen(x, y) {
    const s = this.scale;
    return [this.width / 2 + (x - this.cx) * s, this.height / 2 - (y - this.cy) * s];
  }

  toWorld(px, py) {
    const s = this.scale;
    return [this.cx + (px - this.width / 2) / s, this.cy - (py - this.height / 2) / s];
  }

  panBy(dx, dy) {
    const s = this.scale;
    this.cx -= dx / s;
    this.cy += dy / s;
  }

  /** Zoom so that the world point under (px, py) stays fixed. */
  zoomAt(px, py, factor) {
    const [wx, wy] = this.toWorld(px, py);
    this.radius = clampRadius(this.radius / factor);
    const s = this.scale;
    this.cx = wx - (px - this.width / 2) / s;
    this.cy = wy + (py - this.height / 2) / s;
  }

  set({ cx, cy, radius }) {
    this.cx = cx;
    this.cy = cy;
    this.radius = clampRadius(radius);
  }

  toJSON() {
    return { cx: this.cx, cy: this.cy, radius: this.radius };
  }
}

/** Sanitise a persisted view object. */
export function normalizeView(raw, fallback) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const num = (value, def) => (typeof value === 'number' && Number.isFinite(value) ? value : def);
  return {
    cx: num(v.cx, fallback.cx),
    cy: num(v.cy, fallback.cy),
    radius: clampRadius(num(v.radius, fallback.radius)),
  };
}

/** Choose a 1-2-5 grid step giving roughly ten lines across the span. */
export function niceStep(span) {
  const raw = Math.max(span, MIN_RADIUS) / 10;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  let nice = 10;
  if (m < 1.5) nice = 1;
  else if (m < 3.5) nice = 2;
  else if (m < 7.5) nice = 5;
  return nice * power;
}

export function formatTick(value, step) {
  if (Math.abs(value) < step * 1e-6) return '0';
  if (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-4) return value.toExponential(1).replace('e+', 'e');
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return value.toFixed(Math.min(decimals, 10));
}

/** Read the current theme's canvas colours from CSS custom properties. */
export function themeColors(element = document.documentElement) {
  const style = getComputedStyle(element);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read('--canvas-bg', '#ffffff'),
    grid: read('--canvas-grid', '#e5e7e0'),
    axis: read('--canvas-axis', '#9aa59b'),
    text: read('--canvas-text', '#5d6b5f'),
    accent: read('--accent', '#2e7d32'),
    a: read('--viz-a', '#2563eb'),
    b: read('--viz-b', '#d97706'),
    c: read('--viz-c', '#7c3aed'),
    ink: read('--text', '#18211a'),
  };
}

/** Size a canvas backing store to its CSS box and return a ready 2D context. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const bw = Math.round(width * dpr);
  const bh = Math.round(height * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

/** Draw grid lines, axes, and numeric labels for a view. */
export function drawGrid(ctx, view, colors, { grid = true, labels = true, halo = null } = {}) {
  const { width: w, height: h } = view;
  const step = niceStep(Math.max(w, h) / view.scale);
  const [xmin, ymax] = view.toWorld(0, 0);
  const [xmax, ymin] = view.toWorld(w, h);
  const ix0 = Math.ceil(xmin / step);
  const ix1 = Math.floor(xmax / step);
  const iy0 = Math.ceil(ymin / step);
  const iy1 = Math.floor(ymax / step);
  if (ix1 - ix0 > 400 || iy1 - iy0 > 400) return;

  ctx.save();
  ctx.lineWidth = 1;
  if (grid) {
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    for (let i = ix0; i <= ix1; i += 1) {
      const px = Math.round(view.toScreen(i * step, 0)[0]) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (let j = iy0; j <= iy1; j += 1) {
      const py = Math.round(view.toScreen(0, j * step)[1]) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  }

  const [ox, oy] = view.toScreen(0, 0);
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (oy >= 0 && oy <= h) {
    ctx.moveTo(0, Math.round(oy) + 0.5);
    ctx.lineTo(w, Math.round(oy) + 0.5);
  }
  if (ox >= 0 && ox <= w) {
    ctx.moveTo(Math.round(ox) + 0.5, 0);
    ctx.lineTo(Math.round(ox) + 0.5, h);
  }
  ctx.stroke();

  if (labels) {
    ctx.fillStyle = colors.text;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo ?? 'transparent';
    const label = (text, x, y) => {
      if (halo) ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    const labelY = Math.min(Math.max(oy + 4, 4), h - 16);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (let i = ix0; i <= ix1; i += 1) {
      if (i === 0) continue;
      const px = view.toScreen(i * step, 0)[0];
      if (px > 14 && px < w - 14) label(formatTick(i * step, step), px, labelY);
    }
    const onLeft = ox > w - 48;
    const labelX = Math.min(Math.max(ox + 6, 6), w - 6);
    ctx.textAlign = onLeft ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    for (let j = iy0; j <= iy1; j += 1) {
      if (j === 0) continue;
      const py = view.toScreen(0, j * step)[1];
      if (py > 10 && py < h - 18) label(formatTick(j * step, step), onLeft ? labelX - 4 : labelX, py);
    }
  }
  ctx.restore();
}

/** Draw a line with a filled triangular head ending at (x1, y1). Coordinates are in pixels. */
export function drawArrow(ctx, x0, y0, x1, y1, { color = '#000', width = 2, head = 9, dash = null } = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return;
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.min(head, len * 0.6);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * size * 0.7, y1 - uy * size * 0.7);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * size + uy * size * 0.45, y1 - uy * size - ux * size * 0.45);
  ctx.lineTo(x1 - ux * size - uy * size * 0.45, y1 - uy * size + ux * size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
