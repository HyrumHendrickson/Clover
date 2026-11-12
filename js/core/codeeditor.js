import { h } from './dom.js';
import { tokenizePython } from '../lib/pyhighlight.js';

const LINE_HEIGHT = 20.8;
const PADDING = 24;

/**
 * A plain textarea with a syntax-highlighted layer behind it, a line-number gutter, Tab indenting, and
 * auto-indent. Text is always inserted as text. The Python tab has its own copy of this logic; new tools use this one.
 *
 * @param {{ value: string, label: string, maxLength: number, onInput: (value: string) => void,
 *   onRun?: () => void, tokenize?: (code: string) => { type: string, text: string }[],
 *   minLines?: number, maxLines?: number }} options
 *   `minLines` and `maxLines` make the editor grow with its text (notebook cells); leave them out to fill the parent.
 */
export function createCodeEditor({
  value,
  label,
  maxLength,
  onInput,
  onRun,
  tokenize = tokenizePython,
  minLines,
  maxLines,
}) {
  let trapTab = true;
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
    maxlength: String(maxLength),
    'aria-label': label,
    value,
  });
  const box = h('div', { class: 'py-editor-box' }, gutter, h('div', { class: 'py-code' }, highlight, textarea));
  const growing = minLines !== undefined;
  if (growing) box.classList.add('py-editor-grow');

  function syncScroll() {
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
    gutter.scrollTop = textarea.scrollTop;
  }

  function refresh() {
    const code = textarea.value;
    const tokens = code.length > 60000 ? [{ type: 'plain', text: code }] : tokenize(code);
    highlightCode.replaceChildren(
      ...tokens.map((t) =>
        t.type === 'plain' ? document.createTextNode(t.text) : h('span', { class: `tok-${t.type}` }, t.text),
      ),
      document.createTextNode('\n'),
    );
    const lines = code.split('\n').length;
    gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    if (growing) {
      const shown = Math.min(maxLines ?? lines, Math.max(minLines, lines));
      box.style.height = `${Math.round(shown * LINE_HEIGHT + PADDING)}px`;
    }
    syncScroll();
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
    const text = textarea.value;
    const s = textarea.selectionStart;
    const e = textarea.selectionEnd;
    if (s === e && !outdent) {
      replaceRange(s, e, '    ', s + 4, s + 4);
      return;
    }
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const probe = e > s && text[e - 1] === '\n' ? e - 1 : e;
    const nl = text.indexOf('\n', probe);
    const lineEnd = nl === -1 ? text.length : nl;
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const changed = lines.map((line) =>
      outdent ? line.replace(/^( {1,4}|\t)/, '') : line.length ? `    ${line}` : line,
    );
    const block = text.slice(lineStart, lineEnd);
    const out = changed.join('\n');
    const firstDelta = changed[0].length - lines[0].length;
    replaceRange(lineStart, lineEnd, out, Math.max(lineStart, s + firstDelta), e + (out.length - block.length));
  }

  function autoIndent(event) {
    const text = textarea.value;
    const s = textarea.selectionStart;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const before = text.slice(lineStart, s);
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
      onRun?.();
    } else if (event.key === 'Enter' && event.shiftKey && onRun && growing) {
      event.preventDefault();
      onRun();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      autoIndent(event);
    }
  });
  textarea.addEventListener('blur', () => {
    trapTab = true;
  });
  textarea.addEventListener('scroll', syncScroll);
  textarea.addEventListener('input', () => {
    onInput(textarea.value.slice(0, maxLength));
    refresh();
  });
  refresh();

  return {
    el: box,
    textarea,
    refresh,
    syncScroll,
    focus: () => textarea.focus(),
    /** Replace all text, as if the person had typed it, so undo and saving both see it. */
    setValue(text) {
      replaceRange(0, textarea.value.length, text, 0, 0);
      textarea.scrollTop = 0;
    },
    getValue: () => textarea.value,
  };
}
