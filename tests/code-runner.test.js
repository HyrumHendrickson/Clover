import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, tick } from './support/dom.js';
import { toBase64 } from '../js/lib/codeapi.js';

const { window } = installDom();
after(() => window.close());

const requests = [];
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init });
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (String(url).endsWith('/languages')) return json([{ id: 71, name: 'Python (3.8.1)' }]);
  if (init.method === 'POST') return json({ token: 'tok-12345678' }, 201);
  return json({ status: { id: 3, description: 'Accepted' }, stdout: toBase64('4\n') });
};

const received = [];
window.addEventListener('message', (event) => {
  if (event.data && typeof event.data.type === 'string' && event.data.type !== 'run') received.push(event.data);
});
await import('../runner/code.js');
const send = (data, source = window) => window.dispatchEvent(new window.MessageEvent('message', { data, source }));
const waitFor = async (type) => {
  for (let i = 0; i < 100 && !received.some((m) => m.type === type); i += 1) await tick(10);
  return received.find((m) => m.type === type);
};

test('the runner announces itself, then runs a program through the service', async () => {
  assert.ok(await waitFor('ready'));
  send({ type: 'run', id: 7, endpoint: 'https://svc.test/', language: 'python', code: 'print(2+2)', stdin: '' });
  const result = await waitFor('result');
  assert.equal(result.id, 7);
  assert.equal(result.result.stdout, '4\n');
  assert.equal(result.result.language, 'Python (3.8.1)');
  assert.ok(requests.every((r) => r.url.startsWith('https://svc.test/')));
});

test('bad requests are refused without touching the network', async () => {
  received.length = 0;
  requests.length = 0;
  send({ type: 'run', id: 8, endpoint: 'http://evil.test', language: 'python', code: 'x' });
  assert.match((await waitFor('error')).message, /not valid/);
  received.length = 0;
  send({ type: 'run', id: 9, endpoint: 'https://svc.test', language: 'cobol', code: 'x' });
  assert.match((await waitFor('error')).message, /not supported/);
  received.length = 0;
  send({ type: 'run', id: 10, endpoint: 'https://svc.test', language: 'rust', code: 'fn main(){}' });
  assert.match((await waitFor('error')).message, /does not offer/);
  received.length = 0;
  send({ type: 'run', id: 11, endpoint: 'https://svc.test', language: 'python', code: 'x' }, { not: 'the parent' });
  await tick(30);
  assert.equal(received.length, 0, 'messages from anything but the parent are ignored');
});

test('the runner page keeps a strict policy', async () => {
  const html = await readFile(new URL('../runner/code.html', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, 'no inline script');
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /connect-src 'self';/, 'the main page still cannot make network requests');
  const tool = await readFile(new URL('../js/tools/programming.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tool, /\bfetch\(/, 'the tab itself never calls the network');
});
