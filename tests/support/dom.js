/**
 * jsdom environment for UI smoke tests. Installs browser globals, a recording
 * canvas stub, and layout sizes (jsdom has no layout engine).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function createContext2D() {
  const target = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(target, {
    get: (obj, key) => (key in obj ? obj[key] : () => {}),
    set: () => true,
  });
}

export function installDom({ width = 960, height = 640 } = {}) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = () => createContext2D();
  window.HTMLCanvasElement.prototype.toBlob = (cb) => cb(null);
  for (const [name, value] of [
    ['clientWidth', width],
    ['clientHeight', height],
  ]) {
    Object.defineProperty(window.HTMLElement.prototype, name, { configurable: true, get: () => value });
  }
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.HTMLElement.prototype.scrollIntoView = () => {};

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    CSS: { escape: (s) => String(s).replace(/"/g, '\\"') },
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  window.devicePixelRatio = 1;

  const byId = (id) => window.document.getElementById(id);
  const elements = {
    brand: byId('brand-button'),
    tabstrip: byId('tabstrip'),
    tablist: byId('tablist'),
    panels: byId('panels'),
    launcher: byId('launcher'),
    newTab: byId('new-tab'),
    exportButton: byId('export-button'),
    importButton: byId('import-button'),
    importInput: byId('import-input'),
    themeButton: byId('theme-button'),
    helpButton: byId('help-button'),
    dropOverlay: byId('drop-overlay'),
  };
  return { dom, window, document: window.document, elements };
}

export const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

export function type(window, input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

export function press(window, el, key, init = {}) {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}
