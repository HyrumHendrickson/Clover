/**
 * Workspace model, persistence format, and import/export validation.
 *
 * This module is pure (no DOM access) so it can be unit tested in Node.
 *
 * In memory:   { activeId, tabs: [{ id, type, title, state }] }
 * On disk:     { format: "clover", version, kind: "workspace" | "tab", ... }
 *
 * Version history:
 *   1  first release; the "desmos" tool embedded a Desmos calculator.
 *   2  the "graph" tool replaces "desmos". Version 1 "desmos" tabs are migrated.
 *   3  the "matrix" tool holds named lines (matrices and calculations) instead of a fixed A, B,
 *      and x; older matrix state is converted by that tool's normalize. The notebook gains "embed"
 *      cells, and the "geometry" tool is new.
 *   4  graph rows gain folders, styles, and tables; the "stats" tool is new.
 *   5  the "fractals", "automata", "latex", and "maxima" tools are new, and the notebook gains "code" and
 *      "pycanvas" cells. Older files open unchanged.
 */

export const FORMAT = 'clover';
export const VERSION = 5;
export const MAX_TABS = 24;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_TITLE = 60;

export class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImportError';
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deep-copy JSON-compatible data, dropping keys that could pollute prototypes
 * and anything that is not plain JSON. Depth and size are bounded.
 */
export function sanitizeJson(value, depth = 0) {
  if (depth > 12) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 5000).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).slice(0, 500)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      out[key] = sanitizeJson(value[key], depth + 1);
    }
    return out;
  }
  return null;
}

export function cleanTitle(title, fallback) {
  const text = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
  return text || fallback;
}

const LEGACY_GRAPH_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Version 1 tabs of type "desmos" embedded a calculator that Clover could not read.
 * They become empty graphs; a saved share link is kept as a note so nothing is lost.
 */
function migrateLegacyTab(raw) {
  if (raw.type !== 'desmos') return raw;
  const id = raw.state && typeof raw.state.graphId === 'string' ? raw.state.graphId : '';
  const rows = LEGACY_GRAPH_ID.test(id)
    ? [
        { kind: 'note', text: `Saved Desmos graph from an earlier version: https://www.desmos.com/calculator/${id}` },
        { kind: 'expr', text: '' },
      ]
    : [];
  return { type: 'graph', title: raw.title === 'Desmos' ? undefined : raw.title, state: { rows } };
}

/**
 * @typedef {{ type: string, name: string, normalize: (raw: any) => any }} ToolInfo
 * @param {Record<string, ToolInfo>} tools
 */
export function normalizeTab(input, tools, newId) {
  if (!input || typeof input !== 'object') return null;
  const raw = migrateLegacyTab(input);
  const tool = Object.hasOwn(tools, raw.type) ? tools[raw.type] : null;
  if (!tool) return null;
  const state = tool.normalize(sanitizeJson(raw.state ?? {}));
  return { id: newId(), type: tool.type, title: cleanTitle(raw.title, tool.name), state };
}

/** Rebuild a workspace from persisted or imported data, discarding anything invalid. */
export function normalizeWorkspace(raw, tools, newId, activeIndex = null) {
  const list = raw && Array.isArray(raw.tabs) ? raw.tabs.slice(0, MAX_TABS) : [];
  const tabs = [];
  let byIndex = null;
  let byId = null;
  list.forEach((entry, position) => {
    const tab = normalizeTab(entry, tools, newId);
    if (!tab) return;
    tabs.push(tab);
    if (position === activeIndex) byIndex = tab.id;
    if (raw.activeId && entry.id === raw.activeId) byId = tab.id;
  });
  return { activeId: byIndex ?? byId ?? tabs[0]?.id ?? null, tabs };
}

/** Serialise a whole workspace to the shareable file format (no internal ids). */
export function exportWorkspace(workspace, now = new Date()) {
  const activeIndex = Math.max(
    0,
    workspace.tabs.findIndex((t) => t.id === workspace.activeId),
  );
  return {
    format: FORMAT,
    version: VERSION,
    kind: 'workspace',
    exportedAt: now.toISOString(),
    workspace: {
      activeIndex,
      tabs: workspace.tabs.map(({ type, title, state }) => ({ type, title, state })),
    },
  };
}

/** Serialise a single tab to the shareable file format. */
export function exportTab(tab, now = new Date()) {
  return {
    format: FORMAT,
    version: VERSION,
    kind: 'tab',
    exportedAt: now.toISOString(),
    tab: { type: tab.type, title: tab.title, state: tab.state },
  };
}

/**
 * Parse and validate imported file text.
 * @returns {{ kind: 'workspace', tabs: object[], activeIndex: number } | { kind: 'tab', tab: object }}
 * @throws {ImportError} with a message suitable for display
 */
export function parseImport(text, tools, newId) {
  if (typeof text !== 'string' || text.length === 0) throw new ImportError('The file is empty.');
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('The file is too large to import.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON, so it cannot be a Clover file.');
  }
  if (!data || typeof data !== 'object' || data.format !== FORMAT) {
    throw new ImportError('This is not a Clover file.');
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new ImportError('The file has no valid version number.');
  }
  if (data.version > VERSION) {
    throw new ImportError(
      `The file was made by a newer version of Clover (format ${data.version}). Update Clover to open it.`,
    );
  }
  if (data.kind === 'tab') {
    const tab = normalizeTab(data.tab, tools, newId);
    if (!tab) throw new ImportError('The tab in this file uses a tool this version of Clover does not have.');
    return { kind: 'tab', tab };
  }
  if (data.kind === 'workspace') {
    const raw = data.workspace;
    const { tabs, activeId } = normalizeWorkspace(raw, tools, newId, raw?.activeIndex);
    if (tabs.length === 0)
      throw new ImportError('The workspace in this file has no tabs this version of Clover can open.');
    return {
      kind: 'workspace',
      tabs,
      activeIndex: Math.max(
        0,
        tabs.findIndex((t) => t.id === activeId),
      ),
    };
  }
  throw new ImportError('The file does not say whether it holds a workspace or a tab.');
}

/** Suggest a title that does not collide with existing tab titles. */
export function uniqueTitle(base, tabs) {
  const taken = new Set(tabs.map((t) => t.title));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}
