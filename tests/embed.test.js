import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { installDom, tick } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};
const { App } = await import('../js/core/app.js');
const { connectToHost, applyEmbedMode } = await import('../js/core/embed.js');
const { TOOL_LIST } = await import('../js/tools/index.js');
const code = await import('../js/lib/embedcode.js');
const types = TOOL_LIST.map((t) => t.type);
const apps = [];
after(() => {
  for (const a of apps) {
    a.save.cancel();
    a.teardown();
  }
  window.close();
});
const make = (options) => {
  const a = new App(elements, options);
  apps.push(a);
  return a;
};

test('embed settings are read from the address and anything odd is dropped', () => {
  assert.equal(code.readEmbedConfig('', types), null);
  assert.equal(code.readEmbedConfig('?embed=0', types), null);
  assert.deepEqual(code.readEmbedConfig('?embed=1', types), {
    single: null,
    tools: null,
    theme: null,
    persist: false,
    storageKey: 'clover:embed:v1:all',
  });
  const one = code.readEmbedConfig('?embed=1&tool=stats&theme=dark&persist=1&id=a_1', types);
  assert.equal(one.single, 'stats');
  assert.equal(one.theme, 'dark');
  assert.equal(one.persist, true);
  assert.equal(one.storageKey, 'clover:embed:v1:a_1');
  assert.equal(code.readEmbedConfig('?embed=1&tool=__proto__', types).single, null);
  assert.equal(code.readEmbedConfig('?embed=1&id=../../x&tool=graph', types).storageKey, 'clover:embed:v1:graph');
  assert.deepEqual(code.readEmbedConfig('?embed=1&tools=graph,nope,matrix,graph', types).tools, ['graph', 'matrix']);
  assert.equal(code.readEmbedConfig('?embed=1&tool=graph&tools=matrix', types).tools, null, 'tool wins over tools');
  assert.equal(code.readEmbedConfig('?embed=1&theme=pink', types).theme, null);
});

test('snippets are well formed and escape their values', () => {
  const base = code.baseFromLocation('https://a.test/Clover/index.html?x=1#y');
  assert.equal(base, 'https://a.test/Clover/');
  assert.equal(
    code.buildEmbedUrl(base, { tool: 'matrix', theme: 'dark' }),
    'https://a.test/Clover/?embed=1&tool=matrix&theme=dark',
  );
  assert.equal(
    code.buildEmbedUrl(base, { tools: ['graph', 'stats'] }),
    'https://a.test/Clover/?embed=1&tools=graph%2Cstats',
  );
  const frame = code.embedSnippet({ base, tool: 'matrix', title: 'a "b" <c>' });
  assert.match(frame, /src="https:\/\/a\.test\/Clover\/\?embed=1&amp;tool=matrix"/);
  assert.match(frame, /title="a &quot;b&quot; &lt;c&gt;"/);
  assert.match(frame, /sandbox="allow-scripts allow-same-origin/);
  assert.doesNotMatch(frame, /allow-top-navigation/);
  const element = code.embedSnippet({ base, tool: 'stats', style: 'element', height: 99999 });
  assert.match(element, /<script src="https:\/\/a\.test\/Clover\/embed\.js" async>/);
  assert.match(element, /<clover-embed tool="stats" height="2000">/);
});

test('one tool: a single tab, no launcher, nothing saved by default, nothing else openable', () => {
  window.localStorage.clear();
  const app = make({ single: 'matrix', persist: false });
  app.init();
  assert.equal(app.tabs.length, 1);
  assert.equal(app.tabs[0].type, 'matrix');
  assert.equal(app.addTab({ type: 'graph' }), null, 'other tools are not available');
  assert.equal(app.openTool('stats'), false);
  app.persistNow();
  assert.equal(window.localStorage.length, 0, 'an embedded frame leaves the visitor storage alone');
  app.closeTab(app.tabs[0].id);
  assert.equal(app.tabs.length, 1, 'the one tab cannot be closed');
  app.teardown();
});

test('a subset of tools limits the launcher and the new-tab menu', () => {
  const app = make({ tools: ['graph', 'stats'], persist: false });
  app.init();
  assert.equal(elements.launcher.querySelectorAll('.launch-card').length, 2);
  assert.equal(app.openTool('matrix'), false);
  assert.equal(app.openTool('stats'), true);
  app.teardown();
});

test('persisted embeds use their own key and never the full site workspace', () => {
  window.localStorage.clear();
  window.localStorage.setItem(
    'clover:workspace:v1',
    JSON.stringify({ version: 6, tabs: [{ type: 'graph', state: {} }] }),
  );
  const app = make({ single: 'stats', persist: true, storageKey: 'clover:embed:v1:t' });
  app.init();
  app.persistNow();
  assert.ok(window.localStorage.getItem('clover:embed:v1:t'));
  assert.equal(JSON.parse(window.localStorage.getItem('clover:workspace:v1')).tabs[0].type, 'graph');
  assert.equal(app.tabs.length, 1, 'the full site workspace was not loaded into the embed');
  app.teardown();
});

const clover = JSON.stringify({
  format: 'clover',
  version: 6,
  kind: 'workspace',
  workspace: {
    activeIndex: 0,
    tabs: [
      { type: 'graph', title: 'G', state: {} },
      { type: 'matrix', title: 'Mine', state: { lines: [{ kind: 'expr', text: '2+2' }] } },
    ],
  },
});

test('file text from the page is validated like Import, and single mode takes only its own tool', () => {
  const single = make({ single: 'matrix', persist: false });
  single.init();
  assert.deepEqual(single.applyExternal(clover), { ok: true });
  assert.equal(single.tabs.length, 1);
  assert.equal(single.tabs[0].title, 'Mine');
  assert.equal(single.applyExternal('not json').ok, false);
  assert.match(single.applyExternal(clover.replace('"matrix"', '"stats"')).message, /no tabs|no Linear algebra tab/);
  const roundTrip = JSON.parse(single.exportText());
  assert.equal(roundTrip.kind, 'tab');
  assert.equal(roundTrip.tab.type, 'matrix');
  single.teardown();
  const full = make({ persist: false });
  full.init();
  assert.deepEqual(full.applyExternal(clover), { ok: true });
  assert.equal(full.tabs.length, 2);
  assert.equal(JSON.parse(full.exportText()).kind, 'workspace');
  full.teardown();
});

test('the frame answers only its parent, and only with known requests', async () => {
  const parentDom = new JSDOM('<!doctype html>');
  const parent = parentDom.window;
  const got = [];
  parent.addEventListener('message', (e) => got.push(e.data));
  const app = make({ single: 'matrix', persist: false });
  app.init();
  const stop = connectToHost(app, { parent });
  await tick(20);
  assert.deepEqual(got[0], { type: 'clover:ready', tools: ['matrix'] });
  const send = (data, source = parent) => window.dispatchEvent(new window.MessageEvent('message', { data, source }));
  send({ type: 'clover:load', text: clover });
  send({ type: 'clover:load', text: 5 });
  send({ type: 'clover:export' });
  send({ type: 'clover:theme', theme: 'dark' });
  send({ type: 'clover:load', text: clover }, window);
  send({ type: 'clover:bogus' });
  send('string');
  await tick(20);
  assert.equal(
    got.filter((m) => m.type === 'clover:loaded').length,
    2,
    'the message from the wrong sender got no reply',
  );
  assert.deepEqual(
    got.find((m) => m.type === 'clover:loaded'),
    { type: 'clover:loaded', ok: true },
  );
  assert.equal(got.find((m) => m.type === 'clover:loaded' && !m.ok).ok, false);
  assert.equal(JSON.parse(got.find((m) => m.type === 'clover:export').text).tab.title, 'Mine');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(app.themeLocked, true);
  stop();
  applyEmbedMode({ single: 'matrix' });
  assert.equal(document.documentElement.dataset.embed, 'tool');
  app.teardown();
  parentDom.window.close();
});

test('embed.js builds a sandboxed frame and passes messages only with the right sender', async () => {
  const source = await readFile(new URL('../embed.js', import.meta.url), 'utf8');
  const host = new JSDOM(
    '<!doctype html><body><div id="d" data-clover data-tool="stats" data-height="320"></div></body>',
    {
      runScripts: 'outside-only',
      url: 'https://host.test/page',
    },
  );
  const w = host.window;
  w.eval(source);
  await tick(30);
  assert.ok(w.Clover.embed);
  const el = w.document.createElement('clover-embed');
  el.setAttribute('tool', 'matrix');
  el.setAttribute('height', '400');
  el.setAttribute('theme', 'dark');
  el.setAttribute('src', 'https://clover.test/app/');
  w.document.body.append(el);
  const frame = el.querySelector('iframe');
  assert.equal(frame.src, 'https://clover.test/app/?embed=1&tool=matrix&theme=dark');
  assert.equal(
    frame.getAttribute('sandbox'),
    'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms',
  );
  assert.match(frame.style.cssText, /height: 400px/);
  const fromData = w.document.querySelector('#d iframe');
  assert.match(fromData.src, /tool=stats/);
  assert.match(fromData.style.cssText, /height: 320px/);

  const posted = [];
  frame.contentWindow.postMessage = (m, origin) => posted.push([m, origin]);
  el.load({ format: 'clover' });
  el.setTheme('light');
  assert.equal(posted.length, 0, 'nothing is sent before the frame says it is ready');
  const reply = (data, origin = 'https://clover.test', src = frame.contentWindow) =>
    w.dispatchEvent(new w.MessageEvent('message', { data, origin, source: src }));
  reply({ type: 'clover:ready', tools: ['matrix'] }, 'https://evil.test');
  assert.equal(posted.length, 0, 'a message from another origin is ignored');
  reply({ type: 'clover:ready', tools: ['matrix'] });
  assert.equal(posted.length, 2);
  assert.equal(posted[0][1], 'https://clover.test', "messages go to Clover's origin, not to *");
  assert.equal(posted[0][0].type, 'clover:load');
  const pending = el.exportText();
  assert.equal(posted.at(-1)[0].type, 'clover:export');
  reply({ type: 'clover:export', text: '{"x":1}' });
  assert.equal(await pending, '{"x":1}');
  host.window.close();
});
