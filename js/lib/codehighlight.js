/**
 * A small tokenizer for C, C++, Java, Rust, and Python, so the Programming tab can colour code. It does not
 * validate anything; it only classifies text. Token types match `pyhighlight.js` (and the `tok-*` CSS classes).
 */
import { tokenizePython } from './pyhighlight.js';

const words = (text) => new Set(text.split(/\s+/).filter(Boolean));

const C_KEYWORDS = `auto break case const continue default do else enum extern for goto if inline register restrict
  return sizeof static struct switch typedef union volatile while NULL true false`;
const C_TYPES = `char double float int long short signed unsigned void bool size_t FILE int8_t int16_t int32_t int64_t
  uint8_t uint16_t uint32_t uint64_t`;
const C_BUILTINS = `printf scanf puts putchar getchar malloc calloc realloc free memcpy memset strlen strcmp strcpy
  fopen fclose fgets fprintf fscanf exit abs`;

const CPP_KEYWORDS = `${C_KEYWORDS} alignas alignof and catch class concept consteval constexpr constinit decltype delete
  explicit export final friend mutable namespace new noexcept not nullptr operator or override private protected public
  requires template this throw try typeid typename using virtual`;
const CPP_TYPES = `${C_TYPES} string vector map set unordered_map unordered_set pair array deque list queue stack
  optional variant tuple unique_ptr shared_ptr wstring string_view char16_t char32_t`;
const CPP_BUILTINS = `${C_BUILTINS} cout cin cerr endl std sort make_pair make_unique make_shared move swap min max`;

const JAVA_KEYWORDS = `abstract assert break case catch class const continue default do else enum extends final finally
  for goto if implements import instanceof interface native new package private protected public return static strictfp
  super switch synchronized this throw throws transient try var volatile while record sealed permits yield true false null`;
const JAVA_TYPES = `boolean byte char double float int long short void String Integer Long Double Boolean Character
  Object List ArrayList Map HashMap Set HashSet Scanner Math System`;
const JAVA_BUILTINS = 'println print printf format nextInt nextLine nextDouble hasNext length size add get put';

const RUST_KEYWORDS = `as async await break const continue crate dyn else enum extern false fn for if impl in let loop match
  mod move mut pub ref return self Self static struct super trait true type unsafe use where while`;
const RUST_TYPES = `i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box
  HashMap HashSet BTreeMap Some None Ok Err`;
const RUST_BUILTINS = 'println print eprintln eprint format vec panic assert assert_eq unwrap expect';

const SETS = {
  c: { keyword: words(C_KEYWORDS), type: words(C_TYPES), builtin: words(C_BUILTINS) },
  cpp: { keyword: words(CPP_KEYWORDS), type: words(CPP_TYPES), builtin: words(CPP_BUILTINS) },
  java: { keyword: words(JAVA_KEYWORDS), type: words(JAVA_TYPES), builtin: words(JAVA_BUILTINS) },
  rust: { keyword: words(RUST_KEYWORDS), type: words(RUST_TYPES), builtin: words(RUST_BUILTINS) },
};

/** Words after these introduce a name worth colouring as a function. */
const DEFINERS = { c: new Set(), cpp: new Set(), java: new Set(), rust: new Set(['fn']) };

const COMMENT = ['comment', /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y];
const STRING_C = ['string', /"(?:\\.|[^"\\\n])*(?:"|$)|'(?:\\.|[^'\\\n])*(?:'|$)/y];
const STRING_JAVA = ['string', /"""[\s\S]*?(?:"""|$)|"(?:\\.|[^"\\\n])*(?:"|$)|'(?:\\.|[^'\\\n])*(?:'|$)/y];
// Rust: a quote may start a lifetime ('a), so a character literal must close on the same line to count.
const STRING_RUST = ['string', /r#"[\s\S]*?(?:"#|$)|b?"(?:\\.|[^"\\])*(?:"|$)|b?'(?:\\.|[^'\\\n])'/y];
const PREPROCESSOR = ['builtin', /^[ \t]*#[ \t]*[a-z]+(?:[ \t]*<[^>\n]*>)?/my];
const NUMBER = [
  'number',
  /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[A-Za-z]{0,3}/y,
];
const WORD = ['word', /[A-Za-z_][A-Za-z0-9_]*/y];

const RULES = {
  c: [COMMENT, PREPROCESSOR, STRING_C, NUMBER, WORD],
  cpp: [COMMENT, PREPROCESSOR, STRING_C, NUMBER, WORD],
  java: [COMMENT, STRING_JAVA, NUMBER, WORD],
  rust: [COMMENT, STRING_RUST, NUMBER, WORD],
};

/**
 * @param {string} code
 * @param {'python' | 'c' | 'cpp' | 'java' | 'rust'} language
 * @returns {{ text: string, type: 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'function' | 'plain' }[]}
 */
export function tokenizeCode(code, language) {
  if (language === 'python') return tokenizePython(code);
  const rules = RULES[language];
  if (!rules) return [{ text: code, type: 'plain' }];
  const sets = SETS[language];
  const definers = DEFINERS[language];
  const tokens = [];
  const push = (text, type) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ text, type });
  };
  let index = 0;
  let afterDefiner = false;
  while (index < code.length) {
    let matched = false;
    for (const [name, re] of rules) {
      re.lastIndex = index;
      const m = re.exec(code);
      if (!m || m.index !== index || m[0].length === 0) continue;
      let type = name;
      if (name === 'word') {
        const w = m[0];
        if (afterDefiner) type = 'function';
        else if (sets.keyword.has(w)) type = 'keyword';
        else if (sets.type.has(w) || sets.builtin.has(w)) type = 'builtin';
        else type = 'plain';
        afterDefiner = definers.has(w);
      } else if (name !== 'comment') {
        afterDefiner = false;
      }
      push(m[0], type);
      index += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      if (!/\s/.test(code[index])) afterDefiner = false;
      push(code[index], 'plain');
      index += 1;
    }
  }
  return tokens;
}
