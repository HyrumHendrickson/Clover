import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
const { App } = await import('../js/core/app.js');
const { default: maxima } = await import('../js/tools/maxima.js');
const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const tab = app.addTab({ type: 'maxima' });
const panel = document.getElementById(`panel-${tab.id}`);
const q = (s) => panel.querySelector(s);
const qa = (s) => [...panel.querySelectorAll(s)];
const run = (text) => {
  type(window, q('.mx2-input'), text);
  q('.mx2-input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
};

test('commands run, results are numbered, and the session is saved', () => {
  run('f(x) := x^2+1;');
  run('diff(f(x), x);');
  run('integrate(%, x);');
  const labels = qa('.mx2-in .mx2-label').map((e) => e.textContent);
  assert.deepEqual(labels, ['(%i1)', '(%i2)', '(%i3)']);
  assert.match(qa('.mx2-entry')[1].textContent, /\(%o2\).*2.*x/);
  assert.match(qa('.mx2-entry')[2].textContent, /\(%o3\)/);
  assert.deepEqual(tab.state.inputs, ['f(x) := x^2+1;', 'diff(f(x), x);', 'integrate(%, x);']);
});

test('errors are shown in words and a $ hides a result', () => {
  run('foo(x);');
  assert.match(q('.mx-error').textContent, /does not know foo/);
  run('a: 7$');
  assert.equal(qa('.mx2-entry').at(-1).querySelectorAll('.mx2-line').length, 0);
});

test('removing a command replays the rest, and examples run with one click', async () => {
  const before = qa('.mx2-entry').length;
  qa('.mx2-remove')[0].click();
  assert.equal(qa('.mx2-entry').length, before - 1);
  qa('.chip')
    .find((c) => c.textContent === 'Solve')
    .click();
  assert.match(qa('.mx2-entry').at(-1).textContent, /x\s*=\s*2.*x\s*=\s*3/);
  await tick(5);
});

test('state survives a round trip and hostile input is cleaned', () => {
  const state = maxima.normalize({
    inputs: ['x;', 5, '', 'y'.repeat(5000), ...Array.from({ length: 200 }, () => 'z')],
  });
  assert.equal(state.inputs.length, 100);
  assert.equal(state.inputs[1].length, 2000);
  assert.deepEqual(maxima.normalize(state), state);
});
