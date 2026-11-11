/**
 * Pointer, wheel, touch, and keyboard navigation for a View.
 * Supports drag-to-pan, wheel zoom, pinch zoom, double-click reset, and
 * keyboard control. An optional `drag` handler can claim a pointer press.
 */
export function attachPanZoom(el, view, handlers = {}) {
  const { onChange, onClick, onHover, onLeave, onReset, drag } = handlers;
  const pointers = new Map();
  let mode = null;
  let moved = 0;
  let downTime = 0;
  let startPos = [0, 0];
  let pinchDist = 0;

  const local = (event) => {
    const rect = el.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const change = () => onChange?.();

  el.style.touchAction = 'none';
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

  const onDown = (event) => {
    if (event.button > 0 && event.pointerType === 'mouse') return;
    el.setPointerCapture(event.pointerId);
    const [x, y] = local(event);
    pointers.set(event.pointerId, [x, y]);
    if (pointers.size === 1) {
      moved = 0;
      downTime = performance.now();
      startPos = [x, y];
      if (drag?.hitTest(x, y)) {
        mode = 'custom';
        drag.start?.(x, y);
      } else {
        mode = 'pan';
        el.classList.add('is-grabbing');
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      mode = 'pinch';
      moved = 99;
    }
  };

  const onMove = (event) => {
    const [x, y] = local(event);
    const prev = pointers.get(event.pointerId);
    if (!prev) {
      onHover?.(x, y);
      return;
    }
    pointers.set(event.pointerId, [x, y]);
    if (mode === 'pan') {
      view.panBy(x - prev[0], y - prev[1]);
      moved += Math.abs(x - prev[0]) + Math.abs(y - prev[1]);
      change();
    } else if (mode === 'custom') {
      moved += Math.abs(x - prev[0]) + Math.abs(y - prev[1]);
      drag.move(x, y);
    } else if (mode === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinchDist > 0 && dist > 0) {
        view.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / pinchDist);
        change();
      }
      pinchDist = dist;
    }
    onHover?.(x, y);
  };

  const onUp = (event) => {
    const count = pointers.size;
    if (!pointers.delete(event.pointerId)) return;
    if (mode === 'custom' && count === 1) drag.end?.();
    const quick = performance.now() - downTime < 600;
    if (mode === 'pan' && count === 1 && moved < 5 && quick && event.type === 'pointerup') {
      onClick?.(startPos[0], startPos[1]);
    }
    if (pointers.size === 0) {
      mode = null;
      el.classList.remove('is-grabbing');
    } else if (pointers.size === 1) {
      mode = 'pan';
      moved = 99;
    }
  };

  const onWheel = (event) => {
    event.preventDefault();
    const [x, y] = local(event);
    const unit = event.deltaMode === 1 ? 0.05 : 0.0015;
    view.zoomAt(x, y, Math.exp(-event.deltaY * unit));
    change();
  };

  const onKey = (event) => {
    const pan = 48;
    const keys = {
      ArrowLeft: () => view.panBy(pan, 0),
      ArrowRight: () => view.panBy(-pan, 0),
      ArrowUp: () => view.panBy(0, pan),
      ArrowDown: () => view.panBy(0, -pan),
      '+': () => view.zoomAt(view.width / 2, view.height / 2, 1.25),
      '=': () => view.zoomAt(view.width / 2, view.height / 2, 1.25),
      '-': () => view.zoomAt(view.width / 2, view.height / 2, 0.8),
    };
    if (event.key === '0') {
      onReset?.();
    } else if (keys[event.key]) {
      keys[event.key]();
      change();
    } else {
      return;
    }
    event.preventDefault();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', () => onLeave?.());
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', () => onReset?.());
  el.addEventListener('keydown', onKey);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('keydown', onKey);
  };
}
