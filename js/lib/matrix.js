/** Pure matrix helpers used by the matrix tool. Matrices are arrays of rows. */

export const zeros = (rows, cols) => Array.from({ length: rows }, () => new Array(cols).fill(0));

export const identity = (n) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

/**
 * Terms of the dot product of row i of A with column j of B.
 * @returns {{ a: number, b: number, product: number }[]}
 */
export function dotTerms(A, B, i, j) {
  return A[i].map((a, k) => ({ a, b: B[k][j], product: a * B[k][j] }));
}

/** Matrix product. Throws if the inner dimensions disagree. */
export function multiply(A, B) {
  const n = A[0]?.length ?? 0;
  if (n !== B.length) throw new RangeError(`Cannot multiply ${A.length}x${n} by ${B.length}x${B[0]?.length ?? 0}`);
  const p = B[0]?.length ?? 0;
  return Array.from({ length: A.length }, (_, i) =>
    Array.from({ length: p }, (_, j) => dotTerms(A, B, i, j).reduce((sum, t) => sum + t.product, 0)),
  );
}

export const det2 = (M) => M[0][0] * M[1][1] - M[0][1] * M[1][0];

/** Format a number for display: integers plainly, others to six significant digits. */
export function formatNumber(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? '?' : x > 0 ? '\u221e' : '-\u221e';
  if (Math.abs(x) < 1e-12) return '0';
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const text = Number(x.toPrecision(6)).toString();
  return text.includes('e') ? Number(x).toExponential(3) : text;
}
