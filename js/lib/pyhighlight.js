/**
 * A small Python tokenizer for syntax highlighting. It does not validate code;
 * it only classifies text so the editor can colour it.
 */

const KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const BUILTINS = new Set([
  'abs',
  'all',
  'any',
  'bool',
  'dict',
  'divmod',
  'enumerate',
  'filter',
  'float',
  'int',
  'isinstance',
  'len',
  'list',
  'map',
  'max',
  'min',
  'pow',
  'print',
  'range',
  'reversed',
  'round',
  'set',
  'sorted',
  'str',
  'sum',
  'tuple',
  'type',
  'zip',
]);

const RULES = [
  ['comment', /#[^\n]*/y],
  [
    'string',
    /[rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*(?:"|$)|'(?:\\.|[^'\\\n])*(?:'|$))/y,
  ],
  ['number', /(?:0[xX][\da-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/y],
  ['word', /[A-Za-z_][A-Za-z0-9_]*/y],
];

/**
 * @param {string} code
 * @returns {{ text: string, type: 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'function' | 'plain' }[]}
 */
export function tokenizePython(code) {
  const tokens = [];
  const push = (text, type) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ text, type });
  };
  let index = 0;
  let afterDef = false;
  while (index < code.length) {
    let matched = false;
    for (const [name, re] of RULES) {
      re.lastIndex = index;
      const m = re.exec(code);
      if (!m || m[0].length === 0) continue;
      let type = name;
      if (name === 'word') {
        if (afterDef) type = 'function';
        else if (KEYWORDS.has(m[0])) type = 'keyword';
        else if (BUILTINS.has(m[0])) type = 'builtin';
        else type = 'plain';
        afterDef = m[0] === 'def' || m[0] === 'class';
      } else if (name !== 'comment') {
        afterDef = false;
      }
      push(m[0], type);
      index += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      const ch = code[index];
      if (!/\s/.test(ch)) afterDef = false;
      push(ch, 'plain');
      index += 1;
    }
  }
  return tokens;
}
