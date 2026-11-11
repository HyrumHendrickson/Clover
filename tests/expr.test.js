import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComplex, compileReal, evaluateNumber, parse, ExpressionError } from '../js/lib/expr.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be within ${eps} of ${expected}`);

test('real: precedence and associativity', () => {
  const f = compileReal('2 + 3 * 4 ^ 2 / 8', []);
  close(f(), 2 + (3 * 16) / 8);
  close(compileReal('-2^2')(), -4);
  close(compileReal('2^3^2')(), 512);
  close(compileReal('2^-1')(), 0.5);
  close(compileReal('10 - 4 - 3')(), 3);
  close(compileReal('8 / 4 / 2')(), 1);
});

test('real: implicit multiplication and constants', () => {
  close(compileReal('2x', ['x'])(3), 6);
  close(compileReal('2(x + 1)', ['x'])(3), 8);
  close(compileReal('(x + 1)(x - 1)', ['x'])(3), 8);
  close(compileReal('pi', [])(), Math.PI);
  close(compileReal('2pi', [])(), 2 * Math.PI);
  close(compileReal('x**2', ['x'])(5), 25);
});

test('real: functions with one and two arguments', () => {
  close(compileReal('sin(x)^2 + cos(x)^2', ['x'])(1.234), 1);
  close(compileReal('atan2(y, x)', ['x', 'y'])(1, 1), Math.PI / 4);
  close(compileReal('max(x, y)', ['x', 'y'])(2, 7), 7);
  close(compileReal('ln(e)', [])(), 1);
});

test('real: numbers with exponents and the constant e', () => {
  close(compileReal('1e3')(), 1000);
  close(compileReal('2e')(), 2 * Math.E);
  close(compileReal('.5')(), 0.5);
});

test('evaluateNumber handles matrix-cell input', () => {
  close(evaluateNumber('1/2'), 0.5);
  close(evaluateNumber('sqrt(2)/2'), Math.SQRT1_2);
  assert.equal(evaluateNumber(''), 0);
  assert.ok(Number.isNaN(evaluateNumber('2 +')));
  assert.ok(Number.isNaN(evaluateNumber('x')));
});

test('errors are descriptive and typed', () => {
  assert.throws(() => parse('2 +'), ExpressionError);
  assert.throws(() => parse('(1 + 2'), /Expected "\)"/);
  assert.throws(() => parse('sin x'), /needs parentheses/);
  assert.throws(() => parse('1 $ 2'), /Unexpected character/);
  assert.throws(() => parse(''), /Enter an expression/);
  assert.throws(() => compileReal('q + 1', ['x']), /Unknown name "q"/);
  assert.throws(() => compileReal('atan2(1)', []), /takes 2 arguments/);
  assert.throws(() => parse('('.repeat(200) + '1' + ')'.repeat(200)), /nested too deeply/);
  assert.throws(() => parse('1+'.repeat(400)), /too long/);
});

test('input cannot reach the JavaScript runtime', () => {
  for (const hostile of ['constructor', 'alert(1)', '__proto__', 'this', 'globalThis.x']) {
    assert.throws(() => compileReal(hostile, ['x']), ExpressionError);
  }
});

test('complex: arithmetic', () => {
  const f = compileComplex('(1 + 2i) * (3 - i)');
  const [re, im] = f(0, 0);
  close(re, 5);
  close(im, 5);
  const g = compileComplex('1 / z');
  const [gr, gi] = g(0, 2);
  close(gr, 0);
  close(gi, -0.5);
});

test('complex: Euler identity and principal values', () => {
  const [er, ei] = compileComplex('exp(i * pi)')(0, 0);
  close(er, -1);
  close(ei, 0, 1e-12);
  const [sr, si] = compileComplex('sqrt(z)')(-4, 0);
  close(sr, 0);
  close(si, 2);
  const [lr, li] = compileComplex('log(z)')(-1, 0);
  close(lr, 0);
  close(li, Math.PI);
});

test('complex: integer powers are exact and negative powers invert', () => {
  const [r, i] = compileComplex('z^3')(1, 1);
  close(r, -2);
  close(i, 2);
  const [nr, ni] = compileComplex('z^-2')(0, 1);
  close(nr, -1);
  close(ni, 0);
  const [zr, zi] = compileComplex('z^0')(5, 5);
  close(zr, 1);
  close(zi, 0);
});

test('complex: general powers', () => {
  const [r, i] = compileComplex('z^z')(0, 1);
  close(r, Math.exp(-Math.PI / 2) * Math.cos(0), 1e-12);
  close(i, 0, 1e-12);
  const [hr, hi] = compileComplex('z^0.5')(-4, 0);
  close(hr, 0, 1e-12);
  close(hi, 2, 1e-12);
});

test('complex: trigonometric identities', () => {
  const sinIm = compileComplex('sin(z)')(0, 1);
  close(sinIm[0], 0, 1e-12);
  close(sinIm[1], Math.sinh(1));
  const id = compileComplex('sin(z)^2 + cos(z)^2');
  const [r, i] = id(0.7, -0.3);
  close(r, 1);
  close(i, 0);
});

test('complex: inverse functions round-trip', () => {
  const pairs = [
    ['asin(sin(z))', 0.4, 0.2],
    ['acos(cos(z))', 0.4, 0.2],
    ['atan(tan(z))', 0.4, 0.2],
    ['asinh(sinh(z))', 0.4, 0.2],
    ['acosh(cosh(z))', 0.4, 0.2],
    ['atanh(tanh(z))', 0.4, 0.2],
  ];
  for (const [src, x, y] of pairs) {
    const [r, i] = compileComplex(src)(x, y);
    close(r, x, 1e-9);
    close(i, y, 1e-9);
  }
});

test('complex: gamma matches known values', () => {
  const g = compileComplex('gamma(z)');
  close(g(5, 0)[0], 24, 1e-8);
  close(g(0.5, 0)[0], Math.sqrt(Math.PI), 1e-10);
  close(g(-0.5, 0)[0], -2 * Math.sqrt(Math.PI), 1e-9);
  const [r, i] = g(1, 1);
  close(r, 0.498015668118356, 1e-9);
  close(i, -0.1549498283018107, 1e-9);
});

test('complex: real-valued helpers and constant folding', () => {
  close(compileComplex('abs(z)')(3, 4)[0], 5);
  close(compileComplex('arg(z)')(0, 1)[0], Math.PI / 2);
  close(compileComplex('re(z) + im(z)')(3, 4)[0], 7);
  close(compileComplex('conj(z)')(3, 4)[1], -4);
  close(compileComplex('2i * 2i')(0, 0)[0], -4);
});

test('complex: poles produce non-finite values rather than throwing', () => {
  const [r] = compileComplex('1 / z')(0, 0);
  assert.ok(!Number.isFinite(r));
  assert.throws(() => compileComplex('w + 1'), /use z as the variable/);
});

test('complex: results from consecutive calls stay independent per node', () => {
  const f = compileComplex('z * z + z');
  const a = f(1, 0);
  assert.equal(a[0], 2);
  const b = f(2, 0);
  assert.equal(b[0], 6);
});
