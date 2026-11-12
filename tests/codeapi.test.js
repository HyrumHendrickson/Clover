import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RunError,
  cleanEndpoint,
  compareVersions,
  describeResult,
  fromBase64,
  loadLanguages,
  parseResult,
  pickLanguages,
  runProgram,
  toBase64,
} from '../js/lib/codeapi.js';
import { tokenizeCode } from '../js/lib/codehighlight.js';

const OLD = [
  { id: 50, name: 'C (GCC 9.2.0)' },
  { id: 48, name: 'C (GCC 7.4.0)' },
  { id: 54, name: 'C++ (GCC 9.2.0)' },
  { id: 62, name: 'Java (OpenJDK 13.0.1)' },
  { id: 70, name: 'Python (2.7.17)' },
  { id: 71, name: 'Python (3.8.1)' },
  { id: 73, name: 'Rust (1.40.0)' },
  { id: 75, name: 'C (Clang 7.0.1)' },
];

test('languages are chosen by name, newest version first', () => {
  const picked = pickLanguages(OLD);
  assert.deepEqual(Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.id])), {
    python: 71,
    rust: 73,
    c: 50,
    cpp: 54,
    java: 62,
  });
  const newer = pickLanguages([
    ...OLD,
    { id: 103, name: 'C (GCC 14.1.0)' },
    { id: 105, name: 'C++ (GCC 14.1.0)' },
    { id: 108, name: 'Rust (1.85.0)' },
    { id: 92, name: 'Python (3.11.2)' },
    { id: 91, name: 'Java (OpenJDK 17.0.6)' },
    { id: 10, name: 'Java Test (OpenJDK 14.0.1, JUnit)' },
  ]);
  assert.equal(newer.c.id, 103);
  assert.equal(newer.cpp.id, 105);
  assert.equal(newer.rust.id, 108);
  assert.equal(newer.python.id, 92);
  assert.equal(newer.java.id, 91);
});

test('Clang is the fallback for C, and bad lists give nothing', () => {
  assert.equal(pickLanguages([{ id: 75, name: 'C (Clang 7.0.1)' }]).c.id, 75);
  assert.deepEqual(pickLanguages(null), {});
  assert.deepEqual(pickLanguages([null, { id: 'x', name: 5 }, { id: -1, name: 'Rust (1.0.0)' }]), {});
  assert.equal(compareVersions('14.1.0', '9.2.0'), 1);
  assert.equal(compareVersions('1.40', '1.40.0'), 0);
});

test('only safe service addresses are accepted', () => {
  assert.equal(cleanEndpoint('https://ce.judge0.com/'), 'https://ce.judge0.com');
  assert.equal(cleanEndpoint('http://localhost:2358'), 'http://localhost:2358');
  assert.equal(cleanEndpoint('http://example.com'), null);
  assert.equal(cleanEndpoint('https://user:pw@example.com'), null);
  assert.equal(cleanEndpoint('https://example.com/?k=1'), null);
  assert.equal(cleanEndpoint('javascript:alert(1)'), null);
  assert.equal(cleanEndpoint(5), null);
});

test('base64 round-trips any text', () => {
  const text = 'héllo \u4e16\u754c \ud83d\ude00\nline';
  assert.equal(fromBase64(toBase64(text)), text);
  assert.equal(fromBase64(`${toBase64('ab')}\n`), 'ab');
  assert.equal(fromBase64(null), '');
  assert.equal(fromBase64('***'), '');
});

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function fakeService(steps) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (init.method === 'POST') return reply({ token: 'abcd1234-ef56' }, 201);
    return steps.shift();
  };
  return { fetchImpl, calls };
}

test('a program is submitted, polled, and decoded', async () => {
  const done = reply({
    status: { id: 3, description: 'Accepted' },
    stdout: toBase64('hi\n'),
    stderr: null,
    compile_output: null,
    message: null,
    time: '0.01',
    memory: 2048,
  });
  const { fetchImpl, calls } = fakeService([reply({ status: { id: 1 } }), reply({ status: { id: 2 } }), done]);
  const seen = [];
  const result = await runProgram({
    fetchImpl,
    endpoint: 'https://x.test',
    languageId: 71,
    code: 'print("hi")',
    stdin: 'in',
    onStatus: (s) => seen.push(s),
  });
  assert.equal(result.stdout, 'hi\n');
  assert.equal(result.statusId, 3);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.language_id, 71);
  assert.equal(fromBase64(sent.source_code), 'print("hi")');
  assert.equal(fromBase64(sent.stdin), 'in');
  assert.match(calls[0].url, /base64_encoded=true&wait=false/);
  assert.ok(seen.some((s) => /queue/i.test(s)));
  const shown = describeResult(result);
  assert.equal(shown.ok, true);
  assert.match(shown.summary, /Finished · 0\.01 s · 2 MB/);
});

test('service problems become readable errors', async () => {
  const busy = async () => reply({}, 429);
  await assert.rejects(
    runProgram({ fetchImpl: busy, endpoint: 'https://x.test', languageId: 1, code: 'x' }),
    (e) => e instanceof RunError && /busy/.test(e.message),
  );
  const offline = async () => {
    throw new TypeError('failed to fetch');
  };
  await assert.rejects(
    runProgram({ fetchImpl: offline, endpoint: 'https://x.test', languageId: 1, code: 'x' }),
    /Could not reach x\.test/,
  );
  const odd = async (url, init) => (init?.method === 'POST' ? reply({ token: '../etc' }, 201) : reply({}));
  await assert.rejects(
    runProgram({ fetchImpl: odd, endpoint: 'https://x.test', languageId: 1, code: 'x' }),
    /unexpected/,
  );
  await assert.rejects(
    loadLanguages(async () => reply({}, 500), 'https://x.test'),
    /HTTP 500/,
  );
});

test('stopping aborts the wait', async () => {
  const controller = new AbortController();
  const { fetchImpl } = fakeService([reply({ status: { id: 2 } }), reply({ status: { id: 2 } })]);
  const run = runProgram({
    fetchImpl,
    endpoint: 'https://x.test',
    languageId: 1,
    code: 'x',
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(run, /Stopped/);
});

test('failed runs show compiler output and the reason, and results from a frame are re-checked', () => {
  const failed = describeResult({
    statusId: 6,
    status: 'Compilation Error',
    stdout: '',
    stderr: '',
    compile: 'main.c:1: error',
    message: 'detail',
    time: null,
    memory: null,
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(
    failed.sections.map((s) => s.kind),
    ['compile', 'message'],
  );
  assert.equal(failed.summary, 'Compilation Error');
  assert.equal(parseResult(null), null);
  assert.equal(parseResult({ statusId: 'x' }), null);
  const clean = parseResult({ statusId: 3, stdout: 'a'.repeat(100000), memory: 'x', time: 5 });
  assert.ok(clean.stdout.length < 51000);
  assert.equal(clean.memory, null);
  assert.equal(clean.time, null);
});

test('the highlighter classifies each language', () => {
  const types = (code, lang) => tokenizeCode(code, lang).map((t) => `${t.type}:${t.text}`);
  assert.ok(
    types('#include <stdio.h>\nint main(void) { return 0; } // done', 'c').includes('builtin:#include <stdio.h>'),
  );
  assert.ok(types('int x = 0x1F;', 'c').includes('number:0x1F'));
  assert.ok(types('fn main() { let s = "a\\"b"; }', 'rust').includes('function:main'));
  assert.ok(types("fn f<'a>(x: &'a str) {}", 'rust').some((t) => t.startsWith('function:f')));
  assert.ok(types('/* a\nb */ int y;', 'cpp').some((t) => t.startsWith('comment:/* a')));
  assert.ok(types('String t = """\nhi""";', 'java').some((t) => t.startsWith('string:"""')));
  assert.ok(types('def f(): pass', 'python').includes('keyword:def'));
  const text = 'x'.repeat(5) + '"unterminated';
  assert.equal(
    tokenizeCode(text, 'c')
      .map((t) => t.text)
      .join(''),
    text,
    'tokens always rebuild the source',
  );
  assert.deepEqual(tokenizeCode('abc', 'nope'), [{ text: 'abc', type: 'plain' }]);
});
