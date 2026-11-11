import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphSyntaxError, parseExpression, parseStatement } from '../js/lib/graph/parse.js';
import { Ctx, Scope, compileNode, unimplementedFunctions } from '../js/lib/graph/compile.js';
import { GraphModel, isPointValue, sliderStep, sliderText } from '../js/lib/graph/model.js';
import { FUNCTION_NAMES } from '../js/lib/graph/names.js';
import { GraphEvalError, Point, formatNumber, formatValue, realPow } from '../js/lib/graph/values.js';

/** Evaluate an expression with x bound, in the given angle unit. */
function evaluate(source, x = 2, angle = 'rad') {
  const cx = new Ctx(new Scope(angle), { allowed: ['x'] });
  const fn = compileNode(parseExpression(source), cx);
  const env = cx.newEnv();
  env[0] = x;
  return fn(env);
}

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

const rows = (...texts) => texts.map((text, i) => ({ id: `r${i}`, kind: 'expr', text }));
function build(...texts) {
  const model = new GraphModel();
  model.update(rows(...texts));
  return { model, info: (i) => model.info(`r${i}`) };
}

/* ------------------------------------------------------------------ parsing */

test('every function name the parser accepts can be compiled', () => {
  assert.deepEqual(unimplementedFunctions(), []);
  assert.ok(FUNCTION_NAMES.length > 40);
});

test('precedence, implicit multiplication and powers follow mathematical convention', () => {
  assert.equal(evaluate('-x^2', 3), -9);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('2x', 3), 6);
  assert.equal(evaluate('2x^2', 3), 18);
  assert.equal(evaluate('x(x+1)', 3), 12);
  assert.equal(evaluate('(x+1)(x-1)', 3), 8);
  assert.equal(evaluate('1/2x', 4), 2, 'typed left to right, 1/2x is (1/2)x');
  assert.equal(evaluate('2^-x', 1), 0.5);
  assert.equal(evaluate('x!', 4), 24);
});

test('runs of letters multiply, except reserved words', () => {
  const stmt = parseStatement('xy = 1');
  assert.equal(stmt.parts[0].type, 'bin');
  assert.deepEqual([stmt.parts[0].left.name, stmt.parts[0].right.name], ['x', 'y']);
  close(evaluate('pix', 2), Math.PI * 2);
  close(evaluate('2pi'), 2 * Math.PI);
  assert.equal(evaluate('abs(x)', -3), 3);
  assert.equal(evaluate('exp(0)'), 1);
  assert.equal(evaluate('tau/pi'), 2);
});

test('subscripts and unicode input are understood', () => {
  const stmt = parseStatement('a_1 + x_{12}');
  assert.deepEqual([stmt.parts[0].left.name, stmt.parts[0].right.name], ['a_1', 'x_12']);
  close(evaluate('2\u03c0'), 2 * Math.PI);
  assert.equal(evaluate('x\u00b2', 3), 9);
  assert.equal(evaluate('6\u00f73'), 2);
  assert.equal(evaluate('2\u00d73'), 6);
  assert.equal(evaluate('3\u22122'), 1);
});

test('syntax errors say what is wrong', () => {
  const message = (source) => {
    try {
      parseStatement(source);
    } catch (error) {
      assert.ok(error instanceof GraphSyntaxError);
      return error.message;
    }
    return null;
  };
  assert.match(message('sin x'), /needs parentheses/);
  assert.match(message('sin(x'), /matching \)/);
  assert.match(message('x @ y'), /Unexpected character "@"/);
  assert.match(message('(1, 2, 3)'), /two coordinates/);
  assert.match(message('y = '), /ended unexpectedly/);
  assert.match(message('{x > 0}'), /piecewise/i);
  assert.match(message('y = x {x}'), /needs a comparison/);
  assert.match(message('1 < 2 < 3 < 4'), /At most two/);
  assert.match(message(''), /Enter an expression/);
  assert.match(message('x'.repeat(501)), /at most 500/);
  assert.match(message('('.repeat(80) + 'x' + ')'.repeat(80)), /nested too deeply/);
});

test('absolute value bars nest with parentheses and multiply', () => {
  assert.equal(evaluate('|x|+|1-x|', -2), 5);
  assert.equal(evaluate('2|x|', -3), 6);
  assert.equal(evaluate('|x||x|', -3), 9);
  assert.equal(evaluate('|2(|x|+1)|', -3), 8);
});

test('restrictions, chains and piecewise values parse into their own nodes', () => {
  const stmt = parseStatement('y = x {0 < x < 5, y > 1}');
  assert.equal(stmt.restrictions.length, 2);
  assert.deepEqual(stmt.restrictions[0].ops, ['<', '<']);
  const chain = parseStatement('0 <= y < x');
  assert.deepEqual(chain.ops, ['<=', '<']);
  assert.equal(chain.parts.length, 3);
  assert.equal(evaluate('{x<0:-x,x}', -4), 4);
  assert.equal(evaluate('{x<0:-x,x}', 4), 4);
  assert.equal(evaluate('{x<0:1,x<5:2,3}', 1), 2);
  assert.equal(evaluate('{x<0:1,x<5:2,3}', 9), 3);
  assert.ok(Number.isNaN(evaluate('{x<0:1}', 5)), 'no branch and no default is undefined');
});

/* --------------------------------------------------------------- evaluation */

test('powers are real for odd roots of negative numbers', () => {
  assert.equal(realPow(-8, 1 / 3), -2);
  close(realPow(-8, 2 / 3), 4);
  assert.ok(Number.isNaN(realPow(-4, 0.5)));
  assert.equal(realPow(2, 10), 1024);
  assert.equal(evaluate('nthroot(3,-27)'), -3);
  assert.ok(Number.isNaN(evaluate('nthroot(2,-4)')));
});

test('functions match their definitions, with log in base 10 and mod positive', () => {
  assert.equal(evaluate('log(1000)'), 3);
  close(evaluate('ln(e)'), 1);
  close(evaluate('log_2(8)'), 3);
  assert.equal(evaluate('mod(-1,3)'), 2);
  assert.equal(evaluate('round(2.567,2)'), 2.57);
  assert.equal(evaluate('round(2.5)'), 3);
  assert.equal(evaluate('gcd(12,18)'), 6);
  assert.equal(evaluate('lcm(4,6)'), 12);
  assert.equal(evaluate('nCr(5,2)'), 10);
  assert.equal(evaluate('nPr(5,2)'), 20);
  assert.equal(evaluate('5!'), 120);
  close(evaluate('0.5!'), Math.sqrt(Math.PI) / 2, 1e-9);
  assert.ok(Number.isNaN(evaluate('(-1)!')));
  assert.equal(evaluate('sign(-3)'), -1);
  assert.equal(evaluate('floor(-1.5)'), -2);
  assert.equal(evaluate('ceil(1.2)'), 2);
  close(evaluate('sin^2(x)+cos^2(x)', 1.234), 1);
  close(evaluate('sec(0)'), 1);
  close(evaluate('arctan(1,1)'), Math.PI / 4);
  close(evaluate('cosh(0)'), 1);
  close(evaluate('arcsinh(sinh(1))'), 1);
});

test('degree mode is exact at multiples of 90 and converts inverse functions', () => {
  assert.equal(evaluate('sin(180)', 0, 'deg'), 0);
  assert.equal(evaluate('cos(90)', 0, 'deg'), 0);
  assert.equal(evaluate('sin(90)', 0, 'deg'), 1);
  assert.equal(evaluate('cos(180)', 0, 'deg'), -1);
  assert.equal(evaluate('tan(45)', 0, 'deg') > 0.999999999, true);
  assert.ok(Number.isNaN(evaluate('tan(90)', 0, 'deg')));
  close(evaluate('arcsin(1)', 0, 'deg'), 90);
  close(evaluate('arccos(0)', 0, 'deg'), 90);
  close(evaluate('30\u00b0'), Math.PI / 6);
});

test('lists broadcast, index from one, and refuse mismatched lengths', () => {
  assert.deepEqual(evaluate('[1...5]'), [1, 2, 3, 4, 5]);
  assert.deepEqual(evaluate('[1,3...11]'), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(evaluate('[5...1]'), [5, 4, 3, 2, 1]);
  assert.deepEqual(evaluate('[1,2,3]*2'), [2, 4, 6]);
  assert.deepEqual(evaluate('2^[1,2,3]'), [2, 4, 8]);
  assert.deepEqual(evaluate('[1,2,3]+[10,20,30]'), [11, 22, 33]);
  assert.deepEqual(evaluate('sin([0,0])'), [0, 0]);
  assert.throws(() => evaluate('[1,2]+[1,2,3]'), GraphEvalError);
  assert.equal(evaluate('[10,20,30][2]'), 20);
  assert.deepEqual(evaluate('[10,20,30,40][2...3]'), [20, 30]);
  assert.deepEqual(evaluate('[10,20,30,40][3...]'), [30, 40]);
  assert.deepEqual(evaluate('[10,20,30,40][1,3]'), [10, 30]);
  assert.ok(Number.isNaN(evaluate('[10,20][5]')), 'an index out of range is undefined');
  assert.deepEqual(evaluate('[i^2 for i=[1...4]]'), [1, 4, 9, 16]);
  assert.equal(evaluate('[(a,b) for a=[1,2], b=[3,4]]').length, 4);
  assert.deepEqual(evaluate('[[1,2],[3]]'), [1, 2, 3]);
  assert.throws(() => evaluate('[1...100000]'), /at most 10000/);
});

test('list statistics follow the usual definitions', () => {
  assert.equal(evaluate('total([1...100])'), 5050);
  assert.equal(evaluate('length([1...7])'), 7);
  assert.equal(evaluate('mean([1,2,3,4])'), 2.5);
  assert.equal(evaluate('median([5,1,3])'), 3);
  assert.equal(evaluate('median([1,2,3,4])'), 2.5);
  assert.equal(evaluate('stdevp([2,4,4,4,5,5,7,9])'), 2);
  close(evaluate('stdev([2,4,4,4,5,5,7,9])'), Math.sqrt(32 / 7));
  assert.equal(evaluate('min([4,9,2])'), 2);
  assert.equal(evaluate('max(3,1,2)'), 3);
  assert.deepEqual(evaluate('sort([3,1,2])'), [1, 2, 3]);
  assert.deepEqual(evaluate('unique([1,5,5,10,1])'), [1, 5, 10]);
  assert.deepEqual(evaluate('join([1,2],[3])'), [1, 2, 3]);
  assert.ok(Number.isNaN(evaluate('mean([])')), 'the mean of nothing is undefined');
});

test('points support arithmetic, coordinates and lists of points', () => {
  const p = evaluate('(1,2)+(3,4)');
  assert.ok(p instanceof Point);
  assert.deepEqual([p.x, p.y], [4, 6]);
  const q = evaluate('2(1,2)');
  assert.deepEqual([q.x, q.y], [2, 4]);
  assert.equal(evaluate('(1,2).x'), 1);
  assert.deepEqual(evaluate('[(1,2),(3,4)].y'), [2, 4]);
  const pts = evaluate('([1,2,3], [4,5,6])');
  assert.equal(pts.length, 3);
  assert.deepEqual([pts[2].x, pts[2].y], [3, 6]);
  assert.equal(evaluate('distance((0,0),(3,4))'), 5);
  const m = evaluate('midpoint((0,0),(4,2))');
  assert.deepEqual([m.x, m.y], [2, 1]);
  assert.throws(() => evaluate('(1,2)*(3,4)'), GraphEvalError);
});

test('sum, prod and integrals use their own variable', () => {
  assert.equal(evaluate('sum(k,1,10,k^2)'), 385);
  assert.equal(evaluate('prod(k,1,5,k)'), 120);
  assert.equal(evaluate('sum(k,1,x,k)', 4), 10);
  assert.equal(evaluate('sum(i,1,3,sum(j,1,i,j))'), 10, 'nested sums keep separate variables');
  close(evaluate('int(t,0,pi,sin(t))'), 2, 1e-10);
  close(evaluate('int(t,0,x,2t)', 3), 9, 1e-10);
  close(evaluate('int(t,1,0,t)'), -0.5, 1e-10);
  assert.throws(() => evaluate('sum(k,1,1e9,k)'), /too many terms/);
});

test('number formatting is short and exact enough', () => {
  assert.equal(formatNumber(1 / 3), '0.3333333333');
  assert.equal(formatNumber(1e15), '1e15');
  assert.equal(formatNumber(1.5e-8), '1.5e-8');
  assert.equal(formatNumber(NaN), 'undefined');
  assert.equal(formatNumber(-Infinity), '-\u221e');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatValue([1, 2, 3]), '[1, 2, 3]');
  assert.match(formatValue(Array.from({ length: 20 }, (_, i) => i)), /\u2026 \(20 items\)\]$/);
  assert.equal(formatValue(new Point(1, 2.5)), '(1, 2.5)');
});

/* -------------------------------------------------------------------- model */

test('every kind of row is recognised', () => {
  const { info } = build(
    'y=x^2',
    'x=y^2',
    'x^2+y^2=1',
    'y>x^2',
    '0<y<x',
    'r=1+cos(theta)',
    '(cos(t),sin(t))',
    '(1,2)',
    '[1,2,3]',
    '2+3',
    'x^2',
    'f(x)=x^2',
    'a=2',
    'xy=1',
    '3=y',
    '',
  );
  const kinds = Array.from({ length: 16 }, (_, i) => info(i).kind);
  assert.deepEqual(kinds, [
    'explicit',
    'explicitX',
    'implicit',
    'ineq',
    'ineq',
    'polar',
    'param',
    'value',
    'value',
    'value',
    'explicit',
    'fn',
    'var',
    'implicit',
    'explicit',
    'empty',
  ]);
  assert.equal(info(9).valueText, '5');
  assert.equal(info(8).valueText, '[1, 2, 3]');
  assert.equal(info(7).valueText, '', 'a point is drawn, not printed');
});

test('x and y equations in either orientation are functions', () => {
  const { info } = build('y=2x', '2x=y', 'x=3', '3=x');
  assert.deepEqual(
    [info(0).kind, info(1).kind, info(2).kind, info(3).kind],
    ['explicit', 'explicit', 'explicitX', 'explicitX'],
  );
  assert.equal(info(1).plot.f(4), 8);
});

test('definitions order themselves and feed other rows', () => {
  const { model, info } = build('f(x)=a*x^2+b', 'b=a*3', 'a=2', 'f(2)', "f'(1)", 'g(x,y)=x+y', 'g(1,2)', 'y=f(x)');
  assert.equal(info(3).valueText, '14');
  close(model.info('r4').value, 4, 1e-6);
  assert.equal(info(6).valueText, '3');
  assert.equal(info(7).plot.f(1), 8);
  assert.equal(info(1).valueText, '6');
});

test('derivatives are accurate to a few digits', () => {
  const { model } = build('f(x)=x^3', "f'(2)", "f''(2)", 'g(x)=sin(x)', "g'(0)");
  close(model.info('r1').value, 12, 1e-7);
  close(model.info('r2').value, 12, 1e-4);
  close(model.info('r4').value, 1, 1e-9);
});

test('a number alone becomes a slider; dependent definitions do not', () => {
  const { model, info } = build('a=1', 'b=a+1', 'y=a*x', 'c=2pi', 'd=1/0');
  assert.deepEqual({ ...info(0).slider }, { min: -10, max: 10, step: null, value: 1 });
  assert.equal(info(1).slider, null);
  assert.ok(info(3).slider, 'a constant expression is still a slider');
  assert.equal(info(4).slider, null, 'an infinite value is not a slider');
  assert.equal(info(2).plot.f(2), 2);
  assert.ok(model.setSlider('r0', 4));
  assert.equal(info(2).plot.f(2), 8, 'plots read the new value without recompiling');
  assert.equal(info(1).valueText, '5', 'dependent definitions follow');
  assert.equal(model.setSlider('r1', 1), false, 'only sliders move');
  assert.equal(model.setSlider('r0', Infinity), false);
});

test('slider limits come from the row and are validated', () => {
  const model = new GraphModel();
  model.update([{ id: 'a', kind: 'expr', text: 'k=1', min: '0', max: '2pi', step: '0.5' }]);
  const s = model.info('a').slider;
  close(s.max, 2 * Math.PI);
  assert.equal(s.min, 0);
  assert.equal(sliderStep(s), 0.5);
  model.update([{ id: 'a', kind: 'expr', text: 'k=1', min: '5', max: '1' }]);
  assert.match(model.info('a').sliderError, /minimum must be below/);
  assert.equal(model.info('a').slider.min, -10);
  model.update([{ id: 'a', kind: 'expr', text: 'k=1', min: 'abc' }]);
  assert.match(model.info('a').sliderError, /must be numbers/);
  assert.equal(sliderStep({ min: -10, max: 10, step: null }), 0.01);
  assert.equal(sliderText('a', 1.23456, 0.01), 'a = 1.23');
  assert.equal(sliderText('a', 3, 1), 'a = 3');
});

test('undefined names are reported so the UI can offer sliders', () => {
  const { info } = build('y=a*x+b', 'y=f(x)');
  assert.deepEqual(info(0).undefinedNames.sort(), ['a', 'b']);
  assert.equal(info(0).error, null);
  assert.ok(Number.isNaN(info(0).plot.f(1)));
  assert.deepEqual(info(1).undefinedNames, ['f'], 'f(x) with f undefined multiplies, as a slider times x');
});

test('circular and duplicate definitions are errors, not hangs', () => {
  const { info } = build('a=b', 'b=a', 'c=c+1', 'd=1', 'd=2', 'f(x)=g(x)', 'g(x)=f(x)', 'h=k', 'k=1');
  assert.match(info(0).error, /Circular definition: a \u2192 b \u2192 a/);
  assert.match(info(1).error, /Circular/);
  assert.match(info(2).error, /defined in terms of itself/);
  assert.equal(info(3).kind, 'var');
  assert.match(info(4).error, /already defined/);
  assert.match(info(5).error, /Circular/);
  assert.equal(info(7).error, null, 'a chain that ends is fine');
  assert.equal(info(8).kind, 'var');
});

test('misuse is explained', () => {
  const { info } = build(
    '3=4',
    'y=x=1',
    'y>x=1',
    'x^2+y^2',
    'y=sin(theta)',
    'a=x',
    'f(x,x)=1',
    'y=x {x}',
    '5 {x>0}',
    'x<y<z<w',
    'r=theta',
    'e=3',
    'x=1 {x>0}',
  );
  assert.match(info(0).error, /needs x or y/);
  assert.match(info(1).error, /one = sign/);
  assert.match(info(2).error, /either =/);
  assert.match(info(3).error, /uses y/);
  assert.match(info(4).error, /r alone/);
  assert.match(info(5).error, /only works when graphing/);
  assert.match(info(6).error, /same parameter/);
  assert.equal(info(7).kind, 'error');
  assert.match(info(8).error, /restriction/i);
  assert.equal(info(9).kind, 'error');
  assert.equal(info(10).kind, 'polar', 'r = theta is a spiral');
  assert.match(info(11).error, /needs x or y/, 'e is a constant, so e = 3 is not a definition');
  assert.equal(info(12).kind, 'explicitX');
});

test('restrictions mask a plot, and domains come from braces or the row', () => {
  const { info } = build('y=x {0<x<5}', 'f(x)=x {x>0}', 'f(-1)', '(t,t){0<=t<=3}', '(t,t)', 'r=theta {0<=theta<=pi}');
  const mask = info(0).plot.mask;
  assert.equal(mask(1, 1), true);
  assert.equal(mask(6, 6), false);
  assert.ok(Number.isNaN(info(2).value), 'a restricted function is undefined outside its domain');
  assert.deepEqual(info(3).plot.domain(), [0, 3]);
  assert.equal(info(3).domain.fromRestriction, true);
  assert.deepEqual(info(4).plot.domain(), [0, 1], 'parametric curves default to 0 \u2264 t \u2264 1');
  assert.deepEqual(info(5).plot.domain(), [0, Math.PI]);
  const model = new GraphModel();
  model.update([
    { id: 'p', kind: 'expr', text: '(t,t)', tmin: '-2', tmax: '2pi' },
    { id: 'q', kind: 'expr', text: 'r=1' + '+0*theta', tmin: '', tmax: '' },
  ]);
  const [lo, hi] = model.info('p').plot.domain();
  assert.equal(lo, -2);
  close(hi, 2 * Math.PI);
  close(model.info('q').plot.domain()[1], 12 * Math.PI, 1e-9);
});

test('inequality regions and boundaries follow the relations', () => {
  const { info } = build('y>x^2', '0<y<x', 'y<=2 {x>0}');
  const a = info(0).plot;
  assert.equal(a.region(0, 1), true);
  assert.equal(a.region(0, -1), false);
  assert.equal(a.boundaries[0].strict, true);
  assert.equal(a.boundaries[0].F(2, 4), 0);
  const chain = info(1).plot;
  assert.equal(chain.region(2, 1), true);
  assert.equal(chain.region(2, 3), false);
  assert.equal(chain.boundaries.length, 2);
  assert.equal(chain.boundaries[0].others(2, 1), true, 'the other relation holds there');
  assert.equal(chain.boundaries[0].others(2, 3), false);
  const restricted = info(2).plot;
  assert.equal(restricted.region(1, 1), true);
  assert.equal(restricted.region(-1, 1), false);
  assert.equal(restricted.boundaries[0].strict, false);
});

test('degrees change what trigonometric rows mean', () => {
  const model = new GraphModel();
  const text = [{ id: 'a', kind: 'expr', text: 'sin(90)' }];
  model.update(text, { angle: 'deg' });
  assert.equal(model.info('a').valueText, '1');
  model.update(text, { angle: 'rad' });
  assert.equal(model.info('a').valueText, '0.8939966636');
});

test('runtime errors are reported on the row instead of thrown', () => {
  const { info } = build('L=[1,2]', 'M=[1,2,3]', 'L+M', 'y=L*x');
  assert.match(info(2).runtimeError, /same length/);
  assert.equal(info(2).valueText, '');
  assert.throws(() => info(3).plot.f(1), GraphEvalError, 'drawing catches this and shows it on the row');
});

test('points and point lists are recognised by value', () => {
  const { info } = build('P=[(1,2),(3,4)]', 'P', '(1,2)', '[1,2]', '(L,L^2)', 'L=[1...3]');
  assert.equal(isPointValue(info(1).value), true);
  assert.equal(isPointValue(info(3).value), false);
  assert.equal(isPointValue([]), false);
  assert.equal(info(4).plot.get().length, 3);
});

test('notes and blank rows are ignored', () => {
  const model = new GraphModel();
  model.update([
    { id: 'n', kind: 'note', text: 'y = x is not parsed here' },
    { id: 'e', kind: 'expr', text: '   ' },
  ]);
  assert.equal(model.info('n').kind, 'note');
  assert.equal(model.info('n').plot, null);
  assert.equal(model.info('e').kind, 'empty');
});

test('typing anything never throws', () => {
  // A small deterministic generator (mulberry32) so a failure can be reproduced.
  let seed = 20240607;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pieces = [
    'x',
    'y',
    'a',
    'b',
    'f',
    't',
    'r',
    'theta',
    'pi',
    'e',
    '1',
    '2.5',
    '0',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '|',
    ',',
    ':',
    '+',
    '-',
    '*',
    '/',
    '^',
    '=',
    '<',
    '>',
    '<=',
    '...',
    '!',
    "'",
    ' ',
    'sin',
    'sqrt',
    'sum',
    'for',
    'L',
    '_',
    '\u03c0',
    '@',
  ];
  const model = new GraphModel();
  for (let n = 0; n < 1500; n += 1) {
    const length = 1 + Math.floor(random() * 12);
    const texts = [];
    for (let k = 0; k < 3; k += 1) {
      let text = '';
      for (let i = 0; i < length; i += 1) text += pieces[Math.floor(random() * pieces.length)];
      texts.push(text);
    }
    assert.doesNotThrow(
      () => {
        model.update(rows(...texts));
        for (const info of model.infos.values()) {
          info.plot?.f?.(0.5);
          info.plot?.F?.(0.5, 0.5);
          info.plot?.region?.(0.5, 0.5);
        }
      },
      `input ${JSON.stringify(texts)}`,
    );
  }
});
