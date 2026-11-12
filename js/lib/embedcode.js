/**
 * Embedding Clover in another page. Pure (no DOM), so it is unit tested.
 *
 * Embed mode is chosen by the address of the frame: `?embed=1` shows the whole workspace without the page chrome
 * around it; adding `tool=<type>` shows one tool and nothing else; `tools=a,b` limits the launcher and the new-tab
 * menu to those tools. `theme`, `persist`, and `id` are described in docs/embedding.md.
 */

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const THEMES = ['light', 'dark'];

/**
 * Read embed settings from a query string.
 * @param {string} search for example `location.search`
 * @param {string[]} toolTypes every tool type this build has
 * @returns {null | { single: string | null, tools: string[] | null, theme: 'light' | 'dark' | null,
 *   persist: boolean, storageKey: string }} null when the page is not embedded
 */
export function readEmbedConfig(search, toolTypes) {
  const params = new URLSearchParams(search);
  if (!params.has('embed') || ['0', 'false'].includes(params.get('embed'))) return null;
  const known = new Set(toolTypes);
  const tool = params.get('tool');
  const single = tool && known.has(tool) ? tool : null;
  const listed = (params.get('tools') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => known.has(t));
  const tools = single ? null : listed.length > 0 ? [...new Set(listed)] : null;
  const theme = THEMES.includes(params.get('theme')) ? params.get('theme') : null;
  const persist = params.get('persist') === '1' || params.get('persist') === 'true';
  const id = params.get('id');
  const name = id && ID.test(id) ? id : (single ?? 'all');
  return { single, tools, theme, persist, storageKey: `clover:embed:v1:${name}` };
}

const escapeAttribute = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The address of the embedded frame.
 * @param {string} base where Clover is served, with a trailing slash
 * @param {{ tool?: string, tools?: string[], theme?: string, persist?: boolean, id?: string }} [options]
 */
export function buildEmbedUrl(base, { tool, tools, theme, persist, id } = {}) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('embed', '1');
  if (tool) url.searchParams.set('tool', tool);
  else if (tools?.length) url.searchParams.set('tools', tools.join(','));
  if (THEMES.includes(theme)) url.searchParams.set('theme', theme);
  if (persist) url.searchParams.set('persist', '1');
  if (id && ID.test(id)) url.searchParams.set('id', id);
  return url.href;
}

/**
 * Text to paste into a web page.
 * @param {{ base: string, tool?: string, style?: 'iframe' | 'element', title?: string, height?: number }} options
 *   `element` needs `embed.js` from the same place as Clover, and adds loading a saved file and a small scripting API.
 */
export function embedSnippet({ base, tool, style = 'iframe', title = 'Clover', height = 600 }) {
  const h = Math.max(200, Math.min(2000, Math.round(Number(height)) || 600));
  if (style === 'element') {
    const script = new URL('embed.js', base).href;
    const attrs = tool ? ` tool="${escapeAttribute(tool)}"` : '';
    return `<script src="${escapeAttribute(script)}" async></script>\n<clover-embed${attrs} height="${h}"></clover-embed>`;
  }
  const src = buildEmbedUrl(base, { tool });
  return [
    '<iframe',
    `  src="${escapeAttribute(src)}"`,
    `  title="${escapeAttribute(title)}"`,
    '  width="100%"',
    `  height="${h}"`,
    '  style="border: 0"',
    '  loading="lazy"',
    '  allow="clipboard-write; fullscreen"',
    '  sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"',
    '></iframe>',
  ].join('\n');
}

/** Where Clover is served from the current page: the folder that holds index.html, with a trailing slash. */
export function baseFromLocation(href) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/[^/]*$/, '');
  return url.href;
}

/** Messages the frame accepts from the page that embeds it (see docs/embedding.md). */
export const HOST_MESSAGES = ['clover:load', 'clover:theme', 'clover:open', 'clover:export'];
