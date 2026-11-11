/**
 * Orbit camera for the 3D graph.
 *
 * The graph window is mapped onto the cube [-1, 1]^3 ("unit space"), z up. The
 * camera orbits the cube's centre: `yaw` turns about the vertical axis, `pitch`
 * raises the eye above the horizon. Everything here is pure arithmetic, so it
 * is unit tested without a canvas.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export const DEFAULT_CAMERA = Object.freeze({ yaw: 0.65, pitch: 0.5, zoom: 1, panX: 0, panY: 0, perspective: true });
export const MAX_PITCH = Math.PI / 2 - 0.02;
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 12;

/** Eye distance from the cube's centre, in unit-space lengths, for perspective. */
const EYE = 7;

/** Make any input a valid camera description. */
export function normalizeCamera(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    yaw: finite(r.yaw, DEFAULT_CAMERA.yaw) % (Math.PI * 2),
    pitch: clamp(finite(r.pitch, DEFAULT_CAMERA.pitch), -MAX_PITCH, MAX_PITCH),
    zoom: clamp(finite(r.zoom, 1), MIN_ZOOM, MAX_ZOOM),
    panX: clamp(finite(r.panX, 0), -3, 3),
    panY: clamp(finite(r.panY, 0), -3, 3),
    perspective: r.perspective !== false,
  };
}

export class Camera {
  constructor(saved = {}, width = 1, height = 1) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.set(saved);
  }

  set(saved) {
    Object.assign(this, normalizeCamera(saved));
    this.trig();
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  trig() {
    this.cy = Math.cos(this.yaw);
    this.sy = Math.sin(this.yaw);
    this.cp = Math.cos(this.pitch);
    this.sp = Math.sin(this.pitch);
  }

  /** Pixels per unit-space length at the centre of the view. */
  get scale() {
    return 0.265 * Math.min(this.width, this.height) * this.zoom;
  }

  /**
   * Rotate a unit-space point into view space: `out` receives [right, up, depth],
   * where a larger depth is farther from the eye.
   */
  rotate(x, y, z, out) {
    const x1 = this.cy * x - this.sy * y;
    const y1 = this.sy * x + this.cy * y;
    out[0] = x1;
    out[1] = y1 * this.sp + z * this.cp;
    out[2] = y1 * this.cp - z * this.sp;
    return out;
  }

  /** Project a unit-space point to pixels: `out` receives [px, py, depth]. */
  project(x, y, z, out) {
    this.rotate(x, y, z, out);
    const k = this.perspective ? EYE / (EYE + out[2]) : 1;
    const s = this.scale;
    const side = Math.min(this.width, this.height);
    const depth = out[2];
    out[0] = this.width / 2 + this.panX * side + out[0] * k * s;
    out[1] = this.height / 2 + this.panY * side - out[1] * k * s;
    out[2] = depth;
    return out;
  }

  /** Drag by (dx, dy) pixels as if grabbing the scene. */
  orbit(dx, dy) {
    this.yaw = (this.yaw + dx * 0.008) % (Math.PI * 2);
    this.pitch = clamp(this.pitch + dy * 0.008, -MAX_PITCH, MAX_PITCH);
    this.trig();
  }

  /** Slide the scene by (dx, dy) pixels. */
  pan(dx, dy) {
    const side = Math.min(this.width, this.height);
    this.panX = clamp(this.panX + dx / side, -3, 3);
    this.panY = clamp(this.panY + dy / side, -3, 3);
  }

  zoomBy(factor) {
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  toJSON() {
    const round = (v) => Number(v.toFixed(4));
    return {
      yaw: round(this.yaw),
      pitch: round(this.pitch),
      zoom: round(this.zoom),
      panX: round(this.panX),
      panY: round(this.panY),
      perspective: this.perspective,
    };
  }
}

/** Standard views, as camera fields. */
export const PRESET_VIEWS = {
  top: { yaw: 0, pitch: MAX_PITCH },
  front: { yaw: 0, pitch: 0 },
  side: { yaw: Math.PI / 2, pitch: 0 },
  iso: { yaw: DEFAULT_CAMERA.yaw, pitch: DEFAULT_CAMERA.pitch },
};
