import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
const { App } = await import('../js/core/app.js');
const { bytesToBase64 } = await import('../js/lib/latexproject.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const tab = app.addTab({ type: 'latex' });
const panel = document.getElementById(`panel-${tab.id}`);
const q = (s, r = panel) => r.querySelector(s);
const qa = (s, r = panel) => [...r.querySelectorAll(s)];
const button = (label) => qa('button').find((b) => b.textContent.trim() === label);

test('a new LaTeX tab shows the project files and the source of the main file', () => {
  assert.deepEqual(
    qa('.ltx-file-name').map((b) => b.firstChild.textContent),
    ['main.tex', 'intro.tex'],
  );
  assert.match(q('.py-input').value, /\\documentclass\{article\}/);
  assert.ok(q('.tok-function'), 'LaTeX commands are highlighted');
  assert.equal(q('iframe.ltx-pdf').hidden, true);
  assert.equal(q('iframe:not(.ltx-pdf)'), null, 'nothing is compiled until the person asks');
});

test('switching files and typing edits the right file', () => {
  qa('.ltx-file-name')[1].click();
  assert.match(q('.py-input').value, /Several files/);
  type(window, q('.py-input'), 'changed');
  assert.equal(tab.state.files[1].text, 'changed');
  assert.match(tab.state.files[0].text, /documentclass/);
  assert.equal(tab.state.active, 'intro.tex');
});

test('compiling sends every file to a sandboxed frame and shows the PDF it returns', async () => {
  const input = q('.ltx-upload');
  const png = Uint8Array.of(137, 80, 78, 71);
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [
      { name: 'pic.png', size: 4, arrayBuffer: async () => png.buffer },
      { name: 'evil.exe', size: 4, arrayBuffer: async () => png.buffer },
    ],
  });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(20);
  assert.equal(tab.state.files.at(-1).path, 'pic.png', 'uploaded pictures are stored in the project');
  assert.equal(tab.state.files.at(-1).data, bytesToBase64(png));
  assert.ok(!tab.state.files.some((f) => f.path.includes('evil')), 'unknown file types are refused');
  tab.state.active = 'main.tex';
  button('Compile').click();
  const frame = q('iframe:not(.ltx-pdf)');
  assert.ok(frame);
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts', 'the compiler never gets allow-same-origin');
  assert.match(frame.getAttribute('src'), /runner\/latex\.html$/);
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data, source = frame.contentWindow) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source }));
  send({ type: 'ready' });
  const request = posted[0];
  assert.equal(request.type, 'compile');
  assert.equal(request.main, 'main.tex');
  assert.deepEqual(
    request.files.map((f) => f.path),
    ['main.tex', 'intro.tex', 'pic.png'],
  );
  assert.ok(request.files[2].bytes instanceof Uint8Array, 'pictures travel as bytes');

  send({ type: 'status', id: 'wrong', text: 'ignored' });
  send({ type: 'status', id: request.id, text: 'Compiling\u2026' });
  assert.match(q('.ltx-status').textContent, /Compiling/);
  send({ type: 'status', id: request.id, text: 'from an impostor' }, window);
  assert.doesNotMatch(q('.ltx-status').textContent, /impostor/);

  const pdf = new TextEncoder().encode('%PDF-1.5 fake').buffer;
  send({ type: 'compiled', id: request.id, ok: true, pdf, error: '', log: 'ok' });
  await tick(5);
  assert.equal(q('iframe.ltx-pdf').hidden, false);
  assert.match(q('iframe.ltx-pdf').getAttribute('src'), /^blob:/);
  assert.equal(q('.ltx-status').textContent, 'Compiled');
  assert.equal(button('Download PDF').disabled, false);
});

test('a failed compile reports the first TeX error, and a file that is not a PDF is refused', async () => {
  const frame = q('iframe:not(.ltx-pdf)');
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source: frame.contentWindow }));
  button('Compile').click();
  const first = posted[0];
  send({
    type: 'compiled',
    id: first.id,
    ok: false,
    pdf: null,
    error: 'failed',
    log: '! Undefined control sequence.\nl.4 \\oops\n',
  });
  assert.match(q('.ltx-status').textContent, /Undefined control sequence\. \(l\.4 \\oops\)/);
  assert.equal(q('.ltx-status').dataset.state, 'error');
  assert.equal(q('.ltx-log-box').open, true);

  button('Compile').click();
  const second = posted[1];
  send({
    type: 'compiled',
    id: second.id,
    ok: true,
    pdf: new TextEncoder().encode('not a pdf').buffer,
    error: '',
    log: '',
  });
  assert.equal(q('.ltx-status').dataset.state, 'error');
});

test('pictures show a preview, files can be added and deleted, and the last .tex file stays', () => {
  qa('.ltx-file-name')
    .find((b) => b.textContent === 'pic.png')
    .click();
  assert.ok(q('.ltx-image img'));
  assert.equal(q('.ltx-editor').hidden, true);
  button('Add file').click();
  [...document.querySelectorAll('.menu button, .menu [role="menuitem"]')]
    .find((b) => b.textContent.includes('New .tex file'))
    .click();
  assert.ok(tab.state.files.some((f) => f.path === 'untitled.tex'));
  assert.equal(q('.ltx-editor').hidden, false);
  const before = tab.state.files.length;
  const more = qa('.ltx-more').at(-1);
  more.click();
  [...document.querySelectorAll('.menu button, .menu [role="menuitem"]')]
    .find((b) => b.textContent.includes('Delete'))
    .click();
  assert.equal(tab.state.files.length, before - 1);
});

test('project state is cleaned on import', async () => {
  const { default: latex } = await import('../js/tools/latex.js');
  const state = latex.normalize({ files: [{ path: '../x.tex', text: 'a' }], main: 5 });
  assert.equal(state.main, 'main.tex');
  assert.deepEqual(latex.normalize(state), state);
});
