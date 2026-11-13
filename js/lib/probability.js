/**
 * Probability arithmetic for the Probability tool. Pure functions, no DOM access.
 * Counts use BigInt so they stay exact however large they get.
 */
import { evaluateNumber } from './expr.js';

/** Largest n or r the counting functions accept. */
export const MAX_COUNT = 1000;

const countable = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;

/**
 * Ordered selections of `r` from `n`: n!/(n-r)!, or n^r when items can repeat.
 * @returns {bigint | null} null when n or r is not a whole number from 0 to MAX_COUNT
 */
export function permutations(n, r, repeat = false) {
  if (!countable(n) || !countable(r)) return null;
  if (repeat) return BigInt(n) ** BigInt(r);
  if (r > n) return 0n;
  let result = 1n;
  for (let i = 0; i < r; i += 1) result *= BigInt(n - i);
  return result;
}

/**
 * Unordered selections of `r` from `n`: C(n, r), or C(n+r-1, r) when items can repeat.
 * @returns {bigint | null} null when n or r is not a whole number from 0 to MAX_COUNT
 */
export function combinations(n, r, repeat = false) {
  if (!countable(n) || !countable(r)) return null;
  if (!repeat && r > n) return 0n;
  if (repeat && n === 0) return r === 0 ? 1n : 0n;
  const top = repeat ? n + r - 1 : n;
  const k = Math.min(r, top - r);
  let result = 1n;
  for (let i = 1; i <= k; i += 1) result = (result * BigInt(top - k + i)) / BigInt(i);
  return result;
}

/** A count with thousands separators, or in scientific form once it passes fifteen digits. */
export function formatCount(value) {
  const digits = value.toString();
  if (digits.length <= 15) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${digits[0]}.${digits.slice(1, 7)} \u00d7 10^${digits.length - 1}`;
}

const EPSILON = 1e-9;
const isProbability = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Everything that follows from P(A), P(B), and P(A and B).
 * @returns {{ valid: false, reason: 'probability' } | { valid: false, reason: 'range', lower: number, upper: number }
 *   | { valid: true, joint: number, union: number, aOnly: number, bOnly: number, neither: number,
 *       aGivenB: number, bGivenA: number, independent: boolean }}
 */
export function eventProbabilities({ pa, pb, pab }) {
  if (![pa, pb, pab].every(isProbability)) return { valid: false, reason: 'probability' };
  const lower = Math.max(0, pa + pb - 1);
  const upper = Math.min(pa, pb);
  if (pab < lower - EPSILON || pab > upper + EPSILON) return { valid: false, reason: 'range', lower, upper };
  const joint = Math.min(upper, Math.max(lower, pab));
  const union = pa + pb - joint;
  return {
    valid: true,
    joint,
    union,
    aOnly: pa - joint,
    bOnly: pb - joint,
    neither: Math.max(0, 1 - union),
    aGivenB: pb > 0 ? joint / pb : NaN,
    bGivenA: pa > 0 ? joint / pa : NaN,
    independent: Math.abs(joint - pa * pb) <= EPSILON,
  };
}

/**
 * Bayes' theorem for a hypothesis H and evidence E.
 * @param {{ prior: number, sensitivity: number, falsePositive: number }} input P(H), P(E | H), P(E | not H)
 */
export function bayes({ prior, sensitivity, falsePositive }) {
  if (![prior, sensitivity, falsePositive].every(isProbability)) return null;
  const hit = sensitivity * prior;
  const falseAlarm = falsePositive * (1 - prior);
  const miss = (1 - sensitivity) * prior;
  const clear = (1 - falsePositive) * (1 - prior);
  const evidence = hit + falseAlarm;
  return {
    evidence,
    posterior: evidence > 0 ? hit / evidence : NaN,
    posteriorWithout: 1 - evidence > 0 ? miss / (miss + clear) : NaN,
    hit,
    falseAlarm,
    miss,
    clear,
  };
}

/** The most lines `parseOutcomes` reads. */
export const MAX_OUTCOMES = 200;

/**
 * Read "value, probability" lines. Either part may be an expression such as 1/6. Lines with the same value are
 * added together, and the result is sorted by value.
 * @returns {{ pairs: [number, number][], error: string | null }}
 */
export function parseOutcomes(source) {
  const lines = String(source ?? '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return { pairs: [], error: 'Enter at least one outcome, like "1, 1/6".' };
  if (lines.length > MAX_OUTCOMES) return { pairs: [], error: `Use at most ${MAX_OUTCOMES} outcomes.` };
  const merged = new Map();
  for (const line of lines) {
    const parts = line.includes(',') ? line.split(',') : line.split(/\s+/);
    if (parts.length !== 2) return { pairs: [], error: `Write "${line}" as a value and a probability, like "3, 1/6".` };
    const [x, p] = parts.map((part) => evaluateNumber(part));
    if (!Number.isFinite(x)) return { pairs: [], error: `Could not read the value in "${line}" as a number.` };
    if (!isProbability(p)) return { pairs: [], error: `The probability in "${line}" must be between 0 and 1.` };
    merged.set(x, (merged.get(x) ?? 0) + p);
  }
  return { pairs: [...merged].sort((a, b) => a[0] - b[0]), error: null };
}

/** Total probability, mean, variance, and standard deviation of a discrete random variable. */
export function discreteSummary(pairs) {
  const total = pairs.reduce((sum, [, p]) => sum + p, 0);
  const mean = pairs.reduce((sum, [x, p]) => sum + x * p, 0);
  const variance = pairs.reduce((sum, [x, p]) => sum + (x - mean) ** 2 * p, 0);
  return { total, mean, variance, sd: Math.sqrt(variance) };
}
