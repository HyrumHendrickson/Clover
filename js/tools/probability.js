import {
  MAX_FIELD,
  bars,
  callout,
  chartPane,
  firstProblem,
  inputKit,
  modeButtons,
  note,
  numberOf,
  pick,
  table,
  text,
  tiles,
} from '../core/calcui.js';
import { debounce, h, onResize } from '../core/dom.js';
import { formatNumber } from '../lib/graph/values.js';
import {
  MAX_COUNT,
  bayes,
  combinations,
  discreteSummary,
  eventProbabilities,
  formatCount,
  parseOutcomes,
  permutations,
} from '../lib/probability.js';
import { DISTRIBUTIONS, binomCdf } from '../lib/stats.js';
import { fitCanvas } from '../lib/viewport.js';

const MAX_OUTCOMES_TEXT = 4000;
/** The number of cases the Bayes tab uses to turn probabilities into counts. */
const CASES = 10000;

const MODES = [
  ['counting', 'Counting'],
  ['events', 'Two events'],
  ['bayes', 'Bayes\u2019 theorem'],
  ['trials', 'Repeated trials'],
  ['variable', 'Random variable'],
];
const ORDER = [
  ['no', 'Order does not matter'],
  ['yes', 'Order matters'],
];
const REPEAT = [
  ['no', 'No repeats'],
  ['yes', 'Repeats allowed'],
];
const LINKS = [
  ['independent', 'A and B are independent'],
  ['exclusive', 'A and B cannot both happen'],
  ['joint', 'I know P(A and B)'],
  ['cond', 'I know P(A given B)'],
];
const KINDS = [
  ['exactly', 'Exactly k successes'],
  ['atmost', 'At most k successes'],
  ['atleast', 'At least k successes'],
  ['between', 'Between two numbers of successes'],
];

const DEFAULTS = {
  counting: { n: '10', r: '3', order: 'no', repeat: 'no' },
  events: { pa: '0.5', pb: '0.4', link: 'independent', joint: '0.2', cond: '0.5' },
  bayes: { prior: '0.01', sensitivity: '0.9', falsePositive: '0.05' },
  trials: { n: '10', p: '0.5', kind: 'exactly', k: '5', k2: '7' },
  variable: { outcomes: '1, 1/6\n2, 1/6\n3, 1/6\n4, 1/6\n5, 1/6\n6, 1/6' },
};

const CHOICES = {
  counting: { order: ORDER, repeat: REPEAT },
  events: { link: LINKS },
  bayes: {},
  trials: { kind: KINDS },
  variable: {},
};

/* ------------------------------------------------------------------- state */

function normalizeSection(name, raw) {
  const given = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULTS[name])) {
    const list = CHOICES[name][key];
    if (list) out[key] = pick(given[key], list, fallback);
    else if (key === 'outcomes')
      out[key] = typeof given[key] === 'string' ? given[key].slice(0, MAX_OUTCOMES_TEXT) : fallback;
    else out[key] = text(given[key], MAX_FIELD, fallback);
  }
  return out;
}

const normalize = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: pick(r.mode, MODES, 'counting'),
    counting: normalizeSection('counting', r.counting),
    events: normalizeSection('events', r.events),
    bayes: normalizeSection('bayes', r.bayes),
    trials: normalizeSection('trials', r.trials),
    variable: normalizeSection('variable', r.variable),
  };
};

/* ----------------------------------------------------------------- display */

const show = (value) => formatNumber(value, 6);
const percent = (value) => `${formatNumber(value * 100, 5)}%`;
const PROBABILITY_HELP = 'Enter each probability as a number from 0 to 1, like 0.25 or 1/4.';

/** The formula behind a count, with the numbers filled in. */
export function countFormula(n, r, ordered, repeat) {
  const minus = '\u2212';
  const times = '\u00d7';
  if (ordered && repeat) return `${n}^${r}`;
  if (ordered) return r <= n ? `P(${n}, ${r}) = ${n}! / ${n - r}!` : `P(${n}, ${r}) = 0`;
  if (repeat)
    return n === 0
      ? `C(n + r ${minus} 1, r)`
      : `C(${n} + ${r} ${minus} 1, ${r}) = ${n + r - 1}! / (${r}! ${times} ${n - 1}!)`;
  return r <= n ? `C(${n}, ${r}) = ${n}! / (${r}! ${times} ${n - r}!)` : `C(${n}, ${r}) = 0`;
}

/** The bars of a binomial chart, covering the part of the range where the probability is not negligible. */
function binomialSpec(dist, n, region) {
  const lo = Math.max(0, Math.floor(dist.mean - 5 * dist.sd - 2));
  const hi = Math.min(n, Math.ceil(dist.mean + 5 * dist.sd + 2));
  const barList = [];
  for (let k = lo; k <= hi; k += 1) {
    barList.push({ x0: k - 0.4, x1: k + 0.4, y: dist.pdf(k), shaded: k >= region.from && k <= region.to });
  }
  const top = Math.max(...barList.map((b) => b.y)) || 1;
  return {
    x: [lo - 1, hi + 1],
    y: [0, top * 1.1],
    xLabel: '',
    yLabel: 'Probability',
    layers: [{ kind: 'bars', bars: barList }],
  };
}

/* -------------------------------------------------------------------- tool */

export default {
  type: 'probability',
  name: 'Probability',
  description:
    'Counting, two events, Bayes\u2019 theorem, repeated trials, and the expected value of a random variable.',
  defaultState: () => normalize({}),
  normalize,

  preview(canvas, colors) {
    const { ctx, width, height } = fitCanvas(canvas);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const heights = [0.06, 0.2, 0.42, 0.7, 0.92, 1, 0.92, 0.7, 0.42, 0.2, 0.06];
    const gap = width / (heights.length + 2);
    heights.forEach((v, i) => {
      ctx.fillStyle = i >= 4 && i <= 6 ? colors.b : colors.a;
      ctx.fillRect(gap * (i + 1) + 2, height * 0.85 - v * height * 0.65, gap - 4, v * height * 0.65);
    });
  },

  mount(root, ctx) {
    const state = ctx.state;

    const modeBar = h('div', { class: 'btn-group st-modes', role: 'group', 'aria-label': 'What to work out' });
    const controls = h('div', { class: 'st-controls' });
    const results = h('div', { class: 'st-results', 'aria-live': 'polite' });
    const pane = chartPane('Chart of the result');
    const charts = h('div', { class: 'st-charts' }, pane.canvas);
    const output = h('div', { class: 'st-output' }, charts, results);

    const save = () => ctx.save();
    const refreshLater = debounce(() => refresh(), 200);
    const { textInput, areaInput, choice } = inputKit({
      save,
      refresh: () => refresh(),
      refreshSoon: () => refreshLater(),
      rebuild: () => buildControls(),
    });

    /* ----------------------------------------------------------- results */

    const fail = (message) => ({ out: [note(message)], spec: null });

    function counting() {
      const c = state.counting;
      const n = numberOf(c.n);
      const r = numberOf(c.r);
      const whole = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;
      const problem = firstProblem([
        [!whole(n), `Enter the number of items as a whole number from 0 to ${MAX_COUNT}.`],
        [!whole(r), `Enter how many to choose as a whole number from 0 to ${MAX_COUNT}.`],
      ]);
      if (problem) return fail(problem);

      const ordered = c.order === 'yes';
      const repeat = c.repeat === 'yes';
      const count = (ordered ? permutations : combinations)(n, r, repeat);
      const shown = formatCount(count);
      const rows = [['Formula', countFormula(n, r, ordered, repeat)]];
      if (count.toString().length > 15) rows.push(['Exact value', count.toString()]);
      if (count > 0n) rows.push(['Chance of one particular outcome, if all are equally likely', `1 in ${shown}`]);
      const out = [tiles([[ordered ? 'Arrangements' : 'Selections', shown]]), table(rows)];
      if (count === 0n)
        out.push(
          note(
            'Without repeats you cannot choose more items than there are. Allow repeats or lower the number to choose.',
          ),
        );
      return { out, spec: null };
    }

    function events() {
      const e = state.events;
      const pa = numberOf(e.pa);
      const pb = numberOf(e.pb);
      const joints = {
        independent: pa * pb,
        exclusive: 0,
        joint: numberOf(e.joint),
        cond: numberOf(e.cond) * pb,
      };
      const result = eventProbabilities({ pa, pb, pab: joints[e.link] });
      if (!result.valid) {
        if (result.reason === 'probability') return fail(PROBABILITY_HELP);
        const asCondition = e.link === 'cond' && pb > 0;
        return fail(
          asCondition
            ? `With P(A) = ${show(pa)} and P(B) = ${show(pb)}, P(A given B) must be between ${show(result.lower / pb)} and ${show(result.upper / pb)}.`
            : `With P(A) = ${show(pa)} and P(B) = ${show(pb)}, P(A and B) must be between ${show(result.lower)} and ${show(result.upper)}.`,
        );
      }
      const product = pa * pb;
      const verdict = result.independent
        ? 'A and B are independent: P(A and B) equals P(A) \u00d7 P(B).'
        : `A and B are not independent: P(A and B) is ${show(result.joint)}, but P(A) \u00d7 P(B) is ${show(product)}.`;
      return {
        out: [
          tiles([
            ['P(A or B)', show(result.union)],
            ['P(A and B)', show(result.joint)],
            ['P(A given B)', show(result.aGivenB)],
            ['P(B given A)', show(result.bGivenA)],
          ]),
          callout(verdict, result.independent),
          bars([
            ['A only', result.aOnly, show(result.aOnly)],
            ['Both', result.joint, show(result.joint)],
            ['B only', result.bOnly, show(result.bOnly)],
            ['Neither', result.neither, show(result.neither)],
          ]),
          table([
            ['P(not A)', show(1 - pa)],
            ['P(not B)', show(1 - pb)],
            ['P(A only)', show(result.aOnly)],
            ['P(B only)', show(result.bOnly)],
            ['P(neither)', show(result.neither)],
          ]),
        ],
        spec: null,
      };
    }

    function bayesTheorem() {
      const b = state.bayes;
      const prior = numberOf(b.prior);
      const sensitivity = numberOf(b.sensitivity);
      const falsePositive = numberOf(b.falsePositive);
      const r = bayes({ prior, sensitivity, falsePositive });
      if (!r) return fail(PROBABILITY_HELP);
      if (!Number.isFinite(r.posterior))
        return fail(
          'The evidence cannot happen with these values, so there is nothing to update. Raise the sensitivity or the false positive rate above 0.',
        );
      return {
        out: [
          tiles([
            ['P(H given E)', show(r.posterior)],
            ['P(H given not E)', show(r.posteriorWithout)],
            ['P(E)', show(r.evidence)],
            ['Prior, P(H)', show(prior)],
          ]),
          callout(`Seeing E moves the chance of H from ${percent(prior)} to ${percent(r.posterior)}.`, true),
          bars([
            ['Before', prior, percent(prior)],
            ['After seeing E', r.posterior, percent(r.posterior)],
            ['After not seeing E', r.posteriorWithout, percent(r.posteriorWithout)],
          ]),
          table([
            [`Of ${CASES.toLocaleString('en-US')} cases, H and E`, show(CASES * r.hit)],
            ['H but not E', show(CASES * r.miss)],
            ['E but not H', show(CASES * r.falseAlarm)],
            ['Neither', show(CASES * r.clear)],
          ]),
        ],
        spec: null,
      };
    }

    function trials() {
      const t = state.trials;
      const n = numberOf(t.n);
      const p = numberOf(t.p);
      const k = numberOf(t.k);
      const k2 = numberOf(t.k2);
      const between = t.kind === 'between';
      const dist = DISTRIBUTIONS.binomial.make({ n, p });
      const problem = firstProblem([
        [!dist, 'Enter the trials as a whole number from 1 to 5000, and the probability of success between 0 and 1.'],
        [
          !(Number.isInteger(k) && k >= 0 && k <= n),
          `Enter the number of successes as a whole number from 0 to ${show(n)}.`,
        ],
        [
          between && !(Number.isInteger(k2) && k2 >= k && k2 <= n),
          'Enter the upper number of successes as a whole number from the lower one up to the trials.',
        ],
      ]);
      if (problem) return fail(problem);

      const cases = {
        exactly: { label: `P(X = ${k})`, value: dist.pdf(k), region: { from: k, to: k } },
        atmost: { label: `P(X \u2264 ${k})`, value: dist.cdf(k), region: { from: -Infinity, to: k } },
        atleast: { label: `P(X \u2265 ${k})`, value: binomCdf(n - k, n, 1 - p), region: { from: k, to: Infinity } },
        between: {
          label: `P(${k} \u2264 X \u2264 ${k2})`,
          value: dist.cdf(k2) - dist.cdf(k - 1),
          region: { from: k, to: k2 },
        },
      };
      const chosen = cases[t.kind];
      const anySuccess = -Math.expm1(n * Math.log1p(-p));
      return {
        out: [
          tiles([
            [chosen.label, show(chosen.value)],
            ['Mean, n \u00d7 p', show(dist.mean)],
            ['Standard deviation', show(dist.sd)],
          ]),
          table([
            ['Chance of at least one success', show(anySuccess)],
            ['Chance of no successes', show(1 - anySuccess)],
            ['Variance, n \u00d7 p \u00d7 (1 \u2212 p)', show(dist.variance)],
          ]),
        ],
        spec: binomialSpec(dist, n, chosen.region),
        description: `Binomial probabilities for ${show(n)} trials with success probability ${show(p)}. ${chosen.label} is ${show(chosen.value)}.`,
      };
    }

    function variable() {
      const { pairs, error } = parseOutcomes(state.variable.outcomes);
      if (error) return fail(error);
      const s = discreteSummary(pairs);
      if (Math.abs(s.total - 1) > 1e-9) return fail(`The probabilities add to ${show(s.total)}. They must add to 1.`);
      const xs = pairs.map(([x]) => x);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      const gap = gaps.length > 0 ? Math.min(...gaps) : 1;
      const top = Math.max(...pairs.map(([, p]) => p));
      return {
        out: [
          tiles([
            ['Expected value', show(s.mean)],
            ['Variance', show(s.variance)],
            ['Standard deviation', show(s.sd)],
            ['Outcomes', String(pairs.length)],
          ]),
        ],
        spec: {
          x: [xs[0] - gap, xs.at(-1) + gap],
          y: [0, top * 1.1],
          xLabel: '',
          yLabel: 'Probability',
          layers: [
            { kind: 'bars', bars: pairs.map(([x, p]) => ({ x0: x - gap * 0.4, x1: x + gap * 0.4, y: p })) },
            { kind: 'vline', x: s.mean, label: `Mean ${show(s.mean)}` },
          ],
        },
        description: `Probability of each outcome. The expected value is ${show(s.mean)}.`,
      };
    }

    function refresh() {
      refreshLater.cancel();
      const compute = { counting, events, bayes: bayesTheorem, trials, variable }[state.mode];
      const { out, spec, description } = compute();
      results.replaceChildren(...out);
      output.classList.toggle('calc-no-chart', spec === null);
      pane.show(spec, description);
    }

    /* ---------------------------------------------------------- controls */

    function buildModes() {
      modeBar.replaceChildren(
        ...modeButtons(MODES, state.mode, (next) => {
          state.mode = next;
          save();
          buildModes();
          buildControls();
          refresh();
        }),
      );
    }

    function buildControls() {
      const s = state[state.mode];
      const hint = (message) => h('p', { class: 'st-hint' }, message);
      const parts = {
        counting: () => [
          textInput('Items to choose from, n', s, 'n'),
          textInput('Items chosen, r', s, 'r'),
          choice('Order', s, 'order', ORDER),
          choice('Repeats', s, 'repeat', REPEAT),
        ],
        events: () => [
          textInput('P(A)', s, 'pa'),
          textInput('P(B)', s, 'pb'),
          choice('How A and B relate', s, 'link', LINKS, { rebuilds: true }),
          s.link === 'joint' ? textInput('P(A and B)', s, 'joint') : null,
          s.link === 'cond' ? textInput('P(A given B)', s, 'cond') : null,
          hint('Enter probabilities as decimals or fractions, like 0.25 or 1/4.'),
        ],
        bayes: () => [
          textInput('Prior probability, P(H)', s, 'prior'),
          textInput('Sensitivity, P(E given H)', s, 'sensitivity'),
          textInput('False positive rate, P(E given not H)', s, 'falsePositive'),
          hint(
            'H is what you want to know about, such as having a condition. E is the evidence, such as a positive test.',
          ),
        ],
        trials: () => [
          textInput('Trials, n', s, 'n'),
          textInput('Probability of success, p', s, 'p'),
          choice('Find the probability of', s, 'kind', KINDS, { rebuilds: true }),
          textInput(s.kind === 'between' ? 'From, successes' : 'Successes, k', s, 'k'),
          s.kind === 'between' ? textInput('To, successes', s, 'k2') : null,
        ],
        variable: () => [
          areaInput('Outcomes: one "value, probability" per line', s, 'outcomes', {
            max: MAX_OUTCOMES_TEXT,
            rows: 6,
            placeholder: '1, 1/6\n2, 1/6',
          }),
        ],
      };
      controls.replaceChildren(...parts[state.mode]().filter(Boolean));
    }

    /* ------------------------------------------------------------ layout */

    const stage = h(
      'div',
      { class: 'calc-stage' },
      h('section', { class: 'st-options', 'aria-label': 'Calculation' }, modeBar, controls),
      output,
    );
    root.classList.add('tool', 'calc-tool');
    root.append(stage);

    const stopObserving = onResize(stage, () => pane.repaintSoon());

    buildModes();
    buildControls();
    refresh();

    return {
      onShow: () => {
        pane.activate(true);
        refresh();
      },
      onHide: () => pane.activate(false),
      destroy: () => {
        refreshLater.cancel();
        stopObserving();
        pane.destroy();
      },
    };
  },
};
