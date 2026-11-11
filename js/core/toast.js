import { h } from './dom.js';

let region = null;

function ensureRegion() {
  if (region && document.contains(region)) return region;
  region = document.getElementById('toasts') ?? h('div', { id: 'toasts' });
  if (!region.isConnected) document.body.append(region);
  return region;
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {{ kind?: 'info' | 'error' | 'success', actionLabel?: string, onAction?: () => void, duration?: number }} [options]
 */
export function toast(message, { kind = 'info', actionLabel, onAction, duration } = {}) {
  const host = ensureRegion();
  const dismiss = () => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 180);
  };
  const item = h(
    'div',
    { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-message' }, message),
    actionLabel
      ? h(
          'button',
          {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
              onAction?.();
              dismiss();
            },
          },
          actionLabel,
        )
      : null,
  );
  host.append(item);
  while (host.children.length > 4) host.firstElementChild.remove();
  const lifetime = duration ?? (actionLabel ? 8000 : kind === 'error' ? 7000 : 4200);
  setTimeout(dismiss, lifetime);
  return dismiss;
}
