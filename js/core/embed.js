/**
 * Embed mode: when Clover is shown inside another page, this reads the frame's address, starts the app to match,
 * and answers the few messages the embedding page may send. See docs/embedding.md.
 *
 * Messages to the frame (all objects with a string `type`; the sender must be the parent window):
 *   { type: 'clover:load', text }     open the text of a .clover file (validated exactly like Import)
 *   { type: 'clover:theme', theme }   'light' or 'dark'
 *   { type: 'clover:open', tool }     open a tool in a new tab (not in single-tool mode)
 *   { type: 'clover:export' }         ask for the current work
 * Messages from the frame, to the parent:
 *   { type: 'clover:ready', tools }   the app has started
 *   { type: 'clover:loaded', ok, message? }
 *   { type: 'clover:export', text }   the current work as .clover file text
 */
import { MAX_IMPORT_BYTES } from './workspace.js';

/** Set the page up for embedding: marks the document so embed.css can hide the page chrome. */
export function applyEmbedMode(config) {
  document.documentElement.dataset.embed = config.single ? 'tool' : 'full';
}

/**
 * Listen to the embedding page. Does nothing when Clover is not inside a frame.
 * @returns {() => void} stops listening
 */
export function connectToHost(app, { parent = window.parent } = {}) {
  if (!parent || parent === window) return () => {};
  const send = (message) => parent.postMessage(message, '*');
  const onMessage = (event) => {
    if (event.source !== parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    switch (data.type) {
      case 'clover:load':
        if (typeof data.text !== 'string' || data.text.length > MAX_IMPORT_BYTES) {
          send({ type: 'clover:loaded', ok: false, message: 'The file text is missing or too large.' });
          return;
        }
        send({ type: 'clover:loaded', ...app.applyExternal(data.text) });
        break;
      case 'clover:theme':
        if (data.theme === 'light' || data.theme === 'dark') {
          app.themeLocked = true;
          app.applyTheme(data.theme, false);
        }
        break;
      case 'clover:open':
        if (typeof data.tool === 'string') app.openTool(data.tool);
        break;
      case 'clover:export':
        send({ type: 'clover:export', text: app.exportText() });
        break;
      default:
    }
  };
  window.addEventListener('message', onMessage);
  send({ type: 'clover:ready', tools: app.toolList.map((tool) => tool.type) });
  return () => window.removeEventListener('message', onMessage);
}
