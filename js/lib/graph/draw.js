/**
 * Canvas drawing for the graphing tool: grid and axes, then every plot.
 * Geometry for hit testing is returned so the tool never recomputes it on hover.
 */
import { formatTick } from '../viewport.js';
import { isPointValue } from './model.js';
import { contourPaths, rasterRegion, sampleExplicit, sampleParam, samplePolar } from './sample.js';
import { GraphEvalError, Point } from './values.js';
import { axisTicks } from './view.js';

/** Curve colours: Desmos's familiar palette, with lighter variants for the dark theme. */
export const ROW_COLORS = [
  { name: 'Red', light: '#c74440', dark: '#ff7a75' },
  { name: 'Blue', light: '#2d70b3', dark: '#6ea8ff' },
  { name: 'Green', light: '#388c46', dark: '#6cc46a' },
  { name: 'Purple', light: '#6042a6', dark: '#b79bff' },
  { name: 'Orange', light: '#fa7e19', dark: '#ffa24d' },
  { name: 'Black', light: '#1f2a22', dark: '#e8efe9' },
];

export function rowColor(index, dark) {
  const entry = ROW_COLORS[((index % ROW_COLORS.length) + ROW_COLORS.length) % ROW_COLORS.length];
  return dark ? entry.dark : entry.light;
}

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ------------------------------------------------------------------- axes */

const FONT = '12px ui-sans-serif, system-ui, sans-serif';

/** Draw minor and major grid lines, the axes, and numeric labels. */
export function drawAxes(g, view, colors, { grid = true, minor = true, numbers = true } = {}) {
  const { width: w, height: h } = view;
  const { xmin, xmax, ymin, ymax } = view.bounds();
  const tx = axisTicks(view.xspan, w, 90);
  const ty = axisTicks(view.yspan, h, 70);

  g.save();
  g.lineWidth = 1;
  if (grid) {
    const lines = (min, max, step, horizontal, alpha) => {
      const first = Math.ceil(min / step);
      const last = Math.floor(max / step);
      if (last - first > 800) return;
      g.globalAlpha = alpha;
      g.beginPath();
      for (let i = first; i <= last; i += 1) {
        const v = i * step;
        if (horizontal) {
          const py = Math.round(view.toScreenY(v)) + 0.5;
          g.moveTo(0, py);
          g.lineTo(w, py);
        } else {
          const px = Math.round(view.toScreenX(v)) + 0.5;
          g.moveTo(px, 0);
          g.lineTo(px, h);
        }
      }
      g.stroke();
    };
    g.strokeStyle = colors.grid;
    if (minor) {
      const mx = tx.step / tx.minorDiv;
      const my = ty.step / ty.minorDiv;
      // Minor lines under the major ones; the major pass repaints those positions.
      lines(xmin, xmax, mx, false, 0.45);
      lines(ymin, ymax, my, true, 0.45);
    }
    lines(xmin, xmax, tx.step, false, 1);
    lines(ymin, ymax, ty.step, true, 1);
  }

  g.globalAlpha = 1;
  const ox = view.toScreenX(0);
  const oy = view.toScreenY(0);
  g.strokeStyle = colors.axis;
  g.lineWidth = 1.5;
  g.beginPath();
  if (oy >= 0 && oy <= h) {
    g.moveTo(0, Math.round(oy) + 0.5);
    g.lineTo(w, Math.round(oy) + 0.5);
  }
  if (ox >= 0 && ox <= w) {
    g.moveTo(Math.round(ox) + 0.5, 0);
    g.lineTo(Math.round(ox) + 0.5, h);
  }
  g.stroke();

  if (numbers) {
    g.fillStyle = colors.text;
    g.font = FONT;
    const labelY = Math.min(Math.max(oy + 5, 5), h - 18);
    g.textBaseline = 'top';
    g.textAlign = 'center';
    const firstX = Math.ceil(xmin / tx.step);
    const lastX = Math.floor(xmax / tx.step);
    if (lastX - firstX <= 400) {
      for (let i = firstX; i <= lastX; i += 1) {
        if (i === 0) continue;
        const px = view.toScreenX(i * tx.step);
        if (px > 14 && px < w - 14) g.fillText(formatTick(i * tx.step, tx.step), px, labelY);
      }
    }
    // Labels sit left of the y axis; when it is near or beyond the left edge they move to its right.
    const roomLeft = ox >= 44;
    const side = roomLeft ? Math.min(ox - 6, w - 6) : Math.max(ox + 6, 6);
    g.textAlign = roomLeft ? 'right' : 'left';
    g.textBaseline = 'middle';
    const firstY = Math.ceil(ymin / ty.step);
    const lastY = Math.floor(ymax / ty.step);
    if (lastY - firstY <= 400) {
      for (let j = firstY; j <= lastY; j += 1) {
        if (j === 0) continue;
        const py = view.toScreenY(j * ty.step);
        if (py > 10 && py < h - 18) g.fillText(formatTick(j * ty.step, ty.step), side, py);
      }
    }
  }
  g.restore();
}

/* ------------------------------------------------------------------ plots */

let scratch = null;

const DASHES = { solid: null, dashed: [8, 6], dotted: [2, 5] };

/** Dash pattern for a line style name, scaled a little with the width. */
export const dashFor = (line, width = 2.5) => {
  const base = DASHES[line] ?? null;
  return base ? base.map((n) => n * Math.max(1, width / 2.5)) : null;
};

function strokePaths(g, paths, color, width, dash = null, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.lineCap = dash ? 'butt' : 'round';
  g.setLineDash(dash ?? []);
  for (const path of paths) {
    g.beginPath();
    g.moveTo(path[0], path[1]);
    for (let k = 2; k < path.length; k += 2) g.lineTo(path[k], path[k + 1]);
    g.stroke();
  }
  g.setLineDash([]);
  g.restore();
}

function drawRegion(g, view, plot, color, fast, fill = 0.3) {
  const raster = rasterRegion(plot.region, view, { cell: fast ? 4 : 2, color: hexToRgb(color), alpha: fill });
  if (raster.filled > 0) {
    scratch ??= document.createElement('canvas');
    scratch.width = raster.cols;
    scratch.height = raster.rows;
    const sctx = scratch.getContext('2d');
    const image = sctx.createImageData(raster.cols, raster.rows);
    image.data.set(raster.data);
    sctx.putImageData(image, 0, 0);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(scratch, 0, 0, raster.cols * raster.cell, raster.rows * raster.cell);
    g.restore();
  }
}

/** Trace one marker shape centred on a point. `size` is the diameter. */
function markerPath(g, shape, x, y, size) {
  const r = size / 2;
  g.beginPath();
  switch (shape) {
    case 'square':
      g.rect(x - r, y - r, size, size);
      break;
    case 'triangle':
      g.moveTo(x, y - r);
      g.lineTo(x + r, y + r * 0.8);
      g.lineTo(x - r, y + r * 0.8);
      g.closePath();
      break;
    case 'diamond':
      g.moveTo(x, y - r * 1.2);
      g.lineTo(x + r, y);
      g.lineTo(x, y + r * 1.2);
      g.lineTo(x - r, y);
      g.closePath();
      break;
    case 'cross':
      g.moveTo(x - r, y - r);
      g.lineTo(x + r, y + r);
      g.moveTo(x + r, y - r);
      g.lineTo(x - r, y + r);
      break;
    case 'plus':
      g.moveTo(x - r, y);
      g.lineTo(x + r, y);
      g.moveTo(x, y - r);
      g.lineTo(x, y + r);
      break;
    case 'star':
      for (let k = 0; k < 10; k += 1) {
        const rad = k % 2 === 0 ? r * 1.2 : r * 0.5;
        const ang = -Math.PI / 2 + (k * Math.PI) / 5;
        if (k === 0) g.moveTo(x + rad * Math.cos(ang), y + rad * Math.sin(ang));
        else g.lineTo(x + rad * Math.cos(ang), y + rad * Math.sin(ang));
      }
      g.closePath();
      break;
    default:
      g.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** Markers that are drawn as lines, not as filled shapes. */
const LINE_MARKERS = new Set(['cross', 'plus']);

function drawPoints(g, view, value, color, colors, style = {}) {
  const list = value instanceof Point ? [value] : value.slice(0, 5000);
  const shape = style.point ?? 'point';
  const size = style.size ?? 10;
  const alpha = style.opacity ?? 1;
  const dots = [];
  const screen = [];
  for (const p of list) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      screen.push(null);
      continue;
    }
    screen.push([view.toScreenX(p.x), view.toScreenY(p.y)]);
  }
  const paths = [];
  if (style.lines && screen.length > 1) {
    let run = [];
    const flush = () => {
      if (run.length >= 4) paths.push(run);
      run = [];
    };
    for (const pt of screen) {
      if (pt === null) flush();
      else run.push(pt[0], pt[1]);
    }
    flush();
    strokePaths(g, paths, color, style.width ?? 2.5, dashFor(style.line, style.width ?? 2.5), alpha);
  }
  if (style.points !== false) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.strokeStyle = shape === 'point' ? colors.bg : color;
    g.lineWidth = shape === 'point' ? 2 : 2.5;
    list.forEach((p, i) => {
      const pt = screen[i];
      if (!pt) return;
      const [sx, sy] = pt;
      if (sx < -10 || sx > view.width + 10 || sy < -10 || sy > view.height + 10) return;
      markerPath(g, shape, sx, sy, size);
      if (!LINE_MARKERS.has(shape)) {
        if (shape === 'open') {
          g.fillStyle = colors.bg;
          g.fill();
          g.strokeStyle = color;
          g.stroke();
          g.fillStyle = color;
        } else {
          g.stroke();
          g.fill();
        }
      } else g.stroke();
      dots.push({ sx, sy, x: p.x, y: p.y });
    });
    g.restore();
  }
  return paths.length > 0 ? { dots, paths } : { dots };
}

/**
 * Draw one plot. Returns geometry for hit testing: `paths` (polylines) or `dots` (points).
 */
function drawPlot(g, view, item, theme, fast, width) {
  const { plot, color } = item;
  const style = item.style ?? {};
  const dash = dashFor(style.line, width);
  const alpha = style.opacity ?? 1;
  const quality = fast ? 2 : 1;
  switch (plot.type) {
    case 'explicit':
    case 'explicitX': {
      const paths = [];
      const count = plot.lanes ? plot.lanes.count() : 1;
      for (let i = 0; i < count; i += 1) {
        const f = plot.lanes ? plot.lanes.at(i) : plot.f;
        paths.push(...sampleExplicit(f, plot.mask, view, { vertical: plot.type === 'explicitX', step: quality }));
      }
      strokePaths(g, paths, color, width, dash, alpha);
      return { paths };
    }
    case 'polar': {
      const paths = [];
      const count = plot.lanes ? plot.lanes.count() : 1;
      const domain = plot.domain();
      for (let i = 0; i < count; i += 1) {
        const f = plot.lanes ? plot.lanes.at(i) : plot.f;
        paths.push(...samplePolar(f, plot.mask, domain, view, { samples: fast ? 1000 : 2400 }));
      }
      strokePaths(g, paths, color, width, dash, alpha);
      return { paths };
    }
    case 'param': {
      const paths = sampleParam(plot.at, plot.mask, plot.domain(), view, { samples: fast ? 500 : 1200 });
      strokePaths(g, paths, color, width, dash, alpha);
      return { paths };
    }
    case 'implicit': {
      const paths = contourPaths(plot.F, view, { cell: fast ? 4 : 3, filter: plot.mask });
      strokePaths(g, paths, color, width, dash, alpha);
      return { paths };
    }
    case 'points': {
      const value = plot.get();
      if (!isPointValue(value)) return {};
      return drawPoints(g, view, value, color, theme.colors, style);
    }
    default:
      return {};
  }
}

/**
 * Draw the grid and every visible plot.
 *
 * @param {CanvasRenderingContext2D} g
 * @param {import('./view.js').GraphView} view
 * @param {{ id: string, plot: object, color: string, selected?: boolean }[]} items visible rows, in order
 * @param {{ colors: object, grid?: boolean, minor?: boolean, numbers?: boolean, fast?: boolean }} theme
 * @returns {{ geometry: Map<string, object>, errors: Map<string, string> }}
 */
export function renderGraph(g, view, items, theme) {
  const { colors, fast = false } = theme;
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, view.width, view.height);
  drawAxes(g, view, colors, theme);

  const geometry = new Map();
  const errors = new Map();
  const attempt = (item, fn) => {
    try {
      geometry.set(item.id, fn());
    } catch (error) {
      if (!(error instanceof GraphEvalError)) throw error;
      errors.set(item.id, error.message);
    }
  };

  for (const item of items) {
    if (item.plot.type !== 'ineq') continue;
    attempt(item, () => {
      drawRegion(g, view, item.plot, item.color, fast, item.style?.fill ?? 0.3);
      const paths = [];
      for (const b of item.plot.boundaries) {
        const part = contourPaths(b.F, view, { cell: fast ? 4 : 3, filter: b.others });
        strokePaths(
          g,
          part,
          item.color,
          item.selected ? 4 : (item.style?.width ?? 2.5),
          b.strict ? [7, 6] : dashFor(item.style?.line),
          item.style?.opacity ?? 1,
        );
        paths.push(...part);
      }
      return { paths };
    });
  }
  for (const item of items) {
    if (item.plot.type === 'ineq') continue;
    attempt(item, () => drawPlot(g, view, item, theme, fast, item.selected ? 4 : (item.style?.width ?? 2.5)));
  }
  return { geometry, errors };
}
