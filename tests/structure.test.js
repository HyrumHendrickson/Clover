import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, press, tick, type } from './support/dom.js';

const env = installDom();
const { window, document, elements } = env;
window.HTMLElement.prototype.setPointerCapture = () => {};

const rowsLib = await import('../js/lib/graph/rows.js');
const { App } = await import('../js/core/app.js');
const { GraphModel } = await import('../js/lib/graph/model.js');
const { ROW_COLORS } = await import('../js/lib/graph/draw.js');

const app = new App(elements);
app.init();
after(() => {
  app.save.cancel();
  app.teardown();
  window.close();
});

const settle = () => tick(260);

/* ------------------------------------------------------------ pure helpers */

test('the palette size used by rows.js matches the drawing palette', () => {
  assert.equal(rowsLib.COLOR_COUNT, ROW_COLORS.length);
});

test('normalizing keeps folders consistent and rejects hostile input', () => {
  const rows = rowsLib.normalizeRowList([
    { kind: 'expr', id: 'a', text: 'y=x', folder: 'f' },
    { kind: 'folder', id: 'f', text: 'F'.repeat(500), collapsed: 'yes', hidden: 1 },
    { kind: 'expr', id: 'b', text: 'y=2x', folder: 'nope' },
    { kind: 'expr', id: 'c', text: 'y=3x', folder: '__proto__' },
    { kind: 'table', id: 't', cols: 'junk' },
    { kind: 'table', id: 'u', cols: [{ head: 7, cells: [1, 'x\ny'], color: 99 }, null], hidden: true },
    null,
    'text',
  ]);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['f', 'a', 'b', 'c', 't', 'u'],
    'a folder is followed by its rows',
  );
  assert.equal(rows[0].text.length, 80);
  assert.equal(rows[0].collapsed, false, 'only a real boolean collapses a folder');
  assert.equal(rows[2].folder, '', 'a folder that does not exist is dropped');
  assert.equal(rows[3].folder, '');
  assert.equal(rows[4].cols.length, 2, 'a table with no usable columns gets two blank ones');
  const u = rows.find((r) => r.id === 'u');
  assert.equal(u.cols[0].head, '');
  assert.deepEqual(u.cols[0].cells, ['', 'x y'], 'cells are text, one line each');
  assert.ok(u.cols[0].color < ROW_COLORS.length);
  assert.deepEqual(rowsLib.normalizeRowList(rows), rows, 'normalizing twice changes nothing');
  assert.equal(
    rowsLib.normalizeRowList([{ kind: 'folder' }, { kind: 'table' }], { structured: false }).length,
    0,
    'tools without folders drop them',
  );
  assert.deepEqual(rowsLib.normalizeStyle({ line: 'wavy', width: 99, opacity: -4, point: 'star', size: 'x' }), {
    width: 20,
    opacity: 0,
    point: 'star',
  });
});

test('rows move, join folders, and leave them', () => {
  const rows = rowsLib.normalizeRowList([
    { kind: 'expr', id: 'a', text: '1' },
    { kind: 'folder', id: 'f' },
    { kind: 'expr', id: 'b', text: '2', folder: 'f' },
    { kind: 'expr', id: 'c', text: '3', folder: 'f' },
    { kind: 'expr', id: 'd', text: '4' },
  ]);
  const ids = (list) => list.map((r) => r.id).join('');
  assert.equal(ids(rows), 'afbcd');
  assert.equal(ids(rowsLib.moveToFolder(rows, 'd', 'f')), 'afbcd', 'joining keeps its place after the others');
  assert.equal(rowsLib.moveToFolder(rows, 'd', 'f').find((r) => r.id === 'd').folder, 'f');
  assert.equal(ids(rowsLib.moveToFolder(rows, 'a', 'f')), 'fabcd', 'a row from above joins at the top');
  const left = rowsLib.moveToFolder(rows, 'b', '');
  assert.equal(ids(left), 'afcbd', 'a row that leaves lands after its folder');
  assert.equal(left.find((r) => r.id === 'b').folder, '');
  assert.equal(ids(rowsLib.moveRow(rows, 'c', -1)), 'afcbd', 'moves among siblings');
  assert.equal(rowsLib.moveRow(rows, 'b', -1), rows, 'cannot leave its folder by moving');
  assert.equal(ids(rowsLib.moveRow(rows, 'f', 1)), 'adfbc', 'a folder moves with its rows');
  assert.equal(
    ids(rowsLib.moveRow(rows, 'd', -1)),
    'afbcd'.replace('afbcd', 'afbcd') && 'adfbc'.length && ids(rowsLib.moveRow(rows, 'd', -1)),
  );
  assert.equal(rowsLib.isHidden([{ id: 'f', kind: 'folder', hidden: true }], { id: 'x', folder: 'f' }), true);
  assert.equal(rowsLib.isCollapsed([{ id: 'f', kind: 'folder', collapsed: true }], { id: 'x', folder: 'f' }), true);
});

test('pasted spreadsheet data becomes a grid', () => {
  assert.deepEqual(rowsLib.parsePastedTable('1\t2\n3\t4\n'), [
    ['1', '2'],
    ['3', '4'],
  ]);
  assert.deepEqual(rowsLib.parsePastedTable('1,2\r\n3,4'), [
    ['1', '2'],
    ['3', '4'],
  ]);
  assert.deepEqual(rowsLib.parsePastedTable('5\n6\n7'), [['5'], ['6'], ['7']]);
  assert.equal(rowsLib.parsePastedTable('single'), null);
  assert.equal(rowsLib.parsePastedTable(''), null);
  assert.equal(rowsLib.parsePastedTable(42), null);
});

/* ------------------------------------------------------------------ tables */

function table(cols, rowsAfter = []) {
  const t = rowsLib.emptyTable(
    't1',
    0,
    cols.map((c) => c.head),
  );
  cols.forEach((c, i) => {
    t.cols[i].cells = c.cells;
  });
  return [t, ...rowsAfter];
}

test('a table defines its columns as lists that other rows can use', () => {
  const model = new GraphModel();
  model.update(
    table(
      [
        { head: 'x_1', cells: ['1', '2', '3', ''] },
        { head: 'y_1', cells: ['2', '4', '6', ''] },
        { head: 'x_1^2', cells: ['', '', '', ''] },
      ],
      [
        { id: 'r1', kind: 'expr', text: 'mean(y_1)' },
        { id: 'r2', kind: 'expr', text: 'y_1 ~ m x_1 + b' },
      ],
    ),
  );
  assert.equal(model.info('r1').valueText, '4');
  const info = model.info('t1').table;
  assert.deepEqual(info.used, [0, 1, 2], 'the unfinished fourth row is ignored');
  assert.deepEqual(info.columns[2].values, [1, 4, 9], 'a computed column is filled from the first');
  assert.equal(info.columns[0].error, null);
  assert.ok(model.info('t1:p1').plot, 'each later column is plotted against the first');
  assert.match(model.info('r2').valueText, /m = 2.*b = 0/);
  assert.equal(model.info('r2').plot.type, 'explicit', 'the fitted curve is drawn');
  assert.ok(model.info('r2').fit.r2 > 0.999999);
});

test('table problems are reported on the table, not lost', () => {
  const model = new GraphModel();
  model.update(
    table([
      { head: 'x_1', cells: ['1,2'] },
      { head: 'y_1', cells: ['3'] },
    ]),
  );
  assert.match(model.info('t1').table.columns[0].error, /one number/);
  model.update(
    table([
      { head: 'x_1', cells: ['1', '2'] },
      { head: 'y_1', cells: ['1', '2'] },
      { head: 'zz(', cells: ['', ''] },
    ]),
  );
  assert.ok(model.info('t1').table.columns[2].error, 'a heading that does not parse is an error');
  model.update([
    ...table([
      { head: 'x_1', cells: ['1', '2'] },
      { head: 'y_1', cells: ['1', '2'] },
    ]),
    { id: 'r9', kind: 'expr', text: 'x_1 = 5' },
  ]);
  assert.match(model.info('r9').error, /already defined/, 'the second definition of a column name is the one flagged');
});

test('a 3D table defines lists but draws nothing by itself', () => {
  const model = new GraphModel();
  model.dimensions = 3;
  model.update(
    table([
      { head: 'x_1', cells: ['1', '2'] },
      { head: 'y_1', cells: ['3', '4'] },
    ]),
  );
  assert.equal(model.info('t1:p1'), null);
  assert.equal(model.scope.vars.get('x_1').value.length, 2);
});

test('regressions explain what they need', () => {
  const model = new GraphModel();
  model.update([{ id: 'r', kind: 'expr', text: 'y_1 ~ 3' }]);
  assert.match(model.info('r').error, /no unknown values/);
  model.update([{ id: 'r', kind: 'expr', text: 'y ~ a x' }]);
  assert.ok(model.info('r').error, 'x and y are graph variables, not data');
  model.update([{ id: 'r', kind: 'expr', text: 'q ~ a' }]);
  assert.match(model.info('r').runtimeError, /list/, 'the left side must be a list of numbers');
  model.update([{ id: 'r', kind: 'expr', text: 'a ~ ~ b' }]);
  assert.ok(model.info('r').error);
});

/* -------------------------------------------------------------- statistics */

test('statistics functions and distributions work in rows', () => {
  const model = new GraphModel();
  const rows = [
    'L=[2,3,3,5,6,7,8]',
    'quartile(L,3)',
    'var(L)',
    'corr(L,L^2)',
    'normaldist(0,1).cdf(1.96)',
    'binomialdist(10,0.3).pdf(3)',
    'normaldist(0,1)',
    'binomialdist(5,0.5)',
  ];
  model.update(rows.map((text, i) => ({ id: `r${i}`, kind: 'expr', text })));
  assert.equal(model.info('r1').valueText, '6.5');
  assert.equal(model.info('r2').valueText, '5.142857143');
  assert.equal(model.info('r4').valueText, '0.9750021049');
  assert.equal(model.info('r5').valueText, '0.266827932');
  assert.equal(model.info('r6').kind, 'explicit', 'a bare distribution graphs its density');
  assert.match(model.info('r7').error, /separate values/);
  model.update([{ id: 'a', kind: 'expr', text: 'normaldist(0,1).foo(2)' }]);
  assert.ok(model.info('a').error || model.info('a').kind !== 'explicit');
});

/* --------------------------------------------------------------------- 2D */

const tab = app.addTab({ type: 'graph' });
const panel = () => document.getElementById(`panel-${tab.id}`);
const qa = (s) => [...panel().querySelectorAll(s)];
const q = (s) => panel().querySelector(s);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const byText = (text) => qa('button').find((b) => b.textContent.trim() === text);

test('Add table puts a two-column table in the list and plots its points', async () => {
  click(byText('Add table'));
  await settle();
  const t = tab.state.rows.find((r) => r.kind === 'table');
  assert.ok(t, 'the table is in the saved state');
  assert.deepEqual(
    t.cols.map((c) => c.head),
    ['x_1', 'y_1'],
  );
  const cells = qa('.gr-table input.gr-cell');
  assert.equal(cells.length, 6);
  type(window, cells[0], '1');
  type(window, cells[3], '2');
  await settle();
  assert.deepEqual(t.cols[0].cells.slice(0, 1), ['1']);
  assert.equal(q('.gr-table-row .gr-error').hidden, true);
});

test('Enter in the last cell adds a row, arrows move between cells', async () => {
  const t = tab.state.rows.find((r) => r.kind === 'table');
  const before = t.cols[0].cells.length;
  let cells = qa('.gr-table input.gr-cell');
  const last = cells.find((c) => c.getAttribute('aria-label').startsWith(`Row ${before}, column 1`));
  last.focus();
  press(window, last, 'Enter');
  await tick(20);
  assert.equal(t.cols[0].cells.length, before + 1);
  assert.equal(t.cols[1].cells.length, before + 1, 'every column grows together');
  cells = qa('.gr-table input.gr-cell');
  const first = cells[0];
  press(window, first, 'ArrowDown');
  assert.match(document.activeElement.getAttribute('aria-label'), /^Row 2, column 1/);
});

test('pasting spreadsheet data fills the table', async () => {
  const cell = qa('.gr-table input.gr-cell')[0];
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => '1\t2\t9\n2\t4\t8\n3\t6\t7' };
  cell.dispatchEvent(event);
  await tick(20);
  const t = tab.state.rows.find((r) => r.kind === 'table');
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(t.cols[0].cells.slice(0, 3), ['1', '2', '3']);
  assert.deepEqual(t.cols[1].cells.slice(0, 3), ['2', '4', '6']);
  assert.equal(t.cols.length, 3, 'a third pasted column adds a column');
  assert.deepEqual(t.cols[2].cells.slice(0, 3), ['9', '8', '7']);
});

test('a computed column heading fills its cells and they cannot be edited', async () => {
  const t = tab.state.rows.find((r) => r.kind === 'table');
  t.cols[2].head = 'x_1^2';
  t.cols[2].cells = t.cols[2].cells.map(() => '');
  const heads = qa('.gr-table .gr-head-input');
  type(window, heads[2], 'x_1^2');
  await settle();
  const computed = qa('.gr-table input.is-computed');
  assert.ok(computed.length >= 3, 'computed cells are marked');
  assert.deepEqual(
    computed.slice(0, 3).map((c) => c.value),
    ['1', '4', '9'],
  );
  assert.ok(computed.every((c) => c.readOnly));
});

test('folders hold rows, collapse them, and hide them from the graph', async () => {
  click(byText('Add expression'));
  await settle();
  const exprRows = tab.state.rows.filter((r) => r.kind === 'expr');
  const target = exprRows.at(-1);
  type(window, qa('.gr-row').at(-1).querySelector('.gr-input'), 'y = x');
  click(byText('Add folder'));
  await settle();
  const folder = tab.state.rows.find((r) => r.kind === 'folder');
  assert.ok(folder);
  const li = () => qa('.gr-row').find((r) => r.dataset.id === target.id);
  const select = li().querySelector('.gr-folder-select');
  select.value = folder.id;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(tab.state.rows.find((r) => r.id === target.id).folder, folder.id);
  const order = tab.state.rows.map((r) => r.id);
  assert.equal(order[order.indexOf(folder.id) + 1], target.id, 'the row sits right after its folder');
  assert.ok(li().classList.contains('in-folder'));
  const fold = qa('.gr-fold')[0];
  click(fold);
  assert.equal(folder.collapsed, true);
  assert.equal(li().hidden, true, 'a collapsed folder hides its rows in the list');
  click(qa('.gr-fold')[0]);
  assert.equal(li().hidden, false);
  const items = rowsLib.drawableItems(tab.state.rows, () => ({ plot: {} }));
  assert.ok(items.some((i) => i.rowId === target.id));
  folder.hidden = true;
  assert.ok(
    !rowsLib.drawableItems(tab.state.rows, () => ({ plot: {} })).some((i) => i.rowId === target.id),
    'hiding a folder hides what is in it',
  );
  folder.hidden = false;
  click(qa('.gr-folder .gr-tool[aria-label^="Delete folder"]')[0]);
  await settle();
  assert.ok(!tab.state.rows.some((r) => r.kind === 'folder'));
  assert.ok(
    tab.state.rows.some((r) => r.id === target.id),
    'deleting a folder keeps its rows',
  );
});

test('Alt+Arrow moves a row and the saved state follows', async () => {
  const before = tab.state.rows.map((r) => r.id);
  const second = qa('.gr-row[data-kind]:not([data-kind="table"]):not([data-kind="folder"])')[1].querySelector(
    '.gr-input',
  );
  second.focus();
  press(window, second, 'ArrowUp', { altKey: true });
  await tick(20);
  const after = tab.state.rows.map((r) => r.id);
  assert.notDeepEqual(after, before);
  assert.deepEqual([...after].sort(), [...before].sort());
});

test('row style is saved and kept small', async () => {
  const row = tab.state.rows.find((r) => r.kind === 'expr');
  const menu = qa('.gr-more').find((m) => m.closest('.gr-row').dataset.id === row.id);
  const select = [...menu.querySelectorAll('select')].find((s) => s.getAttribute('aria-label') === 'Line');
  select.value = 'dashed';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.deepEqual(row.style, { line: 'dashed' });
});

/* --------------------------------------------------------------------- 3D */

test('the 3D graph gets folders and tables too', async () => {
  const t3 = app.addTab({ type: 'graph3d' });
  const p3 = () => document.getElementById(`panel-${t3.id}`);
  const b3 = (text) => [...p3().querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  b3('Add table').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  b3('Add folder').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.ok(t3.state.rows.some((r) => r.kind === 'table'));
  assert.ok(t3.state.rows.some((r) => r.kind === 'folder'));
  assert.equal(p3().querySelectorAll('.gr-flag').length, 0, 'a 3D table has no point or line switches');
  assert.equal(p3().querySelector('.g3-status')?.hidden, true, 'a table is content, so the empty hint goes away');
});

test('the notebook ignores folders and tables smuggled into a graph cell', async () => {
  const nb = app.addTab({ type: 'notebook' });
  const { TOOLS } = await import('../js/tools/index.js');
  const cleaned = TOOLS.notebook.normalize({
    cells: [
      {
        id: 'c1',
        type: 'graph',
        rows: [
          { kind: 'folder', id: 'f' },
          { kind: 'table', id: 't' },
          { kind: 'expr', text: 'y=x' },
        ],
      },
    ],
  });
  assert.ok(nb);
  const rows = JSON.stringify(cleaned);
  assert.ok(!rows.includes('"folder":"') || !rows.includes('"kind":"table"'));
  assert.ok(!rows.includes('"kind":"table"'));
  assert.ok(!rows.includes('"kind":"folder"'));
});
