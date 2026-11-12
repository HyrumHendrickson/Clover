/*
 * Clover code runner: sends a program to a Judge0-compatible service and reports the result.
 * Loaded in a sandboxed iframe with an opaque origin (see code.html).
 *
 * Protocol (postMessage):
 *   parent -> runner   { type: 'run', id, endpoint, language, code, stdin }
 *   runner -> parent   { type: 'ready' }
 *                      { type: 'status', id, text }
 *                      { type: 'result', id, result }   result as returned by `normalizeResult`
 *                      { type: 'error', id, message }
 * Removing the frame is how the parent stops a run: the pending requests die with it.
 */
import {
  LANGUAGE_IDS,
  MAX_SOURCE,
  MAX_STDIN,
  RunError,
  cleanEndpoint,
  loadLanguages,
  runProgram,
} from '../js/lib/codeapi.js';

const post = (message) => window.parent.postMessage(message, '*');

/** Languages by host, so a second run does not ask again. */
const known = new Map();
let busy = false;

async function run({ id, endpoint, language, code, stdin }) {
  const host = cleanEndpoint(endpoint);
  if (!host) throw new RunError('The run service address is not valid.');
  if (!LANGUAGE_IDS.includes(language)) throw new RunError('That language is not supported.');
  if (typeof code !== 'string' || code.trim() === '') throw new RunError('Write some code first.');
  const input = typeof stdin === 'string' ? stdin.slice(0, MAX_STDIN) : '';

  const status = (text) => post({ type: 'status', id, text });
  if (!known.has(host)) {
    status('Contacting the run service\u2026');
    known.set(host, await loadLanguages(fetch.bind(window), host));
  }
  const chosen = known.get(host)[language];
  if (!chosen) {
    known.delete(host);
    throw new RunError(`The run service at ${new URL(host).host} does not offer this language.`);
  }
  const result = await runProgram({
    fetchImpl: fetch.bind(window),
    endpoint: host,
    languageId: chosen.id,
    code: code.slice(0, MAX_SOURCE),
    stdin: input,
    onStatus: status,
  });
  post({ type: 'result', id, result: { ...result, language: chosen.name } });
}

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== 'run' || busy) return;
  busy = true;
  try {
    await run(data);
  } catch (error) {
    post({
      type: 'error',
      id: data.id,
      message: error instanceof RunError ? error.message : 'Something went wrong while running the program.',
    });
  } finally {
    busy = false;
  }
});

post({ type: 'ready' });
