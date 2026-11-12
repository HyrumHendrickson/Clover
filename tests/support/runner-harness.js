/**
 * Loads runner/runner.js and the vendored Skulpt build into jsdom and talks to it the way the
 * parent page does, so the session and cellular-automaton protocols can be tested without a browser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

export function startRunner() {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  // A canvas that accepts every drawing call, with a tiny pixel-free toDataURL.
  const context = new Proxy(
    { measureText: () => ({ width: 0 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) },
    {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: () => true,
    },
  );
  window.HTMLCanvasElement.prototype.getContext = () => context;
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
  window.eval(read('vendor/skulpt/skulpt.min.js'));
  window.eval(read('vendor/skulpt/skulpt-stdlib.js'));

  const received = [];
  const pending = [];
  // In jsdom a top-level window is its own parent, so the runner's replies arrive as events with no source.
  window.addEventListener('message', (event) => {
    if (event.source !== null && event.source !== undefined) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    received.push(message);
    const at = pending.findIndex((w) => w.types.includes(message.type));
    if (at >= 0) {
      const [waiter] = pending.splice(at, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  window.eval(read('runner/runner.js'));

  const send = (data) => window.dispatchEvent(new window.MessageEvent('message', { data, source: window }));

  /** Send one message and wait for the first reply whose type is in `types`. */
  const ask = (data, types, ms = 30000) =>
    new Promise((resolve, reject) => {
      const waiter = { types, resolve };
      waiter.timer = setTimeout(
        () => reject(new Error(`no ${types.join('/')} reply; saw ${received.map((m) => m.type).join(', ')}`)),
        ms,
      );
      pending.push(waiter);
      send(data);
    });
  return { window, received, send, ask, close: () => window.close() };
}
