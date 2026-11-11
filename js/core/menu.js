import { h } from './dom.js';
import { icon } from './icons.js';

let current = null;

export function closeMenu() {
  if (current) current.close();
}

/**
 * Open a popup menu.
 * @param {HTMLElement | { x: number, y: number }} anchor element to attach to, or a point
 * @param {Array<{ label?: string, hint?: string, icon?: string, disabled?: boolean, separator?: boolean, onSelect?: () => void }>} items
 * @param {{ align?: 'start' | 'end' }} [options]
 */
export function openMenu(anchor, items, { align = 'start' } = {}) {
  closeMenu();
  const previousFocus = document.activeElement;
  const menu = h('div', { class: 'menu', role: 'menu' });
  const buttons = [];

  const close = ({ restoreFocus = true } = {}) => {
    if (current?.menu !== menu) return;
    current = null;
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
    if (restoreFocus && previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
  };

  const onOutside = (event) => {
    if (!menu.contains(event.target)) close({ restoreFocus: false });
  };

  for (const item of items) {
    if (item.separator) {
      menu.append(h('div', { class: 'menu-separator', role: 'separator' }));
      continue;
    }
    const button = h(
      'button',
      {
        class: 'menu-item',
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled === true,
        onclick: () => {
          close();
          item.onSelect?.();
        },
      },
      item.icon ? icon(item.icon, 16) : h('span', { class: 'menu-icon-gap' }),
      h('span', { class: 'menu-label' }, item.label ?? ''),
      item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null,
    );
    buttons.push(button);
    menu.append(button);
  }

  menu.addEventListener('keydown', (event) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const index = enabled.indexOf(document.activeElement);
    const move = (to) => {
      event.preventDefault();
      enabled[(to + enabled.length) % enabled.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index < 0 ? -1 : index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(-1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close({ restoreFocus: false });
  });

  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  let left;
  let top;
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    left = align === 'end' ? rect.right - box.width : rect.left;
    top = rect.bottom + 6;
  } else {
    left = anchor.x;
    top = anchor.y;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - box.height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  current = { menu, close };
  (buttons.find((b) => !b.disabled) ?? menu).focus();
  return close;
}
