/**
 * The graph model: turns a list of expression rows into plots.
 *
 * For every row it decides what the text means (a function to draw, an implicit
 * curve, an inequality, a polar or parametric curve, points, a slider, a
 * definition, or a value to show), compiles it, and reports errors. Definitions
 * are ordered by dependency, and circular ones are reported instead of looping.
 *
 * Pure: no DOM access, so it is unit tested in Node.
 */
import { evaluateNumber } from '../expr.js';
import { namesUsed } from './ast.js';
import { Ctx, FnEntry, GraphCompileError, Scope, compileConditions, compileNode } from './compile.js';
import { NOT_DEFINABLE, isFunctionName } from './names.js';
import { GraphSyntaxError, parseExpression, parseStatement } from './parse.js';
import { GraphEvalError, Point, formatNumber, formatValue } from './values.js';

export const DEFAULT_SLIDER = { min: -10, max: 10 };
const CONSTANT_NAMES = new Set(['e', 'pi', 'tau']);
const KNOWN_ERRORS = [GraphSyntaxError, GraphCompileError, GraphEvalError];

const isKnownError = (e) => KNOWN_ERRORS.some((type) => e instanceof type);
const isId = (node, name) => node.type === 'id' && node.name === name;

/** Is this value a point or a list of points (so it is drawn rather than printed)? */
export function isPointValue(v) {
  if (v instanceof Point) return true;
  return Array.isArray(v) && v.length > 0 && v.every((item) => item instanceof Point);
}

/* ---------------------------------------------------------- classification */

function functionHead(lhs) {
  if (lhs.type !== 'call' || isFunctionName(lhs.name) || NOT_DEFINABLE.has(lhs.name)) return null;
  if (lhs.args.length === 0 || !lhs.args.every((a) => a.type === 'id' && !CONSTANT_NAMES.has(a.name))) return null;
  const params = lhs.args.map((a) => a.name);
  if (new Set(params).size !== params.length) {
    throw new GraphCompileError(`${lhs.name}() uses the same parameter name twice`);
  }
  return { name: lhs.name, params };
}

/** Recognise `a = ...` and `f(x) = ...` definitions, which need no plotting variables. */
function asDefinition(stmt) {
  if (stmt.ops.length !== 1 || stmt.ops[0] !== '=') return null;
  const [lhs, rhs] = stmt.parts;
  const head = functionHead(lhs);
  if (head) return { kind: 'fn', ...head, rhs, restrictions: stmt.restrictions };
  const isPolarR = lhs.type === 'id' && lhs.name === 'r' && namesUsed(rhs).has('theta');
  if (lhs.type === 'id' && !NOT_DEFINABLE.has(lhs.name) && !isPolarR) {
    return { kind: 'var', name: lhs.name, rhs, restrictions: stmt.restrictions };
  }
  return null;
}

function extractDomain(conds, variable) {
  const list = conds ?? [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c.parts.length !== 3 || !isId(c.parts[1], variable)) continue;
    if (namesUsed(c.parts[0]).has(variable) || namesUsed(c.parts[2]).has(variable)) continue;
    const [a, b] = c.ops;
    const rest = list.filter((_, j) => j !== i);
    if ((a === '<' || a === '<=') && (b === '<' || b === '<=')) return { lo: c.parts[0], hi: c.parts[2], rest };
    if ((a === '>' || a === '>=') && (b === '>' || b === '>=')) return { lo: c.parts[2], hi: c.parts[0], rest };
  }
  return { lo: null, hi: null, rest: list };
}

/** Decide what a non-definition statement draws. `tIsParameter` is false when the user defined t. */
function classifyPlot(stmt, tIsParameter) {
  const { parts, ops, restrictions } = stmt;
  const used = new Set();
  for (const part of parts) for (const name of namesUsed(part)) used.add(name);
  const uses = (name) => used.has(name);
  const usesIn = (node, name) => namesUsed(node).has(name);
  const polar = uses('theta');

  if (ops.length === 0) {
    const expr = parts[0];
    if (polar) throw new GraphCompileError('Polar graphs need an equation, like r = 1 + cos(theta).');
    if (expr.type === 'point' && tIsParameter && uses('t')) return { kind: 'param', expr, restrictions };
    if (uses('y')) {
      throw new GraphCompileError('This uses y. Write an equation such as y = ... or x^2 + y^2 = 1.');
    }
    if (uses('x')) return { kind: 'explicit', rhs: expr, restrictions };
    return { kind: 'value', expr, restrictions };
  }

  if (ops.some((op) => op === '=') && ops.some((op) => op !== '=')) {
    throw new GraphCompileError('Use either = or inequalities such as <, not both in one row.');
  }

  if (ops[0] === '=') {
    if (ops.length > 1) throw new GraphCompileError('An equation has one = sign.');
    const [left, right] = parts;
    if (polar) {
      const rOnLeft = isId(left, 'r') && !usesIn(right, 'r') && !usesIn(right, 'x') && !usesIn(right, 'y');
      const rOnRight = isId(right, 'r') && !usesIn(left, 'r') && !usesIn(left, 'x') && !usesIn(left, 'y');
      if (rOnLeft) return { kind: 'polar', rhs: right, restrictions };
      if (rOnRight) return { kind: 'polar', rhs: left, restrictions };
      throw new GraphCompileError('Polar equations need r alone on one side, like r = 1 + cos(theta).');
    }
    if (isId(left, 'y') && !usesIn(right, 'y')) return { kind: 'explicit', rhs: right, restrictions };
    if (isId(right, 'y') && !usesIn(left, 'y')) return { kind: 'explicit', rhs: left, restrictions };
    if (isId(left, 'x') && !usesIn(right, 'x')) return { kind: 'explicitX', rhs: right, restrictions };
    if (isId(right, 'x') && !usesIn(left, 'x')) return { kind: 'explicitX', rhs: left, restrictions };
    if (uses('x') || uses('y')) return { kind: 'implicit', left, right, restrictions };
    throw new GraphCompileError('To graph an equation it needs x or y. To define a variable, write a = 3.');
  }

  if (polar) throw new GraphCompileError('Polar inequalities are not supported yet.');
  if (!uses('x') && !uses('y')) throw new GraphCompileError('An inequality needs x or y to shade a region.');
  return { kind: 'ineq', parts, ops, restrictions };
}

/* ----------------------------------------------------------------- compile */

const holds = (op, l, r) => {
  switch (op) {
    case '<':
      return l < r;
    case '<=':
      return l <= r;
    case '>':
      return l > r;
    default:
      return l >= r;
  }
};

const mustBeNumber = (v, what) => {
  if (typeof v !== 'number') {
    throw new GraphEvalError(
      `${what} must be a single number at each point, but this gives a ${Array.isArray(v) ? 'list' : 'point'}.`,
    );
  }
  return v;
};

function compilePlot(cls, scope, row, info, tIsParameter) {
  const plotVars = {
    explicit: ['x', 'y'],
    explicitX: ['x', 'y'],
    implicit: ['x', 'y'],
    ineq: ['x', 'y'],
    polar: ['theta', 'r'],
    param: tIsParameter ? ['t'] : [],
    value: [],
  }[cls.kind];
  const cx = new Ctx(scope, { allowed: plotVars });
  if (cls.kind === 'value' && cls.restrictions) {
    throw new GraphCompileError('A restriction needs something to graph, like y = x {x > 0}.');
  }
  let restrictions = cls.restrictions ?? [];
  let domain = null;

  if (cls.kind === 'param' || cls.kind === 'polar') {
    const variable = cls.kind === 'param' ? 't' : 'theta';
    const extracted = extractDomain(restrictions, variable);
    restrictions = extracted.rest;
    const defaults = cls.kind === 'param' ? ['0', '1'] : ['0', '12*pi'];
    const dcx = new Ctx(scope);
    const bound = (node, text, fallback) => {
      try {
        const source = (text ?? '').trim() === '' ? fallback : text;
        return compileNode(node ?? parseExpression(source), dcx);
      } catch (error) {
        if (!isKnownError(error)) throw error;
        throw new GraphCompileError(`The ${variable} limits must be numbers or expressions: ${error.message}`);
      }
    };
    const lo = bound(extracted.lo, row.tmin, defaults[0]);
    const hi = bound(extracted.hi, row.tmax, defaults[1]);
    const denv = dcx.newEnv();
    for (const name of dcx.undefinedNames) cx.undefinedNames.add(name);
    domain = () => {
      const a = lo(denv);
      const b = hi(denv);
      return [typeof a === 'number' ? a : NaN, typeof b === 'number' ? b : NaN];
    };
    info.domain = {
      variable,
      min: defaults[0],
      max: defaults[1],
      fromRestriction: extracted.lo !== null,
    };
  }

  const cond = restrictions.length > 0 ? compileConditions(restrictions, cx) : null;
  let plot;

  switch (cls.kind) {
    case 'explicit': {
      const body = compileNode(cls.rhs, cx);
      const env = cx.newEnv();
      plot = {
        type: 'explicit',
        f: (x) => {
          env[0] = x;
          return mustBeNumber(body(env), 'A graph y = ...');
        },
        mask: cond
          ? (x, y) => {
              env[0] = x;
              env[1] = y;
              return cond(env);
            }
          : null,
      };
      break;
    }
    case 'explicitX': {
      const body = compileNode(cls.rhs, cx);
      const env = cx.newEnv();
      plot = {
        type: 'explicitX',
        f: (y) => {
          env[1] = y;
          return mustBeNumber(body(env), 'A graph x = ...');
        },
        mask: cond
          ? (x, y) => {
              env[0] = x;
              env[1] = y;
              return cond(env);
            }
          : null,
      };
      break;
    }
    case 'implicit': {
      const left = compileNode(cls.left, cx);
      const right = compileNode(cls.right, cx);
      const env = cx.newEnv();
      plot = {
        type: 'implicit',
        F: (x, y) => {
          env[0] = x;
          env[1] = y;
          return (
            mustBeNumber(left(env), 'Each side of an equation') - mustBeNumber(right(env), 'Each side of an equation')
          );
        },
        mask: cond
          ? (x, y) => {
              env[0] = x;
              env[1] = y;
              return cond(env);
            }
          : null,
      };
      break;
    }
    case 'ineq': {
      const parts = cls.parts.map((p) => compileNode(p, cx));
      const env = cx.newEnv();
      const vals = new Array(parts.length).fill(0);
      const load = (x, y) => {
        env[0] = x;
        env[1] = y;
        for (let i = 0; i < parts.length; i += 1) vals[i] = mustBeNumber(parts[i](env), 'Each side of an inequality');
      };
      const holdsExcept = (skip) => {
        for (let i = 0; i < cls.ops.length; i += 1) {
          if (i !== skip && !holds(cls.ops[i], vals[i], vals[i + 1])) return false;
        }
        return cond ? cond(env) : true;
      };
      plot = {
        type: 'ineq',
        region: (x, y) => {
          load(x, y);
          return holdsExcept(-1);
        },
        boundaries: cls.ops.map((op, i) => ({
          strict: op === '<' || op === '>',
          F: (x, y) => {
            load(x, y);
            return vals[i] - vals[i + 1];
          },
          others: (x, y) => {
            load(x, y);
            return holdsExcept(i);
          },
        })),
      };
      break;
    }
    case 'polar': {
      const body = compileNode(cls.rhs, cx);
      const env = cx.newEnv();
      plot = {
        type: 'polar',
        domain,
        f: (theta) => {
          env[3] = theta;
          return mustBeNumber(body(env), 'A polar graph r = ...');
        },
        mask: cond
          ? (theta, r) => {
              env[3] = theta;
              env[4] = r;
              return cond(env);
            }
          : null,
      };
      break;
    }
    case 'param': {
      const px = compileNode(cls.expr.x, cx);
      const py = compileNode(cls.expr.y, cx);
      const env = cx.newEnv();
      plot = {
        type: 'param',
        domain,
        at: (t, out) => {
          env[2] = t;
          out[0] = mustBeNumber(px(env), 'A parametric curve (x(t), y(t))');
          out[1] = mustBeNumber(py(env), 'A parametric curve (x(t), y(t))');
        },
        mask: cond
          ? (t) => {
              env[2] = t;
              return cond(env);
            }
          : null,
      };
      break;
    }
    default: {
      const body = compileNode(cls.expr, cx);
      const env = cx.newEnv();
      plot = { type: 'points', get: () => body(env) };
    }
  }
  return { plot, undefinedNames: cx.undefinedNames };
}

/* ------------------------------------------------------------------- model */

function blankInfo(row) {
  return {
    id: row.id,
    kind: 'empty',
    error: null,
    runtimeError: null,
    undefinedNames: [],
    name: null,
    value: undefined,
    valueText: '',
    slider: null,
    sliderError: null,
    domain: null,
    plot: null,
  };
}

function fail(info, error) {
  if (!isKnownError(error)) throw error;
  info.kind = 'error';
  info.error = error.message;
  info.plot = null;
  info.slider = null;
}

function constantBound(text, fallback) {
  const t = (text ?? '').trim();
  if (t === '') return { value: fallback, bad: false };
  const value = evaluateNumber(t);
  return Number.isFinite(value) ? { value, bad: false } : { value: fallback, bad: true };
}

/**
 * @typedef {{ id: string, kind?: string, text?: string, min?: string, max?: string, step?: string, tmin?: string, tmax?: string }} GraphRow
 */
export class GraphModel {
  constructor() {
    this.scope = new Scope('rad');
    /** @type {Map<string, ReturnType<typeof blankInfo>>} */
    this.infos = new Map();
    this.defOrder = [];
    this.valuePlans = [];
    this.plansById = new Map();
  }

  /** Rebuild everything from the rows. Cheap enough to call on every edit. */
  update(rows, { angle = 'rad' } = {}) {
    const scope = new Scope(angle);
    this.scope = scope;
    this.infos = new Map();
    this.defOrder = [];
    this.valuePlans = [];
    this.plansById = new Map();

    const pending = [];
    for (const row of rows) {
      const info = blankInfo(row);
      this.infos.set(row.id, info);
      if (row.kind === 'note') {
        info.kind = 'note';
        continue;
      }
      if ((row.text ?? '').trim() === '') continue;
      try {
        const stmt = parseStatement(row.text);
        const def = asDefinition(stmt);
        const plan = { row, info, stmt, def };
        pending.push(plan);
        this.plansById.set(row.id, plan);
        info.kind = def ? def.kind : 'pending';
        info.name = def ? def.name : null;
      } catch (error) {
        fail(info, error);
      }
    }

    const defs = this.registerDefinitions(pending);
    this.compileDefinitions(defs);
    this.orderDefinitions(defs);
    this.evaluateVars();
    this.attachSliders();
    this.compilePlots(pending);
    this.refresh({ evaluate: false });
    return this.infos;
  }

  registerDefinitions(pending) {
    const defs = new Map();
    for (const plan of pending) {
      if (!plan.def) continue;
      const { name } = plan.def;
      if (defs.has(name)) {
        fail(plan.info, new GraphCompileError(`"${name}" is already defined in another row.`));
        plan.def = null;
        continue;
      }
      defs.set(name, plan);
      if (plan.def.kind === 'var') {
        plan.cell = { name, value: NaN };
        this.scope.vars.set(name, plan.cell);
      } else {
        plan.entry = new FnEntry(name, plan.def.params);
        this.scope.fns.set(name, plan.entry);
      }
    }
    return defs;
  }

  compileDefinitions(defs) {
    for (const plan of defs.values()) {
      const { def, info } = plan;
      try {
        if (def.kind === 'var') {
          if (def.restrictions)
            throw new GraphCompileError(
              'A variable cannot have a restriction. Define a function instead, like f(x) = ...',
            );
          const cx = new Ctx(this.scope);
          plan.body = compileNode(def.rhs, cx);
          plan.env = cx.newEnv();
          plan.refs = cx.refs;
          plan.undefinedNames = cx.undefinedNames;
        } else {
          const cx = new Ctx(this.scope, { firstSlot: def.params.length });
          def.params.forEach((p, i) => cx.locals.set(p, i));
          const body = compileNode(def.rhs, cx);
          const cond = def.restrictions ? compileConditions(def.restrictions, cx) : null;
          plan.entryBody = cond ? (env) => (cond(env) ? body(env) : NaN) : body;
          plan.entryEnv = cx.newEnv();
          plan.refs = cx.refs;
          plan.undefinedNames = cx.undefinedNames;
          plan.entry.body = plan.entryBody;
          plan.entry.env = plan.entryEnv;
        }
        info.undefinedNames = [...plan.undefinedNames];
      } catch (error) {
        fail(info, error);
        plan.broken = true;
        plan.refs = new Set();
      }
    }
  }

  /** Order definitions so each comes after what it uses, and mark circular ones. */
  orderDefinitions(defs) {
    const mark = new Map();
    const order = [];
    const cyclic = new Set();
    const visit = (name, stack) => {
      const seen = mark.get(name);
      if (seen === 1) return;
      if (seen === 0) {
        const cycle = stack.slice(stack.indexOf(name));
        const text =
          cycle.length === 1
            ? `"${name}" is defined in terms of itself.`
            : `Circular definition: ${[...cycle, name].join(' \u2192 ')}.`;
        for (const member of cycle) {
          cyclic.add(member);
          const plan = defs.get(member);
          if (!plan.info.error) fail(plan.info, new GraphCompileError(text));
        }
        return;
      }
      mark.set(name, 0);
      stack.push(name);
      for (const dep of defs.get(name).refs ?? []) if (defs.has(dep)) visit(dep, stack);
      stack.pop();
      mark.set(name, 1);
      order.push(name);
    };
    for (const name of defs.keys()) visit(name, []);
    for (const name of cyclic) {
      const plan = defs.get(name);
      plan.broken = true;
      if (plan.cell) plan.cell.value = NaN;
      if (plan.entry) plan.entry.body = null;
    }
    this.defOrder = order.map((name) => defs.get(name)).filter((plan) => !plan.broken);
  }

  /** Evaluate variable definitions in dependency order. Sliders keep the value the user set. */
  evaluateVars() {
    for (const plan of this.defOrder) {
      if (plan.def.kind !== 'var' || plan.info.slider) continue;
      try {
        plan.cell.value = plan.body(plan.env);
        plan.info.runtimeError = null;
      } catch (error) {
        if (!(error instanceof GraphEvalError)) throw error;
        plan.cell.value = NaN;
        plan.info.runtimeError = error.message;
      }
    }
  }

  /** A variable that is just a number (no names inside) becomes a slider. */
  attachSliders() {
    for (const plan of this.defOrder) {
      const { info } = plan;
      if (plan.def.kind !== 'var' || info.kind !== 'var') continue;
      const independent = plan.refs.size === 0 && plan.undefinedNames.size === 0;
      const value = plan.cell.value;
      if (independent && typeof value === 'number' && Number.isFinite(value)) this.attachSlider(plan, value);
    }
  }

  attachSlider(plan, value) {
    const { row, info } = plan;
    const min = constantBound(row.min, DEFAULT_SLIDER.min);
    const max = constantBound(row.max, DEFAULT_SLIDER.max);
    const step = constantBound(row.step, 0);
    let error = null;
    let [lo, hi] = [min.value, max.value];
    if (min.bad || max.bad || step.bad || step.value < 0)
      error = 'Slider limits must be numbers, and the step must be positive.';
    else if (!(lo < hi)) error = 'The slider minimum must be below its maximum.';
    if (error) [lo, hi] = [DEFAULT_SLIDER.min, DEFAULT_SLIDER.max];
    info.sliderError = error;
    info.slider = { min: lo, max: hi, step: step.bad || step.value <= 0 ? null : step.value, value };
  }

  compilePlots(pending) {
    const tIsParameter = !this.scope.vars.has('t');
    for (const plan of pending) {
      const { row, info } = plan;
      if (plan.def) {
        if (plan.broken) continue;
        this.attachDefinitionPlot(plan);
        continue;
      }
      if (info.kind === 'error') continue;
      try {
        const cls = classifyPlot(plan.stmt, tIsParameter);
        info.kind = cls.kind;
        const { plot, undefinedNames } = compilePlot(cls, this.scope, row, info, tIsParameter);
        info.plot = plot;
        info.undefinedNames = [...undefinedNames];
        if (cls.kind === 'value') this.valuePlans.push(plan);
      } catch (error) {
        fail(info, error);
      }
    }
  }

  attachDefinitionPlot(plan) {
    const { info } = plan;
    if (plan.def.kind === 'fn') {
      if (plan.entry.arity === 1) {
        const entry = plan.entry;
        info.plot = {
          type: 'explicit',
          f: (x) => mustBeNumber(entry.call1(x), `${entry.name}(x)`),
          mask: null,
        };
      }
      return;
    }
    const cell = plan.cell;
    info.plot = { type: 'points', get: () => cell.value };
  }

  /** Recompute displayed values after a slider moves or definitions change. */
  refresh({ evaluate = true } = {}) {
    if (evaluate) this.evaluateVars();
    for (const plan of this.valuePlans) {
      const { info } = plan;
      try {
        info.value = info.plot.get();
        info.runtimeError = null;
      } catch (error) {
        if (!(error instanceof GraphEvalError)) throw error;
        info.value = undefined;
        info.runtimeError = error.message;
      }
    }
    for (const info of this.infos.values()) {
      if (info.kind === 'var') info.value = this.plansById.get(info.id).cell.value;
      const shown = info.kind === 'var' || info.kind === 'value' ? info.value : undefined;
      info.valueText = info.slider || shown === undefined || isPointValue(shown) ? '' : formatValue(shown);
    }
  }

  /** Move a slider. Returns false when the row is not a slider. */
  setSlider(id, value) {
    const plan = this.plansById.get(id);
    if (!plan?.cell || !plan.info.slider || !Number.isFinite(value)) return false;
    plan.cell.value = value;
    plan.info.slider.value = value;
    this.refresh();
    return true;
  }

  info(id) {
    return this.infos.get(id) ?? null;
  }
}

/** Text that sets a slider row's variable to `value`: "a = 1.5". */
export function sliderText(name, value, step) {
  let digits = 12;
  if (step && step > 0) digits = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  const rounded = Number(value.toFixed(Math.min(digits, 12)));
  return `${name} = ${formatNumber(rounded)}`;
}

/** The step a slider moves in: the one the user set, or a tidy power of ten for about 1000 positions. */
export function sliderStep(slider) {
  if (slider.step && slider.step > 0) return slider.step;
  const raw = (slider.max - slider.min) / 1000;
  return Number(`1e${Math.floor(Math.log10(raw))}`);
}
