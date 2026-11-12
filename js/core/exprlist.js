/**
 * A list of expression rows for tools that share the graphing language: the 3D
 * graph and notebook cells. Each row has a colour dot, a typeset math field, a
 * slider when the row defines a plain number, parameter limits for curves, a
 * value, and an error line. The list owns no model: the tool compiles the rows
 * and the list reads each row's `info` from `model.info(id)`.
 */
import { icon } from './icons.js';
import { buildFolderRow, buildTableRow, commitRows, createRowMenu } from './structrows.js';
import { emptyTable, isCollapsed, moveRow, nextTableNames, normalizeRowList } from '../lib/graph/rows.js';
import { createMathField } from './mathfield.js';
import { debounce, h, uid } from './dom.js';
import { ROW_COLORS, rowColor } from '../lib/graph/draw.js';
import { sliderStep, sliderText } from '../lib/graph/model.js';
import { formatNumber } from '../lib/graph/values.js';

export const MAX_TEXT = 500;
const MAX_FIELD = 40;
const SLIDER_SECONDS = 8;
const RANGE_VARS = ['t', 'u', 'v', 'theta'];

export const cleanText = (value) =>
  typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, MAX_TEXT) : '';
export const cleanField = (value) => (typeof value === 'string' && value.length <= MAX_FIELD ? value : '');

export const emptyRow = (id, color) => ({
  id,
  kind: 'expr',
  text: '',
  color,
  hidden: false,
  min: '',
  max: '',
  step: '',
  tmin: '',
  tmax: '',
  ranges: {},
  folder: '',
  style: {},
});

function cleanRanges(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const name of RANGE_VARS) {
    const pair = raw[name];
    if (Array.isArray(pair)) out[name] = [cleanField(pair[0]), cleanField(pair[1])];
  }
  return out;
}

/**
 * Validate rows from saved or imported state. Ids stay unique, colours stay in
 * the palette, text stays bounded. `taken` lets a tool keep ids unique across lists.
 */
export function normalizeRows(raw, { max = 60, taken = new Set(), startColor = 0, structured = false } = {}) {
  return normalizeRowList(raw, { max, taken, startColor, structured, ranges: cleanRanges });
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

/**
 * @param {object} options
 * @param {object[]} options.rows rows, edited in place
 * @param {{ info(id: string): any, setSlider(id: string, v: number): boolean }} options.model
 * @param {{ save(): void, notify(message: string, kind?: string): void }} options.ctx
 * @param {() => void} options.onChange text or structure changed: recompile
 * @param {() => void} [options.onSlider] a slider moved: redraw quickly
 * @param {() => void} [options.onVisual] visibility or colour changed: redraw
 * @param {() => Map<string, string>} [options.renderErrors] errors found while drawing
 * @param {() => boolean} [options.isActive] false pauses slider animation
 * @param {number} [options.maxRows]
 * @param {boolean} [options.compact] no colour dot or colour button (calculation rows)
 * @param {string} [options.placeholder]
 * @param {(info: any, row: object) => string} [options.hint] muted text under a row, such as where it can be graphed
 * @param {boolean} [options.structured] folders, tables, and a row options menu (the 3D graph)
 * @param {{ onEnter?: (row: object) => boolean, onBackspaceEmpty?: (row: object) => boolean }} [options.hooks]
 */
export function createExprList(options) {
  const {
    rows,
    model,
    ctx,
    onChange,
    onSlider = () => {},
    onVisual = () => {},
    renderErrors = () => new Map(),
    isActive = () => true,
    maxRows = 60,
    compact = false,
    placeholder = 'Type an expression, like y = x^2',
    hint = () => '',
    hooks = {},
    structured = false,
  } = options;

  const list = h('ol', { class: `gr-list${compact ? ' gr-compact' : ''}` });
  const rowEls = new Map();
  const playing = new Map();
  let animFrame = 0;
  let animLast = 0;
  let selectedId = null;

  const rowById = (id) => rows.find((r) => r.id === id) ?? null;
  const recompileLater = debounce(() => onChange(), 160);

  const nextColor = () => rows.length % ROW_COLORS.length;

  function focusRow(id) {
    rowEls.get(id)?.field.focus();
  }

  function addRow(afterId = null, init = {}, { focus = true } = {}) {
    if (rows.length >= maxRows) {
      ctx.notify(`You can have up to ${maxRows} rows here. Delete one to add another.`);
      return null;
    }
    const after = afterId === null ? null : rowById(afterId);
    const inherited = structured && after ? (after.kind === 'folder' ? after.id : (after.folder ?? '')) : '';
    const row = {
      ...emptyRow(uid('r'), nextColor()),
      ...(init.kind === 'folder' ? {} : { folder: inherited }),
      ...init,
    };
    const at = afterId === null ? rows.length : rows.findIndex((r) => r.id === afterId) + 1;
    rows.splice(at, 0, row);
    rebuild();
    onChange();
    ctx.save();
    if (focus) focusRow(row.id);
    return row;
  }

  function removeRow(id) {
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return;
    playing.delete(id);
    if (rows.length === 1) {
      rows.splice(0, 1, emptyRow(rows[0].id, rows[0].color));
      rebuild();
      onChange();
      ctx.save();
      focusRow(rows[0].id);
      return;
    }
    rows.splice(index, 1);
    if (selectedId === id) selectedId = null;
    rebuild();
    onChange();
    ctx.save();
    focusRow(rows[Math.max(0, index - 1)].id);
  }

  function insertSliders(id, names) {
    const at = rows.findIndex((r) => r.id === id);
    const added = names.slice(0, Math.max(0, maxRows - rows.length));
    if (added.length === 0) return;
    added.forEach((name, k) => {
      rows.splice(at + k, 0, {
        ...emptyRow(uid('r'), (rows.length + k) % ROW_COLORS.length),
        text: `${name} = 1`,
      });
    });
    rebuild();
    onChange();
    ctx.save();
  }

  function onKey(event, row) {
    const index = rows.findIndex((r) => r.id === row.id);
    const showing = (step) => {
      for (let i = index + step; i >= 0 && i < rows.length; i += step) if (!isCollapsed(rows, rows[i])) return rows[i];
      return null;
    };
    if (structured && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const next = moveRow(rows, row.id, event.key === 'ArrowUp' ? -1 : 1);
      if (next !== rows) {
        commitRows(env, next);
        focusRow(row.id);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      recompileLater.flush();
      if (hooks.onEnter?.(row)) return;
      addRow(row.id);
    } else if (event.key === 'ArrowDown' && showing(1)) {
      event.preventDefault();
      focusRow(showing(1).id);
    } else if (event.key === 'ArrowUp' && showing(-1)) {
      event.preventDefault();
      focusRow(showing(-1).id);
    } else if (event.key === 'Backspace' && row.text === '') {
      if (hooks.onBackspaceEmpty?.(row)) {
        event.preventDefault();
      } else if (rows.length > 1) {
        event.preventDefault();
        removeRow(row.id);
      }
    }
  }

  const env = {
    rows,
    ctx,
    rebuild: () => rebuild(),
    onChange: () => onChange(),
    onVisual: () => onVisual(),
    removeRow: (id) => removeRow(id),
    plot: false,
  };

  function addTable() {
    if (rows.length >= maxRows) {
      ctx.notify(`You can have up to ${maxRows} rows here. Delete one to add another.`);
      return;
    }
    const table = emptyTable(uid('r'), nextColor(), nextTableNames(rows));
    rows.push(table);
    rebuild();
    onChange();
    ctx.save();
    focusRow(table.id);
  }

  function addFolder() {
    addRow(null, { kind: 'folder', text: '', collapsed: false, hidden: false });
  }

  /* ----------------------------------------------------------------- rows */

  function rangeFor(row, dom) {
    if (dom.variable === 'theta' || (row.ranges?.[dom.variable] === undefined && dom.variable === 't')) {
      const typed = row.ranges?.[dom.variable];
      if (typed) return typed;
      return [row.tmin, row.tmax];
    }
    return row.ranges?.[dom.variable] ?? ['', ''];
  }

  function setRange(row, dom, index, value) {
    const clean = cleanField(value.trim());
    row.ranges ??= {};
    const current = rangeFor(row, dom);
    const pair = [current[0] ?? '', current[1] ?? ''];
    pair[index] = clean;
    row.ranges[dom.variable] = pair;
    if (dom.variable === 't' || dom.variable === 'theta') {
      if (index === 0) row.tmin = clean;
      else row.tmax = clean;
    }
  }

  function buildRow(row, index) {
    const refs = { domainEls: [] };
    const label = (text) => `${text} ${index + 1}`;
    const note = row.kind === 'note';

    refs.dot = h('button', {
      class: 'gr-dot',
      type: 'button',
      'aria-label': label('Show or hide expression'),
      onclick: () => {
        row.hidden = !row.hidden;
        ctx.save();
        syncRow(row.id);
        onVisual();
      },
    });

    if (note) {
      const input = h('input', {
        class: 'gr-input',
        type: 'text',
        spellcheck: 'false',
        maxlength: String(MAX_TEXT),
        placeholder: 'Note',
        'aria-label': label('Note'),
        value: row.text,
        oninput: () => {
          row.text = cleanText(input.value);
          ctx.save();
        },
        onkeydown: (event) => onKey(event, row),
      });
      refs.field = {
        el: input,
        input,
        refresh() {},
        setValue(text) {
          input.value = text;
        },
        focus() {
          input.focus();
        },
      };
    } else {
      refs.field = createMathField({
        value: row.text,
        label: label('Expression'),
        placeholder,
        maxlength: MAX_TEXT,
        oninput: (text) => {
          row.text = cleanText(text);
          ctx.save();
          recompileLater();
        },
        onblur: () => recompileLater.flush(),
        onkeydown: (event) => onKey(event, row),
        onfocus: () => {
          for (const [id, other] of rowEls) other.li.classList.toggle('is-current', id === row.id);
        },
      });
    }
    refs.input = refs.field.input;

    refs.value = h('p', { class: 'gr-value', hidden: true });
    refs.hint = h('p', { class: 'gr-hint', hidden: true });
    refs.error = h('p', { class: 'gr-error', role: 'alert', hidden: true });
    refs.add = h('button', {
      class: 'btn btn-small gr-add-slider',
      type: 'button',
      hidden: true,
      onclick: () => insertSliders(row.id, model.info(row.id)?.undefinedNames ?? []),
    });

    const bound = (key, text) => {
      const el = h('input', {
        class: 'input gr-bound',
        type: 'text',
        spellcheck: 'false',
        autocomplete: 'off',
        'aria-label': label(`Slider ${text}, expression`),
        onchange: () => {
          row[key] = cleanField(el.value.trim());
          ctx.save();
          onChange();
        },
      });
      return el;
    };
    refs.minInput = bound('min', 'minimum');
    refs.maxInput = bound('max', 'maximum');
    refs.stepInput = bound('step', 'step');
    refs.stepInput.placeholder = 'step';
    refs.range = h('input', {
      class: 'range gr-range',
      type: 'range',
      min: '-10',
      max: '10',
      step: '0.01',
      value: '0',
      'aria-label': label('Slider value, expression'),
      oninput: () => moveSlider(row.id, Number(refs.range.value)),
    });
    refs.play = h(
      'button',
      {
        class: 'btn btn-quiet btn-icon gr-play',
        type: 'button',
        'aria-label': label('Animate slider, expression'),
        'aria-pressed': 'false',
        onclick: () => togglePlay(row.id),
      },
      icon('play', 14),
    );
    refs.slider = h(
      'div',
      { class: 'gr-slider', hidden: true },
      refs.minInput,
      refs.range,
      refs.maxInput,
      refs.stepInput,
      refs.play,
    );
    refs.domains = h('div', { class: 'gr-domains', hidden: true });

    refs.color = h(
      'button',
      {
        class: 'btn btn-quiet btn-icon gr-tool',
        type: 'button',
        'aria-label': label('Change colour of expression'),
        title: 'Change colour',
        onclick: () => {
          row.color = (row.color + 1) % ROW_COLORS.length;
          ctx.save();
          syncRow(row.id);
          onVisual();
        },
      },
      h('span', { class: 'gr-swatch' }),
    );
    refs.remove = h(
      'button',
      {
        class: 'btn btn-quiet btn-icon gr-tool',
        type: 'button',
        'aria-label': label(note ? 'Delete note' : 'Delete expression'),
        title: 'Delete',
        onclick: () => removeRow(row.id),
      },
      icon('close', 14),
    );
    refs.li = h(
      'li',
      { class: 'gr-row', dataset: { id: row.id, kind: note ? 'note' : 'empty' } },
      compact
        ? h('span', { class: 'gr-dot gr-dot-none', 'aria-hidden': 'true' })
        : note
          ? h('span', { class: 'gr-dot gr-dot-note', 'aria-hidden': 'true' }, 'N')
          : refs.dot,
      h(
        'div',
        { class: 'gr-body' },
        refs.field.el,
        refs.slider,
        refs.domains,
        refs.value,
        refs.hint,
        refs.error,
        refs.add,
      ),
      h(
        'div',
        { class: 'gr-actions' },
        note || compact ? null : refs.color,
        structured ? createRowMenu(row, env, { styled: false }) : null,
        refs.remove,
      ),
    );
    return refs;
  }

  function rebuild() {
    rowEls.clear();
    list.replaceChildren();
    rows.forEach((row, index) => {
      let refs;
      if (structured && row.kind === 'folder') refs = { ...buildFolderRow(row, index, env), struct: true };
      else if (structured && row.kind === 'table') refs = { ...buildTableRow(row, index, env), struct: true };
      else refs = buildRow(row, index);
      rowEls.set(row.id, refs);
      refs.li.classList.toggle('is-selected', row.id === selectedId);
      refs.li.classList.toggle('in-folder', row.kind !== 'folder' && Boolean(row.folder));
      refs.li.hidden = isCollapsed(rows, row);
      list.append(refs.li);
    });
    syncAll();
  }

  function syncAll() {
    for (const row of rows) syncRow(row.id);
  }

  function syncRow(id) {
    const refs = rowEls.get(id);
    const row = rowById(id);
    if (!refs || !row) return;
    const info = model.info(id);
    if (refs.struct) {
      refs.sync?.(info);
      return;
    }
    const color = rowColor(row.color, isDark());
    refs.li.dataset.kind = info?.kind ?? 'empty';

    const plot = info?.plot ?? null;
    refs.dot.disabled = !plot;
    refs.dot.setAttribute('aria-pressed', String(!row.hidden));
    refs.dot.style.setProperty('--row-color', color);
    refs.dot.classList.toggle('is-off', row.hidden);
    refs.color.hidden = !plot;
    refs.color.firstChild.style.setProperty('--row-color', color);

    const read = () => {
      const current = model.info(id);
      return current?.error ?? current?.sliderError ?? current?.runtimeError ?? renderErrors().get(id) ?? '';
    };
    const show = () => {
      const text = read();
      refs.error.textContent = text;
      refs.error.hidden = text === '';
      if (text) refs.input.setAttribute('aria-invalid', 'true');
      else refs.input.removeAttribute('aria-invalid');
      refs.field.el.classList?.toggle('is-invalid', text !== '');
    };
    clearTimeout(refs.errorTimer);
    // While someone is typing, wait a moment before calling half-written input an error.
    if (read() && document.activeElement === refs.input) refs.errorTimer = setTimeout(show, 800);
    else show();

    const valueText = info?.valueText ?? '';
    refs.value.textContent = valueText ? `= ${valueText}` : '';
    refs.value.hidden = valueText === '';

    const hintText = row.text.trim() === '' || info?.error ? '' : hint(info, row);
    refs.hint.textContent = hintText;
    refs.hint.hidden = hintText === '';

    const names = info?.undefinedNames ?? [];
    refs.add.hidden = names.length === 0;
    refs.add.textContent = names.length === 1 ? `Add slider for ${names[0]}` : `Add sliders for ${names.join(', ')}`;

    const slider = info?.slider ?? null;
    refs.slider.hidden = !slider;
    if (slider) {
      const typing = (el) => document.activeElement === el;
      if (!typing(refs.minInput)) refs.minInput.value = row.min || formatNumber(slider.min);
      if (!typing(refs.maxInput)) refs.maxInput.value = row.max || formatNumber(slider.max);
      if (!typing(refs.stepInput)) refs.stepInput.value = row.step;
      refs.range.min = String(slider.min);
      refs.range.max = String(slider.max);
      refs.range.step = String(sliderStep(slider));
      refs.range.value = String(slider.value);
      refs.range.setAttribute('aria-valuetext', formatNumber(slider.value, 6));
    } else {
      playing.delete(id);
    }
    refs.play.setAttribute('aria-pressed', String(playing.has(id)));
    refs.play.replaceChildren(icon(playing.has(id) ? 'stop' : 'play', 14));

    syncDomains(refs, row, info);
  }

  function syncDomains(refs, row, info) {
    const doms = (info?.domains ?? (info?.domain ? [info.domain] : [])).filter((d) => !d.fromRestriction);
    refs.domains.hidden = doms.length === 0;
    const signature = doms.map((d) => d.variable).join(',');
    if (refs.domainSignature !== signature) {
      refs.domainSignature = signature;
      refs.domains.replaceChildren(
        ...doms.map((dom) => {
          const field = (index) => {
            const el = h('input', {
              class: 'input gr-bound',
              type: 'text',
              spellcheck: 'false',
              autocomplete: 'off',
              'aria-label': `${dom.variable === 'theta' ? 'theta' : dom.variable} ${index === 0 ? 'minimum' : 'maximum'}, expression`,
              onchange: () => {
                setRange(row, dom, index, el.value);
                ctx.save();
                onChange();
              },
            });
            return el;
          };
          const lo = field(0);
          const hi = field(1);
          const wrap = h(
            'div',
            { class: 'gr-domain' },
            lo,
            '\u2264',
            h('span', { class: 'gr-var' }, dom.variable === 'theta' ? '\u03b8' : dom.variable),
            '\u2264',
            hi,
          );
          wrap.lo = lo;
          wrap.hi = hi;
          wrap.dom = dom;
          return wrap;
        }),
      );
    }
    for (const wrap of refs.domains.children) {
      const [min, max] = rangeFor(row, wrap.dom);
      const dom = doms.find((d) => d.variable === wrap.dom.variable) ?? wrap.dom;
      wrap.lo.placeholder = dom.min;
      wrap.hi.placeholder = dom.max === '12*pi' ? '12\u03c0' : dom.max === '2*pi' ? '2\u03c0' : dom.max;
      if (document.activeElement !== wrap.lo) wrap.lo.value = min ?? '';
      if (document.activeElement !== wrap.hi) wrap.hi.value = max ?? '';
    }
  }

  /* -------------------------------------------------------------- sliders */

  function moveSlider(id, value) {
    const row = rowById(id);
    const info = model.info(id);
    if (!row || !info?.slider || !model.setSlider(id, value)) return;
    row.text = sliderText(info.name, value, sliderStep(info.slider));
    rowEls.get(id)?.field.setValue(row.text);
    syncAll();
    ctx.save();
    onSlider();
  }

  function stepAnimation(now) {
    animFrame = 0;
    if (playing.size === 0 || !isActive() || document.hidden) return;
    const dt = Math.min(100, now - animLast);
    animLast = now;
    for (const [id, phase] of [...playing]) {
      const slider = model.info(id)?.slider;
      if (!slider) {
        playing.delete(id);
        continue;
      }
      const span = slider.max - slider.min;
      let next = phase + (span * dt) / (SLIDER_SECONDS * 1000);
      if (next > slider.max) next = slider.min + ((next - slider.min) % span);
      playing.set(id, next);
      const step = sliderStep(slider);
      moveSlider(id, slider.min + Math.round((next - slider.min) / step) * step);
    }
    animFrame = requestAnimationFrame(stepAnimation);
  }

  function togglePlay(id) {
    const slider = model.info(id)?.slider;
    if (!slider) return;
    if (playing.has(id)) playing.delete(id);
    else playing.set(id, slider.value);
    syncRow(id);
    cancelAnimationFrame(animFrame);
    animFrame = 0;
    if (playing.size > 0) {
      animLast = performance.now();
      animFrame = requestAnimationFrame(stepAnimation);
    }
  }

  rebuild();

  return {
    el: list,
    rebuild,
    syncAll,
    syncRow,
    addRow,
    addTable,
    addFolder,
    removeRow,
    focusRow,
    flush: () => recompileLater.flush(),
    setSelected(id) {
      selectedId = id;
      for (const [rowId, refs] of rowEls) refs.li.classList.toggle('is-selected', rowId === id);
    },
    resume() {
      if (playing.size > 0 && !animFrame) {
        animLast = performance.now();
        animFrame = requestAnimationFrame(stepAnimation);
      }
    },
    pause() {
      cancelAnimationFrame(animFrame);
      animFrame = 0;
    },
    destroy() {
      playing.clear();
      for (const refs of rowEls.values()) clearTimeout(refs.errorTimer);
      cancelAnimationFrame(animFrame);
      recompileLater.cancel();
    },
  };
}
