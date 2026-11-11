/**
 * Late-bound lookup of every tool, so a tool (the notebook) can embed the others
 * without importing them, which would be a cycle: `index.js` imports the notebook.
 */
let tools = {};

/** Called once by `index.js` with every tool, keyed by type. */
export function registerTools(map) {
  tools = map;
}

/** The tool for `type`, or null. Never reads inherited properties. */
export function getTool(type) {
  return typeof type === 'string' && Object.hasOwn(tools, type) ? tools[type] : null;
}

/** Tools that can be embedded in a notebook cell: everything except the notebook itself. */
export function embeddableTools() {
  return Object.values(tools).filter((tool) => tool.type !== 'notebook');
}
