/**
 * Row structure shared by the graphing tool, the 3D graph, and anything else that
 * edits a list of rows: validation of saved state, folders, tables, and per-row style.
 *
 * A table is not compiled specially. `expandRows` turns each one into ordinary rows:
 * a definition for every column the person typed values into (`x_1 = [1, 2, 3]`), a
 * value row for every computed column, and, in 2D, one plotted row per column
 * `(x_1, y_1)`. The model then treats them like any other rows, so tables get
 * dependency ordering, error reporting, and use from other rows for free.
 *
 * Pure: no DOM access.
 */

/** Number of colours in the palette (`ROW_COLORS` in draw.js; a test keeps them equal). */
export const COLOR_COUNT = 6;

export const MAX_TEXT = 500;
export const MAX_FIELD = 40;
export const MAX_TITLE = 80;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

export const TABLE_LIMITS = Object.freeze({ columns: 8, rows: 500, cell: 40, head: 60 });

export const LINE_STYLES = ['solid', 'dashed', 'dotted'];
export const POINT_STYLES = ['point', 'open', 'cross', 'square', 'plus', 'triangle', 'diamond', 'star'];
/** What a row looks like when nothing is set. Rows store only what differs. */
export const DEFAULT_STYLE = Object.freeze({
  line: 'solid',
  width: 2.5,
  opacity: 1,
  point: 'point',
  size: 10,
  fill: 0.3,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, lo, hi, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback);

export const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) : '';
export const cleanField = (value) => (typeof value === 'string' && value.length <= MAX_FIELD ? value : '');
const cleanCell = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, TABLE_LIMITS.cell)
    : '';
const cleanHead = (value) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, TABLE_LIMITS.head)
    : '';

/** Keep only style values that differ from the defaults, each inside its allowed range. */
export function normalizeStyle(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (LINE_STYLES.includes(raw.line) && raw.line !== DEFAULT_STYLE.line) out.line = raw.line;
  if (POINT_STYLES.includes(raw.point) && raw.point !== DEFAULT_STYLE.point) out.point = raw.point;
  for (const [key, lo, hi] of [
    ['width', 0.5, 20],
    ['opacity', 0, 1],
    ['size', 2, 40],
    ['fill', 0, 1],
  ]) {
    const v = num(raw[key], lo, hi, DEFAULT_STYLE[key]);
    if (v !== DEFAULT_STYLE[key]) out[key] = Math.round(v * 100) / 100;
  }
  return out;
}

export const styleOf = (row) => ({ ...DEFAULT_STYLE, ...(row?.style ?? {}) });

/* ------------------------------------------------------------ validation */

const BARE_NAME = /^[A-Za-z](?:_\d+|_[A-Za-z]|_\{[A-Za-z0-9]+\})?$/;
/** Is this column heading one variable name, such as `x_1`? Those columns hold typed values. */
export const isVariableHead = (head) => BARE_NAME.test(head.trim());

function normalizeColumn(raw, index, count) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const cells = (Array.isArray(c.cells) ? c.cells : []).slice(0, TABLE_LIMITS.rows).map(cleanCell);
  return {
    head: cleanHead(c.head),
    cells,
    color: Number.isInteger(c.color) && c.color >= 0 && c.color < COLOR_COUNT ? c.color : (index + count) % COLOR_COUNT,
    hidden: c.hidden === true,
    points: c.points !== false,
    lines: c.lines === true,
  };
}

/** Names for a new table's first two columns, using the lowest subscript no table has used. */
export function nextTableNames(rows) {
  const used = new Set();
  for (const r of rows) {
    if (r.kind !== 'table') continue;
    for (const c of r.cols ?? []) used.add(c.head);
  }
  let n = 1;
  while (used.has(`x_${n}`) || used.has(`y_${n}`)) n += 1;
  return [`x_${n}`, `y_${n}`];
}

/** A new table: two named columns and a few empty rows. */
export function emptyTable(id, colorStart, names = ['x_1', 'y_1'], rowCount = 3) {
  return {
    id,
    kind: 'table',
    folder: '',
    hidden: false,
    style: {},
    cols: names.map((head, i) => ({
      head,
      cells: Array.from({ length: rowCount }, () => ''),
      color: (colorStart + i) % COLOR_COUNT,
      hidden: false,
      points: true,
      lines: false,
    })),
  };
}

/**
 * Validate rows from saved or imported state. Unknown kinds become expressions; ids stay
 * unique; colours stay in the palette; text stays bounded; a row's folder must be a folder
 * in this list. Folders and tables are dropped when `structured` is false.
 */
export function normalizeRowList(
  raw,
  { max = 60, taken = new Set(), startColor = 0, structured = true, ranges = null } = {},
) {
  let entries = (Array.isArray(raw) ? raw : []).filter((r) => r && typeof r === 'object');
  if (!structured) entries = entries.filter((r) => r.kind !== 'folder' && r.kind !== 'table');
  entries = entries.slice(0, max);
  const own = new Set();
  const ids = entries.map((r) => {
    if (typeof r.id === 'string' && ID_PATTERN.test(r.id) && !taken.has(r.id) && !own.has(r.id)) {
      own.add(r.id);
      return r.id;
    }
    return null;
  });
  let n = 0;
  const fresh = () => {
    do n += 1;
    while (taken.has(`r${n}`) || own.has(`r${n}`));
    own.add(`r${n}`);
    return `r${n}`;
  };
  const rows = entries.map((r, i) => {
    const id = ids[i] ?? fresh();
    const color =
      Number.isInteger(r.color) && r.color >= 0 && r.color < COLOR_COUNT ? r.color : (startColor + i) % COLOR_COUNT;
    const folder = typeof r.folder === 'string' ? r.folder : '';
    if (r.kind === 'folder') {
      return {
        id,
        kind: 'folder',
        text: cleanText(r.text).slice(0, MAX_TITLE),
        collapsed: r.collapsed === true,
        hidden: r.hidden === true,
      };
    }
    if (r.kind === 'table') {
      const cols = (Array.isArray(r.cols) ? r.cols : []).slice(0, TABLE_LIMITS.columns);
      const length = Math.max(
        1,
        ...cols.map((c) => (Array.isArray(c?.cells) ? Math.min(c.cells.length, TABLE_LIMITS.rows) : 0)),
      );
      const fixed = cols.map((c, k) => normalizeColumn(c, k, startColor + i));
      for (const c of fixed) while (c.cells.length < length) c.cells.push('');
      if (fixed.length === 0) {
        const blank = emptyTable(id, startColor + i);
        return { ...blank, folder, hidden: r.hidden === true };
      }
      return { id, kind: 'table', folder, hidden: r.hidden === true, style: normalizeStyle(r.style), cols: fixed };
    }
    const row = {
      id,
      kind: r.kind === 'note' ? 'note' : 'expr',
      text: cleanText(r.text),
      color,
      hidden: r.hidden === true,
      min: cleanField(r.min),
      max: cleanField(r.max),
      step: cleanField(r.step),
      tmin: cleanField(r.tmin),
      tmax: cleanField(r.tmax),
      folder,
      style: normalizeStyle(r.style),
    };
    if (ranges) row.ranges = ranges(r.ranges);
    return row;
  });
  const folders = new Set(rows.filter((r) => r.kind === 'folder').map((r) => r.id));
  for (const row of rows) if (row.kind !== 'folder' && !folders.has(row.folder)) row.folder = '';
  for (const id of own) taken.add(id);
  return arrangeRows(rows);
}

/* --------------------------------------------------------------- folders */

/**
 * Put every folder's rows directly after the folder, in their current order. Folders do not
 * nest, so a folder row is always at the top level.
 */
export function arrangeRows(rows) {
  const members = new Map();
  for (const r of rows) {
    if (r.kind !== 'folder' && r.folder) {
      if (!members.has(r.folder)) members.set(r.folder, []);
      members.get(r.folder).push(r);
    }
  }
  const out = [];
  for (const r of rows) {
    if (r.kind !== 'folder' && r.folder && members.has(r.folder)) continue;
    out.push(r);
    if (r.kind === 'folder') out.push(...(members.get(r.id) ?? []));
  }
  return out;
}

export const folderOf = (rows, row) =>
  row.folder ? (rows.find((r) => r.id === row.folder && r.kind === 'folder') ?? null) : null;

/** Is a row hidden by its own flag or by its folder's? */
export const isHidden = (rows, row) => row.hidden === true || folderOf(rows, row)?.hidden === true;

/** Is a row out of sight in the list because its folder is collapsed? */
export const isCollapsed = (rows, row) => folderOf(rows, row)?.collapsed === true;

/**
 * Move a row into a folder, or out of every folder when `folderId` is empty. A row that joins a
 * folder keeps its place among the folder's rows by its old position; one that leaves lands just
 * after the folder it left. Returns the new order.
 */
export function moveToFolder(rows, id, folderId) {
  const target = rows.find((r) => r.id === id);
  if (!target || target.kind === 'folder') return rows;
  const valid = folderId && rows.some((f) => f.id === folderId && f.kind === 'folder') ? folderId : '';
  return arrangeRows(rows.map((r) => (r.id === id ? { ...r, folder: valid } : r)));
}

/**
 * Move a row one place up (-1) or down (1) among the rows it sits with. A folder moves
 * together with its rows. Returns the new order, or the same array when it cannot move.
 */
export function moveRow(rows, id, delta) {
  const row = rows.find((r) => r.id === id);
  if (!row) return rows;
  // Work on blocks: a folder with its rows is one block; any other top-level row is its own.
  if (row.folder) {
    const siblings = rows.filter((r) => r.folder === row.folder);
    const at = siblings.findIndex((r) => r.id === id);
    const swap = siblings[at + delta];
    if (!swap) return rows;
    return rows.map((r) => (r.id === id ? swap : r.id === swap.id ? row : r));
  }
  const blocks = [];
  for (const r of rows) {
    if (r.kind !== 'folder' && r.folder) blocks[blocks.length - 1].push(r);
    else blocks.push([r]);
  }
  const at = blocks.findIndex((b) => b[0].id === id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= blocks.length) return rows;
  [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
  return blocks.flat();
}

/* ----------------------------------------------------------------- tables */

/**
 * Which rows of a table are complete: every column the person types values into has
 * something in that row. Rows that are not complete are ignored, as in Desmos.
 */
export function completeRows(table) {
  const typed = table.cols.filter((c) => isVariableHead(c.head) && c.cells.some((v) => v !== ''));
  const length = Math.max(0, ...table.cols.map((c) => c.cells.length));
  const used = [];
  for (let i = 0; i < length; i += 1) {
    if (typed.length > 0 && typed.every((c) => (c.cells[i] ?? '') !== '')) used.push(i);
  }
  return used;
}

/** Why a cell cannot be used as one value, or null. */
const BAD_CELL = /[,[\]{}=<>~]/;
export function cellProblem(text) {
  if (BAD_CELL.test(text))
    return 'Each cell holds one number or expression, with no commas, brackets, or equals signs.';
  return null;
}

/** Ids of the rows a table expands into. */
export const tableIds = {
  definition: (id, k) => `${id}:d${k}`,
  value: (id, k) => `${id}:v${k}`,
  plot: (id, k) => `${id}:p${k}`,
};

/**
 * Expand rows for compilation: tables become definition, value, and plot rows; folders and
 * notes pass through as kinds the model skips. `owner` on a synthetic row is its table.
 *
 * @param {object[]} rows
 * @param {{ plot?: boolean }} [options] `plot: false` (the 3D graph) defines columns but draws nothing.
 * @returns {{ rows: object[], tables: Map<string, object> }}
 */
export function expandRows(rows, { plot = true } = {}) {
  const out = [];
  const tables = new Map();
  for (const row of rows) {
    if (row.kind !== 'table') {
      out.push(row);
      continue;
    }
    const used = completeRows(row);
    const meta = { id: row.id, used, columns: row.cols.map(() => ({ kind: 'empty', problem: null, ids: [] })) };
    tables.set(row.id, meta);
    out.push({ id: row.id, kind: 'table', text: '', hidden: row.hidden, owner: null });
    const heads = row.cols.map((c) => c.head.trim());
    row.cols.forEach((col, k) => {
      const head = heads[k];
      const info = meta.columns[k];
      if (head === '') return;
      if (isVariableHead(head) && col.cells.some((v) => v !== '')) {
        info.kind = 'typed';
        const bad = col.cells.map(cellProblem).find((p) => p);
        if (bad) {
          info.problem = bad;
          return;
        }
        const id = tableIds.definition(row.id, k);
        info.ids.push(id);
        out.push({
          id,
          kind: 'expr',
          text: `${head} = [${used.map((i) => col.cells[i]).join(', ')}]`,
          color: col.color,
          hidden: true,
          owner: row.id,
          column: k,
        });
      } else if (isVariableHead(head)) {
        info.kind = 'named';
      } else {
        info.kind = 'computed';
        const id = tableIds.value(row.id, k);
        info.ids.push(id);
        out.push({ id, kind: 'expr', text: head, color: col.color, hidden: true, owner: row.id, column: k });
      }
    });
    if (!plot) continue;
    for (let k = 1; k < row.cols.length; k += 1) {
      const col = row.cols[k];
      if (heads[0] === '' || heads[k] === '') continue;
      const id = tableIds.plot(row.id, k);
      meta.columns[k].plotId = id;
      out.push({
        id,
        kind: 'expr',
        text: `(${heads[0]}, ${heads[k]})`,
        color: col.color,
        hidden: row.hidden || col.hidden,
        owner: row.id,
        column: k,
        plotOnly: true,
        style: { ...row.style, points: col.points, lines: col.lines },
      });
    }
  }
  return { rows: out, tables };
}

/**
 * The things to draw, in order: every visible row's plot, and a table's plotted columns.
 * `info(id)` returns the model's information for a row or a table's synthetic row.
 *
 * @returns {{ id: string, rowId: string, plot: object, colorIndex: number, style: object }[]}
 */
export function drawableItems(rows, info) {
  const items = [];
  for (const row of rows) {
    if (row.kind === 'note' || row.kind === 'folder' || isHidden(rows, row)) continue;
    if (row.kind === 'table') {
      row.cols.forEach((col, k) => {
        if (k === 0 || col.hidden) return;
        const id = tableIds.plot(row.id, k);
        const plot = info(id)?.plot;
        if (plot) {
          items.push({
            id,
            rowId: row.id,
            plot,
            colorIndex: col.color,
            style: { ...styleOf(row), points: col.points, lines: col.lines },
          });
        }
      });
      continue;
    }
    const plot = info(row.id)?.plot;
    if (plot) items.push({ id: row.id, rowId: row.id, plot, colorIndex: row.color, style: styleOf(row) });
  }
  return items;
}

/** Parse tab- or comma-separated text, as pasted from a spreadsheet, into rows of cells. */
export function parsePastedTable(text) {
  if (typeof text !== 'string') return null;
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.some((l) => l.includes(',')) ? ',' : null;
  if (sep === null && lines.length < 2) return null;
  const grid = lines.map((l) => (sep ? l.split(sep) : [l]).map((c) => c.trim()));
  const width = Math.max(...grid.map((r) => r.length));
  if (width < 1) return null;
  return grid.map((r) => Array.from({ length: width }, (_, i) => cleanCell(r[i] ?? '')));
}
