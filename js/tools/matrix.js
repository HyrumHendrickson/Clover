import { clamp, debounce, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { openMenu } from '../core/menu.js';
import { createMathField } from '../core/mathfield.js';
import { evaluateLines, formatScalar, isMatrix, MAX_DIM } from '../lib/linalg.js';
import { typeset } from '../lib/graph/typeset.js';
import { fitCanvas } from '../lib/viewport.js';

const MAX_LINES = 40;
const MAX_CELL = 24;
const MAX_TEXT = 300;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
const NAME_PATTERN = /^[\p{L}][\p{L}\p{N}_]{0,15}$/u;
const SHORTCUT = /^\s*(?:([\p{L}][\p{L}\p{N}_]*)\s*=\s*)?(matrix|vector)\s*$/u;

/* ------------------------------------------------------------------- state */

const zeroCells = (rows, cols) => Array.from({ length: rows }, () => Array.from({ length: cols }, () => '0'));

function readCells(raw, fallbackRows = 2, fallbackCols = 2) {
  const source = Array.isArray(raw) ? raw.filter(Array.isArray).slice(0, MAX_DIM) : [];
  const rows = source.length || fallbackRows;
  const cols = source.length ? clamp(Math.max(1, ...source.map((row) => row.length)), 1, MAX_DIM) : fallbackCols;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => {
      const cell = source[i]?.[j];
      return typeof cell === 'string' || typeof cell === 'number' ? String(cell).slice(0, MAX_CELL) : '0';
    }),
  );
}

function normalizeLine(raw, taken, counter) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'matrix' && raw.kind !== 'expr') return null;
  let id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) && !taken.has(raw.id) ? raw.id : null;
  while (id === null || taken.has(id)) {
    counter.n += 1;
    id = `l${counter.n}`;
  }
  taken.add(id);
  if (raw.kind === 'expr') {
    return {
      id,
      kind: 'expr',
      text: typeof raw.text === 'string' ? raw.text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) : '',
    };
  }
  const name = typeof raw.name === 'string' && NAME_PATTERN.test(raw.name.trim()) ? raw.name.trim() : '';
  return { id, kind: 'matrix', name, cells: readCells(raw.cells) };
}

/** Version 1 of this tool held A, B, and a vector x; they become lines. */
function fromLegacy(raw) {
  const A = readCells(raw.A);
  const lines = [{ kind: 'matrix', name: 'A', cells: A }];
  if (raw.mode === 'mv') {
    const x = Array.isArray(raw.x) ? raw.x.map((v) => [v]) : [['1'], ['1']];
    lines.push({ kind: 'matrix', name: 'x', cells: readCells(x) }, { kind: 'expr', text: 'A*x' });
  } else {
    lines.push({ kind: 'matrix', name: 'B', cells: readCells(raw.B) }, { kind: 'expr', text: 'A*B' });
  }
  return lines;
}

const STARTER = () => [
  {
    kind: 'matrix',
    name: 'A',
    cells: [
      ['2', '1'],
      ['1', '3'],
    ],
  },
  {
    kind: 'matrix',
    name: 'B',
    cells: [
      ['1', '-1'],
      ['1', '1'],
    ],
  },
  { kind: 'expr', text: 'A+B' },
  { kind: 'expr', text: 'A*B' },
];

function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const taken = new Set();
  const counter = { n: 0 };
  let list = Array.isArray(r.lines) ? r.lines : Array.isArray(r.A) ? fromLegacy(r) : [];
  list = list.slice(0, MAX_LINES);
  let lines = list.map((l) => normalizeLine(l, taken, counter)).filter(Boolean);
  if (lines.length === 0) {
    taken.clear();
    lines = STARTER().map((l) => normalizeLine(l, taken, counter));
  }
  return { lines };
}

/* -------------------------------------------------------------------- tool */

function matrixDisplay(matrix) {
  const out = h(
    'div',
    { class: 'mx-out', role: 'group', 'aria-label': `Matrix, ${matrix.shape}` },
    ...matrix.a.flat().map((x) => h('span', { class: 'mx-entry' }, typeset(formatScalar(x)))),
  );
  out.style.setProperty('--cols', String(matrix.cols));
  return out;
}

export default {
  type: 'matrix',
  name: 'Matrices',
  description:
    'Define matrices and vectors, then add, multiply, invert, and more on the next line. Entries stay exact fractions.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const box = Math.min(width * 0.22, height * 0.5);
    const y = (height - box) / 2;
    const bracket = (x) => {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + box);
      ctx.lineTo(x + 6, y + box);
      ctx.moveTo(x + box - 6, y);
      ctx.lineTo(x + box, y);
      ctx.lineTo(x + box, y + box);
      ctx.lineTo(x + box - 6, y + box);
      ctx.stroke();
      ctx.fillStyle = colors.grid;
      for (let i = 0; i < 2; i += 1) {
        for (let j = 0; j < 2; j += 1) {
          ctx.fillRect(x + box * (0.25 + 0.3 * j), y + box * (0.22 + 0.34 * i), box * 0.16, box * 0.16);
        }
      }
    };
    const gap = (width - box * 3) / 4;
    [gap, gap * 2 + box, gap * 3 + box * 2].forEach(bracket);
    ctx.fillStyle = colors.accent;
    ctx.font = `${Math.round(box * 0.5)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u00d7', gap * 1.5 + box, height / 2);
    ctx.fillText('=', gap * 2.5 + box * 2, height / 2);
  },

  mount(root, ctx) {
    const state = ctx.state;
    const lineEls = new Map();
    const fields = new Map();
    let result = [];

    const list = h('ol', { class: 'mx-lines' });
    const indexOf = (id) => state.lines.findIndex((l) => l.id === id);

    /* ------------------------------------------------------------ evaluate */

    function evaluate() {
      result = evaluateLines(state.lines);
      state.lines.forEach((line, index) => syncLine(line, result[index]));
    }
    const evaluateLater = debounce(evaluate, 100);

    function syncLine(line, out) {
      const refs = lineEls.get(line.id);
      if (!refs || !out) return;
      if (line.kind === 'matrix') {
        refs.cells.forEach((row, i) =>
          row.forEach((input, j) => {
            const message = out.cellErrors.get(`${i},${j}`);
            input.setAttribute('aria-invalid', message ? 'true' : 'false');
            input.title = message ?? '';
          }),
        );
        refs.note.hidden = !out.error;
        refs.note.textContent = out.error ?? '';
        return;
      }
      refs.result.replaceChildren();
      refs.field.el.classList.toggle('is-invalid', Boolean(out.error));
      if (out.error) {
        refs.result.append(h('p', { class: 'mx-error', role: 'alert' }, out.error));
      } else if (out.value !== null) {
        const value = out.value;
        const shown = isMatrix(value)
          ? matrixDisplay(value)
          : h('span', { class: 'mx-scalar' }, typeset(formatScalar(value)));
        refs.result.append(
          h('div', { class: 'mx-answer' }, h('span', { class: 'mx-equals', 'aria-hidden': 'true' }, '='), shown),
        );
      }
      refs.result.hidden = refs.result.childNodes.length === 0;
    }

    /* ------------------------------------------------------------ line ops */

    const taken = () =>
      new Set(
        state.lines
          .flatMap((l) => (l.kind === 'matrix' && l.name ? [l.name] : []))
          .concat(
            state.lines.flatMap((l) =>
              l.kind === 'expr' ? [...l.text.matchAll(/^\s*([\p{L}][\p{L}\p{N}_]*)\s*=/gu)].map((m) => m[1]) : [],
            ),
          ),
      );
    const nextName = (letters) => {
      const used = taken();
      return [...letters].find((c) => !used.has(c)) ?? `${letters[0]}${used.size}`;
    };

    function newId() {
      const ids = new Set(state.lines.map((l) => l.id));
      let n = state.lines.length;
      let id;
      do {
        n += 1;
        id = `l${n}`;
      } while (ids.has(id));
      return id;
    }

    function insertLine(line, afterId = null, { focus = true } = {}) {
      if (state.lines.length >= MAX_LINES) {
        ctx.notify(`A sheet can have up to ${MAX_LINES} lines. Delete one to add another.`);
        return null;
      }
      const made = { id: newId(), ...line };
      const at = afterId === null ? state.lines.length : indexOf(afterId) + 1;
      state.lines.splice(at, 0, made);
      rebuild();
      evaluate();
      ctx.save();
      if (focus) focusLine(made.id);
      return made;
    }

    function removeLine(id) {
      const index = indexOf(id);
      if (index < 0) return;
      state.lines.splice(index, 1);
      if (state.lines.length === 0) state.lines.push({ id: 'l1', kind: 'expr', text: '' });
      rebuild();
      evaluate();
      ctx.save();
      focusLine(state.lines[Math.max(0, index - 1)].id);
    }

    function replaceLine(id, line) {
      const index = indexOf(id);
      if (index < 0) return;
      state.lines[index] = { id, ...line };
      rebuild();
      evaluate();
      ctx.save();
      focusLine(id);
    }

    function focusLine(id) {
      const refs = lineEls.get(id);
      if (!refs) return;
      if (refs.field) refs.field.focus();
      else refs.cells[0]?.[0]?.focus();
    }

    const matrixLine = (name, rows, cols) => ({ kind: 'matrix', name, cells: zeroCells(rows, cols) });

    function resize(line, rows, cols) {
      const r = clamp(rows, 1, MAX_DIM);
      const c = clamp(cols, 1, MAX_DIM);
      line.cells = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => line.cells[i]?.[j] ?? '0'));
      rebuild();
      evaluate();
      ctx.save();
    }

    /* --------------------------------------------------------------- lines */

    function buildMatrix(line, index) {
      const rows = line.cells.length;
      const cols = line.cells[0].length;
      const label = line.name || `Matrix ${index + 1}`;
      const refs = { cells: [] };

      const name = h('input', {
        class: 'input input-mono mx-name',
        type: 'text',
        value: line.name,
        placeholder: 'Name',
        spellcheck: 'false',
        autocomplete: 'off',
        maxlength: '16',
        'aria-label': `Name of matrix ${index + 1}`,
        oninput: () => {
          const text = name.value.trim();
          line.name = NAME_PATTERN.test(text) ? text : '';
          name.setAttribute('aria-invalid', text !== '' && line.name === '' ? 'true' : 'false');
          ctx.save();
          evaluateLater();
        },
      });
      const size = (key, value, text) =>
        h('input', {
          class: 'input mx-size',
          type: 'number',
          min: '1',
          max: String(MAX_DIM),
          step: '1',
          inputmode: 'numeric',
          value: String(value),
          'aria-label': `${label}, number of ${text}`,
          onchange: () => {
            const n = Math.round(Number(refs[key].value));
            if (!Number.isFinite(n)) {
              refs[key].value = String(value);
              return;
            }
            resize(line, key === 'rows' ? n : rows, key === 'cols' ? n : cols);
          },
        });
      refs.rows = size('rows', rows, 'rows');
      refs.cols = size('cols', cols, 'columns');

      const move = (i, j) => refs.cells[i]?.[j]?.focus();
      const grid = h('div', {
        class: 'mx-grid',
        role: 'group',
        'aria-label': `${label}, ${rows} by ${cols}`,
      });
      grid.style.setProperty('--cols', String(cols));
      for (let i = 0; i < rows; i += 1) {
        refs.cells.push([]);
        for (let j = 0; j < cols; j += 1) {
          const input = h('input', {
            class: 'input input-mono mx-cell',
            type: 'text',
            value: line.cells[i][j],
            spellcheck: 'false',
            autocomplete: 'off',
            maxlength: String(MAX_CELL),
            'aria-label': `${label}, row ${i + 1}, column ${j + 1}`,
            oninput: () => {
              line.cells[i][j] = input.value.slice(0, MAX_CELL);
              ctx.save();
              evaluateLater();
            },
            onfocus: () => input.select(),
            onkeydown: (event) => {
              const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
              const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
              if (event.key === 'Enter' || event.key === 'ArrowDown') {
                event.preventDefault();
                if (i + 1 < rows) move(i + 1, j);
                else if (event.key === 'Enter' && j + 1 < cols) move(0, j + 1);
              } else if (event.key === 'ArrowUp' && i > 0) {
                event.preventDefault();
                move(i - 1, j);
              } else if (event.key === 'ArrowRight' && atEnd && j + 1 < cols) {
                event.preventDefault();
                move(i, j + 1);
              } else if (event.key === 'ArrowLeft' && atStart && j > 0) {
                event.preventDefault();
                move(i, j - 1);
              }
            },
          });
          refs.cells[i].push(input);
          grid.append(input);
        }
      }

      const fill = (kind) => {
        line.cells = line.cells.map((row, i) => row.map((_, j) => (kind === 'identity' && i === j ? '1' : '0')));
        rebuild();
        evaluate();
        ctx.save();
      };
      const more = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon',
          type: 'button',
          'aria-label': `More options, ${label}`,
          'aria-haspopup': 'menu',
          title: 'More',
          onclick: (event) =>
            openMenu(
              event.currentTarget,
              [
                { label: 'Fill with the identity', onSelect: () => fill('identity') },
                { label: 'Fill with zeros', onSelect: () => fill('zeros') },
                { separator: true },
                { label: 'Delete', icon: 'trash', onSelect: () => removeLine(line.id) },
              ],
              { align: 'end' },
            ),
        },
        icon('settings', 16),
      );

      refs.note = h('p', { class: 'mx-error', role: 'alert', hidden: true });
      const li = h(
        'li',
        { class: 'mx-line mx-matrix', dataset: { id: line.id } },
        h(
          'div',
          { class: 'mx-head' },
          name,
          h('span', { class: 'mx-eq', 'aria-hidden': 'true' }, '='),
          h('span', { class: 'mx-dims' }, refs.rows, h('span', { 'aria-hidden': 'true' }, '\u00d7'), refs.cols),
          h('span', { class: 'mx-spacer' }),
          more,
        ),
        grid,
        refs.note,
      );
      refs.li = li;
      return { li, refs };
    }

    function buildExpr(line, index) {
      const refs = {};
      const field = createMathField({
        value: line.text,
        label: `Calculation ${index + 1}`,
        placeholder: 'Type a calculation, like A*B, or matrix',
        maxlength: MAX_TEXT,
        oninput: (text) => {
          const shortcut = SHORTCUT.exec(text);
          if (shortcut) {
            const vector = shortcut[2] === 'vector';
            const name = shortcut[1] ?? nextName(vector ? 'uvwxyz' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
            replaceLine(line.id, matrixLine(NAME_PATTERN.test(name) ? name : '', vector ? 3 : 2, vector ? 1 : 2));
            return;
          }
          line.text = text.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT);
          ctx.save();
          evaluateLater();
        },
        onblur: () => evaluateLater.flush(),
        onkeydown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            evaluateLater.flush();
            insertLine({ kind: 'expr', text: '' }, line.id);
          } else if (event.key === 'Backspace' && line.text === '' && state.lines.length > 1) {
            event.preventDefault();
            removeLine(line.id);
          } else if (event.key === 'ArrowUp' && index > 0) {
            event.preventDefault();
            focusLine(state.lines[index - 1].id);
          } else if (event.key === 'ArrowDown' && state.lines[index + 1]) {
            event.preventDefault();
            focusLine(state.lines[index + 1].id);
          }
        },
      });
      fields.set(line.id, field);
      refs.field = field;
      refs.result = h('div', { class: 'mx-result', 'aria-live': 'polite', hidden: true });
      const remove = h(
        'button',
        {
          class: 'btn btn-quiet btn-icon mx-remove',
          type: 'button',
          'aria-label': `Delete calculation ${index + 1}`,
          title: 'Delete line',
          onclick: () => removeLine(line.id),
        },
        icon('close', 14),
      );
      const li = h(
        'li',
        { class: 'mx-line mx-expr', dataset: { id: line.id } },
        h('div', { class: 'mx-expr-row' }, field.el, remove),
        refs.result,
      );
      refs.li = li;
      return { li, refs };
    }

    function rebuild() {
      lineEls.clear();
      fields.clear();
      const items = state.lines.map((line, index) => {
        const built = line.kind === 'matrix' ? buildMatrix(line, index) : buildExpr(line, index);
        lineEls.set(line.id, built.refs);
        return built.li;
      });
      list.replaceChildren(...items);
    }

    /* --------------------------------------------------------------- layout */

    const add = (label, onclick) => h('button', { class: 'btn', type: 'button', onclick }, icon('plus', 16), label);

    const help = h(
      'details',
      { class: 'mx-help' },
      h('summary', {}, 'What you can type'),
      h(
        'div',
        { class: 'mx-help-body' },
        h(
          'p',
          {},
          'Type matrix or vector on a line, or use the buttons, to get a grid. Set its size beside the name. Entries can be numbers like 3, -1/2, 0.25, or sqrt(2).',
        ),
        h(
          'p',
          {},
          'Then calculate with the names you defined. Later lines can use earlier results: write C = A*B to keep one.',
        ),
        h(
          'ul',
          {},
          ...[
            ['A+B, A-B, A*B, 2A, A/2', 'sums, products, and scalar multiples'],
            ['A^2, A^-1, A^T', 'powers, inverse, transpose (A\u2019 also works)'],
            ['det(A), tr(A), rank(A), rref(A), inv(A)', 'determinant, trace, rank, reduced row echelon form'],
            ['solve(A, b)', 'the solution x of Ax = b'],
            ['dot(u, v), cross(u, v), norm(v)', 'for vectors'],
            ['[[1, 2], [3, 4]]  and  [1, 2, 3]', 'a matrix, and a column vector, written inline'],
            ['identity(3), zeros(2, 3), diag(1, 2, 3)', 'common matrices'],
          ].map(([code, text]) => h('li', {}, h('code', {}, code), ' \u2014 ', text)),
        ),
        h(
          'p',
          {},
          'Fractions stay exact. Anything that is not rational, like sqrt(2) or \u03c0, is calculated as a decimal.',
        ),
      ),
    );

    root.classList.add('tool', 'matrix-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar mx-bar', role: 'toolbar', 'aria-label': 'Add to the sheet' },
        add('Matrix', () => insertLine(matrixLine(nextName('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 2, 2))),
        add('Vector', () => insertLine(matrixLine(nextName('uvwxyz'), 3, 1))),
        add('Calculation', () => insertLine({ kind: 'expr', text: '' })),
      ),
      h('div', { class: 'tool-body mx-body' }, list, help),
    );

    rebuild();
    evaluate();

    return {
      onShow: () => {},
      destroy: () => {
        evaluateLater.cancel();
        for (const field of fields.values()) field.destroy?.();
      },
    };
  },
};
