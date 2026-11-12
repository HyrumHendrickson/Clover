import { createCodeEditor } from '../core/codeeditor.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import {
  DEFAULT_ENDPOINT,
  LANGUAGES,
  LANGUAGE_IDS,
  MAX_SOURCE,
  MAX_STDIN,
  describeResult,
  parseResult,
} from '../lib/codeapi.js';
import { tokenizeCode } from '../lib/codehighlight.js';
import { PythonFrame } from '../lib/pyframe.js';
import { fitCanvas } from '../lib/viewport.js';
import { STARTERS } from './programming-presets.js';

/** The sandboxed page that talks to the run service, resolved relative to this module. */
const CODE_RUNNER_URL = new URL('../../runner/code.html', import.meta.url).href;
const SERVICE_HOST = new URL(DEFAULT_ENDPOINT).host;

const BLOCK_LABELS = {
  compile: 'Compiler output',
  stdout: 'Output',
  stderr: 'Errors',
  message: 'Details',
};

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const given = r.sources && typeof r.sources === 'object' ? r.sources : {};
  const sources = {};
  for (const id of LANGUAGE_IDS) {
    sources[id] = Object.hasOwn(given, id) ? (text(given[id], MAX_SOURCE) ?? STARTERS[id]) : STARTERS[id];
  }
  return {
    language: LANGUAGE_IDS.includes(r.language) ? r.language : 'python',
    sources,
    stdin: text(r.stdin, MAX_STDIN) ?? '',
  };
}

export default {
  type: 'programming',
  name: 'Programming',
  description: 'Write and run Python, Rust, C, C++, or Java. Give the program input and read what it prints.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const lines = [
      [0.1, 0.32, colors.b],
      [0.14, 0.5, colors.a],
      [0.14, 0.26, colors.ink],
      [0.22, 0.44, colors.accent],
      [0.14, 0.18, colors.ink],
      [0.1, 0.08, colors.b],
    ];
    const rowHeight = height / (lines.length + 2);
    lines.forEach(([indent, length, color], i) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(width * (0.12 + indent), rowHeight * (i + 1) + 2, width * length, rowHeight * 0.45);
    });
    ctx.globalAlpha = 1;
  },

  mount(root, ctx) {
    const state = ctx.state;
    let frame = null;
    let runId = 0;
    let running = false;

    /* ----------------------------------------------------------------- editor */

    const fileName = h('span', { class: 'prog-file' });
    const editor = createCodeEditor({
      value: state.sources[state.language],
      label: 'Program source code',
      maxLength: MAX_SOURCE,
      tokenize: (code) => tokenizeCode(code, state.language),
      onInput: (value) => {
        state.sources[state.language] = value;
        ctx.save();
      },
      onRun: () => run(),
    });

    function showLanguage(id) {
      state.language = id;
      fileName.textContent = LANGUAGES.find((l) => l.id === id).file;
      // Set the text directly instead of through the edit pipeline: undo should not cross languages.
      editor.textarea.value = state.sources[id];
      editor.textarea.scrollTop = 0;
      editor.refresh();
      for (const [key, button] of buttons) button.setAttribute('aria-checked', String(key === id));
    }

    const buttons = new Map();
    const picker = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Language' });
    for (const language of LANGUAGES) {
      const button = h(
        'button',
        {
          class: 'segment',
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          onclick: () => {
            if (state.language === language.id) return;
            showLanguage(language.id);
            ctx.save();
          },
          onkeydown: (event) => {
            const step =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!step) return;
            event.preventDefault();
            const next = LANGUAGES[(LANGUAGES.indexOf(language) + step + LANGUAGES.length) % LANGUAGES.length];
            showLanguage(next.id);
            ctx.save();
            buttons.get(next.id).focus();
          },
        },
        language.label,
      );
      buttons.set(language.id, button);
      picker.append(button);
    }

    /* ------------------------------------------------------------------ input */

    const stdin = h('textarea', {
      class: 'input input-mono prog-stdin',
      rows: '3',
      spellcheck: 'false',
      maxlength: String(MAX_STDIN),
      'aria-label': 'Standard input for the program',
      placeholder: 'Text the program reads from standard input',
      value: state.stdin,
      oninput: () => {
        state.stdin = stdin.value.slice(0, MAX_STDIN);
        ctx.save();
      },
    });

    /* ----------------------------------------------------------------- output */

    const results = h('div', {
      class: 'prog-results',
      role: 'log',
      'aria-live': 'polite',
      'aria-label': 'Program output',
      tabindex: 0,
    });
    const statusEl = h('span', { class: 'prog-status', role: 'status' });

    const showEmpty = () =>
      results.replaceChildren(
        h(
          'p',
          { class: 'prog-empty' },
          'Press Run, or Ctrl+Enter (\u2318+Enter) in the editor. What the program prints appears here.',
        ),
      );

    function setStatus(kind, message = '') {
      statusEl.textContent = message;
      statusEl.dataset.state = kind;
      runButton.disabled = kind === 'running';
      stopButton.disabled = kind !== 'running';
      running = kind === 'running';
    }

    function showBlocks(sections, failed) {
      results.replaceChildren(
        ...sections.map((section) =>
          h(
            'section',
            { class: `prog-block prog-${section.kind}${failed && section.kind !== 'stdout' ? ' is-error' : ''}` },
            h('h3', { class: 'prog-block-title' }, BLOCK_LABELS[section.kind]),
            h('pre', { class: 'prog-pre' }, section.text),
          ),
        ),
      );
    }

    function showFailure(message) {
      showBlocks([{ kind: 'message', text: message }], true);
      setStatus('error', 'Could not run');
    }

    /* -------------------------------------------------------------------- run */

    function onMessage(data) {
      if (data.id !== runId || !running) return;
      if (data.type === 'status' && typeof data.text === 'string') {
        setStatus('running', data.text.slice(0, 80));
      } else if (data.type === 'result') {
        const result = parseResult(data.result);
        if (!result) {
          showFailure('The run service sent a reply this page could not read.');
          return;
        }
        const shown = describeResult(result);
        if (shown.sections.length === 0)
          results.replaceChildren(h('p', { class: 'prog-empty' }, 'The program finished and printed nothing.'));
        else showBlocks(shown.sections, !shown.ok);
        setStatus(shown.ok ? 'done' : 'error', shown.summary);
      } else if (data.type === 'error' && typeof data.message === 'string') {
        showFailure(data.message.slice(0, 400));
      }
    }

    function stopFrame() {
      frame?.destroy();
      frame = null;
    }

    function run() {
      if (running) return;
      const code = editor.getValue();
      if (code.trim() === '') {
        ctx.notify('Write some code first.');
        return;
      }
      runId += 1;
      results.replaceChildren();
      setStatus('running', 'Starting\u2026');
      frame ??= new PythonFrame(host, {
        title: 'Code runner',
        url: CODE_RUNNER_URL,
        hidden: true,
        onMessage,
        onFailure: (message) => {
          stopFrame();
          if (running) showFailure(message);
        },
      });
      frame.post({
        type: 'run',
        id: runId,
        endpoint: DEFAULT_ENDPOINT,
        language: state.language,
        code,
        stdin: state.stdin,
      });
    }

    function stop() {
      if (!running) return;
      runId += 1;
      stopFrame();
      showBlocks([{ kind: 'message', text: 'Stopped.' }], false);
      setStatus('idle', 'Stopped');
    }

    /* ----------------------------------------------------------------- layout */

    const host = h('div', { class: 'prog-frame-host' });
    const runButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: run }, icon('play', 14), ' Run');
    const stopButton = h(
      'button',
      { class: 'btn', type: 'button', disabled: true, onclick: stop },
      icon('stop', 14),
      ' Stop',
    );
    const reset = h(
      'button',
      {
        class: 'btn btn-quiet',
        type: 'button',
        title: 'Replace this program with the example',
        onclick: () => editor.setValue(STARTERS[state.language]),
      },
      'Load example',
    );

    root.classList.add('tool', 'programming-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        picker,
        runButton,
        stopButton,
        statusEl,
        h('span', { class: 'tool-bar-spacer' }),
        reset,
      ),
      h(
        'div',
        { class: 'tool-body prog-body' },
        h(
          'section',
          { class: 'prog-editor', 'aria-label': 'Editor' },
          h('div', { class: 'prog-pane-head' }, fileName),
          editor.el,
          h('p', { class: 'tool-note' }, 'Tab indents. Press Esc, then Tab, to move focus out of the editor.'),
        ),
        h(
          'section',
          { class: 'prog-side', 'aria-label': 'Input and output' },
          h('label', { class: 'prog-input' }, h('span', { class: 'prog-pane-head' }, 'Input'), stdin),
          h(
            'div',
            { class: 'prog-output' },
            h(
              'div',
              { class: 'prog-pane-head prog-output-head' },
              h('span', {}, 'Output'),
              h('button', { class: 'btn btn-quiet btn-small', type: 'button', onclick: showEmpty }, 'Clear'),
            ),
            results,
          ),
        ),
      ),
      h(
        'div',
        { class: 'tool-footer' },
        h(
          'p',
          { class: 'tool-note' },
          `When you press Run, your program and its input are sent to ${SERVICE_HOST}, which compiles and runs it. Clover does not keep them there. The service is shared and can be slow or busy.`,
        ),
      ),
      host,
    );

    showLanguage(state.language);
    showEmpty();
    setStatus('idle');

    return {
      onShow: () => editor.syncScroll(),
      destroy: () => stopFrame(),
    };
  },
};
