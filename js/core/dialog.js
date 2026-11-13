import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * Show a modal dialog and resolve with the chosen action value, or null if dismissed.
 * @param {{ title: string, body: Node | string | Array<Node | string>, actions: Array<{ label: string, value: any, kind?: 'primary' | 'danger' | 'quiet' }>, wide?: boolean }} options
 */
export function showDialog({ title, body, actions, wide = false }) {
  return new Promise((resolve) => {
    let result = null;
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = h(
      'dialog',
      { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'dialog-head' },
        h('h2', { class: 'dialog-title', id: titleId }, title),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet btn-icon dialog-close',
            'aria-label': 'Close',
            title: 'Close',
            onclick: () => dialog.close(),
          },
          icon('close', 16),
        ),
      ),
      h('div', { class: 'dialog-body' }, body),
      h(
        'div',
        { class: 'dialog-actions' },
        actions.map((action) =>
          h(
            'button',
            {
              type: 'button',
              autofocus: action.kind === 'primary' || action.kind === 'danger',
              class: `btn ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'btn-danger' : 'btn-quiet'}`,
              onclick: () => {
                result = action.value;
                dialog.close();
              },
            },
            action.label,
          ),
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
