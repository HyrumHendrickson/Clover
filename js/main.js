import { App } from './core/app.js';

const byId = (id) => document.getElementById(id);

const app = new App({
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
});

app.init();
