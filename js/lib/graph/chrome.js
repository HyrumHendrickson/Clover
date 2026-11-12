import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';

/**
 * A button for the corner of a graph that hides and shows the expression list beside it, as in Desmos.
 * It toggles `is-collapsed` on the nearest `.graph-layout`; the graph resizes itself.
 */
export function sidebarToggle() {
  const button = h('button', {
    class: 'btn btn-icon gr-sidebar-toggle',
    type: 'button',
    'aria-label': 'Hide expression list',
    'aria-expanded': 'true',
    title: 'Hide expression list',
    onclick: () => {
      const collapsed = button.closest('.graph-layout')?.classList.toggle('is-collapsed') === true;
      const label = collapsed ? 'Show expression list' : 'Hide expression list';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', label);
      button.title = label;
    },
  });
  button.append(icon('sidebar'));
  return button;
}
