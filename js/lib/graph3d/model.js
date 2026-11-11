/**
 * The 3D graph model. It reuses everything about definitions, sliders, and
 * values from the 2D `GraphModel` and only decides what a row draws in space:
 *
 *   z = f(x, y), f(x, y) = ...   surface          (a list draws several)
 *   F(x, y, z) = G(x, y, z)      implicit surface
 *   (x(t), y(t), z(t))           space curve
 *   (x(u, v), y(u, v), z(u, v))  parametric surface
 *   (1, 2, 3), [(1, 2, 3), ...]  points
 *
 * Pure: no DOM access.
 */
import { namesUsed } from '../graph/ast.js';
import { Ctx, GraphCompileError, PLOT_SLOT, compileConditions, compileNode } from '../graph/compile.js';
import { GraphModel, extractDomain, fail, isId, isKnownError, mustBeNumber } from '../graph/model.js';
import { NOT_DEFINABLE } from '../graph/names.js';
import { parseExpression } from '../graph/parse.js';
import { GraphEvalError, Point } from '../graph/values.js';

const PARAMS = ['t', 'u', 'v'];

/** Is this value a 3D point or a list of them? */
export function isPoint3Value(v) {
  const is3 = (p) => p instanceof Point && p.z !== undefined;
  if (is3(v)) return true;
  return Array.isArray(v) && v.length > 0 && v.every(is3);
}

function classify(stmt, scope) {
  const { parts, ops, restrictions } = stmt;
  const used = new Set();
  for (const part of parts) for (const name of namesUsed(part)) used.add(name);
  const uses = (name) => used.has(name);
  const usesIn = (node, name) => namesUsed(node).has(name);
  const free = (name) => !scope.vars.has(name);

  if (uses('theta') || (uses('r') && free('r') && ops.length === 1 && ops[0] === '=' && isId(parts[0], 'r'))) {
    if (uses('theta')) throw new GraphCompileError('Polar graphs are in the 2D graph. Here, use x, y, and z.');
  }

  if (ops.length === 0) {
    const expr = parts[0];
    if (expr.type === 'point') {
      if (!expr.z) {
        throw new GraphCompileError('Points here have three coordinates, like (1, 2, 3).');
      }
      const params = PARAMS.filter((name) => uses(name) && free(name));
      if (params.length === 0) return { kind: 'points3', expr, restrictions };
      if (params.length === 1) return { kind: 'curve3', expr, params, restrictions };
      if (params.length === 2) return { kind: 'psurface', expr, params, restrictions };
      throw new GraphCompileError('A parametric graph can use at most two of t, u, and v.');
    }
    if (uses('z'))
      throw new GraphCompileError('This uses z. Write an equation such as z = ... or x^2 + y^2 + z^2 = 9.');
    if (uses('x') || uses('y')) return { kind: 'surface', rhs: expr, restrictions };
    return { kind: 'value', expr, restrictions };
  }

  if (ops.some((op) => op === '=') && ops.some((op) => op !== '=')) {
    throw new GraphCompileError('Use either = or inequalities such as <, not both in one row.');
  }
  if (ops[0] !== '=') throw new GraphCompileError('Inequalities are not supported in 3D yet. Use an equation.');
  if (ops.length > 1) throw new GraphCompileError('An equation has one = sign.');
  const [left, right] = parts;
  if (isId(left, 'z') && !usesIn(right, 'z')) return { kind: 'surface', rhs: right, restrictions };
  if (isId(right, 'z') && !usesIn(left, 'z')) return { kind: 'surface', rhs: left, restrictions };
  if (uses('x') || uses('y') || uses('z')) return { kind: 'implicit3', left, right, restrictions };
  throw new GraphCompileError('To graph an equation it needs x, y, or z. To define a variable, write a = 3.');
}

const slotOf = (name) => PLOT_SLOT[name];

export class Graph3DModel extends GraphModel {
  constructor() {
    super();
    this.reserved = new Set([...NOT_DEFINABLE, 'z']);
    this.dimensions = 3;
  }

  compilePlots(pending) {
    for (const plan of pending) {
      const { info } = plan;
      if (plan.def) {
        if (plan.broken) continue;
        this.attachDefinitionPlot(plan);
        continue;
      }
      if (info.kind === 'error') continue;
      try {
        const cls = classify(plan.stmt, this.scope);
        info.kind = cls.kind;
        const { plot, undefinedNames } = this.compile3(cls, plan.row, info);
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
      if (plan.entry.arity === 2) {
        const entry = plan.entry;
        info.plot = { type: 'surface', raw: (x, y) => entry.call2(x, y), mask: null };
      }
      return;
    }
    const cell = plan.cell;
    info.plot = { type: 'points3', get: () => cell.value };
  }

  /** Compile the parameter limits of a curve or parametric surface. */
  domains(cls, row, info, scope) {
    const out = [];
    let restrictions = cls.restrictions ?? [];
    const undefinedNames = new Set();
    info.domains = [];
    for (const name of cls.params) {
      const extracted = extractDomain(restrictions, name);
      restrictions = extracted.rest;
      const typed = row.ranges?.[name] ?? [];
      const dcx = new Ctx(scope, { dimensions: 3 });
      const bound = (node, text, fallback) => {
        try {
          const source = (text ?? '').trim() === '' ? fallback : text;
          return compileNode(node ?? parseExpression(source), dcx);
        } catch (error) {
          if (!isKnownError(error)) throw error;
          throw new GraphCompileError(`The ${name} limits must be numbers or expressions: ${error.message}`);
        }
      };
      const lo = bound(extracted.lo, typed[0], '0');
      const hi = bound(extracted.hi, typed[1], '2*pi');
      const env = dcx.newEnv();
      for (const n of dcx.undefinedNames) undefinedNames.add(n);
      out.push(() => {
        const a = lo(env);
        const b = hi(env);
        return [typeof a === 'number' ? a : NaN, typeof b === 'number' ? b : NaN];
      });
      info.domains.push({ variable: name, min: '0', max: '2*pi', fromRestriction: extracted.lo !== null });
    }
    return { domains: out, restrictions, undefinedNames };
  }

  compile3(cls, row, info) {
    const { kind } = cls;
    if (kind === 'value' && cls.restrictions) {
      throw new GraphCompileError('A restriction needs something to graph, like z = x + y {x > 0}.');
    }
    let allowed = [];
    let restrictions = cls.restrictions ?? [];
    let domains = [];
    let extraUndefined = new Set();
    if (kind === 'surface') allowed = ['x', 'y', 'z'];
    else if (kind === 'implicit3') allowed = ['x', 'y', 'z'];
    else if (kind === 'curve3' || kind === 'psurface') {
      const parsed = this.domains(cls, row, info, this.scope);
      domains = parsed.domains;
      restrictions = parsed.restrictions;
      extraUndefined = parsed.undefinedNames;
      allowed = cls.params;
    }
    const cx = new Ctx(this.scope, { allowed, dimensions: 3 });
    const cond = restrictions.length > 0 ? compileConditions(restrictions, cx) : null;
    let plot;

    switch (kind) {
      case 'surface': {
        const body = compileNode(cls.rhs, cx);
        const env = cx.newEnv();
        plot = {
          type: 'surface',
          raw: (x, y) => {
            env[0] = x;
            env[1] = y;
            return body(env);
          },
          mask: cond
            ? (x, y, z) => {
                env[0] = x;
                env[1] = y;
                env[PLOT_SLOT.z] = z;
                return cond(env);
              }
            : null,
        };
        break;
      }
      case 'implicit3': {
        const left = compileNode(cls.left, cx);
        const right = compileNode(cls.right, cx);
        const env = cx.newEnv();
        const what = 'Each side of an equation';
        plot = {
          type: 'implicit3',
          F: (x, y, z) => {
            env[0] = x;
            env[1] = y;
            env[PLOT_SLOT.z] = z;
            return mustBeNumber(left(env), what) - mustBeNumber(right(env), what);
          },
          mask: cond
            ? (x, y, z) => {
                env[0] = x;
                env[1] = y;
                env[PLOT_SLOT.z] = z;
                return cond(env);
              }
            : null,
        };
        break;
      }
      case 'curve3': {
        const [px, py, pz] = ['x', 'y', 'z'].map((k) => compileNode(cls.expr[k], cx));
        const env = cx.newEnv();
        const slot = slotOf(cls.params[0]);
        const what = 'A space curve (x(t), y(t), z(t))';
        plot = {
          type: 'curve3',
          variable: cls.params[0],
          domain: domains[0],
          at: (t, out) => {
            env[slot] = t;
            out[0] = mustBeNumber(px(env), what);
            out[1] = mustBeNumber(py(env), what);
            out[2] = mustBeNumber(pz(env), what);
          },
          mask: cond
            ? (t) => {
                env[slot] = t;
                return cond(env);
              }
            : null,
        };
        break;
      }
      case 'psurface': {
        const [px, py, pz] = ['x', 'y', 'z'].map((k) => compileNode(cls.expr[k], cx));
        const env = cx.newEnv();
        const [su, sv] = cls.params.map(slotOf);
        const what = 'A parametric surface';
        plot = {
          type: 'psurface',
          variables: cls.params,
          domainU: domains[0],
          domainV: domains[1],
          at: (u, v, out) => {
            env[su] = u;
            env[sv] = v;
            out[0] = mustBeNumber(px(env), what);
            out[1] = mustBeNumber(py(env), what);
            out[2] = mustBeNumber(pz(env), what);
          },
          mask: cond
            ? (u, v) => {
                env[su] = u;
                env[sv] = v;
                return cond(env);
              }
            : null,
        };
        break;
      }
      default: {
        const body = compileNode(cls.expr, cx);
        const env = cx.newEnv();
        plot = { type: 'points3', get: () => body(env) };
      }
    }
    const undefinedNames = new Set([...cx.undefinedNames, ...extraUndefined]);
    return { plot, undefinedNames };
  }
}

export { GraphEvalError };
