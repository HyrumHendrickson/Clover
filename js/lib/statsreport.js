/**
 * Words and distributions for the Tests mode of the Stats tool: the hypotheses, a plain statement of what the
 * p-value says, and the distribution the test statistic is compared with. Pure, so it is unit tested.
 */

const SYMBOL = { two: '\u2260', left: '<', right: '>' };

/**
 * The null and alternative hypotheses, as text.
 * @param {string} kind a test key from the Stats tool: t1, z1, t2, prop1, prop2, gof, or indep
 * @param {{ tail: 'two' | 'left' | 'right', mu0?: string, p0?: string }} options
 */
export function hypotheses(kind, { tail = 'two', mu0 = '0', p0 = '0.5' } = {}) {
  const sign = SYMBOL[tail] ?? SYMBOL.two;
  switch (kind) {
    case 't1':
    case 'z1':
      return { null: `H\u2080: \u03bc = ${mu0}`, alt: `H\u2090: \u03bc ${sign} ${mu0}` };
    case 't2':
      return { null: 'H\u2080: \u03bc\u2081 = \u03bc\u2082', alt: `H\u2090: \u03bc\u2081 ${sign} \u03bc\u2082` };
    case 'prop1':
      return { null: `H\u2080: p = ${p0}`, alt: `H\u2090: p ${sign} ${p0}` };
    case 'prop2':
      return { null: 'H\u2080: p\u2081 = p\u2082', alt: `H\u2090: p\u2081 ${sign} p\u2082` };
    case 'gof':
      return { null: 'H\u2080: the counts follow the expected shares', alt: 'H\u2090: they do not' };
    case 'indep':
      return { null: 'H\u2080: the two variables are independent', alt: 'H\u2090: they are not independent' };
    default:
      return { null: '', alt: '' };
  }
}

const fmtP = (p) => (p < 0.0001 ? '< 0.0001' : `= ${Number(p.toPrecision(3))}`);

/**
 * What a p-value means at a significance level, without saying more than it shows.
 * @returns {{ reject: boolean, text: string } | null} null when `p` is not a probability
 */
export function conclusion(p, alpha) {
  if (!(p >= 0 && p <= 1)) return null;
  const a = alpha > 0 && alpha < 1 ? alpha : 0.05;
  const reject = p < a;
  const head = `p ${fmtP(p)}, which is ${reject ? 'below' : 'not below'} \u03b1 = ${Number(a.toPrecision(3))}.`;
  return {
    reject,
    text: reject
      ? `${head} Reject H\u2080: data like these would be unusual if H\u2080 were true.`
      : `${head} Do not reject H\u2080: data like these are not unusual if H\u2080 were true. That does not show H\u2080 is true.`,
  };
}

/**
 * The distribution a test statistic is compared with.
 * @param {string} kind a test key
 * @param {{ dof: number | null }} result
 * @returns {{ family: 'normal' | 't' | 'chisq', dof: number | null, tails: boolean }} `tails` is false when only the
 *   right tail means anything (chi-square)
 */
export function testDistribution(kind, result) {
  if (kind === 'gof' || kind === 'indep') return { family: 'chisq', dof: result.dof, tails: false };
  if (kind === 't1' || kind === 't2') return { family: 't', dof: result.dof, tails: true };
  return { family: 'normal', dof: null, tails: true };
}
