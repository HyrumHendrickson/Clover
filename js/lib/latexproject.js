/**
 * The LaTeX tab's project: a handful of text files and images, a main file, and the helpers that keep a
 * project from a shared file safe. Pure, so it is tested without a DOM.
 */

export const MAX_FILES = 30;
export const MAX_PATH = 80;
export const MAX_TEXT = 200_000;
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_PROJECT_BYTES = 6_000_000;

export const TEXT_EXTENSIONS = ['tex', 'bib', 'sty', 'cls', 'bst', 'cfg', 'txt'];
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' };

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ -]*$/;

export const extensionOf = (path) => (/\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '').toLowerCase();
export const isTextPath = (path) => TEXT_EXTENSIONS.includes(extensionOf(path));
export const isImagePath = (path) => Object.hasOwn(IMAGE_TYPES, extensionOf(path));

/** True for a relative path like `figures/plot.png`: no leading slash, no `..`, sensible characters only. */
export function isValidPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH) return false;
  if (!isTextPath(path) && !isImagePath(path)) return false;
  return path.split('/').every((part) => part !== '.' && part !== '..' && SEGMENT.test(part) && !part.endsWith(' '));
}

/** A path nobody else in `taken` uses, adding -2, -3, ... before the extension when needed. */
export function uniquePath(path, taken) {
  const used = new Set(taken);
  if (!used.has(path)) return path;
  const dot = path.lastIndexOf('.');
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return path;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const base64Size = (text) => Math.floor((text.length * 3) / 4) - (/={1,2}$/.exec(text)?.[0].length ?? 0);

export const SAMPLE_FILES = [
  {
    path: 'main.tex',
    text: String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{graphicx}
\title{A first Clover document}
\author{}
\date{}

\begin{document}
\maketitle

\section{Mathematics}
The quadratic formula gives the roots of $ax^2 + bx + c = 0$:
\[
  x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}.
\]

\input{intro}

% To add a picture, upload a PNG, JPEG, or PDF with "Add file", then:
% \includegraphics[width=0.5\textwidth]{picture.png}

\end{document}
`,
  },
  {
    path: 'intro.tex',
    text: String.raw`\section{Several files}
This paragraph lives in \texttt{intro.tex} and is pulled in with \verb|\input{intro}|.
Euler's identity is $e^{i\pi} + 1 = 0$.
`,
  },
];

/**
 * Make a project from anything. Bad files are dropped, text and image sizes are limited, and there is always
 * at least one text file, a main file that exists, and an active file that exists.
 */
export function normalizeProject(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const files = [];
  const seen = new Set();
  let bytes = 0;
  for (const f of Array.isArray(r.files) ? r.files.slice(0, MAX_FILES * 2) : []) {
    if (files.length >= MAX_FILES || !f || typeof f !== 'object' || !isValidPath(f.path) || seen.has(f.path)) continue;
    if (isTextPath(f.path)) {
      if (typeof f.text !== 'string') continue;
      const text = f.text.slice(0, MAX_TEXT);
      if (bytes + text.length > MAX_PROJECT_BYTES) continue;
      bytes += text.length;
      files.push({ path: f.path, text });
    } else {
      if (typeof f.data !== 'string' || !BASE64.test(f.data) || f.data.length % 4 !== 0) continue;
      const size = base64Size(f.data);
      if (size > MAX_IMAGE_BYTES || bytes + size > MAX_PROJECT_BYTES) continue;
      bytes += size;
      files.push({ path: f.path, data: f.data });
    }
    seen.add(f.path);
  }
  if (!files.some((f) => isTextPath(f.path) && extensionOf(f.path) === 'tex')) {
    files.length = 0;
    seen.clear();
    for (const s of SAMPLE_FILES) {
      files.push({ ...s });
      seen.add(s.path);
    }
  }
  const texFiles = files.filter((f) => extensionOf(f.path) === 'tex');
  const main = typeof r.main === 'string' && texFiles.some((f) => f.path === r.main) ? r.main : texFiles[0].path;
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : main;
  return {
    files,
    main,
    active,
    engine: ['pdflatex', 'xelatex'].includes(r.engine) ? r.engine : 'pdflatex',
    auto: r.auto === true,
  };
}

/** Total size of a project in bytes, counting images by their decoded size. */
export const projectBytes = (files) =>
  files.reduce((sum, f) => sum + (typeof f.text === 'string' ? f.text.length : base64Size(f.data ?? '')), 0);

/** What the compiler is sent: each file's path and its bytes or text. */
export function compileRequest(project) {
  return {
    main: project.main,
    engine: project.engine,
    files: project.files.map((f) =>
      typeof f.text === 'string' ? { path: f.path, text: f.text } : { path: f.path, bytes: base64ToBytes(f.data) },
    ),
  };
}

/** Classify LaTeX source for highlighting: comments, commands, math shifts, braces, and plain text. */
export function tokenizeLatex(code) {
  const tokens = [];
  const push = (type, text) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ type, text });
  };
  const pattern = /(%[^\n]*)|(\\(?:[A-Za-z@]+\*?|[^A-Za-z]))|(\$\$?)|([{}[\]])|([^%\\${}[\]]+)|([\s\S])/g;
  for (const m of code.matchAll(pattern)) {
    if (m[1] !== undefined) push('comment', m[1]);
    else if (m[2] !== undefined) push(/^\\(begin|end)$/.test(m[2]) ? 'keyword' : 'function', m[2]);
    else if (m[3] !== undefined) push('string', m[3]);
    else if (m[4] !== undefined) push('number', m[4]);
    else push('plain', m[5] ?? m[6]);
  }
  return tokens;
}

/** Pull the first useful line out of a TeX log: the line that starts with "!" plus its line number. */
export function firstTexError(log) {
  const lines = String(log ?? '').split('\n');
  const at = lines.findIndex((l) => l.startsWith('!'));
  if (at < 0) return '';
  const where = lines.slice(at + 1, at + 8).find((l) => /^l\.\d+/.test(l));
  return `${lines[at].slice(1).trim()}${where ? ` (${where.trim()})` : ''}`;
}
