/**
 * A text field that shows its content as typeset math.
 *
 * The real control is a plain `<input>`, so selection, undo, paste, input
 * methods, and screen readers all behave normally. When the field is not
 * focused the input is transparent and the typeset version shows through (a
 * click lands on the input, so it focuses as usual). While it is focused the
 * input is visible and a live typeset preview sits under it.
 */
import { typeset, autoSymbols } from '../lib/graph/typeset.js';
import { h } from './dom.js';

/**
 * @param {{ value?: string, label: string, placeholder?: string, maxlength?: number, className?: string,
 *   oninput?: (value: string) => void, onblur?: () => void, onfocus?: () => void, onkeydown?: (e: KeyboardEvent) => void }} options
 */
export function createMathField({
  value = '',
  label,
  placeholder = '',
  maxlength = 500,
  className = 'gr-input',
  oninput,
  onblur,
  onfocus,
  onkeydown,
}) {
  const display = h('div', { class: 'mf-display', 'aria-hidden': 'true' });
  const input = h('input', {
    class: `${className} mf-input`,
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    autocapitalize: 'off',
    maxlength: String(maxlength),
    placeholder,
    'aria-label': label,
    value,
  });
  const el = h('div', { class: 'mf' }, input, display);

  function refresh() {
    const text = input.value;
    el.classList.toggle('is-empty', text.trim() === '');
    if (text.trim() === '') {
      display.replaceChildren(h('span', { class: 'mf-placeholder' }, placeholder));
    } else {
      display.replaceChildren(typeset(text));
    }
  }

  input.addEventListener('input', (event) => {
    // Typing a Greek name turns it into the letter; deleting never re-triggers it.
    if (event.inputType === undefined || !event.inputType.startsWith('delete')) {
      const caret = input.selectionStart ?? input.value.length;
      const next = autoSymbols(input.value, caret);
      if (next.text !== input.value) {
        input.value = next.text;
        input.setSelectionRange?.(next.caret, next.caret);
      }
    }
    refresh();
    oninput?.(input.value);
  });
  input.addEventListener('focus', () => {
    el.classList.add('is-focused');
    onfocus?.();
  });
  input.addEventListener('blur', () => {
    el.classList.remove('is-focused');
    onblur?.();
  });
  if (onkeydown) input.addEventListener('keydown', onkeydown);

  refresh();
  return {
    el,
    input,
    refresh,
    setValue(text) {
      input.value = text;
      refresh();
    },
    focus(atEnd = true) {
      input.focus();
      if (atEnd) {
        const end = input.value.length;
        input.setSelectionRange?.(end, end);
      }
    },
  };
}
