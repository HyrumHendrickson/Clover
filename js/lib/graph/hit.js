/** Nearest-point queries against drawn geometry, in screen pixels. */

function closestOnSegment(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { x, y, dist: Math.hypot(px - x, py - y) };
}

/**
 * Nearest point on a set of polylines, each a flat [x0, y0, x1, y1, ...] array.
 * @returns {{ x: number, y: number, dist: number } | null} null when none is within maxDist
 */
export function nearestOnPaths(paths, px, py, maxDist) {
  let best = null;
  for (const path of paths) {
    for (let k = 0; k + 3 < path.length; k += 2) {
      const ax = path[k];
      const ay = path[k + 1];
      const bx = path[k + 2];
      const by = path[k + 3];
      if (Math.max(ax, bx) < px - maxDist || Math.min(ax, bx) > px + maxDist) continue;
      if (Math.max(ay, by) < py - maxDist || Math.min(ay, by) > py + maxDist) continue;
      const hit = closestOnSegment(ax, ay, bx, by, px, py);
      if (hit.dist <= maxDist && (!best || hit.dist < best.dist)) best = hit;
    }
  }
  return best;
}

/** Nearest point on a flat [x0, y0, x1, y1, ...] list of independent segments. */
export function nearestOnSegments(segs, px, py, maxDist) {
  let best = null;
  for (let k = 0; k + 3 < segs.length; k += 4) {
    const hit = closestOnSegment(segs[k], segs[k + 1], segs[k + 2], segs[k + 3], px, py);
    if (hit.dist <= maxDist && (!best || hit.dist < best.dist)) best = hit;
  }
  return best;
}
