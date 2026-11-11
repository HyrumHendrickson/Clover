/**
 * Names the graphing language reserves.
 *
 * Variable names are a single letter with an optional subscript (`a`, `x_1`).
 * A run of letters such as `xy` is split into single letters and multiplied,
 * except where it contains one of the reserved words below.
 */

/** Names written with parentheses: `sin(x)`. Binders take a variable first: `sum(k, 1, 10, k^2)`. */
export const FUNCTION_NAMES = [
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'arccot',
  'arcsec',
  'arccsc',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'sech',
  'csch',
  'arcsinh',
  'arccosh',
  'arctanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'ln',
  'log',
  'sqrt',
  'nthroot',
  'abs',
  'sign',
  'floor',
  'ceil',
  'round',
  'mod',
  'min',
  'max',
  'gcd',
  'lcm',
  'nCr',
  'nPr',
  'total',
  'length',
  'mean',
  'median',
  'stdev',
  'stdevp',
  'sort',
  'unique',
  'join',
  'distance',
  'midpoint',
  'sum',
  'prod',
  'int',
];

export const FUNCTIONS = new Set(FUNCTION_NAMES);

/** Functions whose first argument names a variable that the last argument can use. */
export const BINDERS = new Set(['sum', 'prod', 'int']);

/** Constants that cannot be redefined. `theta` is the polar angle, not a number. */
export const CONSTANT_VALUES = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };

/** Words that are never split into letters. */
export const RESERVED_WORDS = [...FUNCTION_NAMES, 'pi', 'tau', 'theta', 'for'].sort((a, b) => b.length - a.length);

/** Names a row may not define as variables or functions. */
export const NOT_DEFINABLE = new Set(['x', 'y', 'e', 'pi', 'tau', 'theta']);

export const isFunctionName = (name) => FUNCTIONS.has(name) || /^log_[A-Za-z0-9]+$/.test(name);
