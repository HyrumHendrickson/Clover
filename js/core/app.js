import { TOOLS, TOOL_LIST } from '../tools/index.js';
import { themeColors } from '../lib/viewport.js';
import { showDialog } from './dialog.js';
import { clear, debounce, downloadText, h, slugify, uid } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { store } from './store.js';
import { toast } from './toast.js';
import {
  ImportError,
  MAX_IMPORT_BYTES,
  MAX_TABS,
  VERSION,
  cleanTitle,
  exportTab,
  exportWorkspace,
  normalizeWorkspace,
  parseImport,
  uniqueTitle,
} from './workspace.js';

const BRAND_TITLE = 'Clover \u2014 mathematics workspace';
const FILE_EXTENSION = '.clover';

const dateStamp = () => new Date().toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The Clover application shell: tabs, panels, persistence, import and export. */
export class App {
  constructor(elements) {
    this.el = elements;
    /** @type {{ id: string, type: string, title: string, state: any }[]} */
    this.tabs = [];
    this.activeId = null;
    this.instances = new Map();
    this.panels = new Map();
    this.previews = [];
    this.dragId = null;
    this.warnedStorage = false;
    this.save = debounce(() => this.persistNow(), 300);
  }

  /* ----------------------------------------------------------------- startup */

  init() {
    const { tabs, activeId } = normalizeWorkspace(store.loadWorkspace(), TOOLS, () => uid('tab'));
    this.tabs = tabs;
    this.buildLauncher();
    this.bindShell();
    this.syncThemeButton();
    this.renderTabs();
    if (activeId) this.activate(activeId);
    else this.showLauncher();
  }

  bindShell() {
    const { newTab, exportButton, importButton, importInput, themeButton, helpButton, tablist } = this.el;
    this.el.brand?.addEventListener('click', () => this.showLauncher());
    newTab.append(icon('plus', 16));
    newTab.addEventListener('click', () => openMenu(newTab, this.newTabItems()));
    exportButton.prepend(icon('download', 16));
    exportButton.addEventListener('click', () =>
      openMenu(
        exportButton,
        [
          {
            label: 'Export workspace',
            hint: 'All tabs',
            icon: 'download',
            disabled: this.tabs.length === 0,
            onSelect: () => this.exportWorkspaceFile(),
          },
          {
            label: 'Export this tab',
            icon: 'download',
            disabled: !this.activeId,
            onSelect: () => this.exportTabFile(this.activeId),
          },
        ],
        { align: 'end' },
      ),
    );
    importButton.prepend(icon('upload', 16));
    importButton.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async () => {
      const [file] = importInput.files;
      importInput.value = '';
      if (file) await this.importFile(file);
    });
    themeButton.addEventListener('click', () => this.toggleTheme());
    helpButton.prepend(icon('help', 16));
    helpButton.addEventListener('click', () => this.showHelp());

    tablist.addEventListener('keydown', (event) => this.onTabKeydown(event));
    tablist.addEventListener('dragover', (event) => this.onTabDragOver(event));
    tablist.addEventListener('drop', (event) => this.onTabDrop(event));
    tablist.addEventListener('dragleave', (event) => {
      if (!tablist.contains(event.relatedTarget)) this.clearDropMarks();
    });

    this.bindFileDrop();
    window.addEventListener('pagehide', () => {
      this.save.cancel();
      this.persistNow();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save.cancel();
        this.persistNow();
      }
    });
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (event) => {
      if (!store.loadTheme()) this.applyTheme(event.matches ? 'dark' : 'light', false);
    });
  }

  /* ------------------------------------------------------------------- theme */

  applyTheme(theme, remember = true) {
    document.documentElement.dataset.theme = theme;
    if (remember) store.saveTheme(theme);
    this.syncThemeButton();
    document.dispatchEvent(new CustomEvent('clover:themechange', { detail: { theme } }));
    if (!this.el.launcher.hidden) this.drawPreviews();
  }

  toggleTheme() {
    this.applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  syncThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const button = this.el.themeButton;
    button.replaceChildren(icon(dark ? 'sun' : 'moon', 16));
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  /* ---------------------------------------------------------------- launcher */

  buildLauncher() {
    this.previews = [];
    const cards = TOOL_LIST.map((tool) => {
      const canvas = h('canvas', { class: 'launch-preview', 'aria-hidden': 'true' });
      this.previews.push({ tool, canvas });
      return h(
        'button',
        { class: 'launch-card', type: 'button', onclick: () => this.addTab({ type: tool.type }) },
        canvas,
        h('span', { class: 'launch-name' }, icon(`tool-${tool.type}`, 18), tool.name),
        h('span', { class: 'launch-desc' }, tool.description),
      );
    });
    this.el.launcher.replaceChildren(
      h(
        'div',
        { class: 'launch-inner' },
        h('img', { class: 'launch-logo', src: 'assets/clover-128.png', width: 72, height: 72, alt: '' }),
        h('h1', { class: 'launch-title' }, 'Clover'),
        h(
          'p',
          { class: 'launch-lede' },
          'A workspace for seeing mathematics. Open as many tabs as you like, including several of the same tool. Everything is saved on this device.',
        ),
        h('div', { class: 'launch-grid' }, cards),
        h(
          'p',
          { class: 'launch-foot' },
          'Have a Clover file? ',
          h('button', { class: 'link-button', type: 'button', onclick: () => this.el.importInput.click() }, 'Open it'),
          ' or drop it anywhere on this page.',
        ),
      ),
    );
  }

  drawPreviews() {
    requestAnimationFrame(() => {
      if (this.el.launcher.hidden) return;
      const colors = themeColors();
      for (const { tool, canvas } of this.previews) {
        try {
          tool.preview?.(canvas, colors);
        } catch (error) {
          console.error('Preview failed for', tool.type, error);
        }
      }
    });
  }

  showLauncher() {
    if (this.activeId) this.instances.get(this.activeId)?.onHide?.();
    this.activeId = null;
    for (const panel of this.panels.values()) panel.hidden = true;
    this.el.launcher.hidden = false;
    document.title = BRAND_TITLE;
    this.updateTabSelection();
    this.drawPreviews();
    this.save();
  }

  newTabItems() {
    return [
      ...TOOL_LIST.map((tool) => ({
        label: tool.name,
        icon: `tool-${tool.type}`,
        onSelect: () => this.addTab({ type: tool.type }),
      })),
      { separator: true },
      { label: 'Open Clover file\u2026', icon: 'upload', onSelect: () => this.el.importInput.click() },
    ];
  }

  /* -------------------------------------------------------------------- tabs */

  /**
   * Add a tab. State is normalised by the tool, so partial or untrusted state is safe.
   * @returns the new tab, or null if the tab limit was reached
   */
  addTab({ type, title, state }, { index = this.tabs.length, activate = true } = {}) {
    const tool = TOOLS[type];
    if (!tool) return null;
    if (this.tabs.length >= MAX_TABS) {
      toast(`Close a tab first. Clover keeps up to ${MAX_TABS} tabs open.`, { kind: 'error' });
      return null;
    }
    const tab = {
      id: uid('tab'),
      type,
      title: cleanTitle(title, uniqueTitle(tool.name, this.tabs)),
      state: tool.normalize(state ?? tool.defaultState()),
    };
    this.tabs.splice(Math.min(Math.max(index, 0), this.tabs.length), 0, tab);
    this.renderTabs();
    if (activate) this.activate(tab.id, { focusPanel: true });
    this.save();
    return tab;
  }

  ensureMounted(tab) {
    if (this.instances.has(tab.id)) return;
    const panel = h('section', {
      class: 'panel',
      role: 'tabpanel',
      id: `panel-${tab.id}`,
      'aria-labelledby': `tab-${tab.id}`,
      tabindex: -1,
      hidden: true,
    });
    this.el.panels.append(panel);
    this.panels.set(tab.id, panel);
    const ctx = {
      state: tab.state,
      save: () => this.save(),
      notify: (message, kind = 'info') => toast(message, { kind }),
      title: () => tab.title,
    };
    let instance = {};
    try {
      instance = TOOLS[tab.type].mount(panel, ctx) ?? {};
    } catch (error) {
      console.error(`Could not open ${tab.type}`, error);
      panel.replaceChildren(
        h(
          'div',
          { class: 'panel-error', role: 'alert' },
          h('h2', {}, 'This tab could not be opened'),
          h('p', {}, 'Something went wrong while starting this tool. Your other tabs are not affected.'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.closeTab(tab.id) }, 'Close this tab'),
        ),
      );
    }
    this.instances.set(tab.id, instance);
  }

  activate(id, { focusPanel = false } = {}) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (this.activeId && this.activeId !== id) this.instances.get(this.activeId)?.onHide?.();
    this.activeId = id;
    this.ensureMounted(tab);
    for (const [panelId, panel] of this.panels) panel.hidden = panelId !== id;
    this.el.launcher.hidden = true;
    this.updateTabSelection();
    document.title = `${tab.title} \u00b7 Clover`;
    this.instances.get(id)?.onShow?.();
    if (focusPanel) this.panels.get(id)?.focus({ preventScroll: true });
    this.save();
  }

  updateTabSelection() {
    for (const element of this.el.tablist.children) {
      const selected = element.dataset.id === this.activeId;
      element.setAttribute('aria-selected', String(selected));
      element.tabIndex = selected ? 0 : -1;
      if (selected) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (!this.activeId) {
      const first = this.el.tablist.firstElementChild;
      if (first) first.tabIndex = 0;
    }
  }

  closeTab(id, { undo = true } = {}) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);
    const snapshot = { type: tab.type, title: tab.title, state: structuredClone(tab.state) };
    this.instances.get(id)?.onHide?.();
    this.instances.get(id)?.destroy?.();
    this.instances.delete(id);
    this.panels.get(id)?.remove();
    this.panels.delete(id);
    const wasActive = this.activeId === id;
    this.renderTabs();
    if (wasActive) {
      this.activeId = null;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next) this.activate(next.id);
      else this.showLauncher();
    }
    this.save();
    if (undo) {
      toast(`Closed \u201c${tab.title}\u201d`, {
        actionLabel: 'Undo',
        onAction: () => this.addTab(snapshot, { index }),
      });
    }
  }

  closeOthers(id) {
    for (const tab of [...this.tabs]) if (tab.id !== id) this.closeTab(tab.id, { undo: false });
    toast('Closed the other tabs.');
  }

  duplicateTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = this.tabs[index];
    const base = tab.title.replace(/\s+\d+$/, '');
    this.addTab(
      { type: tab.type, title: uniqueTitle(base, this.tabs), state: structuredClone(tab.state) },
      { index: index + 1 },
    );
  }

  moveTab(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    this.tabs.splice(Math.min(Math.max(toIndex > from ? toIndex - 1 : toIndex, 0), this.tabs.length), 0, tab);
    this.renderTabs();
    this.save();
  }

  renameTab(id) {
    const tab = this.tabs.find((t) => t.id === id);
    const element = this.el.tablist.querySelector(`[data-id="${CSS.escape(id)}"] .tab-title`);
    if (!tab || !element) return;
    const input = h('input', {
      class: 'tab-rename',
      type: 'text',
      value: tab.title,
      maxlength: 60,
      'aria-label': 'Tab name',
    });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        tab.title = cleanTitle(input.value, tab.title);
        if (this.activeId === id) document.title = `${tab.title} \u00b7 Clover`;
        this.save();
      }
      this.renderTabs();
      this.el.tablist.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('dblclick', (event) => event.stopPropagation());
    element.replaceWith(input);
    input.focus();
    input.select();
  }

  renderTabs() {
    const { tablist, tabstrip } = this.el;
    clear(tablist);
    for (const tab of this.tabs) tablist.append(this.buildTab(tab));
    tabstrip.dataset.empty = String(this.tabs.length === 0);
    this.updateTabSelection();
  }

  buildTab(tab) {
    const selected = tab.id === this.activeId;
    const element = h(
      'div',
      {
        class: 'tab',
        role: 'tab',
        id: `tab-${tab.id}`,
        'aria-selected': String(selected),
        'aria-controls': `panel-${tab.id}`,
        tabindex: selected ? 0 : -1,
        draggable: 'true',
        title: tab.title,
        dataset: { id: tab.id },
        onclick: () => this.activate(tab.id),
        ondblclick: () => this.renameTab(tab.id),
        onauxclick: (event) => {
          if (event.button === 1) {
            event.preventDefault();
            this.closeTab(tab.id);
          }
        },
        oncontextmenu: (event) => {
          event.preventDefault();
          this.openTabMenu(tab, { x: event.clientX, y: event.clientY });
        },
        ondragstart: (event) => {
          this.dragId = tab.id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-clover-tab', tab.id);
          element.classList.add('is-dragging');
        },
        ondragend: () => {
          this.dragId = null;
          this.clearDropMarks();
          element.classList.remove('is-dragging');
        },
      },
      icon(`tool-${tab.type}`, 15),
      h('span', { class: 'tab-title' }, tab.title),
      h(
        'button',
        {
          class: 'tab-close',
          type: 'button',
          tabindex: -1,
          'aria-label': `Close ${tab.title}`,
          title: 'Close',
          onclick: (event) => {
            event.stopPropagation();
            this.closeTab(tab.id);
          },
        },
        icon('close', 12),
      ),
    );
    return element;
  }

  openTabMenu(tab, anchor) {
    openMenu(anchor, [
      { label: 'Rename', hint: 'F2', onSelect: () => this.renameTab(tab.id) },
      { label: 'Duplicate', onSelect: () => this.duplicateTab(tab.id) },
      { label: 'Export this tab', icon: 'download', onSelect: () => this.exportTabFile(tab.id) },
      { separator: true },
      { label: 'Close', onSelect: () => this.closeTab(tab.id) },
      { label: 'Close other tabs', disabled: this.tabs.length < 2, onSelect: () => this.closeOthers(tab.id) },
    ]);
  }

  onTabKeydown(event) {
    const tabElement = event.target.closest?.('.tab');
    if (!tabElement) return;
    const id = tabElement.dataset.id;
    const index = this.tabs.findIndex((t) => t.id === id);
    const go = (to) => {
      const target = this.tabs[(to + this.tabs.length) % this.tabs.length];
      if (!target) return;
      event.preventDefault();
      this.activate(target.id);
      this.el.tablist.querySelector(`[data-id="${CSS.escape(target.id)}"]`)?.focus();
    };
    switch (event.key) {
      case 'ArrowRight':
        go(index + 1);
        break;
      case 'ArrowLeft':
        go(index - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(this.tabs.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activate(id, { focusPanel: true });
        break;
      case 'F2':
        event.preventDefault();
        this.renameTab(id);
        break;
      case 'Delete':
        event.preventDefault();
        this.closeTab(id);
        break;
      case 'ContextMenu': {
        event.preventDefault();
        const rect = tabElement.getBoundingClientRect();
        this.openTabMenu(this.tabs[index], { x: rect.left, y: rect.bottom });
        break;
      }
      default:
    }
  }

  /* ------------------------------------------------------------- tab reorder */

  dropIndexFor(clientX) {
    const elements = [...this.el.tablist.children];
    for (let i = 0; i < elements.length; i += 1) {
      const box = elements[i].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) return i;
    }
    return elements.length;
  }

  clearDropMarks() {
    for (const element of this.el.tablist.children) element.classList.remove('drop-before', 'drop-after');
  }

  onTabDragOver(event) {
    if (!this.dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    this.clearDropMarks();
    const index = this.dropIndexFor(event.clientX);
    const children = this.el.tablist.children;
    if (index < children.length) children[index].classList.add('drop-before');
    else children[children.length - 1]?.classList.add('drop-after');
  }

  onTabDrop(event) {
    if (!this.dragId) return;
    event.preventDefault();
    const index = this.dropIndexFor(event.clientX);
    const id = this.dragId;
    this.dragId = null;
    this.clearDropMarks();
    this.moveTab(id, index);
  }

  /* ------------------------------------------------------------- persistence */

  persistNow() {
    const saved = store.saveWorkspace({
      version: VERSION,
      activeId: this.activeId,
      tabs: this.tabs.map(({ id, type, title, state }) => ({ id, type, title, state })),
    });
    if (!saved && !this.warnedStorage) {
      this.warnedStorage = true;
      toast('Clover could not save to this browser (storage may be full or blocked). Use Export to keep your work.', {
        kind: 'error',
        duration: 9000,
      });
    }
  }

  /* ---------------------------------------------------------- export & import */

  exportWorkspaceFile() {
    if (this.tabs.length === 0) {
      toast('Open a tab first, then export.');
      return;
    }
    const data = exportWorkspace({ activeId: this.activeId ?? this.tabs[0].id, tabs: this.tabs });
    downloadText(`clover-workspace-${dateStamp()}${FILE_EXTENSION}`, JSON.stringify(data, null, 2));
    toast(`Exported ${plural(this.tabs.length, 'tab')}.`, { kind: 'success' });
  }

  exportTabFile(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) {
      toast('Open a tab first, then export.');
      return;
    }
    downloadText(`clover-${slugify(tab.title)}${FILE_EXTENSION}`, JSON.stringify(exportTab(tab), null, 2));
    toast(`Exported \u201c${tab.title}\u201d.`, { kind: 'success' });
  }

  bindFileDrop() {
    const overlay = this.el.dropOverlay;
    const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    let depth = 0;
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      overlay.hidden = false;
    });
    window.addEventListener('dragover', (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) overlay.hidden = true;
    });
    window.addEventListener('drop', async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      overlay.hidden = true;
      const [file] = event.dataTransfer.files;
      if (file) await this.importFile(file);
    });
  }

  snapshot() {
    return {
      tabs: this.tabs.map(({ type, title, state }) => ({ type, title, state: structuredClone(state) })),
      activeIndex: Math.max(
        0,
        this.tabs.findIndex((t) => t.id === this.activeId),
      ),
    };
  }

  teardown() {
    for (const instance of this.instances.values()) {
      instance.onHide?.();
      instance.destroy?.();
    }
    for (const panel of this.panels.values()) panel.remove();
    this.instances.clear();
    this.panels.clear();
    this.tabs = [];
    this.activeId = null;
  }

  loadTabs(entries, activeIndex = 0) {
    this.teardown();
    this.tabs = entries.slice(0, MAX_TABS).map((entry) => ({
      id: uid('tab'),
      type: entry.type,
      title: cleanTitle(entry.title, TOOLS[entry.type].name),
      state: TOOLS[entry.type].normalize(entry.state),
    }));
    this.renderTabs();
    const active = this.tabs[Math.min(activeIndex, this.tabs.length - 1)];
    if (active) this.activate(active.id);
    else this.showLauncher();
    this.save();
  }

  async importFile(file) {
    if (file.size > MAX_IMPORT_BYTES) {
      toast('That file is too large to be a Clover file.', { kind: 'error' });
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      toast('The file could not be read.', { kind: 'error' });
      return;
    }
    let result;
    try {
      result = parseImport(text, TOOLS, () => uid('tab'));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      toast(error.message, { kind: 'error', duration: 8000 });
      return;
    }
    const hasPython = (list) => list.some((t) => t.type === 'python');
    const codeNote = (list) => (hasPython(list) ? ' Python code in the file does not run until you press Run.' : '');

    if (result.kind === 'tab') {
      const tab = this.addTab(result.tab);
      if (tab) toast(`Opened \u201c${tab.title}\u201d.${codeNote([tab])}`, { kind: 'success' });
      return;
    }

    const entries = result.tabs;
    const describe = `${plural(entries.length, 'tab')}: ${entries
      .map((t) => t.title)
      .slice(0, 6)
      .join(', ')}${entries.length > 6 ? ', \u2026' : ''}.`;
    if (this.tabs.length === 0) {
      this.loadTabs(entries, result.activeIndex);
      toast(`Opened ${plural(entries.length, 'tab')}.${codeNote(entries)}`, { kind: 'success' });
      return;
    }
    const choice = await showDialog({
      title: 'Open this workspace?',
      body: [
        h('p', {}, `The file contains ${describe}`),
        h('p', {}, 'You can replace your current workspace, or add these tabs to it.'),
        hasPython(entries)
          ? h(
              'p',
              { class: 'dialog-note' },
              'Python code in the file never runs automatically. It runs only when you press Run, and in a sandbox.',
            )
          : null,
      ],
      actions: [
        { label: 'Cancel', value: null, kind: 'quiet' },
        { label: 'Add tabs', value: 'add' },
        { label: 'Replace workspace', value: 'replace', kind: 'primary' },
      ],
    });
    if (choice === 'replace') {
      const previous = this.snapshot();
      this.loadTabs(entries, result.activeIndex);
      toast(`Replaced your workspace with ${plural(entries.length, 'tab')}.`, {
        actionLabel: 'Undo',
        onAction: () => this.loadTabs(previous.tabs, previous.activeIndex),
      });
    } else if (choice === 'add') {
      let added = 0;
      for (const entry of entries) {
        if (this.addTab(entry, { activate: added === 0 })) added += 1;
        else break;
      }
      toast(`Added ${plural(added, 'tab')}.${codeNote(entries)}`, { kind: added ? 'success' : 'error' });
    }
  }

  /* -------------------------------------------------------------------- help */

  showHelp() {
    const section = (title, ...children) => h('section', { class: 'help-section' }, h('h3', {}, title), ...children);
    showDialog({
      title: 'About Clover',
      wide: true,
      body: [
        h('p', {}, 'Clover is a workspace for visualising mathematics. It runs entirely in your browser.'),
        section(
          'Tools',
          h(
            'ul',
            {},
            TOOL_LIST.map((tool) => h('li', {}, h('strong', {}, tool.name), ` \u2013 ${tool.description}`)),
          ),
        ),
        section(
          'Tabs',
          h(
            'ul',
            {},
            h('li', {}, 'Use the plus button to open a tool. Open the same tool in as many tabs as you like.'),
            h(
              'li',
              {},
              'Double-click a tab (or press F2) to rename it. Right-click for more actions. Drag to reorder.',
            ),
            h(
              'li',
              {},
              'With a tab focused: Left and Right arrows switch tabs, Delete closes, and closing can be undone.',
            ),
          ),
        ),
        section(
          'Saving and sharing',
          h(
            'ul',
            {},
            h(
              'li',
              {},
              'Your tabs are saved automatically in this browser (local storage). Nothing is sent to a server.',
            ),
            h(
              'li',
              {},
              `Export saves the workspace or one tab as a ${FILE_EXTENSION} file. Send it to anyone; they open it with Import or by dropping it on the page, and see what you saw.`,
            ),
            h('li', {}, 'Clearing site data removes the saved workspace, so export anything you want to keep.'),
          ),
        ),
        section(
          'Plots',
          h(
            'ul',
            {},
            h(
              'li',
              {},
              'Drag to pan, scroll or pinch to zoom, double-click to reset. With a plot focused: arrow keys pan, plus and minus zoom, and 0 resets.',
            ),
            h(
              'li',
              {},
              'Expressions use + - * / ^ and functions such as sin(x), exp(x), sqrt(x). Implicit products like 2x are allowed.',
            ),
          ),
        ),
      ],
      actions: [{ label: 'Close', value: true, kind: 'primary' }],
    });
  }
}
