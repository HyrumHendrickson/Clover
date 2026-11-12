/**
 * List rows that are not plain expressions: folders, tables, and the options menu every
 * expression row has (folder, order, style). Shared by the graphing tool and the 3D graph.
 *
 * Each builder takes `env`, the list it lives in:
 * `{ rows, ctx, rebuild(), onChange(), onVisual(), removeRow(id), plot }`
 * where `rows` is the tool's own array (edited in place), `onChange` recompiles, `onVisual`
 * redraws, and `plot` is false when a table only defines lists (the 3D graph).
 */
import { ROW_COLORS, rowColor } from '../lib/graph/draw.js';
import {
  DEFAULT_STYLE,
  LINE_STYLES,
  MAX_TITLE,
  POINT_STYLES,
  TABLE_LIMITS,
  arrangeRows,
  cleanText,
  moveRow,
  moveToFolder,
  normalizeStyle,
  parsePastedTable,
  styleOf,
} from '../lib/graph/rows.js';
import { formatNumber } from '../lib/graph/values.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { createMathField } from './mathfield.js';

const isDark = () => document.documentElement.dataset.theme === 'dark';

/** Where to put the caret after the list rebuilds, which replaces every input. */
let pendingFocus = null;

/** Replace the contents of the tool's row array with a new order, then rebuild the list. */
export function commitRows(env, next) {
  env.rows.splice(0, env.rows.length, ...next);
  env.ctx.save();
  env.rebuild();
  env.onChange();
}

export const folderTitle = (row) => row.text.trim() || 'Folder';

/* ------------------------------------------------------------ options menu */

/**
 * The "more" menu of a row: which folder it is in, move up and down, and style. Style
 * applies to expressions and tables; folders only get the first two.
 */
export function createRowMenu(row, env, { styled = true } = {}) {
  const folders = env.rows.filter((r) => r.kind === 'folder');
  const parts = [];

  if (row.kind !== 'folder' && folders.length > 0) {
    const select = h(
      'select',
      {
        class: 'select gr-folder-select',
        'aria-label': 'Folder',
        onchange: () => commitRows(env, moveToFolder(env.rows, row.id, select.value)),
      },
      h('option', { value: '' }, 'No folder'),
      folders.map((f) => h('option', { value: f.id }, folderTitle(f))),
    );
    select.value = row.folder || '';
    parts.push(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Folder'), select));
  }

  const move = (delta) => {
    const next = moveRow(env.rows, row.id, delta);
    if (next !== env.rows) commitRows(env, next);
  };
  parts.push(
    h(
      'div',
      { class: 'gr-move btn-group', role: 'group', 'aria-label': 'Order' },
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => move(-1) }, icon('arrow-up', 14), 'Move up'),
      h(
        'button',
        { class: 'btn btn-small', type: 'button', onclick: () => move(1) },
        icon('arrow-down', 14),
        'Move down',
      ),
    ),
  );

  if (styled) {
    const set = (key, value) => {
      row.style = normalizeStyle({ ...(row.style ?? {}), [key]: value });
      env.ctx.save();
      env.onVisual();
    };
    const current = () => styleOf(row);
    const choice = (label, key, values) => {
      const select = h(
        'select',
        { class: 'select', 'aria-label': label, onchange: () => set(key, select.value) },
        values.map((v) => h('option', { value: v }, v[0].toUpperCase() + v.slice(1))),
      );
      select.value = current()[key];
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), select);
    };
    const number = (label, key, min, max, step) => {
      const input = h('input', {
        class: 'input gr-bound',
        type: 'number',
        min: String(min),
        max: String(max),
        step: String(step),
        'aria-label': label,
        value: String(current()[key]),
        onchange: () => {
          const v = Number(input.value);
          set(key, Number.isFinite(v) ? v : DEFAULT_STYLE[key]);
          input.value = String(current()[key]);
        },
      });
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
    };
    parts.push(
      h(
        'div',
        { class: 'gr-style', role: 'group', 'aria-label': 'Style' },
        choice('Line', 'line', LINE_STYLES),
        number('Line width', 'width', 0.5, 20, 0.5),
        number('Opacity', 'opacity', 0, 1, 0.1),
        choice('Points', 'point', POINT_STYLES),
        number('Point size', 'size', 2, 40, 1),
        number('Fill', 'fill', 0, 1, 0.1),
        h(
          'button',
          {
            class: 'btn btn-small',
            type: 'button',
            onclick: () => {
              row.style = {};
              env.ctx.save();
              env.onVisual();
              env.rebuild();
            },
          },
          'Reset style',
        ),
      ),
    );
  }

  return h(
    'details',
    { class: 'gr-more' },
    h(
      'summary',
      { class: 'btn btn-quiet btn-icon gr-tool', 'aria-label': 'Row options', title: 'Row options' },
      icon('settings', 14),
    ),
    h('div', { class: 'gr-menu' }, parts),
  );
}

/* ----------------------------------------------------------------- folders */

/** The row for a folder: collapse toggle, title, show/hide for everything inside, delete. */
export function buildFolderRow(row, index, env) {
  const title = h('input', {
    class: 'gr-input gr-folder-title',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    maxlength: String(MAX_TITLE),
    placeholder: 'Folder name',
    'aria-label': `Folder name ${index + 1}`,
    value: row.text,
    oninput: () => {
      row.text = cleanText(title.value).slice(0, MAX_TITLE);
      env.ctx.save();
    },
    onblur: () => env.rebuild(),
  });
  const toggle = h(
    'button',
    {
      class: 'btn btn-quiet btn-icon gr-fold',
      type: 'button',
      'aria-label': `Collapse or expand folder ${index + 1}`,
      'aria-expanded': String(!row.collapsed),
      onclick: () => {
        row.collapsed = !row.collapsed;
        env.ctx.save();
        env.rebuild();
      },
    },
    icon(row.collapsed ? 'arrow-up' : 'arrow-down', 14),
  );
  toggle.classList.toggle('is-collapsed', row.collapsed);
  const dot = h('button', {
    class: `gr-dot${row.hidden ? ' is-off' : ''}`,
    type: 'button',
    'aria-label': `Show or hide everything in folder ${index + 1}`,
    'aria-pressed': String(!row.hidden),
    onclick: () => {
      row.hidden = !row.hidden;
      dot.classList.toggle('is-off', row.hidden);
      dot.setAttribute('aria-pressed', String(!row.hidden));
      env.ctx.save();
      env.onVisual();
    },
  });
  const remove = h(
    'button',
    {
      class: 'btn btn-quiet btn-icon gr-tool',
      type: 'button',
      'aria-label': `Delete folder ${index + 1}, keeping its rows`,
      title: 'Delete folder (its rows stay)',
      onclick: () => {
        const next = env.rows
          .filter((r) => r.id !== row.id)
          .map((r) => (r.folder === row.id ? { ...r, folder: '' } : r));
        commitRows(env, arrangeRows(next));
      },
    },
    icon('close', 14),
  );
  const li = h(
    'li',
    { class: 'gr-row gr-folder', dataset: { id: row.id, kind: 'folder' } },
    dot,
    h('div', { class: 'gr-body gr-folder-body' }, toggle, title),
    h('div', { class: 'gr-actions' }, createRowMenu(row, env, { styled: false }), remove),
  );
  return {
    li,
    field: { el: title, input: title, focus: () => title.focus(), refresh() {}, setValue() {} },
    input: title,
  };
}

/* ------------------------------------------------------------------ tables */

function blankCells(count) {
  return Array.from({ length: count }, () => '');
}

/**
 * A table of values. Column headings are variable names (`x_1`, `y_1`) for columns the person
 * types into, or expressions (`x_1^2`) for computed columns. In the graphing tool every column
 * after the first is plotted against the first.
 */
export function buildTableRow(row, index, env) {
  const grid = [];
  const heads = [];
  const computedCells = [];
  const errorLine = h('p', { class: 'gr-error', role: 'alert', hidden: true });
  const rowCount = () => row.cols[0]?.cells.length ?? 0;
  const table = h('table', { class: 'gr-table' });
  const addRow = h(
    'button',
    { class: 'btn btn-small', type: 'button', onclick: () => grow({ c: 0, r: rowCount() }) },
    icon('plus', 14),
    'Row',
  );
  const addCol = h(
    'button',
    { class: 'btn btn-small', type: 'button', onclick: () => addColumn() },
    icon('plus', 14),
    'Column',
  );

  const changed = () => {
    env.ctx.save();
    env.onChange();
  };
  const rebuildLater = (focus = null) => {
    pendingFocus = focus ? { id: row.id, ...focus } : null;
    env.rebuild();
  };

  function grow(focus = null) {
    if (rowCount() >= TABLE_LIMITS.rows) {
      env.ctx.notify(`A table can have up to ${TABLE_LIMITS.rows} rows.`);
      return;
    }
    for (const c of row.cols) c.cells.push('');
    changed();
    rebuildLater(focus);
  }

  function addColumn() {
    if (row.cols.length >= TABLE_LIMITS.columns) {
      env.ctx.notify(`A table can have up to ${TABLE_LIMITS.columns} columns.`);
      return;
    }
    row.cols.push({
      head: '',
      cells: blankCells(rowCount()),
      color: (row.cols.length + index) % ROW_COLORS.length,
      hidden: false,
      points: true,
      lines: false,
    });
    changed();
    rebuildLater();
  }

  function focusCell(c, r) {
    const target = r < 0 ? heads[c]?.input : grid[c]?.[r];
    target?.focus();
    if (target?.setSelectionRange) {
      const end = target.value.length;
      target.setSelectionRange(end, end);
    }
  }

  function paste(event, c, r) {
    const text = event.clipboardData?.getData('text') ?? '';
    const data = /[\t\n]/.test(text.trim()) ? parsePastedTable(text) : null;
    if (!data) return;
    event.preventDefault();
    const neededRows = Math.min(TABLE_LIMITS.rows, r + data.length);
    const neededCols = Math.min(TABLE_LIMITS.columns, c + data[0].length);
    while (row.cols.length < neededCols) {
      row.cols.push({
        head: `c_${row.cols.length + 1}`,
        cells: blankCells(rowCount()),
        color: (row.cols.length + index) % ROW_COLORS.length,
        hidden: false,
        points: true,
        lines: false,
      });
    }
    for (const col of row.cols) while (col.cells.length < neededRows) col.cells.push('');
    data.forEach((line, i) => {
      line.forEach((cell, j) => {
        if (row.cols[c + j] && r + i < TABLE_LIMITS.rows) row.cols[c + j].cells[r + i] = cell;
      });
    });
    if (r + data.length > TABLE_LIMITS.rows) env.ctx.notify(`Only the first ${TABLE_LIMITS.rows} rows were pasted.`);
    changed();
    rebuildLater({ c, r });
  }

  function cellKey(event, c, r) {
    const input = event.target;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (r + 1 >= rowCount()) {
        if (event.key === 'Enter') grow({ c, r: r + 1 });
      } else focusCell(c, r + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusCell(c, r - 1);
    } else if (event.key === 'ArrowLeft' && atStart && c > 0) {
      event.preventDefault();
      focusCell(c - 1, r);
    } else if (event.key === 'ArrowRight' && atEnd && c + 1 < row.cols.length) {
      event.preventDefault();
      focusCell(c + 1, r);
    }
  }

  function build() {
    grid.length = 0;
    heads.length = 0;
    computedCells.length = 0;
    const dark = isDark();
    const head = h('tr', {});
    const tools = h('tr', { class: 'gr-table-tools' });
    row.cols.forEach((col, c) => {
      const field = createMathField({
        value: col.head,
        label: `Column ${c + 1} heading, table ${index + 1}`,
        placeholder: c === 0 ? 'x_1' : 'y_1',
        maxlength: TABLE_LIMITS.head,
        className: 'gr-input gr-head-input',
        oninput: (text) => {
          col.head = text.trim().slice(0, TABLE_LIMITS.head);
          changed();
        },
        onkeydown: (event) => {
          if (event.key === 'ArrowDown' && !event.defaultPrevented) {
            event.preventDefault();
            focusCell(c, 0);
          }
        },
      });
      heads.push(field);
      grid.push([]);
      head.append(h('th', { scope: 'col' }, field.el));

      const buttons = [];
      if (env.plot && c > 0) {
        const swatch = h('span', { class: 'gr-swatch' });
        swatch.style.setProperty('--row-color', rowColor(col.color, dark));
        buttons.push(
          h(
            'button',
            {
              class: 'btn btn-quiet btn-icon gr-tool',
              type: 'button',
              'aria-label': `Change colour of column ${c + 1}`,
              title: 'Change colour',
              onclick: () => {
                col.color = (col.color + 1) % ROW_COLORS.length;
                swatch.style.setProperty('--row-color', rowColor(col.color, isDark()));
                env.ctx.save();
                env.onVisual();
              },
            },
            swatch,
          ),
        );
        const flag = (label, key, text) => {
          const button = h(
            'button',
            {
              class: 'btn btn-small gr-flag',
              type: 'button',
              'aria-pressed': String(col[key]),
              'aria-label': `${label}, column ${c + 1}`,
              title: label,
              onclick: () => {
                col[key] = !col[key];
                button.setAttribute('aria-pressed', String(col[key]));
                env.ctx.save();
                env.onVisual();
                env.onChange();
              },
            },
            text,
          );
          return button;
        };
        buttons.push(flag('Show points', 'points', 'Dots'), flag('Connect points with lines', 'lines', 'Line'));
        buttons.push(
          h(
            'button',
            {
              class: `btn btn-quiet btn-small gr-flag${col.hidden ? ' is-off' : ''}`,
              type: 'button',
              'aria-pressed': String(!col.hidden),
              'aria-label': `Show or hide column ${c + 1}`,
              title: 'Show or hide',
              onclick: () => {
                col.hidden = !col.hidden;
                env.ctx.save();
                env.onVisual();
                env.rebuild();
              },
            },
            col.hidden ? 'Hidden' : 'Shown',
          ),
        );
      }
      if (row.cols.length > 1) {
        buttons.push(
          h(
            'button',
            {
              class: 'btn btn-quiet btn-icon gr-tool',
              type: 'button',
              'aria-label': `Delete column ${c + 1}`,
              title: 'Delete column',
              onclick: () => {
                row.cols.splice(c, 1);
                changed();
                rebuildLater();
              },
            },
            icon('close', 14),
          ),
        );
      }
      tools.append(h('td', {}, h('div', { class: 'gr-col-tools' }, buttons)));
    });
    head.append(h('th', {}, ''));
    tools.append(h('td', {}, ''));

    const body = [];
    for (let r = 0; r < rowCount(); r += 1) {
      const tr = h('tr', {});
      row.cols.forEach((col, c) => {
        const input = h('input', {
          class: 'gr-cell',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          maxlength: String(TABLE_LIMITS.cell),
          'aria-label': `Row ${r + 1}, column ${c + 1}, table ${index + 1}`,
          value: col.cells[r] ?? '',
          oninput: () => {
            col.cells[r] = input.value.slice(0, TABLE_LIMITS.cell);
            changed();
          },
          onkeydown: (event) => cellKey(event, c, r),
          onpaste: (event) => paste(event, c, r),
        });
        grid[c][r] = input;
        tr.append(h('td', {}, input));
      });
      tr.append(
        h(
          'td',
          {},
          h(
            'button',
            {
              class: 'btn btn-quiet btn-icon gr-tool',
              type: 'button',
              'aria-label': `Delete row ${r + 1}`,
              title: 'Delete row',
              disabled: rowCount() <= 1,
              onclick: () => {
                for (const col of row.cols) col.cells.splice(r, 1);
                changed();
                rebuildLater();
              },
            },
            icon('close', 14),
          ),
        ),
      );
      body.push(tr);
    }
    table.replaceChildren(h('thead', {}, head, tools), h('tbody', {}, body));
  }

  /** Show values for computed columns and problems for any column. */
  function sync(info) {
    const data = info?.table;
    const messages = [];
    row.cols.forEach((col, c) => {
      const meta = data?.columns[c];
      heads[c]?.el.classList.toggle('is-invalid', Boolean(meta?.error));
      if (meta?.error) messages.push(`${col.head || `Column ${c + 1}`}: ${meta.error}`);
      for (let r = 0; r < rowCount(); r += 1) {
        const input = grid[c]?.[r];
        if (!input) continue;
        const computed = meta?.kind === 'computed';
        input.readOnly = computed;
        input.classList.toggle('is-computed', computed);
        if (computed) {
          const at = data.used.indexOf(r);
          const value = at >= 0 ? meta.values?.[at] : undefined;
          input.value = typeof value === 'number' ? formatNumber(value, 6) : '';
        } else if (document.activeElement !== input && input.value !== (col.cells[r] ?? '')) {
          input.value = col.cells[r] ?? '';
        }
      }
    });
    errorLine.textContent = messages.join(' ');
    errorLine.hidden = messages.length === 0;
  }

  build();
  if (pendingFocus?.id === row.id) {
    const { c, r } = pendingFocus;
    pendingFocus = null;
    queueMicrotask(() => focusCell(c, r));
  }
  const dot = h('span', { class: 'gr-dot gr-dot-note', 'aria-hidden': 'true' }, 'T');
  const visible = env.plot
    ? h('button', {
        class: `gr-dot${row.hidden ? ' is-off' : ''}`,
        type: 'button',
        'aria-label': `Show or hide table ${index + 1}`,
        'aria-pressed': String(!row.hidden),
        onclick: () => {
          row.hidden = !row.hidden;
          visible.classList.toggle('is-off', row.hidden);
          visible.setAttribute('aria-pressed', String(!row.hidden));
          env.ctx.save();
          env.onVisual();
          env.onChange();
        },
      })
    : dot;
  const remove = h(
    'button',
    {
      class: 'btn btn-quiet btn-icon gr-tool',
      type: 'button',
      'aria-label': `Delete table ${index + 1}`,
      title: 'Delete',
      onclick: () => env.removeRow(row.id),
    },
    icon('close', 14),
  );
  const li = h(
    'li',
    { class: 'gr-row gr-table-row', dataset: { id: row.id, kind: 'table' } },
    visible,
    h(
      'div',
      { class: 'gr-body' },
      h('div', { class: 'gr-table-wrap' }, table),
      h('div', { class: 'gr-table-add' }, addRow, addCol),
      errorLine,
    ),
    h('div', { class: 'gr-actions' }, createRowMenu(row, env, { styled: env.plot }), remove),
  );
  const first = () => heads[0];
  return {
    li,
    sync,
    field: { el: table, input: heads[0]?.input, focus: () => first()?.focus(), refresh() {}, setValue() {} },
    input: heads[0]?.input,
  };
}
