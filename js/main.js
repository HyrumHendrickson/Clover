import { App } from './core/app.js';
import { applyEmbedMode, connectToHost } from './core/embed.js';
import { readEmbedConfig } from './lib/embedcode.js';
import { TOOL_LIST } from './tools/index.js';

const byId = (id) => document.getElementById(id);

const embed = readEmbedConfig(
  window.location.search,
  TOOL_LIST.map((tool) => tool.type),
);
if (embed) applyEmbedMode(embed);

const app = new App(
  {
    brand: byId('brand-button'),
    tabstrip: byId('tabstrip'),
    tablist: byId('tablist'),
    panels: byId('panels'),
    launcher: byId('launcher'),
    newTab: byId('new-tab'),
    exportButton: byId('export-button'),
    importButton: byId('import-button'),
    importInput: byId('import-input'),
    themeButton: byId('theme-button'),
    helpButton: byId('help-button'),
    dropOverlay: byId('drop-overlay'),
  },
  embed ? { tools: embed.tools, single: embed.single, persist: embed.persist, storageKey: embed.storageKey } : {},
);

app.init();

if (embed) {
  if (embed.theme) {
    app.themeLocked = true;
    app.applyTheme(embed.theme, false);
  }
  connectToHost(app);
}
