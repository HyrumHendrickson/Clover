import { debounce, h, onResize } from '../core/dom.js';
import { createCodeEditor } from '../core/codeeditor.js';
import { icon } from '../core/icons.js';
import {
  History,
  MAX_SIZE,
  MIN_SIZE,
  countStates,
  decodeCells,
  emptyGrid,
  encodeCells,
  lineCells,
  paintedState,
  previewColors,
  randomGrid,
  resizeGrid,
} from '../lib/automata.js';
import { AUTOMATA_PRESETS, DEFAULT_AUTOMATON } from '../lib/automata-presets.js';
import { PythonFrame } from '../lib/pyframe.js';
import { fitCanvas, themeColors } from '../lib/viewport.js';

const MAX_CODE = 20000;
const MAX_CONSOLE = 8000;
const SPEED = { min: 1, max: 30, initial: 8 };
const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ------------------------------------------------------------------- state */

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const code = typeof r.code === 'string' ? r.code.slice(0, MAX_CODE) : DEFAULT_AUTOMATON.code;
  const width = clampInt(r.width, MIN_SIZE, MAX_SIZE, DEFAULT_AUTOMATON.width);
  const height = clampInt(r.height, MIN_SIZE, MAX_SIZE, DEFAULT_AUTOMATON.height);
  const decoded = decodeCells(r.cells, width * height);
  const cells = encodeCells(decoded ?? DEFAULT_AUTOMATON.start(width, height));
  return { code, width, height, cells, speed: clampInt(r.speed, SPEED.min, SPEED.max, SPEED.initial) };
}

/* -------------------------------------------------------------------- tool */

export default {
  type: 'automata',
  name: 'Cellular automata',
  description:
    'Grids that evolve by a rule you write in Python, with any number of colours. Click cells to edit, then play, step, or step back.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const n = 9;
    const size = Math.min(width, height) / (n + 2);
    const x0 = (width - size * n) / 2;
    const y0 = (height - size * n) / 2;
    const glider = new Set(['1,0', '2,1', '0,2', '1,2', '2,2']);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        ctx.fillStyle = glider.has(`${x - 2},${y - 2}`) ? colors.accent : colors.grid;
        ctx.fillRect(x0 + x * size + 1, y0 + y * size + 1, size - 2, size - 2);
      }
    }
  },

  mount(root, ctx) {
    const state = ctx.state;
    let width = state.width;
    let height = state.height;
    let cells = decodeCells(state.cells, width * height) ?? emptyGrid(width, height);
    let colors = previewColors(state.code);
    let names = [];
    let brush = Math.min(1, colors.length - 1);
    let generation = 0;
    let running = false;
    let epoch = 0;
    let pending = null;
    let loadedCode = null;
    let timer = 0;
    let active = false;
    let cursor = [0, 0];
    let cellPx = 8;
    const history = new History();

    const save = () => {
      state.width = width;
      state.height = height;
      state.cells = encodeCells(cells);
      ctx.save();
    };
    const saveLater = debounce(save, 300);

    /* ---------------------------------------------------------- console */

    const consoleEl = h('pre', {
      class: 'py-console ca-console',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Rule output',
    });
    function writeConsole(text, isError = false) {
      consoleEl.append(h('span', { class: isError ? 'py-error' : null }, text));
      while (consoleEl.textContent.length > MAX_CONSOLE && consoleEl.firstChild) consoleEl.firstChild.remove();
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    /* ----------------------------------------------------------- runner */

    const frameHost = h('div', { class: 'ca-frame-host' });
    const runner = new PythonFrame(frameHost, {
      title: 'Cellular automaton rule runner',
      hidden: true,
      onFailure: (message) => {
        writeConsole(`${message}\n`, true);
        settle(new Error(message));
      },
      onMessage: (data) => {
        if (data.type === 'stdout' && typeof data.text === 'string') writeConsole(data.text.slice(0, 2000));
        else if (data.type === 'ca-ready') onReady(data);
        else if (data.type === 'ca-result') onResult(data);
        else if (data.type === 'ca-error' && typeof data.message === 'string') {
          writeConsole(`${data.message.slice(0, 1500)}\n`, true);
          settle(new Error(data.message));
        }
      },
    });

    /** Resolve or reject the one request in flight. */
    function settle(error, value) {
      const p = pending;
      pending = null;
      if (!p) return;
      if (error) p.reject(error);
      else p.resolve(value);
    }

    function request(message, kind) {
      return new Promise((resolve, reject) => {
        pending = { kind, resolve, reject };
        runner.post(message);
      });
    }

    function onReady(data) {
      const list = Array.isArray(data.colors) ? data.colors.filter((c) => typeof c === 'string').slice(0, 16) : [];
      if (list.length < 2) return settle(new Error('The rule reported no colours.'));
      colors = list;
      names = Array.isArray(data.names) ? data.names.map((n) => String(n).slice(0, 24)) : [];
      for (let i = 0; i < cells.length; i += 1) if (cells[i] >= colors.length) cells[i] = 0;
      brush = Math.min(brush, colors.length - 1);
      buildPalette();
      draw();
      settle(null, data);
    }

    function onResult(data) {
      if (!pending || pending.kind !== 'step') return;
      if (!data.cells || data.cells.length !== width * height)
        return settle(new Error('The runner returned a grid of the wrong size.'));
      settle(
        null,
        Uint8Array.from(data.cells, (v) => (v < colors.length ? v : 0)),
      );
    }

    async function ensureRule() {
      if (loadedCode === state.code) return;
      writeConsole('');
      loadedCode = null;
      await request({ type: 'ca-load', code: state.code }, 'load');
      loadedCode = state.code;
      ruleNote.hidden = true;
    }

    /* ------------------------------------------------------------ stepping */

    /** Advance by `steps` generations. Returns false if nothing changed (an error, or the grid was edited meanwhile). */
    async function advance(steps = 1) {
      const mine = epoch;
      try {
        await ensureRule();
        if (mine !== epoch) return false;
        const next = await request({ type: 'ca-step', cells: Uint8Array.from(cells), width, height, steps }, 'step');
        if (mine !== epoch) return false;
        history.push(cells);
        cells = next;
        generation += steps;
        refreshInfo();
        draw();
        saveLater();
        return true;
      } catch {
        pause();
        refreshInfo();
        return false;
      }
    }

    async function loop() {
      if (!running) return;
      const started = performance.now();
      await advance(1);
      if (!running) return;
      timer = setTimeout(loop, Math.max(0, 1000 / state.speed - (performance.now() - started)));
    }

    function play() {
      if (running) return;
      running = true;
      syncButtons();
      loop();
    }

    function pause() {
      running = false;
      clearTimeout(timer);
      syncButtons();
    }

    function stepBack() {
      pause();
      epoch += 1;
      const previous = history.pop();
      if (!previous) {
        ctx.notify('There is nothing earlier to go back to.', 'info');
        return;
      }
      cells = previous;
      generation = Math.max(0, generation - 1);
      refreshInfo();
      draw();
      save();
    }

    /* -------------------------------------------------------------- editing */

    function edited() {
      epoch += 1;
      refreshInfo();
      draw();
      saveLater();
    }

    function setGrid(next, { resetHistory = true } = {}) {
      cells = next;
      if (resetHistory) {
        history.clear();
        generation = 0;
      }
      edited();
      saveLater.flush();
    }

    function resizeTo(w, h2) {
      const nw = clampInt(w, MIN_SIZE, MAX_SIZE, width);
      const nh = clampInt(h2, MIN_SIZE, MAX_SIZE, height);
      pause();
      cells = resizeGrid(cells, width, height, nw, nh);
      width = nw;
      height = nh;
      widthInput.value = String(nw);
      heightInput.value = String(nh);
      cursor = [Math.min(cursor[0], nw - 1), Math.min(cursor[1], nh - 1)];
      history.clear();
      generation = 0;
      edited();
      layoutCanvas();
    }

    function loadPreset(preset) {
      pause();
      state.code = preset.code.slice(0, MAX_CODE);
      editor.setValue(state.code);
      width = preset.width;
      height = preset.height;
      widthInput.value = String(width);
      heightInput.value = String(height);
      colors = previewColors(state.code);
      names = [];
      brush = Math.min(1, colors.length - 1);
      loadedCode = null;
      cursor = [0, 0];
      history.clear();
      generation = 0;
      cells = preset.start(width, height);
      buildPalette();
      markPresets();
      edited();
      saveLater.flush();
      layoutCanvas();
    }

    /* --------------------------------------------------------------- canvas */

    const canvas = h('canvas', {
      class: 'ca-canvas',
      tabindex: '0',
      role: 'img',
      'aria-label': 'Cellular automaton grid. Click a cell to paint it; arrow keys move, Space paints.',
    });
    const stage = h('div', { class: 'ca-stage' }, canvas);

    function layoutCanvas() {
      const availW = Math.max(40, stage.clientWidth - 16);
      const availH = Math.max(40, stage.clientHeight - 16);
      cellPx = Math.max(2, Math.floor(Math.min(availW / width, availH / height)));
      canvas.style.width = `${cellPx * width}px`;
      canvas.style.height = `${cellPx * height}px`;
      draw();
    }

    function draw() {
      if (!active) return;
      const a = fitCanvas(canvas);
      const theme = themeColors();
      a.ctx.fillStyle = theme.bg;
      a.ctx.fillRect(0, 0, a.width, a.height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          a.ctx.fillStyle = colors[cells[y * width + x]] ?? colors[0];
          a.ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
        }
      }
      if (cellPx >= 6) {
        a.ctx.strokeStyle = theme.grid;
        a.ctx.lineWidth = 1;
        a.ctx.beginPath();
        for (let x = 0; x <= width; x += 1) {
          a.ctx.moveTo(x * cellPx + 0.5, 0);
          a.ctx.lineTo(x * cellPx + 0.5, height * cellPx);
        }
        for (let y = 0; y <= height; y += 1) {
          a.ctx.moveTo(0, y * cellPx + 0.5);
          a.ctx.lineTo(width * cellPx, y * cellPx + 0.5);
        }
        a.ctx.stroke();
      }
      if (document.activeElement === canvas) {
        a.ctx.strokeStyle = theme.accent;
        a.ctx.lineWidth = 2;
        a.ctx.strokeRect(cursor[0] * cellPx + 1, cursor[1] * cellPx + 1, cellPx - 2, cellPx - 2);
      }
    }

    const cellAt = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * width);
      const y = Math.floor(((event.clientY - rect.top) / Math.max(1, rect.height)) * height);
      return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
    };

    let drag = null;
    function paint(x, y) {
      cells[y * width + x] = drag.value;
    }
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button > 0 && event.pointerType === 'mouse') return;
      const at = cellAt(event);
      if (!at) return;
      canvas.focus();
      canvas.setPointerCapture?.(event.pointerId);
      cursor = at;
      drag = { value: paintedState(cells[at[1] * width + at[0]], brush), last: at };
      paint(at[0], at[1]);
      edited();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const at = cellAt(event);
      if (!at) return;
      for (const [x, y] of lineCells(drag.last[0], drag.last[1], at[0], at[1])) paint(x, y);
      drag.last = at;
      cursor = at;
      edited();
    });
    const endDrag = () => {
      drag = null;
      saveLater.flush();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('focus', draw);
    canvas.addEventListener('blur', draw);
    canvas.addEventListener('keydown', (event) => {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[event.key]) {
        cursor = [
          (cursor[0] + moves[event.key][0] + width) % width,
          (cursor[1] + moves[event.key][1] + height) % height,
        ];
        draw();
      } else if (event.key === ' ' || event.key === 'Enter') {
        const i = cursor[1] * width + cursor[0];
        cells[i] = paintedState(cells[i], brush);
        edited();
      } else if (/^[0-9]$/.test(event.key) && Number(event.key) < colors.length) {
        brush = Number(event.key);
        syncPalette();
        return;
      } else return;
      event.preventDefault();
    });

    /* ------------------------------------------------------------- controls */

    const info = h('span', { class: 'ca-info', role: 'status', 'aria-live': 'off' });
    function refreshInfo() {
      const counts = countStates(cells, colors.length);
      const parts = counts.map((n, i) => `${names[i] ?? `State ${i}`}: ${n}`);
      info.textContent = `Generation ${generation}. ${parts.join(', ')}`;
      stepBackButton.disabled = history.size === 0;
    }

    const button = (label, iconName, onclick, props = {}) =>
      h(
        'button',
        { class: 'btn', type: 'button', onclick, ...props },
        iconName ? icon(iconName, 14) : null,
        iconName ? ' ' : null,
        label,
      );
    const playButton = button('Play', 'play', () => (running ? pause() : play()), { class: 'btn btn-primary' });
    const stepButton = button('Step', null, async () => {
      pause();
      await advance(1);
    });
    const stepBackButton = button('Step back', null, stepBack);
    function syncButtons() {
      playButton.replaceChildren(icon(running ? 'stop' : 'play', 14), ` ${running ? 'Pause' : 'Play'}`);
      playButton.setAttribute('aria-pressed', String(running));
    }
    const randomButton = button('Randomise', null, () => {
      pause();
      const weights = colors.map((_, i) => (i === 0 ? colors.length : 1));
      setGrid(randomGrid(width, height, weights));
    });
    const clearButton = button('Clear', 'trash', () => {
      pause();
      setGrid(emptyGrid(width, height));
    });

    const speed = h('input', {
      class: 'ca-speed',
      type: 'range',
      min: String(SPEED.min),
      max: String(SPEED.max),
      step: '1',
      value: String(state.speed),
      'aria-label': 'Generations per second',
      oninput: () => {
        state.speed = clampInt(speed.value, SPEED.min, SPEED.max, SPEED.initial);
        speedLabel.textContent = `${state.speed}/s`;
        ctx.save();
      },
    });
    const speedLabel = h('span', { class: 'ca-speed-label' }, `${state.speed}/s`);

    const sizeInput = (label, value) =>
      h('input', {
        class: 'input ca-size',
        type: 'number',
        min: String(MIN_SIZE),
        max: String(MAX_SIZE),
        step: '1',
        value: String(value),
        'aria-label': label,
        onchange: () => resizeTo(widthInput.value, heightInput.value),
      });
    const widthInput = sizeInput('Grid width in cells', width);
    const heightInput = sizeInput('Grid height in cells', height);

    const palette = h('div', { class: 'chip-row ca-palette', role: 'group', 'aria-label': 'Brush colour' });
    function buildPalette() {
      palette.replaceChildren(
        ...colors.map((color, i) =>
          h(
            'button',
            {
              class: 'chip ca-brush',
              type: 'button',
              'aria-pressed': String(i === brush),
              title: `Paint with ${names[i] ?? `state ${i}`}. Clicking a cell that already has this colour clears it.`,
              onclick: () => {
                brush = i;
                syncPalette();
              },
            },
            h('span', { class: 'ca-swatch', style: { background: color } }),
            names[i] ?? `State ${i}`,
          ),
        ),
      );
    }
    function syncPalette() {
      [...palette.children].forEach((el, i) => el.setAttribute('aria-pressed', String(i === brush)));
    }

    const presetChips = new Map();
    const presetRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Example rules' });
    for (const preset of AUTOMATA_PRESETS) {
      const chip = h(
        'button',
        { class: 'chip', type: 'button', title: preset.description, onclick: () => loadPreset(preset) },
        preset.label,
      );
      presetChips.set(preset.id, chip);
      presetRow.append(chip);
    }
    function markPresets() {
      for (const preset of AUTOMATA_PRESETS) {
        const on = preset.code === state.code;
        presetChips.get(preset.id).setAttribute('aria-pressed', String(on));
        presetChips.get(preset.id).classList.toggle('is-active', on);
      }
    }

    /* --------------------------------------------------------------- editor */

    const ruleNote = h(
      'p',
      { class: 'tool-note', hidden: true },
      'The rule has changed. Press Apply rule, or Step, to use it.',
    );
    const editor = createCodeEditor({
      value: state.code,
      label: 'Python rule',
      maxLength: MAX_CODE,
      onInput: (value) => {
        state.code = value;
        ruleNote.hidden = loadedCode === null || loadedCode === value;
        colors = loadedCode === null ? previewColors(value) : colors;
        markPresets();
        ctx.save();
      },
      onRun: () => applyRule(),
    });
    async function applyRule() {
      pause();
      loadedCode = null;
      try {
        await ensureRule();
        writeConsole('Rule applied.\n');
      } catch {
        // The error is already in the console.
      }
    }

    /* --------------------------------------------------------------- layout */

    root.classList.add('tool', 'automata-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar', role: 'toolbar', 'aria-label': 'Simulation controls' },
        playButton,
        stepButton,
        stepBackButton,
        randomButton,
        clearButton,
        h('label', { class: 'field ca-speed-field' }, h('span', { class: 'field-label' }, 'Speed'), speed, speedLabel),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Width'), widthInput),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Height'), heightInput),
      ),
      h('div', { class: 'tool-subbar' }, presetRow),
      h(
        'div',
        { class: 'tool-body ca-body' },
        h('section', { class: 'ca-left', 'aria-label': 'Grid' }, stage, palette, info),
        h(
          'section',
          { class: 'ca-right', 'aria-label': 'Rule' },
          h('div', { class: 'ca-editor' }, editor.el),
          h(
            'div',
            { class: 'ca-actions' },
            button('Apply rule', 'play', applyRule),
            h('span', { class: 'tool-note' }, 'Ctrl+Enter in the editor'),
          ),
          ruleNote,
          h(
            'div',
            { class: 'py-console-wrap ca-console-wrap' },
            h('div', { class: 'py-console-head' }, h('span', {}, 'Rule output')),
            consoleEl,
          ),
        ),
      ),
      h(
        'div',
        { class: 'tool-footer' },
        h(
          'p',
          { class: 'tool-note' },
          'The rule runs in your browser, in a sandboxed frame, only when you press Play, Step, or Apply rule. Clicking a cell that already has the brush colour clears it.',
        ),
      ),
      frameHost,
    );

    buildPalette();
    markPresets();
    syncButtons();
    refreshInfo();
    const stopObserving = onResize(stage, layoutCanvas);
    const onTheme = () => active && draw();
    document.addEventListener('clover:themechange', onTheme);

    return {
      onShow: () => {
        active = true;
        layoutCanvas();
        editor.syncScroll();
      },
      onHide: () => {
        active = false;
        pause();
      },
      destroy: () => {
        active = false;
        running = false;
        clearTimeout(timer);
        saveLater.cancel();
        stopObserving();
        document.removeEventListener('clover:themechange', onTheme);
        runner.destroy();
      },
    };
  },
};
