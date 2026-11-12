/** Reading and writing comma-, tab-, and semicolon-separated text. Pure functions, no DOM. */

const DELIMITERS = [',', '\t', ';'];

/** The delimiter used on the first non-blank line, ignoring any inside quotes. Defaults to a comma. */
export function detectDelimiter(text) {
  const first = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .find((line) => line.trim() !== '');
  if (first === undefined) return ',';
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of first) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ',';
  let most = 0;
  for (const [d, n] of counts) {
    if (n > most) {
      best = d;
      most = n;
    }
  }
  return best;
}

/**
 * Parse delimited text into rows of trimmed cells. Quoted fields may hold delimiters, line breaks, and
 * doubled quotes. Rows that are entirely blank are dropped. Rows are padded to the same width.
 * @param {string} text
 * @param {{ delimiter?: string }} [options] Detected from the first line when omitted.
 * @returns {string[][]}
 */
export function parseCsv(text, { delimiter } = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const sep = delimiter ?? detectDelimiter(source);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      touched = true;
    } else if (ch === sep) {
      endCell();
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else {
      cell += ch;
      touched = true;
    }
  }
  if (touched || cell !== '' || row.length > 0) endRow();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
}

/**
 * Decide whether the first row names the columns: it must have text in every filled cell and none of it
 * a number, and there must be data beneath it.
 * @param {string[][]} grid
 * @param {(cell: string) => boolean} isNumber
 */
export function hasHeaderRow(grid, isNumber) {
  if (!Array.isArray(grid) || grid.length < 2) return false;
  const filled = grid[0].filter((c) => c !== '');
  return filled.length > 0 && filled.every((c) => !isNumber(c));
}

const quote = (cell, sep) => (/["\r\n]/.test(cell) || cell.includes(sep) ? `"${cell.replace(/"/g, '""')}"` : cell);

/**
 * Write columns as CSV with a header row. Trailing blank rows are left out.
 * @param {{ name: string, cells: string[] }[]} cols
 * @param {{ delimiter?: string }} [options]
 */
export function toCsv(cols, { delimiter = ',' } = {}) {
  let length = 0;
  for (const col of cols) {
    for (let i = col.cells.length - 1; i >= 0; i -= 1) {
      if (col.cells[i].trim() !== '') {
        length = Math.max(length, i + 1);
        break;
      }
    }
  }
  const lines = [cols.map((c) => quote(c.name, delimiter)).join(delimiter)];
  for (let i = 0; i < length; i += 1) lines.push(cols.map((c) => quote(c.cells[i] ?? '', delimiter)).join(delimiter));
  return `${lines.join('\n')}\n`;
}
