/*
 * Clover LaTeX runner: compiles a project with the vendored Siglum engine (BusyTeX, TeX Live in WebAssembly).
 * Loaded in a sandboxed iframe with an opaque origin. See vendor/siglum/README.md.
 *
 * Protocol (postMessage):
 *   parent -> runner   { type: 'compile', id, main, engine, files: [{ path, text } | { path, bytes }] }
 *   runner -> parent   { type: 'ready' }
 *                      { type: 'status', id, text }
 *                      { type: 'log', id, text }
 *                      { type: 'compiled', id, ok, pdf, error, log }
 */
const MAX_FILES = 40;
const MAX_TOTAL = 12_000_000;
const PATH = /^[A-Za-z0-9_][A-Za-z0-9._ /-]*$/;

const post = (message, transfer = []) => window.parent.postMessage(message, '*', transfer);

let compiler = null;
let starting = null;
let busy = false;
let currentId = null;

async function start() {
  if (compiler) return compiler;
  starting ??= (async () => {
    post({ type: 'status', id: currentId, text: 'Loading the TeX engine\u2026' });
    const { SiglumCompiler, resolveRuntime } = await import('../vendor/siglum/engine.js');
    // A worker must be same-origin with its creator. This page's origin is opaque, so the worker comes from a blob.
    const source = await (await fetch(new URL('../vendor/siglum/worker.js', import.meta.url))).text();
    const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const runtime = await resolveRuntime();
    const instance = new SiglumCompiler({
      ...runtime,
      workerUrl,
      onLog: (text) => post({ type: 'log', id: currentId, text: String(text).slice(0, 2000) }),
      onProgress: (stage) => post({ type: 'status', id: currentId, text: String(stage).slice(0, 80) }),
    });
    await instance.init();
    return instance;
  })();
  try {
    compiler = await starting;
  } finally {
    starting = null;
  }
  return compiler;
}

function validRequest(data) {
  if (!data || data.type !== 'compile' || typeof data.id !== 'string' || data.id.length > 40) return false;
  if (typeof data.main !== 'string' || !PATH.test(data.main) || !['pdflatex', 'xelatex'].includes(data.engine))
    return false;
  if (!Array.isArray(data.files) || data.files.length === 0 || data.files.length > MAX_FILES) return false;
  let total = 0;
  for (const f of data.files) {
    if (!f || typeof f.path !== 'string' || !PATH.test(f.path) || f.path.includes('..')) return false;
    if (typeof f.text === 'string') total += f.text.length;
    else if (f.bytes instanceof Uint8Array) total += f.bytes.length;
    else return false;
  }
  return total <= MAX_TOTAL && data.files.some((f) => f.path === data.main && typeof f.text === 'string');
}

async function compile(data) {
  busy = true;
  currentId = data.id;
  try {
    const engine = await start();
    post({ type: 'status', id: data.id, text: 'Compiling\u2026' });
    const main = data.files.find((f) => f.path === data.main);
    const additionalFiles = {};
    for (const f of data.files) if (f !== main) additionalFiles[f.path] = f.text ?? f.bytes;
    const result = await engine.compile(main.text, { engine: data.engine, mainFile: data.main, additionalFiles });
    if (result.success) {
      const pdf = result.pdf.buffer.slice(result.pdf.byteOffset, result.pdf.byteOffset + result.pdf.byteLength);
      post(
        { type: 'compiled', id: data.id, ok: true, pdf, error: '', log: String(result.log ?? '').slice(0, 200000) },
        [pdf],
      );
    } else {
      post({
        type: 'compiled',
        id: data.id,
        ok: false,
        pdf: null,
        error: String(result.error ?? 'The document did not compile.').slice(0, 2000),
        log: String(result.log ?? '').slice(0, 200000),
      });
    }
  } catch (error) {
    post({
      type: 'compiled',
      id: data.id,
      ok: false,
      pdf: null,
      error: `The TeX engine could not run: ${String(error?.message ?? error).slice(0, 500)}`,
      log: '',
    });
  } finally {
    busy = false;
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (!validRequest(event.data)) return;
  if (busy) {
    post({
      type: 'compiled',
      id: event.data.id,
      ok: false,
      pdf: null,
      error: 'Still compiling the previous version.',
      log: '',
    });
    return;
  }
  compile(event.data);
});

post({ type: 'ready' });
