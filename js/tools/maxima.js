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

/** The reference list beside the session: what to type, and what it does. Each entry inserts its example. */
const COMMANDS = [
  ['expand(expr)', 'Multiply out products and powers.', 'expand((x+1)^3);'],
  ['factor(n)', 'Split a whole number into primes.', 'factor(360);'],
  ['diff(expr, x)', 'Differentiate. Add a third argument for higher orders.', 'diff(sin(x)^2, x, 2);'],
  ['integrate(expr, x)', 'Antiderivative of expr.', 'integrate(x*exp(x), x);'],
  ['integrate(expr, x, a, b)', 'Definite integral from a to b.', 'integrate(x^2, x, 0, 3);'],
  ['solve(eq, x)', 'Solve equations up to degree 2.', 'solve(x^2-5*x+6=0, x);'],
  ['subst(value, x, expr)', 'Replace x by a value or expression.', 'subst(2, x, x^2+1);'],
  ['ev(expr, x=value)', 'Evaluate with x set to a value.', 'ev(x^2+1, x=3);'],
  ['f(x) := expr', 'Define a function, then call it as f(3).', 'f(x) := x^2+1;'],
  ['a: value', 'Give a name to a value.', 'a: 5;'],
  ['float(expr)', 'Turn an exact result into a decimal.', 'float(%pi);'],
  ['%', 'The result of the previous command.', '%;'],
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
      oninput: () => grow(),
      onkeydown: (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submit();
        }
      },
    });

    /** Let the input grow with what is typed, up to a few lines. */
    function grow() {
      field.style.height = 'auto';
      if (field.scrollHeight > 0) field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
    }

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
            onclick: () => insert(entry.source),
          },
          'Edit and run again',
        ),
      );
    }

    function redraw() {
      transcript.replaceChildren(...entries.map((e, i) => render(e, i + 1)));
      syncEmpty();
      scroller().scrollTop = scroller().scrollHeight;
    }
    const scroller = () => transcript.parentElement ?? transcript;

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
      grow();
      ctx.save();
      redraw();
    }

    function remove(index) {
      state.inputs.splice(index, 1);
      ctx.save();
      replay();
    }

    /** Put text in the input without running it, so it can be changed first. */
    function insert(code) {
      field.value = code;
      grow();
      field.focus();
    }

    const chips = h(
      'div',
      { class: 'chip-row mx2-chips', role: 'group', 'aria-label': 'Examples' },
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

    const clear = h(
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
    );

    const empty = h(
      'div',
      { class: 'mx2-empty' },
      h('p', { class: 'mx2-empty-title' }, 'Exact algebra and calculus'),
      h(
        'p',
        { class: 'mx2-empty-text' },
        'Type a command below, or start from one of these. Results are exact, and earlier results stay available as %.',
      ),
      h(
        'div',
        { class: 'mx2-cards' },
        EXAMPLES.slice(0, 6).map(([label, code]) =>
          h(
            'button',
            {
              class: 'mx2-card',
              type: 'button',
              onclick: () => {
                field.value = code;
                submit();
              },
            },
            h('span', { class: 'mx2-card-name' }, label),
            h('code', { class: 'mx2-card-code' }, code),
          ),
        ),
      ),
    );

    const composer = h(
      'div',
      { class: 'mx2-compose' },
      h(
        'div',
        { class: 'mx2-prompt' },
        h('span', { class: 'mx2-caret', 'aria-hidden': 'true' }, '\u203a'),
        field,
        h('button', { class: 'btn btn-primary mx2-run', type: 'button', onclick: submit }, icon('play', 14), ' Run'),
      ),
      chips,
      h(
        'p',
        { class: 'mx2-keys' },
        'Enter runs the command. Shift+Enter starts a new line. End a command with $ to hide its result.',
      ),
    );

    const side = h(
      'aside',
      { class: 'mx2-side', 'aria-label': 'Command reference' },
      h('h3', { class: 'mx2-side-title' }, 'Commands'),
      h('p', { class: 'mx2-side-hint' }, 'Select one to put its example in the input.'),
      h(
        'ul',
        { class: 'mx2-ref' },
        COMMANDS.map(([syntax, about, example]) =>
          h(
            'li',
            {},
            h(
              'button',
              { class: 'mx2-ref-item', type: 'button', title: example, onclick: () => insert(example) },
              h('code', { class: 'mx2-ref-syntax' }, syntax),
              h('span', { class: 'mx2-ref-about' }, about),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'mx2-side-note' },
        'This is a small built-in engine that reads Maxima syntax, not the full Maxima program. A command it does not support is reported, never guessed.',
      ),
    );

    root.classList.add('tool', 'maxima-tool');
    root.append(
      h(
        'div',
        { class: 'mx2-layout' },
        h(
          'section',
          { class: 'mx2-main', 'aria-label': 'Session' },
          h(
            'header',
            { class: 'mx2-head' },
            h(
              'div',
              {},
              h('h2', { class: 'mx2-title' }, 'Symbolic algebra'),
              h('p', { class: 'mx2-sub' }, 'Commands use Maxima syntax.'),
            ),
            clear,
          ),
          h('div', { class: 'mx2-scroll' }, empty, transcript),
          composer,
        ),
        side,
      ),
    );
    const syncEmpty = () => {
      empty.hidden = entries.length > 0;
    };
    replay();
    const save = debounce(() => ctx.save(), 200);
    return {
      onShow: () => {
        scroller().scrollTop = scroller().scrollHeight;
      },
      destroy: () => save.cancel(),
    };
  },
};
