/**
 * Pure helpers for the cellular automaton tab: grids, saved-state encoding, starting patterns, and history.
 * A grid is a Uint8Array of `width * height` state numbers, row by row.
 */

export const MIN_SIZE = 8;
export const MAX_SIZE = 100;
export const MAX_STATES = 16;
export const MAX_HISTORY = 200;
const HEX = '0123456789abcdef';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Saved grids are one hex digit per cell, so a 100 by 100 grid is 10,000 characters. */
export function encodeCells(cells) {
  let out = '';
  for (let i = 0; i < cells.length; i += 1) out += HEX[cells[i] & 15];
  return out;
}

/** The inverse of `encodeCells`. Returns null unless `text` has exactly `count` hex digits. */
export function decodeCells(text, count) {
  if (typeof text !== 'string' || text.length !== count || !/^[0-9a-f]*$/.test(text)) return null;
  const cells = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) cells[i] = HEX.indexOf(text[i]);
  return cells;
}

export const emptyGrid = (width, height) => new Uint8Array(width * height);

/** Fill a grid at random. `weights[s]` is how likely state `s` is, relative to the others. */
export function randomGrid(width, height, weights, random = Math.random) {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  const cells = new Uint8Array(width * height);
  if (!(total > 0)) return cells;
  for (let i = 0; i < cells.length; i += 1) {
    let pick = random() * total;
    let state = 0;
    for (let s = 0; s < weights.length; s += 1) {
      pick -= Math.max(0, weights[s]);
      if (pick < 0) {
        state = s;
        break;
      }
    }
    cells[i] = state;
  }
  return cells;
}

/**
 * Draw a picture made of text into a blank grid. `map` says which state each character means; other
 * characters are state 0. The picture is placed at (`left`, `top`), or centred when those are omitted.
 */
export function asciiGrid(width, height, rows, map, { left, top } = {}) {
  const cells = new Uint8Array(width * height);
  const pictureWidth = Math.max(0, ...rows.map((r) => r.length));
  const x0 = left ?? Math.floor((width - pictureWidth) / 2);
  const y0 = top ?? Math.floor((height - rows.length) / 2);
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && y >= 0 && x < width && y < height) cells[y * width + x] = map[ch] ?? 0;
    });
  });
  return cells;
}

/** Copy the part of `cells` that fits into a new size, keeping the top-left corner. */
export function resizeGrid(cells, oldWidth, oldHeight, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < Math.min(oldHeight, height); y += 1) {
    for (let x = 0; x < Math.min(oldWidth, width); x += 1) out[y * width + x] = cells[y * oldWidth + x];
  }
  return out;
}

/** How many cells are in each of `states` states. */
export function countStates(cells, states) {
  const counts = new Array(states).fill(0);
  for (let i = 0; i < cells.length; i += 1) if (cells[i] < states) counts[cells[i]] += 1;
  return counts;
}

/** Cells in a straight line between two cells, ends included (Bresenham), so a fast drag leaves no gaps. */
export function lineCells(x0, y0, x1, y1) {
  const out = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/**
 * What a click does. Clicking a cell that already has the brush colour clears it, so with two colours a
 * click flips white to black and back. The result is used for the whole drag.
 */
export const paintedState = (current, brush) => (current === brush ? 0 : brush);

/** A fixed-size stack of earlier grids, for Step back. The oldest are dropped first. */
export class History {
  constructor(limit = MAX_HISTORY) {
    this.limit = limit;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(cells) {
    this.items.push(Uint8Array.from(cells));
    if (this.items.length > this.limit) this.items.shift();
  }

  pop() {
    return this.items.pop() ?? null;
  }

  clear() {
    this.items.length = 0;
  }
}

/**
 * Colours written in a rule's `COLORS = [...]` line, read as text without running the rule. Used to draw the
 * grid before the rule has been run; once it runs, the colours it reports replace these.
 */
export function previewColors(code) {
  const match = /^\s*COLORS\s*=\s*\[([^\]]*)\]/m.exec(String(code));
  const found = match ? [...match[1].matchAll(/["'](#[0-9a-fA-F]{6})["']/g)].map((m) => m[1]) : [];
  return found.length >= 2 && found.length <= MAX_STATES ? found : ['#ffffff', '#1b1f1d'];
}

export const isHexColor = (value) => typeof value === 'string' && HEX_COLOR.test(value);
