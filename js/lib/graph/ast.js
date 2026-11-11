/** Helpers for walking the graphing language's AST. */
import { BINDERS } from './names.js';

/**
 * Collect the names an AST uses.
 * `ids` holds plain names; `calls` holds names written like f(...), which are
 * either functions or a variable multiplying a parenthesised expression.
 * Names bound by `for`, `sum`, `prod`, and `int` are not reported.
 */
export function collectNames(node) {
  const out = { ids: new Set(), calls: new Set() };
  walk(node, new Set(), out);
  return out;
}

/** Every name that appears, whether as an id or the head of a call. */
export function namesUsed(node) {
  const { ids, calls } = collectNames(node);
  return new Set([...ids, ...calls]);
}

export const usesName = (node, name) => namesUsed(node).has(name);

function walk(node, bound, out) {
  switch (node.type) {
    case 'num':
      return;
    case 'id':
      if (!bound.has(node.name)) out.ids.add(node.name);
      return;
    case 'neg':
    case 'abs':
    case 'fact':
    case 'deg':
      walk(node.arg, bound, out);
      return;
    case 'bin':
      walk(node.left, bound, out);
      walk(node.right, bound, out);
      return;
    case 'call': {
      if (BINDERS.has(node.name) && node.args.length === 4 && node.args[0].type === 'id') {
        walk(node.args[1], bound, out);
        walk(node.args[2], bound, out);
        walk(node.args[3], new Set([...bound, node.args[0].name]), out);
        return;
      }
      if (!bound.has(node.name)) out.calls.add(node.name);
      for (const arg of node.args) walk(arg, bound, out);
      return;
    }
    case 'deriv':
      out.calls.add(node.name);
      for (const arg of node.args) walk(arg, bound, out);
      return;
    case 'point':
      walk(node.x, bound, out);
      walk(node.y, bound, out);
      return;
    case 'list':
      for (const item of node.items) walk(item, bound, out);
      return;
    case 'range':
      walk(node.start, bound, out);
      if (node.second) walk(node.second, bound, out);
      if (node.end) walk(node.end, bound, out);
      return;
    case 'index':
      walk(node.target, bound, out);
      walk(node.index, bound, out);
      return;
    case 'listcomp': {
      for (const b of node.bindings) walk(b.source, bound, out);
      walk(node.body, new Set([...bound, ...node.bindings.map((b) => b.name)]), out);
      return;
    }
    case 'piece':
      for (const b of node.branches) {
        walk(b.cond, bound, out);
        walk(b.value, bound, out);
      }
      if (node.otherwise) walk(node.otherwise, bound, out);
      return;
    case 'cmp':
      for (const part of node.parts) walk(part, bound, out);
      return;
    case 'dot':
      walk(node.target, bound, out);
      return;
    default:
      return;
  }
}
