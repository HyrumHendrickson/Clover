import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILES,
  SAMPLE_FILES,
  base64ToBytes,
  bytesToBase64,
  compileRequest,
  firstTexError,
  isValidPath,
  normalizeProject,
  projectBytes,
  tokenizeLatex,
  uniquePath,
} from '../js/lib/latexproject.js';

test('paths must be relative, tidy, and of a known kind', () => {
  for (const ok of ['main.tex', 'figures/plot.png', 'a b/c-d_e.bib', 'img.JPG'])
    assert.equal(isValidPath(ok), true, ok);
  for (const bad of [
    '',
    '/etc/passwd.tex',
    '../x.tex',
    'a/../b.tex',
    'a//b.tex',
    'x.exe',
    'noext',
    '.hidden.tex',
    'a\\b.tex',
    'x.tex ',
    'a'.repeat(90) + '.tex',
    5,
    null,
  ]) {
    assert.equal(isValidPath(bad), false, String(bad));
  }
});

test('uniquePath numbers duplicates before the extension', () => {
  assert.equal(uniquePath('a.tex', ['b.tex']), 'a.tex');
  assert.equal(uniquePath('a.tex', ['a.tex']), 'a-2.tex');
  assert.equal(uniquePath('d/a.tex', ['d/a.tex', 'd/a-2.tex']), 'd/a-3.tex');
});

test('base64 round trips bytes of any size', () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('a project always has a main tex file, and hostile input is cleaned', () => {
  const empty = normalizeProject(null);
  assert.deepEqual(
    empty.files.map((f) => f.path),
    SAMPLE_FILES.map((f) => f.path),
  );
  assert.equal(empty.main, 'main.tex');

  const messy = normalizeProject({
    files: [
      { path: 'a.tex', text: '\\input{b}' },
      { path: 'a.tex', text: 'duplicate' },
      { path: '../evil.tex', text: 'x' },
      { path: 'pic.png', data: 'not base64!!' },
      { path: 'pic2.png', data: bytesToBase64(Uint8Array.of(1, 2, 3)) },
      { path: 'x.sh', text: 'rm' },
      { path: 'n.tex', text: 5 },
    ],
    main: 'missing.tex',
    active: 'nope',
    engine: 'rm -rf',
    auto: 'yes',
  });
  assert.deepEqual(
    messy.files.map((f) => f.path),
    ['a.tex', 'pic2.png'],
  );
  assert.equal(messy.main, 'a.tex');
  assert.equal(messy.active, 'a.tex');
  assert.equal(messy.engine, 'pdflatex');
  assert.equal(messy.auto, false);
  assert.deepEqual(normalizeProject(messy), messy, 'normalising twice changes nothing');
});

test('limits: file count, oversized images and oversized projects', () => {
  const many = normalizeProject({ files: Array.from({ length: 80 }, (_, i) => ({ path: `f${i}.tex`, text: 'x' })) });
  assert.equal(many.files.length, MAX_FILES);
  const big = bytesToBase64(new Uint8Array(1_600_000));
  assert.equal(
    normalizeProject({
      files: [
        { path: 'a.tex', text: 'x' },
        { path: 'big.png', data: big },
      ],
    }).files.length,
    1,
  );
  const sizes = normalizeProject({ files: [{ path: 'a.tex', text: 'x'.repeat(300000) }] });
  assert.equal(sizes.files[0].text.length, 200000);
});

test('the compile request carries text as text and images as bytes', () => {
  const project = normalizeProject({
    files: [
      { path: 'm.tex', text: 'hi' },
      { path: 'p.png', data: bytesToBase64(Uint8Array.of(9, 8)) },
    ],
    engine: 'xelatex',
  });
  const request = compileRequest(project);
  assert.equal(request.main, 'm.tex');
  assert.equal(request.engine, 'xelatex');
  assert.deepEqual(request.files[0], { path: 'm.tex', text: 'hi' });
  assert.deepEqual([...request.files[1].bytes], [9, 8]);
  assert.equal(projectBytes(project.files), 4);
});

test('highlighting covers comments, commands, environments, math and braces, and loses no text', () => {
  const source = '\\begin{document} % hi\n$x^2$ \\alpha \\\\ {a}';
  const tokens = tokenizeLatex(source);
  assert.equal(tokens.map((t) => t.text).join(''), source);
  const kinds = new Set(tokens.map((t) => t.type));
  for (const k of ['keyword', 'comment', 'string', 'function', 'number']) assert.ok(kinds.has(k), k);
});

test('the first TeX error is reported with its line', () => {
  const log = 'This is pdfTeX\n! Undefined control sequence.\nl.7 \\foo\n               bar\n';
  assert.equal(firstTexError(log), 'Undefined control sequence. (l.7 \\foo)');
  assert.equal(firstTexError('all fine'), '');
});
