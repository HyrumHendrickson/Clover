import { downloadBlob, h, slugify } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { tokenizePython } from '../lib/pyhighlight.js';
import { DEFAULT_PRESET, PYTHON_PRESETS } from './python-presets.js';

/** Location of the sandboxed runner page, resolved relative to this module. */
const RUNNER_URL = new URL('../../runner/index.html', import.meta.url).href;
const MAX_CODE = 100000;
const MAX_CONSOLE = 20000;
const START_TIMEOUT_MS = 15000;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

const normalize = (raw) => ({
  code: typeof raw?.code === 'string' ? raw.code.slice(0, MAX_CODE) : DEFAULT_PRESET.code,
});

function dataUrlToBlob(dataUrl) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

export default {
  type: 'python',
  name: 'Python turtle',
  description: 'Write Python with the turtle module, or load a fractal and change its parameters.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const w = canvas.clientWidth || 200;
    const hgt = canvas.clientHeight || 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, hgt);
    g.lineCap = 'round';
    const branch = (x, y, angle, length, depth) => {
      if (depth === 0) return;
      const nx = x + Math.cos(angle) * length;
      const ny = y - Math.sin(angle) * length;
      g.strokeStyle = depth > 3 ? '#6b4a2b' : colors.accent;
      g.lineWidth = Math.max(1, depth * 0.7);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      branch(nx, ny, angle + 0.42, length * 0.76, depth - 1);
      branch(nx, ny, angle - 0.42, length * 0.76, depth - 1);
    };
    branch(w / 2, hgt - 6, Math.PI / 2, hgt * 0.26, 8);
  },

  mount(root, ctx) {
    const state = ctx.state;
    let frame = null;
    let status = 'idle';
    let runId = 0;
    let startTimer = 0;
    let consoleLength = 0;
    let trapTab = true;

    /* ----------------------------------------------------------------- editor */

    const gutter = h('pre', { class: 'py-gutter', 'aria-hidden': 'true' });
    const highlightCode = h('code');
    const highlight = h('pre', { class: 'py-highlight', 'aria-hidden': 'true' }, highlightCode);
    const textarea = h('textarea', {
      class: 'py-input',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
      wrap: 'off',
      'aria-label': 'Python source code',
      value: state.code,
    });

    function refreshEditor() {
      const code = textarea.value;
      const tokens = code.length > 60000 ? [{ type: 'plain', text: code }] : tokenizePython(code);
      highlightCode.replaceChildren(
        ...tokens.map((t) =>
          t.type === 'plain' ? document.createTextNode(t.text) : h('span', { class: `tok-${t.type}` }, t.text),
        ),
        document.createTextNode('\n'),
      );
      const lines = code.split('\n').length;
      gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
      syncScroll();
      for (const [id, chip] of chips) {
        const active = PYTHON_PRESETS.find((p) => p.id === id)?.code === code;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      }
    }

    function syncScroll() {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    }

    /** Replace a range through the browser's edit pipeline so undo keeps working. */
    function replaceRange(start, end, insert, selStart, selEnd) {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, end);
      let ok = false;
      try {
        ok = document.execCommand('insertText', false, insert);
      } catch {
        ok = false;
      }
      if (!ok) {
        textarea.setRangeText(insert, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      textarea.setSelectionRange(selStart, selEnd);
    }

    function indentSelection(outdent) {
      const value = textarea.value;
      const s = textarea.selectionStart;
      const e = textarea.selectionEnd;
      if (s === e && !outdent) {
        replaceRange(s, e, '    ', s + 4, s + 4);
        return;
      }
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const probe = e > s && value[e - 1] === '\n' ? e - 1 : e;
      const nl = value.indexOf('\n', probe);
      const lineEnd = nl === -1 ? value.length : nl;
      const lines = value.slice(lineStart, lineEnd).split('\n');
      const changed = lines.map((line) =>
        outdent ? line.replace(/^( {1,4}|\t)/, '') : line.length ? `    ${line}` : line,
      );
      const block = value.slice(lineStart, lineEnd);
      const out = changed.join('\n');
      const firstDelta = changed[0].length - lines[0].length;
      replaceRange(lineStart, lineEnd, out, Math.max(lineStart, s + firstDelta), e + (out.length - block.length));
    }

    function autoIndent(event) {
      const value = textarea.value;
      const s = textarea.selectionStart;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const before = value.slice(lineStart, s);
      const indent = /^[ \t]*/.exec(before)[0];
      const extra = /:\s*(#.*)?$/.test(before) ? '    ' : '';
      if (!indent && !extra) return;
      event.preventDefault();
      const insert = `\n${indent}${extra}`;
      replaceRange(s, textarea.selectionEnd, insert, s + insert.length, s + insert.length);
    }

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        trapTab = false;
        return;
      }
      if (event.key === 'Tab') {
        if (!trapTab) return;
        event.preventDefault();
        indentSelection(event.shiftKey);
        return;
      }
      trapTab = true;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        run();
      } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        autoIndent(event);
      }
    });
    textarea.addEventListener('blur', () => {
      trapTab = true;
    });
    textarea.addEventListener('scroll', syncScroll);
    textarea.addEventListener('input', () => {
      state.code = textarea.value.slice(0, MAX_CODE);
      refreshEditor();
      ctx.save();
    });

    /* ----------------------------------------------------------------- console */

    const consoleEl = h('pre', {
      class: 'py-console',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Program output',
      tabindex: 0,
    });
    const statusEl = h('span', { class: 'py-status', role: 'status' });

    function writeConsole(text, isError = false) {
      const span = h('span', { class: isError ? 'py-error' : null }, text);
      consoleEl.append(span);
      consoleLength += text.length;
      while (consoleLength > MAX_CONSOLE && consoleEl.firstChild && consoleEl.firstChild !== span) {
        consoleLength -= consoleEl.firstChild.textContent.length;
        consoleEl.firstChild.remove();
      }
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }

    function clearConsole() {
      consoleEl.replaceChildren();
      consoleLength = 0;
    }

    /* ------------------------------------------------------------------ runner */

    const stage = h('div', { class: 'py-stage' });
    const idle = h(
      'div',
      { class: 'py-idle' },
      h('p', {}, 'Press Run to draw.'),
      h('p', { class: 'py-idle-hint' }, 'Ctrl+Enter or \u2318+Enter works inside the editor.'),
    );
    stage.append(idle);
    const runButton = h(
      'button',
      { class: 'btn btn-primary', type: 'button', onclick: () => run() },
      icon('play', 14),
      ' Run',
    );
    const stopButton = h(
      'button',
      { class: 'btn', type: 'button', disabled: true, onclick: () => stop() },
      icon('stop', 14),
      ' Stop',
    );

    const STATUS_TEXT = {
      idle: '',
      starting: 'Starting\u2026',
      running: 'Running\u2026',
      done: 'Finished',
      error: 'Stopped by an error',
      stopped: 'Stopped',
    };

    function setStatus(next) {
      status = next;
      statusEl.textContent = STATUS_TEXT[next];
      statusEl.dataset.state = next;
      stopButton.disabled = !(next === 'starting' || next === 'running');
    }

    function removeFrame() {
      clearTimeout(startTimer);
      if (frame) {
        frame.remove();
        frame = null;
      }
    }

    function run() {
      const id = (runId += 1);
      removeFrame();
      clearConsole();
      idle.hidden = true;
      setStatus('starting');
      frame = h('iframe', {
        class: 'py-frame',
        title: 'Turtle graphics output',
        sandbox: 'allow-scripts',
        referrerpolicy: 'no-referrer',
        src: RUNNER_URL,
      });
      stage.append(frame);
      startTimer = setTimeout(() => {
        if (id !== runId || status !== 'starting') return;
        writeConsole('The Python runner did not start. Check your connection, then reload the page.', true);
        setStatus('error');
      }, START_TIMEOUT_MS);
    }

    function stop() {
      runId += 1;
      removeFrame();
      idle.hidden = false;
      idle.firstChild.textContent = 'Stopped. Press Run to draw again.';
      writeConsole('Stopped.\n');
      setStatus('stopped');
    }

    function onMessage(event) {
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'ready':
          clearTimeout(startTimer);
          if (status === 'starting') {
            setStatus('running');
            frame.contentWindow.postMessage({ type: 'run', code: textarea.value.slice(0, MAX_CODE) }, '*');
          }
          break;
        case 'stdout':
          if (typeof data.text === 'string') writeConsole(data.text.slice(0, 4000));
          break;
        case 'done':
          if (status === 'running') setStatus('done');
          break;
        case 'error':
          if (typeof data.message === 'string') writeConsole(`${data.message.slice(0, 2000)}\n`, true);
          setStatus('error');
          break;
        case 'snapshot':
          if (typeof data.dataUrl === 'string' && data.dataUrl.length < 8_000_000 && PNG_DATA_URL.test(data.dataUrl)) {
            downloadBlob(`${slugify(ctx.title?.() ?? 'turtle', 'turtle')}.png`, dataUrlToBlob(data.dataUrl));
          }
          break;
        default:
      }
    }
    window.addEventListener('message', onMessage);

    function saveImage() {
      if (!frame || !['running', 'done', 'error'].includes(status)) {
        ctx.notify('Run the program first, then save the image.', 'info');
        return;
      }
      frame.contentWindow.postMessage({ type: 'snapshot' }, '*');
    }

    /* ----------------------------------------------------------------- presets */

    const chips = new Map();
    const presetRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Example programs' });
    for (const preset of PYTHON_PRESETS) {
      const chip = h(
        'button',
        {
          class: 'chip',
          type: 'button',
          title: preset.description,
          'aria-pressed': 'false',
          onclick: () => {
            replaceRange(0, textarea.value.length, preset.code, 0, 0);
            textarea.scrollTop = 0;
            run();
          },
        },
        preset.label,
      );
      chips.set(preset.id, chip);
      presetRow.append(chip);
    }

    /* ----------------------------------------------------------------- layout */

    root.classList.add('tool', 'python-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        runButton,
        stopButton,
        statusEl,
        h('span', { class: 'tool-bar-spacer' }),
        h(
          'button',
          {
            class: 'btn btn-icon',
            type: 'button',
            'aria-label': 'Save drawing as PNG',
            title: 'Save drawing as PNG',
            onclick: saveImage,
          },
          icon('image'),
        ),
      ),
      h('div', { class: 'tool-subbar' }, presetRow),
      h(
        'div',
        { class: 'tool-body py-body' },
        h(
          'section',
          { class: 'py-editor', 'aria-label': 'Editor' },
          h('div', { class: 'py-editor-box' }, gutter, h('div', { class: 'py-code' }, highlight, textarea)),
          h('p', { class: 'tool-note py-hint' }, 'Tab indents. Press Esc, then Tab, to move focus out of the editor.'),
        ),
        h(
          'section',
          { class: 'py-output', 'aria-label': 'Output' },
          stage,
          h(
            'div',
            { class: 'py-console-wrap' },
            h(
              'div',
              { class: 'py-console-head' },
              h('span', {}, 'Console'),
              h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: clearConsole }, 'Clear'),
            ),
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
          'Python runs in your browser with Skulpt, inside a sandboxed frame that cannot read your saved workspace or reach the network.',
        ),
      ),
    );

    refreshEditor();
    setStatus('idle');

    return {
      onShow: syncScroll,
      destroy: () => {
        window.removeEventListener('message', onMessage);
        removeFrame();
      },
    };
  },
};
