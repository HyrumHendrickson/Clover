/**
 * Charts for the Stats tab. Each `...Spec` function turns data into a plain description
 * (`{ x: [min, max], y: [min, max], layers }`), which `drawChart` paints. Keeping the two
 * apart lets the layout be unit tested without a canvas.
 *
 * Layer kinds: bars, line, area, points, vline, box, dots.
 */
import { histogramBins, quantile } from './stats.js';
import { formatTick } from './viewport.js';
import { axisTicks } from './graph/view.js';

const finite = (list) => list.filter((v) => typeof v === 'number' && Number.isFinite(v));

/** Widen a [min, max] pair so a chart is never degenerate, with a margin on each side. */
export function padRange([lo, hi], fraction = 0.06) {
  if (!(hi > lo)) return [lo - 1, lo + 1];
  const pad = (hi - lo) * fraction;
  return [lo - pad, hi + pad];
}

export function histogramSpec(raw, width, density = false) {
  const data = finite(raw);
  const bins = histogramBins(data, width);
  if (bins.length === 0) return null;
  const heights = bins.map((b) => (density ? b.count / (data.length * width) : b.count));
  return {
    x: padRange([bins[0].start, bins.at(-1).end], 0.04),
    y: [0, Math.max(...heights) * 1.1 || 1],
    xLabel: '',
    yLabel: density ? 'Density' : 'Count',
    layers: [{ kind: 'bars', bars: bins.map((b, i) => ({ x0: b.start, x1: b.end, y: heights[i], count: b.count })) }],
  };
}

/** A box plot: whiskers reach the furthest values within 1.5 IQR of the box; others are outliers. */
export function boxplotSpec(raw) {
  const data = finite(raw).sort((a, b) => a - b);
  if (data.length === 0) return null;
  const q1 = quantile(data, 0.25);
  const q3 = quantile(data, 0.75);
  const iqr = q3 - q1;
  const inside = data.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
  const low = inside[0];
  const high = inside.at(-1);
  const outliers = data.filter((v) => v < low || v > high);
  return {
    x: padRange([data[0], data.at(-1)], 0.08),
    y: [0, 1],
    xLabel: '',
    yLabel: '',
    hideY: true,
    layers: [{ kind: 'box', y: 0.5, half: 0.22, low, q1, median: quantile(data, 0.5), q3, high, outliers }],
  };
}

/** A dot plot: one stack of dots per bin, each value a dot, drawn at its own position. */
export function dotplotSpec(raw, width) {
  const data = finite(raw);
  if (data.length === 0 || !(width > 0)) return null;
  const stacks = new Map();
  const dots = [];
  for (const v of data.sort((a, b) => a - b)) {
    const key = Math.floor(v / width);
    const height = (stacks.get(key) ?? 0) + 1;
    stacks.set(key, height);
    dots.push({ x: v, y: height });
  }
  const tallest = Math.max(...stacks.values());
  return {
    x: padRange([data[0], data.at(-1)], 0.08),
    y: [0, tallest + 1],
    xLabel: '',
    yLabel: 'Count',
    layers: [{ kind: 'dots', dots }],
  };
}

/** Points with an optional fitted curve, sampled across the data. */
export function scatterSpec(xs, ys, predict = null) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length === 0) return null;
  const layers = [];
  const xr = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  let yr = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  if (predict) {
    const line = [];
    const [lo, hi] = padRange(xr, 0.03);
    for (let i = 0; i <= 160; i += 1) {
      const x = lo + ((hi - lo) * i) / 160;
      const y = predict(x);
      if (Number.isFinite(y)) line.push([x, y]);
    }
    const ys2 = line.map((p) => p[1]).filter((y) => Math.abs(y) < 1e12);
    if (ys2.length > 0) yr = [Math.min(yr[0], ...ys2), Math.max(yr[1], ...ys2)];
    layers.push({ kind: 'line', pts: line, role: 'fit' });
  }
  layers.push({ kind: 'points', pts, role: 'data' });
  return { x: padRange(xr), y: padRange(yr, 0.1), xLabel: '', yLabel: '', layers };
}

export function residualSpec(xs, residuals) {
  const pts = xs.map((x, i) => [x, residuals[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length === 0) return null;
  const big = Math.max(...pts.map((p) => Math.abs(p[1]))) || 1;
  return {
    x: padRange([Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))]),
    y: [-big * 1.2, big * 1.2],
    xLabel: '',
    yLabel: 'Residual',
    layers: [
      { kind: 'hline', y: 0 },
      { kind: 'points', pts, role: 'data' },
    ],
  };
}

/**
 * A density or mass function with a shaded region. `shade` is `{ from, to }` (either may be
 * infinite) or null. Discrete distributions become bars, one per whole number.
 */
export function distributionSpec(dist, discrete, shade = null) {
  const [rawLo, rawHi] = dist.range;
  if (discrete) {
    const lo = Math.max(0, Math.floor(rawLo));
    const hi = Math.min(lo + 200, Math.ceil(rawHi));
    const bars = [];
    for (let k = lo; k <= hi; k += 1) {
      bars.push({ x0: k - 0.4, x1: k + 0.4, y: dist.pdf(k), shaded: shade ? k >= shade.from && k <= shade.to : false });
    }
    const top = Math.max(...bars.map((b) => b.y)) || 1;
    return {
      x: [lo - 1, hi + 1],
      y: [0, top * 1.1],
      xLabel: '',
      yLabel: 'Probability',
      layers: [{ kind: 'bars', bars }],
    };
  }
  const [lo, hi] = rawLo === rawHi ? [rawLo - 1, rawHi + 1] : [rawLo, rawHi];
  const pts = [];
  for (let i = 0; i <= 240; i += 1) {
    const x = lo + ((hi - lo) * i) / 240;
    const y = dist.pdf(x);
    pts.push([x, Number.isFinite(y) ? y : 0]);
  }
  const top = Math.max(...pts.map((p) => p[1]).filter((y) => y < 1e6)) || 1;
  const layers = [];
  if (shade) {
    const a = Math.max(lo, shade.from);
    const b = Math.min(hi, shade.to);
    if (b > a) layers.push({ kind: 'area', pts: pts.filter((p) => p[0] >= a && p[0] <= b), from: a, to: b });
  }
  layers.push({ kind: 'line', pts, role: 'curve' });
  return { x: [lo, hi], y: [0, top * 1.1], xLabel: '', yLabel: 'Density', layers };
}

/* ----------------------------------------------------------------- drawing */

const FONT = '12px ui-sans-serif, system-ui, sans-serif';

/** Paint a chart spec. Returns the mapping from data to pixels, so a test or tooltip can use it. */
export function drawChart(g, width, height, spec, colors) {
  g.fillStyle = colors.bg;
  g.fillRect(0, 0, width, height);
  if (!spec) {
    g.fillStyle = colors.text;
    g.font = FONT;
    g.textAlign = 'center';
    g.fillText('Nothing to show yet', width / 2, height / 2);
    return null;
  }
  const m = { l: spec.hideY ? 16 : 52, r: 16, t: 14, b: 34 };
  const w = Math.max(10, width - m.l - m.r);
  const h = Math.max(10, height - m.t - m.b);
  const sx = (x) => m.l + ((x - spec.x[0]) / (spec.x[1] - spec.x[0])) * w;
  const sy = (y) => m.t + h - ((y - spec.y[0]) / (spec.y[1] - spec.y[0])) * h;
  const map = { sx, sy };

  const tx = axisTicks(spec.x[1] - spec.x[0], w, 70);
  const ty = axisTicks(spec.y[1] - spec.y[0], h, 46);
  g.save();
  g.lineWidth = 1;
  g.strokeStyle = colors.grid;
  g.fillStyle = colors.text;
  g.font = FONT;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (let i = Math.ceil(spec.x[0] / tx.step); i <= Math.floor(spec.x[1] / tx.step); i += 1) {
    const px = Math.round(sx(i * tx.step)) + 0.5;
    g.beginPath();
    g.moveTo(px, m.t);
    g.lineTo(px, m.t + h);
    g.stroke();
    g.fillText(formatTick(i * tx.step, tx.step), px, m.t + h + 6);
  }
  if (!spec.hideY) {
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let j = Math.ceil(spec.y[0] / ty.step); j <= Math.floor(spec.y[1] / ty.step); j += 1) {
      const py = Math.round(sy(j * ty.step)) + 0.5;
      g.beginPath();
      g.moveTo(m.l, py);
      g.lineTo(m.l + w, py);
      g.stroke();
      g.fillText(formatTick(j * ty.step, ty.step), m.l - 6, py);
    }
  }
  g.strokeStyle = colors.axis;
  g.lineWidth = 1.5;
  g.strokeRect(m.l + 0.5, m.t + 0.5, w, h);
  g.restore();

  g.save();
  g.beginPath();
  g.rect(m.l, m.t, w, h);
  g.clip();
  for (const layer of spec.layers) paintLayer(g, layer, map, colors, { w, h, m });
  g.restore();

  if (spec.yLabel || spec.xLabel) {
    g.save();
    g.fillStyle = colors.text;
    g.font = FONT;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    if (spec.yLabel) g.fillText(spec.yLabel, m.l + 6, m.t + 4);
    g.restore();
  }
  return map;
}

function paintLayer(g, layer, { sx, sy }, colors, { w, m }) {
  switch (layer.kind) {
    case 'bars':
      for (const b of layer.bars) {
        g.fillStyle = b.shaded ? colors.b : colors.a;
        g.globalAlpha = 0.85;
        const x0 = sx(b.x0);
        g.fillRect(x0, sy(b.y), Math.max(1, sx(b.x1) - x0 - 1), sy(0) - sy(b.y));
      }
      g.globalAlpha = 1;
      break;
    case 'area':
      g.beginPath();
      g.moveTo(sx(layer.from), sy(0));
      for (const [x, y] of layer.pts) g.lineTo(sx(x), sy(y));
      g.lineTo(sx(layer.to), sy(0));
      g.closePath();
      g.fillStyle = colors.b;
      g.globalAlpha = 0.4;
      g.fill();
      g.globalAlpha = 1;
      break;
    case 'line':
      g.beginPath();
      layer.pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(sx(x), sy(y)) : g.lineTo(sx(x), sy(y))));
      g.strokeStyle = layer.role === 'fit' ? colors.b : colors.a;
      g.lineWidth = 2.5;
      g.stroke();
      break;
    case 'points':
      g.fillStyle = colors.a;
      for (const [x, y] of layer.pts) {
        g.beginPath();
        g.arc(sx(x), sy(y), 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'hline':
      g.strokeStyle = colors.axis;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(m.l, sy(layer.y));
      g.lineTo(m.l + w, sy(layer.y));
      g.stroke();
      break;
    case 'dots':
      g.fillStyle = colors.a;
      for (const d of layer.dots) {
        g.beginPath();
        g.arc(sx(d.x), sy(d.y - 0.5), 5, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'box': {
      const top = sy(layer.y + layer.half);
      const bottom = sy(layer.y - layer.half);
      g.strokeStyle = colors.ink;
      g.lineWidth = 2;
      g.fillStyle = colors.a;
      g.globalAlpha = 0.3;
      g.fillRect(sx(layer.q1), top, sx(layer.q3) - sx(layer.q1), bottom - top);
      g.globalAlpha = 1;
      g.strokeRect(sx(layer.q1), top, sx(layer.q3) - sx(layer.q1), bottom - top);
      g.beginPath();
      g.moveTo(sx(layer.median), top);
      g.lineTo(sx(layer.median), bottom);
      g.moveTo(sx(layer.low), sy(layer.y));
      g.lineTo(sx(layer.q1), sy(layer.y));
      g.moveTo(sx(layer.q3), sy(layer.y));
      g.lineTo(sx(layer.high), sy(layer.y));
      g.moveTo(sx(layer.low), sy(layer.y + layer.half / 2));
      g.lineTo(sx(layer.low), sy(layer.y - layer.half / 2));
      g.moveTo(sx(layer.high), sy(layer.y + layer.half / 2));
      g.lineTo(sx(layer.high), sy(layer.y - layer.half / 2));
      g.stroke();
      g.fillStyle = colors.b;
      for (const v of layer.outliers) {
        g.beginPath();
        g.arc(sx(v), sy(layer.y), 4, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    default:
  }
}
