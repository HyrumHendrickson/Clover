/**
 * Decides what to draw when a line of the linear algebra sheet is selected, and the geometry behind it.
 * Pure: no DOM, so it is tested directly.
 */
import { LinalgError, eigen, evaluate, isMatrix, matMul, toNumber } from './linalg.js';

const ASSIGN = /^\s*[\p{L}][\p{L}\p{N}_]*\s*=(?!=)\s*/u;

/** The text of an expression with a leading `name =` removed. */
export const stripAssignment = (text) => String(text).replace(ASSIGN, '').trim();

/** Split `A*B*x` at the top-level multiplication signs. Brackets and parentheses are respected. */
export function splitProduct(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if ((ch === '*' || ch === '\u00d7' || ch === '\u00b7') && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter((p) => p !== '');
}

const numbers = (m) => m.a.map((row) => row.map(toNumber));
const fits = (m, rows, cols) => isMatrix(m) && m.rows === rows && m.cols === cols;

/** Matrices and vectors that can be drawn: 2D and 3D vectors, and 2 by 2 and 3 by 3 matrices. */
export const drawable = (m) => fits(m, 2, 1) || fits(m, 3, 1) || fits(m, 2, 2) || fits(m, 3, 3);

function eigenOf(m) {
  try {
    const e = eigen(m);
    return e.pairs
      .filter((p) => p.value !== null)
      .flatMap((p) => p.unit.map((direction) => ({ value: toNumber(p.value), direction })));
  } catch (error) {
    if (error instanceof LinalgError) return [];
    throw error;
  }
}

/**
 * @param {{ id: string, kind: string, text?: string }[]} lines
 * @param {{ name: string | null, value: any, error: string | null }[]} results output of evaluateLines
 * @param {number} index the selected line
 * @returns {{ kind: 'none', message: string } | { kind: 'vector', dim: 2 | 3, v: number[], label: string }
 *   | { kind: 'transform', dim: 2 | 3, A: number[][], eigen: { value: number, direction: number[] }[], label: string }
 *   | { kind: 'apply', dim: 2 | 3, A: number[][], x: number[], eigen: { value: number, direction: number[] }[], label: string }}
 */
export function planFor(lines, results, index) {
  const line = lines[index];
  const out = results[index];
  if (!line || !out) return { kind: 'none', message: 'Select a line to draw it.' };
  const scope = new Map();
  for (let i = 0; i < index; i += 1)
    if (results[i].name && results[i].value !== null) scope.set(results[i].name, results[i].value);
  const label = out.name ?? (line.kind === 'expr' ? stripAssignment(line.text ?? '') : 'matrix');

  if (out.error) return { kind: 'none', message: 'Fix the error on this line to draw it.' };
  if (line.kind === 'expr') {
    const body = stripAssignment(line.text ?? '');
    if (body === '') return { kind: 'none', message: 'Type a calculation, or select a matrix or vector.' };
    const spectral = /^(?:eig|eigenvalues|eigenvectors)\s*\(([\s\S]*)\)$/.exec(body);
    if (spectral) {
      try {
        const A = evaluate(spectral[1], scope);
        if (fits(A, 2, 2) || fits(A, 3, 3)) {
          return { kind: 'transform', dim: A.rows, A: numbers(A), eigen: eigenOf(A), label: spectral[1].trim() };
        }
      } catch (error) {
        if (!(error instanceof LinalgError)) throw error;
      }
    }
    const factors = splitProduct(body);
    const letters = factors.length === 1 && /^\p{L}{2,}$/u.test(body) && !scope.has(body) ? [...body] : null;
    const parts = letters ?? factors;
    if (parts.length >= 2) {
      try {
        const x = evaluate(parts[parts.length - 1], scope);
        const rest = parts.slice(0, -1).map((p) => evaluate(p, scope));
        const A =
          rest.length === 1 ? rest[0] : rest.reduce((acc, m) => (isMatrix(acc) && isMatrix(m) ? matMul(acc, m) : null));
        if (isMatrix(A) && isMatrix(x) && ((fits(A, 2, 2) && fits(x, 2, 1)) || (fits(A, 3, 3) && fits(x, 3, 1)))) {
          return {
            kind: 'apply',
            dim: A.rows,
            A: numbers(A),
            x: numbers(x).map((r) => r[0]),
            eigen: eigenOf(A),
            label: body,
          };
        }
      } catch (error) {
        if (!(error instanceof LinalgError)) throw error;
      }
    }
  }
  const value = out.value;
  if (!isMatrix(value)) {
    return {
      kind: 'none',
      message:
        value === null
          ? 'Select a matrix, a vector, or a calculation that gives one.'
          : 'A single number has nothing to draw.',
    };
  }
  if (fits(value, 2, 1) || fits(value, 3, 1))
    return { kind: 'vector', dim: value.rows, v: numbers(value).map((r) => r[0]), label };
  if (fits(value, 2, 2) || fits(value, 3, 3)) {
    return { kind: 'transform', dim: value.rows, A: numbers(value), eigen: eigenOf(value), label };
  }
  return {
    kind: 'none',
    message: `A ${value.shape} matrix cannot be drawn. Vectors with 2 or 3 entries and 2 by 2 or 3 by 3 matrices can.`,
  };
}

/** The matrix that is `t` of the way from the identity to A, for animating a transformation. */
export const interpolate = (A, t) =>
  A.map((row, i) => row.map((x, j) => (i === j ? 1 : 0) + t * (x - (i === j ? 1 : 0))));

export const applyMatrix = (A, v) => A.map((row) => row.reduce((sum, a, j) => sum + a * v[j], 0));

/** How a 2D map turns and stretches x: signed turn in degrees (counterclockwise is positive) and length ratio. */
export function turnAndScale(x, y) {
  const lx = Math.hypot(...x);
  const ly = Math.hypot(...y);
  if (lx < 1e-12 || ly < 1e-12) return { degrees: null, scale: lx < 1e-12 ? null : 0 };
  let turn = Math.atan2(y[1], y[0]) - Math.atan2(x[1], x[0]);
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn <= -Math.PI) turn += 2 * Math.PI;
  return { degrees: (turn * 180) / Math.PI, scale: ly / lx };
}

export const determinant2 = (A) => A[0][0] * A[1][1] - A[0][1] * A[1][0];

export function determinant3(A) {
  return (
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
  );
}

/** Rotate a point about the vertical axis by `yaw`, then tilt by `pitch`, and drop the depth: returns [x, y, depth]. */
export function project3([x, y, z], yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const rx = x * cy - y * sy;
  const ry = x * sy + y * cy;
  return [rx, z * cp - ry * sp, ry * cp + z * sp];
}

/** Sizes the view so everything in `points` fits, with a floor so small vectors do not zoom in absurdly. */
export function fitRadius(points) {
  const far = Math.max(0, ...points.flat().map((c) => (Number.isFinite(c) ? Math.abs(c) : 0)));
  return Math.max(3, far * 1.35);
}
