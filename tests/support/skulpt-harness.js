/**
 * Runs Python through the vendored Skulpt build inside jsdom, with a recording
 * stub in place of a real canvas. Used to check that preset programs run to
 * completion and stay within the drawing area.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

export async function runPython(code, { size = 640 } = {}) {
  const dom = new JSDOM('<!doctype html><div id="stage"></div>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const stats = { points: [], strokes: 0, fills: 0, arcs: 0 };

  // Skulpt applies scale(1, -1) and translate(w/2, -h/2) before drawing, so the
  // coordinates passed to moveTo/lineTo are already in turtle space (origin at
  // the centre, y up). Record them directly.
  const makeContext = () => {
    const record = (x, y) => stats.points.push([x, y]);
    const target = {
      moveTo: (x, y) => record(x, y),
      lineTo: (x, y) => record(x, y),
      stroke: () => {
        stats.strokes += 1;
      },
      fill: () => {
        stats.fills += 1;
      },
      arc: (x, y) => {
        stats.arcs += 1;
        record(x, y);
      },
      measureText: () => ({ width: 0 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    };
    return new Proxy(target, {
      get: (obj, key) => (key in obj ? obj[key] : () => {}),
      set: () => true,
    });
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return makeContext();
  };

  window.eval(read('vendor/skulpt/skulpt.min.js'));
  window.eval(read('vendor/skulpt/skulpt-stdlib.js'));
  const { Sk } = window;
  const output = [];
  Sk.configure({
    output: (text) => output.push(text),
    read: (path) => {
      if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[path] === undefined)
        throw new Error(`File not found: '${path}'`);
      return Sk.builtinFiles.files[path];
    },
    __future__: Sk.python3,
  });
  Sk.TurtleGraphics = { target: 'stage', width: size, height: size };

  const started = Date.now();
  try {
    await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, code, true));
  } catch (error) {
    window.close();
    return { ok: false, error: String(error), output: output.join(''), stats, ms: Date.now() - started };
  }
  const xs = stats.points.map((p) => p[0]);
  const ys = stats.points.map((p) => p[1]);
  window.close();
  return {
    ok: true,
    output: output.join(''),
    stats,
    ms: Date.now() - started,
    bounds: xs.length
      ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      : null,
  };
}
