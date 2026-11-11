/**
 * Numerical helpers for planar vector fields F(x, y) = (P, Q).
 * All functions take plain number-valued callbacks, so they are DOM free.
 */

/** Divergence and scalar curl at (x, y) by central differences. */
export function divCurl(P, Q, x, y, h) {
  const dPdx = (P(x + h, y) - P(x - h, y)) / (2 * h);
  const dPdy = (P(x, y + h) - P(x, y - h)) / (2 * h);
  const dQdx = (Q(x + h, y) - Q(x - h, y)) / (2 * h);
  const dQdy = (Q(x, y + h) - Q(x, y - h)) / (2 * h);
  return { div: dPdx + dQdy, curl: dQdx - dPdy };
}

/**
 * Trace a streamline by integrating the unit-speed direction field with RK4.
 * Returns world-space points, ordered along the direction of integration.
 *
 * @param {(x: number, y: number) => number} P
 * @param {(x: number, y: number) => number} Q
 * @param {number} x0
 * @param {number} y0
 * @param {object} options
 * @param {number} options.step arc length per step, in world units (sign gives direction)
 * @param {number} options.maxSteps
 * @param {{ xmin: number, xmax: number, ymin: number, ymax: number }} options.bounds stop outside
 */
export function traceStreamline(P, Q, x0, y0, { step, maxSteps = 1200, bounds }) {
  const dir = (x, y) => {
    const a = P(x, y);
    const b = Q(x, y);
    const m = Math.hypot(a, b);
    if (!(m > 1e-12) || !Number.isFinite(m)) return null;
    return [a / m, b / m];
  };
  const points = [[x0, y0]];
  let x = x0;
  let y = y0;
  const half = step / 2;
  for (let i = 0; i < maxSteps; i += 1) {
    const k1 = dir(x, y);
    if (!k1) break;
    const k2 = dir(x + half * k1[0], y + half * k1[1]);
    if (!k2) break;
    const k3 = dir(x + half * k2[0], y + half * k2[1]);
    if (!k3) break;
    const k4 = dir(x + step * k3[0], y + step * k3[1]);
    if (!k4) break;
    x += (step / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (step / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (x < bounds.xmin || x > bounds.xmax || y < bounds.ymin || y > bounds.ymax) break;
    points.push([x, y]);
    // Stop once a closed orbit returns to its start.
    if (i > 40 && Math.hypot(x - x0, y - y0) < Math.abs(step) * 1.2) {
      points.push([x0, y0]);
      break;
    }
  }
  return points;
}

/** A robust "typical magnitude": the median finite |F| over a sample grid. */
export function typicalMagnitude(P, Q, view, samples = 18) {
  const values = [];
  const [xmin, ymax] = view.toWorld(0, 0);
  const [xmax, ymin] = view.toWorld(view.width, view.height);
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const x = xmin + ((i + 0.5) / samples) * (xmax - xmin);
      const y = ymin + ((j + 0.5) / samples) * (ymax - ymin);
      const m = Math.hypot(P(x, y), Q(x, y));
      if (Number.isFinite(m)) values.push(m);
    }
  }
  if (values.length === 0) return 1;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  return median > 1e-12 ? median : Math.max(values[values.length - 1], 1e-12) || 1;
}
