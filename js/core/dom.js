/** Small DOM utilities. Text is always inserted as text, never as HTML. */

const PROPERTY_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'textContent', 'tabIndex']);

/**
 * Create an element.
 * @param {string} tag
 * @param {Record<string, any>} [props] class, dataset, style, on* listeners, aria-* and other attributes
 * @param {...any} children strings, nodes, arrays, or null
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPERTY_KEYS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.flush = (...args) => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn(...args);
    }
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

let counter = 0;
/** Short unique identifier, stable enough for DOM ids and tab keys. */
export function uid(prefix = 'id') {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

export function slugify(text, fallback = 'clover') {
  const slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/** Trigger a browser download for in-memory content. */
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, rel: 'noopener' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** Observe element size changes; returns a disconnect function. */
export function onResize(el, callback) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(() => callback());
  observer.observe(el);
  return () => observer.disconnect();
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
