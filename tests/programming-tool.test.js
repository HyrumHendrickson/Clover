import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};
const { App } = await import('../js/core/app.js');
const { TOOLS } = await import('../js/tools/index.js');
const { STARTERS } = await import('../js/tools/programming-presets.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const programming = TOOLS.programming;
const tab = app.addTab({ type: 'programming' });
const panel = document.getElementById(`panel-${tab.id}`);
const q = (s) => panel.querySelector(s);
const qa = (s) => [...panel.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const runButton = () => qa('button').find((b) => b.textContent.trim() === 'Run');
const language = (label) => qa('[role="radio"]').find((b) => b.textContent === label);

test('hostile state is repaired', () => {
  const state = programming.normalize({
    language: 'cobol',
    sources: { python: 5, rust: 'x'.repeat(60000), evil: 'y', __proto__: { c: 'no' } },
    stdin: { a: 1 },
  });
  assert.equal(state.language, 'python');
  assert.equal(state.sources.python, STARTERS.python);
  assert.equal(state.sources.rust.length, 50000);
  assert.deepEqual(Object.keys(state.sources), ['python', 'rust', 'c', 'cpp', 'java']);
  assert.equal(state.stdin, '');
  assert.deepEqual(programming.normalize(state), state);
});

test('each language keeps its own program', () => {
  const area = q('textarea.py-input');
  assert.equal(area.value, STARTERS.python);
  type(window, area, 'print(1)');
  click(language('Rust'));
  assert.equal(tab.state.language, 'rust');
  assert.equal(area.value, STARTERS.rust);
  assert.equal(q('.prog-file').textContent, 'main.rs');
  click(language('Python'));
  assert.equal(area.value, 'print(1)');
  assert.equal(language('Python').getAttribute('aria-checked'), 'true');
  assert.equal(tab.state.sources.python, 'print(1)');
});

test('Run talks to a sandboxed frame and shows what comes back', async () => {
  click(runButton());
  const frame = q('iframe.py-frame');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts', 'the runner never gets allow-same-origin');
  assert.match(frame.getAttribute('src'), /runner\/code\.html$/);
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data, source = frame.contentWindow) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source }));
  send({ type: 'ready' });
  assert.equal(posted[0].type, 'run');
  assert.equal(posted[0].language, 'python');
  assert.equal(posted[0].code, 'print(1)');
  assert.equal(runButton().disabled, true);
  const id = posted[0].id;

  send({ type: 'status', id: id + 5, text: 'stale' });
  send({ type: 'status', id, text: 'Waiting in the queue…' });
  assert.match(q('.prog-status').textContent, /queue/);
  send({ type: 'status', id, text: 'impostor' }, window);
  assert.doesNotMatch(q('.prog-status').textContent, /impostor/);

  send({
    type: 'result',
    id,
    result: {
      statusId: 3,
      status: 'Accepted',
      stdout: '1\n',
      stderr: '',
      compile: '',
      message: '',
      time: '0.02',
      memory: 1024,
    },
  });
  assert.match(q('.prog-stdout .prog-pre').textContent, /^1/);
  assert.match(q('.prog-status').textContent, /Finished/);
  assert.equal(runButton().disabled, false);
});

test('a compile error is shown as an error, and a malformed reply is refused', () => {
  const frame = q('iframe.py-frame');
  const posted = [];
  frame.contentWindow.postMessage = (m) => posted.push(m);
  const send = (data) =>
    window.dispatchEvent(new window.MessageEvent('message', { data, source: frame.contentWindow }));
  click(runButton()); // the frame from the last run is still alive and ready, so the request goes out at once
  assert.equal(posted.at(-1).type, 'run');
  send({
    type: 'result',
    id: posted.at(-1).id,
    result: {
      statusId: 6,
      status: 'Compilation Error',
      stdout: '',
      stderr: '',
      compile: 'oops',
      message: '',
      time: null,
      memory: null,
    },
  });
  assert.equal(q('.prog-compile').classList.contains('is-error'), true);
  assert.equal(q('.prog-status').dataset.state, 'error');
  click(runButton());
  send({ type: 'result', id: posted.at(-1).id, result: { statusId: 'x' } });
  assert.match(q('.prog-block .prog-pre').textContent, /could not read/);
});

test('Stop removes the frame, and empty code is not sent', () => {
  click(runButton());
  assert.equal(qa('button').find((b) => b.textContent.trim() === 'Stop').disabled, false);
  click(qa('button').find((b) => b.textContent.trim() === 'Stop'));
  assert.equal(q('iframe.py-frame'), null);
  assert.match(q('.prog-status').textContent, /Stopped/);
  type(window, q('textarea.py-input'), '   ');
  click(runButton());
  assert.equal(q('iframe.py-frame'), null, 'nothing runs for blank code');
});

test('a runner that never starts is reported', async () => {
  type(window, q('textarea.py-input'), 'print(2)');
  click(runButton());
  assert.ok(q('iframe.py-frame'));
  click(qa('button').find((b) => b.textContent.trim() === 'Stop'));
  await tick(5);
});
