import { TOOL_LIST } from '../tools/index.js';
import { themeColors } from '../lib/viewport.js';
import { showDialog } from './dialog.js';
import { clear, debounce, downloadText, h, slugify, uid } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { store } from './store.js';
import { baseFromLocation, embedSnippet } from '../lib/embedcode.js';
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

/** Launcher sections, in display order. Tools missing from every list fall into the last one. */
const LAUNCH_GROUPS = [
  { title: 'Plot and draw', types: ['graph', 'graph3d', 'geometry', 'vector', 'complex', 'fractals'] },
  { title: 'Calculate and analyse', types: ['matrix', 'maxima', 'stats', 'probability', 'finance'] },
  { title: 'Write and code', types: ['notebook', 'latex', 'python', 'programming', 'automata'] },
];
const OTHER_GROUP = 'More tools';
const dateStamp = () => new Date().toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The Clover application shell: tabs, panels, persistence, import and export. */
export class App {
  /**
   * @param {object} elements the shell's DOM elements
   * @param {{ tools?: string[] | null, single?: string | null, persist?: boolean, storageKey?: string }} [options]
   *   Used when Clover is embedded in another page. `tools` limits which tools can be opened, `single` shows one
   *   tool and nothing else, and `persist: false` keeps work in memory only. `storageKey` names where to save.
   */
  constructor(elements, options = {}) {
    this.el = elements;
    const only = TOOL_LIST.some((tool) => tool.type === options.single) ? [options.single] : null;
    const allowed = only ?? (Array.isArray(options.tools) ? options.tools : null);
    /** The tools this instance can open, in launcher order. */
    this.toolList = allowed ? TOOL_LIST.filter((tool) => allowed.includes(tool.type)) : TOOL_LIST;
    this.tools = Object.fromEntries(this.toolList.map((tool) => [tool.type, tool]));
    this.single = options.single && Object.hasOwn(this.tools, options.single) ? options.single : null;
    this.persist = options.persist !== false;
    this.storageKey = options.storageKey;
    this.themeLocked = false;
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
    const saved = this.persist ? store.loadWorkspace(this.storageKey) : null;
    const { tabs, activeId } = normalizeWorkspace(saved, this.tools, () => uid('tab'));
    if (this.single) {
      // One tool, one tab: keep the saved one if there is one, otherwise start fresh.
      const tool = this.tools[this.single];
      const kept = tabs.find((t) => t.type === this.single);
      this.tabs = [
        kept ?? { id: uid('tab'), type: tool.type, title: tool.name, state: tool.normalize(tool.defaultState()) },
      ];
      this.buildLauncher();
      this.bindShell();
      this.syncThemeButton();
      this.renderTabs();
      this.activate(this.tabs[0].id);
      return;
    }
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
          { separator: true },
          {
            label: 'Embed on a website\u2026',
            hint: 'Whole site or one tool',
            icon: 'external',
            onSelect: () => this.showEmbedDialog(),
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
    tablist.addEventListener('scroll', () => this.updateTabOverflow(), { passive: true });
    // A mouse wheel turns sideways over the tab strip, which otherwise has no visible scrollbar.
    tablist.addEventListener(
      'wheel',
      (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || tablist.scrollWidth <= tablist.clientWidth) return;
        event.preventDefault();
        tablist.scrollLeft += event.deltaY;
      },
      { passive: false },
    );
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.updateTabOverflow()).observe(tablist);
    window.addEventListener(
      'resize',
      debounce(() => {
        if (!this.el.launcher.hidden) this.drawPreviews();
      }, 150),
    );
    tablist.addEventListener('dragover', (event) => this.onTabDragOver(event));
    tablist.addEventListener('drop', (event) => this.onTabDrop(event));
    tablist.addEventListener('dragleave', (event) => {
      if (!tablist.contains(event.relatedTarget)) this.clearDropMarks();
    });

    this.onHelpShortcut = (event) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog'))
        return;
      if (document.querySelector('dialog[open]') || helpButton.offsetParent === null) return;
      event.preventDefault();
      this.showHelp();
    };
    document.addEventListener('keydown', this.onHelpShortcut);

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
      if (!this.themeLocked && (!this.persist || !store.loadTheme())) {
        this.applyTheme(event.matches ? 'dark' : 'light', false);
      }
    });
  }

  /* ------------------------------------------------------------------- theme */

  applyTheme(theme, remember = this.persist) {
    document.documentElement.dataset.theme = theme;
    if (remember) store.saveTheme(theme);
    this.syncThemeButton();
    document.dispatchEvent(new CustomEvent('clover:themechange', { detail: { theme } }));
    if (!this.el.launcher.hidden) this.drawPreviews();
  }

  toggleTheme() {
    this.themeLocked = true;
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
    const makeCard = (tool) => {
      const canvas = h('canvas', { class: 'launch-preview', 'aria-hidden': 'true' });
      this.previews.push({ tool, canvas });
      const element = h(
        'button',
        { class: 'launch-card', type: 'button', onclick: () => this.addTab({ type: tool.type }) },
        canvas,
        h('span', { class: 'launch-name' }, icon(`tool-${tool.type}`, 18), tool.name),
        h('span', { class: 'launch-desc' }, tool.description),
      );
      return element;
    };

    const placed = new Set();
    const sections = [];
    const addSection = (title, tools) => {
      if (tools.length === 0) return;
      const grid = h('div', { class: 'launch-grid' }, tools.map(makeCard));
      const heading = h(
        'h2',
        { class: 'launch-group-title' },
        title,
        h(
          'span',
          { class: 'launch-group-count', dataset: { total: String(tools.length) } },
          plural(tools.length, 'tool'),
        ),
      );
      const section = h('section', { class: 'launch-group' }, heading, grid);
      sections.push(section);
    };
    for (const group of LAUNCH_GROUPS) {
      const tools = this.toolList.filter((tool) => group.types.includes(tool.type));
      for (const tool of tools) placed.add(tool.type);
      addSection(group.title, tools);
    }
    addSection(
      sections.length ? OTHER_GROUP : 'Tools',
      this.toolList.filter((tool) => !placed.has(tool.type)),
    );

    this.el.launcher.replaceChildren(
      h(
        'div',
        { class: 'launch-inner' },
        h('h1', { class: 'launch-title' }, 'Clover'),
        h(
          'p',
          { class: 'launch-lede' },
          'A workspace for seeing mathematics. Open as many tabs as you like, including several of the same tool. Everything is saved on this device.',
        ),
        ...sections,
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
      ...this.toolList.map((tool) => ({
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
    const tool = this.tools[type];
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
      instance = this.tools[tab.type].mount(panel, ctx) ?? {};
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

  /** Mark which sides of the tab strip have tabs hidden past the edge, so the stylesheet can fade them. */
  updateTabOverflow() {
    const { tablist } = this.el;
    const start = tablist.scrollLeft > 1;
    const end = tablist.scrollLeft + tablist.clientWidth < tablist.scrollWidth - 1;
    tablist.dataset.overflowStart = String(start);
    tablist.dataset.overflowEnd = String(end);
  }

  updateTabSelection() {
    for (const element of this.el.tablist.children) {
      const selected = element.dataset.id === this.activeId;
      element.setAttribute('aria-selected', String(selected));
      element.tabIndex = selected ? 0 : -1;
      if (selected) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.updateTabOverflow();
    if (!this.activeId) {
      const first = this.el.tablist.firstElementChild;
      if (first) first.tabIndex = 0;
    }
  }

  closeTab(id, { undo = true } = {}) {
    if (this.single) return;
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
    if (!this.persist) return;
    const saved = store.saveWorkspace(
      {
        version: VERSION,
        activeId: this.activeId,
        tabs: this.tabs.map(({ id, type, title, state }) => ({ id, type, title, state })),
      },
      this.storageKey,
    );
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
    if (this.onHelpShortcut) document.removeEventListener('keydown', this.onHelpShortcut);
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
      title: cleanTitle(entry.title, this.tools[entry.type].name),
      state: this.tools[entry.type].normalize(entry.state),
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
      result = parseImport(text, this.tools, () => uid('tab'));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      toast(error.message, { kind: 'error', duration: 8000 });
      return;
    }
    if (this.single) {
      const problem = this.openInSingle(result);
      if (problem) toast(problem, { kind: 'error' });
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

  /* ---------------------------------------------------------------- embedding */

  /**
   * In single-tool mode a file can only replace the one tab.
   * @returns {string | null} a message when the file has nothing for this tool, otherwise null
   */
  openInSingle(result) {
    const entries = result.kind === 'tab' ? [result.tab] : result.tabs;
    const entry = entries.find((e) => e.type === this.single);
    if (!entry) return `This file has no ${this.tools[this.single].name} tab.`;
    this.loadTabs([entry], 0);
    return null;
  }

  /**
   * Open file text sent by the page that embeds Clover. It gets the same validation as Import and no dialogs.
   * @returns {{ ok: boolean, message?: string }}
   */
  applyExternal(text) {
    let result;
    try {
      result = parseImport(text, this.tools, () => uid('tab'));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      return { ok: false, message: error.message };
    }
    if (this.single) {
      const problem = this.openInSingle(result);
      return problem ? { ok: false, message: problem } : { ok: true };
    }
    if (result.kind === 'tab') {
      return this.addTab(result.tab) ? { ok: true } : { ok: false, message: 'Too many tabs are open.' };
    }
    this.loadTabs(result.tabs, result.activeIndex);
    return { ok: true };
  }

  /** Open a tool in a new tab, for the embedding page. Not available when one tool is shown. */
  openTool(type) {
    if (this.single || !Object.hasOwn(this.tools, type)) return false;
    return this.addTab({ type }) !== null;
  }

  /** The current work as `.clover` file text: the one tab in single-tool mode, otherwise the whole workspace. */
  exportText() {
    if (this.single) return JSON.stringify(exportTab(this.tabs[0]));
    return JSON.stringify(exportWorkspace({ activeId: this.activeId ?? this.tabs[0]?.id ?? null, tabs: this.tabs }));
  }

  showEmbedDialog() {
    const active = this.tabs.find((t) => t.id === this.activeId);
    const base = baseFromLocation(window.location.href);
    const scope = h(
      'select',
      { class: 'select', 'aria-label': 'What to embed' },
      h('option', { value: 'all' }, 'The whole workspace'),
      active ? h('option', { value: 'tool' }, `Only this tool: ${this.tools[active.type].name}`) : null,
    );
    const style = h(
      'select',
      { class: 'select', 'aria-label': 'Kind of code' },
      h('option', { value: 'iframe' }, 'Plain iframe, works on any page'),
      h('option', { value: 'element' }, 'Script and <clover-embed>, can open a saved file'),
    );
    const code = h('textarea', {
      class: 'input input-mono embed-code',
      readonly: true,
      rows: '9',
      spellcheck: 'false',
      'aria-label': 'Code to paste into your page',
    });
    const update = () => {
      const tool = scope.value === 'tool' && active ? active.type : undefined;
      code.value = embedSnippet({
        base,
        tool,
        style: style.value,
        title: tool ? `Clover: ${this.tools[tool].name}` : 'Clover',
      });
    };
    scope.addEventListener('change', update);
    style.addEventListener('change', update);
    update();
    const copy = h(
      'button',
      {
        class: 'btn btn-small',
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(code.value);
            toast('Copied. Paste it into your page.', { kind: 'success' });
          } catch {
            code.select();
            toast('Press Ctrl+C (\u2318+C) to copy the selected code.');
          }
        },
      },
      icon('copy', 14),
      ' Copy',
    );
    showDialog({
      title: 'Embed Clover on a website',
      wide: true,
      body: [
        h(
          'p',
          {},
          'Paste this into any page to show Clover there. Visitors get their own copy; nothing they do is saved to your site or to your workspace.',
        ),
        h(
          'div',
          { class: 'embed-options' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Show'), scope),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Code'), style),
        ),
        code,
        h('div', { class: 'embed-actions' }, copy),
        h(
          'p',
          { class: 'dialog-note' },
          'Pick a tool to show only that tab. Options such as theme, which tools to offer, and starting content are in docs/embedding.md.',
        ),
      ],
      actions: [{ label: 'Close', value: true, kind: 'primary' }],
    });
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
          'Keyboard',
          h(
            'dl',
            { class: 'help-keys' },
            ...[
              [['?'], 'Open this help.'],
              [['Left', 'Right'], 'With a tab focused: switch to the previous or next tab.'],
              [['Home', 'End'], 'With a tab focused: jump to the first or last tab.'],
              [['F2'], 'With a tab focused: rename it.'],
              [['Delete'], 'With a tab focused: close it. Closing can be undone.'],
              [['Esc'], 'Close a menu or dialog.'],
            ].flatMap(([keys, text]) => [
              h(
                'dt',
                {},
                keys.flatMap((key, index) => (index === 0 ? [h('kbd', {}, key)] : [' ', h('kbd', {}, key)])),
              ),
              h('dd', {}, text),
            ]),
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
              'Your tabs are saved automatically in this browser (local storage). Nothing is sent to a server, except the program and input of a Programming tab when you press Run.',
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
        section(
          'Tools',
          h(
            'ul',
            {},
            this.toolList.map((tool) => h('li', {}, h('strong', {}, tool.name), ` \u2013 ${tool.description}`)),
          ),
        ),
      ],
      actions: [{ label: 'Close', value: true, kind: 'primary' }],
    });
  }
}
