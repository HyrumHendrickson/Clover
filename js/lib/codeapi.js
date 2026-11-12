/**
 * Talking to a Judge0-compatible code execution service. Pure (no DOM), so it is unit tested with a fake `fetch`.
 * The Programming tab never calls this directly: it runs inside `runner/code.html`, a sandboxed frame with its
 * own CSP, so the main page keeps `connect-src 'self'`.
 *
 * Language ids differ between Judge0 hosts and change when a host upgrades. Nothing here hard-codes them;
 * `pickLanguages` reads the host's own `/languages` list and takes the newest entry for each language.
 */

/** The public community instance. Best effort and rate limited: see docs/programming.md to use your own. */
export const DEFAULT_ENDPOINT = 'https://ce.judge0.com';

export const MAX_SOURCE = 50_000;
export const MAX_STDIN = 10_000;
export const MAX_OUTPUT = 50_000;
export const POLL_TIMEOUT_MS = 45_000;

/** The languages the tab offers, in menu order. `file` is the name shown in the editor header. */
export const LANGUAGES = [
  { id: 'python', label: 'Python', file: 'main.py' },
  { id: 'rust', label: 'Rust', file: 'main.rs' },
  { id: 'c', label: 'C', file: 'main.c' },
  { id: 'cpp', label: 'C++', file: 'main.cpp' },
  { id: 'java', label: 'Java', file: 'Main.java' },
];

export const LANGUAGE_IDS = LANGUAGES.map((l) => l.id);

/**
 * Patterns for the names Judge0 gives its languages, such as "C (GCC 9.2.0)" or "Rust (1.40.0)".
 * The first pattern that matches anything wins, so GCC is preferred to Clang. Test, MPI, and "for ML"
 * variants do not match any of these.
 */
const NAME_PATTERNS = {
  python: [/^Python \((3\.[\d.]+)\)$/],
  rust: [/^Rust \(([\d.]+)\)$/],
  c: [/^C \(GCC ([\d.]+)\)$/, /^C \(Clang ([\d.]+)\)$/],
  cpp: [/^C\+\+ \(GCC ([\d.]+)\)$/, /^C\+\+ \(Clang ([\d.]+)\)$/],
  java: [/^Java \(OpenJDK ([\d.]+)\)$/],
};

/** Compare dotted versions numerically: 14.1.0 is newer than 9.2.0. */
export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Choose a Judge0 language for each of ours from the host's `/languages` list.
 * @param {unknown} list the parsed JSON, expected `[{ id, name }]`
 * @returns {Record<string, { id: number, name: string }>} only the languages the host has
 */
export function pickLanguages(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  const entries = list.filter(
    (e) => e && Number.isInteger(e.id) && e.id > 0 && typeof e.name === 'string' && e.name.length < 120,
  );
  for (const [language, patterns] of Object.entries(NAME_PATTERNS)) {
    for (const pattern of patterns) {
      let best = null;
      for (const entry of entries) {
        const m = pattern.exec(entry.name);
        if (m && (!best || compareVersions(m[1], best.version) > 0)) best = { version: m[1], entry };
      }
      if (best) {
        out[language] = { id: best.entry.id, name: best.entry.name };
        break;
      }
    }
  }
  return out;
}

/**
 * A usable service address, or null. Only https is accepted, plus http on this machine for local development.
 * Credentials in the address are refused so they cannot end up in a saved or shared file.
 */
export function cleanEndpoint(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** UTF-8 text to base64, which is how Judge0 accepts source code that may hold any character. */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Base64 from Judge0 back to text. Bytes that are not valid UTF-8 become U+FFFD instead of failing. */
export function fromBase64(value) {
  if (typeof value !== 'string' || value === '') return '';
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

export class RunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunError';
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new RunError('Stopped.'));
      },
      { once: true },
    );
  });

async function readJson(response, what) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return body;
  if (response.status === 429) {
    throw new RunError('The run service is busy or has limited this connection. Wait a minute and try again.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new RunError('The run service refused the request. It may need a key; see docs/programming.md.');
  }
  if (response.status === 503) throw new RunError('The run service queue is full. Try again in a moment.');
  const detail = body && typeof body === 'object' ? JSON.stringify(body).slice(0, 200) : '';
  throw new RunError(`The run service could not ${what} (HTTP ${response.status}). ${detail}`.trim());
}

/** Fetch and pick the host's languages. */
export async function loadLanguages(fetchImpl, endpoint, signal) {
  let response;
  try {
    response = await fetchImpl(`${endpoint}/languages`, { signal });
  } catch (error) {
    if (error instanceof RunError || error?.name === 'AbortError') throw new RunError('Stopped.');
    throw new RunError(`Could not reach ${new URL(endpoint).host}. Check your connection, then try again.`);
  }
  return pickLanguages(await readJson(response, 'list its languages'));
}

/**
 * Submit a program and wait for the result by polling. `wait=true` is not used because hosts may turn it off.
 * @returns {Promise<{ statusId: number, status: string, stdout: string, stderr: string, compile: string,
 *   message: string, time: string | null, memory: number | null }>}
 */
export async function runProgram({ fetchImpl, endpoint, languageId, code, stdin = '', signal, onStatus = () => {} }) {
  const guard = (error) => {
    if (error instanceof RunError) throw error;
    if (error?.name === 'AbortError') throw new RunError('Stopped.');
    throw new RunError(`Could not reach ${new URL(endpoint).host}. Check your connection, then try again.`);
  };
  onStatus('Sending your code\u2026');
  let token;
  try {
    const response = await fetchImpl(`${endpoint}/submissions?base64_encoded=true&wait=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language_id: languageId,
        source_code: toBase64(code.slice(0, MAX_SOURCE)),
        stdin: toBase64(stdin.slice(0, MAX_STDIN)),
      }),
      signal,
    });
    const body = await readJson(response, 'accept the program');
    token = body?.token;
  } catch (error) {
    guard(error);
  }
  if (typeof token !== 'string' || !/^[\w-]{8,64}$/.test(token))
    throw new RunError('The run service sent an unexpected reply.');

  const fields = 'stdout,stderr,compile_output,message,status,time,memory';
  const started = Date.now();
  let delay = 500;
  for (;;) {
    let body;
    try {
      const response = await fetchImpl(`${endpoint}/submissions/${token}?base64_encoded=true&fields=${fields}`, {
        signal,
      });
      body = await readJson(response, 'report the result');
    } catch (error) {
      guard(error);
    }
    const id = body?.status?.id;
    if (!Number.isInteger(id)) throw new RunError('The run service sent an unexpected reply.');
    if (id > 2) return normalizeResult(body);
    onStatus(id === 1 ? 'Waiting in the queue\u2026' : 'Compiling and running\u2026');
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new RunError('The run service took too long to answer. Try again, or use a smaller program.');
    }
    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, 2000);
  }
}

const clip = (text) =>
  text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n\u2026 output cut at ${MAX_OUTPUT} characters` : text;

/** A finished submission with its base64 text decoded and trimmed. */
export function normalizeResult(body) {
  const time = typeof body.time === 'string' || typeof body.time === 'number' ? String(body.time).slice(0, 12) : null;
  return {
    statusId: body.status.id,
    status: typeof body.status.description === 'string' ? body.status.description.slice(0, 80) : '',
    stdout: clip(fromBase64(body.stdout)),
    stderr: clip(fromBase64(body.stderr)),
    compile: clip(fromBase64(body.compile_output)),
    message: clip(fromBase64(body.message)),
    time,
    memory: Number.isFinite(body.memory) ? body.memory : null,
  };
}

/**
 * How to show a result: whether it succeeded, the sections to print, and one line for the status bar.
 * @returns {{ ok: boolean, sections: { kind: 'compile' | 'stdout' | 'stderr' | 'message', text: string }[], summary: string }}
 */
export function describeResult(result) {
  const sections = [];
  const add = (kind, text) => {
    if (text && text.trim() !== '') sections.push({ kind, text });
  };
  add('compile', result.compile);
  add('stdout', result.stdout);
  add('stderr', result.stderr);
  // Judge0 puts the sandbox's reason here ("Exited with error status 1"); it only helps when the run failed.
  if (result.statusId !== 3) add('message', result.message);
  const ok = result.statusId === 3;
  const parts = [ok ? 'Finished' : result.status || 'Stopped'];
  if (result.time !== null) parts.push(`${result.time} s`);
  if (result.memory !== null) parts.push(`${Math.round(result.memory / 1024)} MB`);
  if (ok && sections.length === 0) parts.push('no output');
  return { ok, sections, summary: parts.join(' \u00b7 ') };
}

/**
 * Re-check a result that arrived from the runner frame before showing it. The frame is isolated, but anything
 * that crosses `postMessage` is treated as untrusted data.
 * @returns the same shape as `normalizeResult` plus `language`, or null when the shape is wrong
 */
export function parseResult(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.statusId)) return null;
  const text = (value) => (typeof value === 'string' ? clip(value) : '');
  return {
    statusId: raw.statusId,
    status: typeof raw.status === 'string' ? raw.status.slice(0, 80) : '',
    stdout: text(raw.stdout),
    stderr: text(raw.stderr),
    compile: text(raw.compile),
    message: text(raw.message),
    time: typeof raw.time === 'string' ? raw.time.slice(0, 12) : null,
    memory: Number.isFinite(raw.memory) ? raw.memory : null,
    language: typeof raw.language === 'string' ? raw.language.slice(0, 80) : '',
  };
}
