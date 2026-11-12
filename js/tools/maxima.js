import { debounce, h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { typeset } from '../lib/graph/typeset.js';
import { CasError, Session } from '../lib/cas.js';
import { fitCanvas } from '../lib/viewport.js';

const MAX_INPUTS = 100;
const MAX_INPUT = 2000;
const MAX_OUTPUT = 4000;

const EXAMPLES = [
  ['Expand', 'expand((x+1)^5);'],
  ['Differentiate', 'diff(x^3*sin(x), x);'],
  ['Integrate', 'integrate(x^2*exp(x), x);'],
  ['Definite integral', 'integrate(x^2, x, 0, 3);'],
  ['Solve', 'solve(x^2-5*x+6=0, x);'],
  ['Define a function', 'f(x) := x^2+1;'],
  ['Factor a number', 'factor(360);'],
  ['Decimals', 'float(%pi);'],
];

const normalize = (raw) => {
  const inputs = (Array.isArray(raw?.inputs) ? raw.inputs : [])
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .slice(0, MAX_INPUTS)
    .map((t) => t.slice(0, MAX_INPUT));
  return { inputs };
};

export default {
  type: 'maxima',
  name: 'Symbolic algebra',
  description:
    'Type Maxima commands to expand, differentiate, integrate, and solve symbolically. A built-in engine reads Maxima syntax and covers the everyday commands.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = colors.accent;
    ctx.font = `${Math.round(height * 0.34)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u222b x\u00b2 dx', width / 2, height * 0.42);
    ctx.fillStyle = colors.ink;
    ctx.font = `${Math.round(height * 0.2)}px serif`;
    ctx.fillText('x\u00b3/3', width / 2, height * 0.74);
  },

  mount(root, ctx) {
    const state = ctx.state;
    let session = new Session();
    const entries = [];

    const transcript = h('div', { class: 'mx2-transcript', role: 'log', 'aria-label': 'Commands and results' });
    const field = h('textarea', {
      class: 'input input-mono mx2-input',
      rows: '2',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      maxlength: String(MAX_INPUT),
      'aria-label': 'Maxima command',
      placeholder: 'Type a command, like integrate(x^2, x);   Enter runs it, Shift+Enter starts a new line.',
      onkeydown: (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submit();
        }
      },
    });

    /** Run one input against the session and describe what to show. */
    function evaluate(source) {
      const firstIndex = session.results.length;
      try {
        const results = session
          .run(source)
          .map((r, i) => ({ ...r, label: `%o${firstIndex + i + 1}`, text: r.text.slice(0, MAX_OUTPUT) }));
        return { results, error: null };
      } catch (error) {
        if (!(error instanceof CasError)) throw error;
        return { results: [], error: error.message };
      }
    }

    function render(entry, number) {
      const lines = entry.results
        .filter((r) => !r.hidden)
        .map((r) =>
          h(
            'div',
            { class: 'mx2-line' },
            h('span', { class: 'mx2-label' }, `(${r.label})`),
            h('span', { class: 'mx2-math' }, typeset(r.text)),
          ),
        );
      return h(
        'div',
        { class: 'mx2-entry' },
        h(
          'div',
          { class: 'mx2-in' },
          h('span', { class: 'mx2-label' }, `(%i${number})`),
          h('code', { class: 'mx2-code' }, entry.source),
          h(
            'button',
            {
              class: 'btn btn-quiet btn-icon mx2-remove',
              type: 'button',
              'aria-label': `Remove command ${number}`,
              title: 'Remove',
              onclick: () => remove(number - 1),
            },
            icon('close', 14),
          ),
        ),
        ...lines,
        entry.error ? h('p', { class: 'mx-error', role: 'alert' }, entry.error) : null,
        h(
          'button',
          {
            class: 'btn btn-quiet btn-small mx2-again',
            type: 'button',
            onclick: () => ((field.value = entry.source), field.focus()),
          },
          'Edit and run again',
        ),
      );
    }

    function redraw() {
      transcript.replaceChildren(...entries.map((e, i) => render(e, i + 1)));
      transcript.scrollTop = transcript.scrollHeight;
    }

    function replay() {
      session = new Session();
      entries.length = 0;
      for (const source of state.inputs) entries.push({ source, ...evaluate(source) });
      redraw();
    }

    function submit() {
      const source = field.value.trim();
      if (!source) return;
      if (state.inputs.length >= MAX_INPUTS) {
        ctx.notify(`A session keeps up to ${MAX_INPUTS} commands. Clear it to start again.`);
        return;
      }
      state.inputs.push(source.slice(0, MAX_INPUT));
      entries.push({ source: state.inputs.at(-1), ...evaluate(state.inputs.at(-1)) });
      field.value = '';
      ctx.save();
      redraw();
    }

    function remove(index) {
      state.inputs.splice(index, 1);
      ctx.save();
      replay();
    }

    const chips = h(
      'div',
      { class: 'chip-row', role: 'group', 'aria-label': 'Examples' },
      EXAMPLES.map(([label, code]) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            title: code,
            onclick: () => {
              field.value = code;
              submit();
            },
          },
          label,
        ),
      ),
    );

    root.classList.add('tool', 'maxima-tool');
    root.append(
      h(
        'div',
        { class: 'tool-bar' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, icon('play', 14), ' Run'),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              state.inputs.length = 0;
              ctx.save();
              replay();
            },
          },
          icon('trash', 14),
          ' Clear session',
        ),
      ),
      h('div', { class: 'tool-subbar' }, chips),
      h('div', { class: 'tool-body mx2-body' }, transcript),
      h('div', { class: 'mx2-compose' }, field),
      h(
        'div',
        { class: 'tool-footer' },
        h(
          'p',
          { class: 'tool-note' },
          'This tab uses a small built-in engine that reads Maxima syntax: expand, diff, integrate, solve (up to degree 2), subst, ev, factor (whole numbers), float, f(x) := ..., a: value, and % for the last result. It is not the full Maxima program, so anything else is reported rather than guessed. End a command with $ to hide its result.',
        ),
      ),
    );
    replay();
    const save = debounce(() => ctx.save(), 200);
    return {
      onShow: () => {
        transcript.scrollTop = transcript.scrollHeight;
      },
      destroy: () => save.cancel(),
    };
  },
};
