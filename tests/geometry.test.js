import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssignedEnv,
  ActualEnv,
  buildFigure,
  checkFigure,
  createChecker,
  describeExample,
  describeValue,
  planFor,
} from '../js/lib/geometry/engine.js';
import { parseLine, parseRational, formatRational } from '../js/lib/geometry/dsl.js';
import { IntRing, Poly, ratioToFloat } from '../js/lib/geometry/poly.js';

const TRI = ['A=(0,0)', 'B=(6,0)', 'C=(2,5)'];
const verdict = (lines) =>
  checkFigure(lines)
    .rows.filter((r) => r.claim)
    .map((r) => `${r.claim.status}/${r.claim.here}`);

test('polynomials are exact: no tolerance, cancellation is real', () => {
  const x = Poly.variable(0);
  const y = Poly.variable(1);
  const lhs = x.add(y).mul(x.add(y));
  const rhs = x.mul(x).add(Poly.int(2).mul(x).mul(y)).add(y.mul(y));
  assert.ok(lhs.sub(rhs).isZero());
  assert.ok(!lhs.sub(rhs).add(Poly.int(1)).isZero());
  assert.equal(ratioToFloat(10n ** 400n, 10n ** 399n), 10);
});

test('rationals parse exactly', () => {
  assert.equal(formatRational(parseRational('-3/6')), '-1/2');
  assert.equal(formatRational(parseRational('0.25')), '1/4');
  assert.equal(parseRational('abc'), null);
  assert.equal(parseRational('1/0'), null);
});

test('the parser turns lines into statements and never throws', () => {
  assert.equal(parseLine('').kind, 'blank');
  assert.equal(parseLine('# note').kind, 'comment');
  assert.equal(parseLine('A = (1, 2)').kind, 'assign');
  assert.equal(parseLine('collinear(A, B, C)').kind, 'claim');
  for (const bad of ['A = (1', 'A = ', '((', 'f(', '= 3', '😀', 'x'.repeat(5000), '('.repeat(200)]) {
    assert.doesNotThrow(() => parseLine(bad), bad.slice(0, 20));
  }
  assert.equal(parseLine('A = (1, x)').kind, 'error');
});

test('classical theorems are proved for every position of the free points', () => {
  const cases = {
    medians: [
      ...TRI,
      'M=midpoint(B,C)',
      'N=midpoint(A,C)',
      'P=midpoint(A,B)',
      'concurrent(line(A,M),line(B,N),line(C,P))',
    ],
    altitudes: [...TRI, 'concurrent(perpto(A,line(B,C)),perpto(B,line(A,C)),perpto(C,line(A,B)))'],
    euler: [...TRI, 'O=circumcenter(A,B,C)', 'G=centroid(A,B,C)', 'H=orthocenter(A,B,C)', 'collinear(O,G,H)'],
    ninePoint: [
      ...TRI,
      'Ma=midpoint(B,C)',
      'Mb=midpoint(A,C)',
      'Mc=midpoint(A,B)',
      'Fa=foot(A,line(B,C))',
      'Fb=foot(B,line(A,C))',
      'concyclic(Ma,Mb,Mc,Fa,Fb)',
    ],
    simson: [
      ...TRI,
      'c=circumcircle(A,B,C)',
      'P=on(c)',
      'D=foot(P,line(B,C))',
      'E=foot(P,line(A,C))',
      'F=foot(P,line(A,B))',
      'collinear(D,E,F)',
    ],
    thales: ['A=(0,0)', 'B=(5,0)', 'O=midpoint(A,B)', 'c=circle(O,A)', 'P=on(c)', 'perpendicular(line(P,A),line(P,B))'],
    miquel: [
      ...TRI,
      'D=on(line(A,B))',
      'E=on(line(B,C))',
      'F=on(line(A,C))',
      'c1=circumcircle(A,D,F)',
      'c2=circumcircle(B,D,E)',
      'Q=second(c1,c2,D)',
      'concyclic(C,E,F,Q)',
    ],
    inscribed: [...TRI, 'c=circumcircle(A,B,C)', 'D=on(c)', 'equal(angle(A,C,B),angle(A,D,B))'],
    tangent: ['O=(0,0)', 'A=(3,0)', 'c=circle(O,A)', 't=tangentat(A,c)', 'touches(t,c)', 'perpendicular(t,line(O,A))'],
    area: [...TRI, 'M=midpoint(B,C)', 'equal(area(A,B,M),area(A,M,C))'],
    reflection: [...TRI, 'R=reflect(A,line(B,C))', 'equal(length(B,A),length(B,R))'],
    parallelogram: [...TRI, 'D=parallelogram(A,B,C)', 'same(midpoint(A,C),midpoint(B,D))'],
  };
  for (const [name, lines] of Object.entries(cases)) {
    for (const v of verdict(lines)) assert.equal(v, 'proved/true', name);
  }
});

test('a claim is never proved because it merely looks true', () => {
  // Parallel by construction is proved; parallel only in this drawing is not.
  assert.deepEqual(verdict([...TRI, 'l=parallelto(C,line(A,B))', 'parallel(l,line(A,B))']), ['proved/true']);
  const rect = verdict(['A=(0,0)', 'B=(4,0)', 'C=(4,3)', 'D=(0,3)', 'parallel(line(A,B),line(C,D))']);
  assert.deepEqual(rect, ['refuted/true'], 'true here, not in general');
  // A near miss: one coordinate off by a tiny exact amount is false, not "close enough".
  const near = verdict(['A=(0,0)', 'B=(4,0)', 'C=(4,3)', 'D=(0,3/1000000)', 'parallel(line(A,B),line(C,D))']);
  assert.deepEqual(near, ['refuted/false']);
  assert.deepEqual(verdict([...TRI, 'O=circumcenter(A,B,C)', 'G=centroid(A,B,C)', 'same(O,G)']), ['refuted/false']);
});

test('refutations carry an exact counterexample in which the claim really fails', () => {
  const lines = [...TRI, 'M=midpoint(B,C)', 'collinear(A,B,M)'];
  const row = checkFigure(lines).rows.at(-1);
  assert.equal(row.claim.status, 'refuted');
  assert.match(describeExample(row.claim.example), /^A = \(0, 0\), B = /);
  const statements = lines.map(parseLine);
  const values = row.claim.example.points
    .slice(1)
    .flatMap((p) => (p.name === 'B' ? [Number(p.x.replace('\u2212', '-'))] : [Number(p.x), Number(p.y)]));
  const figure = buildFigure(statements, new AssignedEnv(planFor(statements), values));
  assert.ok(figure.rows.at(-1).claim.polys.some((p) => p !== 0n));
});

test('proved claims hold at random integer figures, refuted ones fail somewhere', () => {
  const base = [
    ...TRI,
    'M=midpoint(B,C)',
    'H=foot(A,line(B,C))',
    'O=circumcenter(A,B,C)',
    'G=centroid(A,B,C)',
    'K=orthocenter(A,B,C)',
    'c=circumcircle(A,B,C)',
    'P=on(c)',
  ];
  const claims = [
    'collinear(O,G,K)',
    'collinear(A,G,M)',
    'collinear(A,H,M)',
    'concyclic(A,B,C,P)',
    'perpendicular(line(A,M),line(B,C))',
    'equal(length(O,A),length(O,B))',
    'equal(area(A,B,G),area(A,B,C))',
    'lies(M,line(B,C))',
    'touches(line(A,B),c)',
  ];
  const lines = [...base, ...claims];
  const checked = checkFigure(lines);
  const statements = lines.map(parseLine);
  const plan = planFor(statements);
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed % 19) - 9;
  };
  claims.forEach((_, k) => {
    const index = base.length + k;
    const status = checked.rows[index].claim.status;
    let zero = 0;
    let nonzero = 0;
    for (let t = 0; t < 40; t += 1) {
      const fig = buildFigure(statements, new AssignedEnv(plan, Array.from({ length: checked.variables.length }, rnd)));
      if (fig.rows[index].error) continue;
      if (fig.rows[index].claim.polys.every((p) => p === 0n)) zero += 1;
      else nonzero += 1;
    }
    if (status === 'proved') assert.equal(nonzero, 0, claims[k]);
    else assert.ok(nonzero > 0, claims[k]);
    assert.ok(zero + nonzero > 0);
  });
});

test('degenerate constructions are reported, never silently accepted', () => {
  const parallel = checkFigure([...TRI, 'l=parallelto(C,line(A,B))', 'P=intersect(l,line(A,B))']).rows.at(-1);
  assert.match(parallel.error, /undefined for every position|point at infinity/);
  const same = checkFigure(['A=(0,0)', 'l=line(A,A)']).rows.at(-1);
  assert.match(same.error, /coincide/);
  assert.match(checkFigure(['A=(0,0)', 'A=(1,1)']).rows.at(-1).error, /already defined/);
  assert.match(checkFigure(['collinear(A,B,C)']).rows[0].error, /not defined/);
  const offCircle = checkFigure([...TRI, 'c=circle(A,B)', 'l=line(A,C)', 'Q=second(l,c,C)']).rows.at(-1);
  assert.match(offCircle.error, /lie on/, 'second needs the known point to really be on both');
  const collinearCircle = checkFigure(['A=(0,0)', 'B=(1,0)', 'M=midpoint(A,B)', 'concyclic(A,B,M,A)']).rows.at(-1);
  assert.match(collinearCircle.error, /collinear/);
});

test('moving a free point reuses the proofs and only the figure changes', () => {
  const check = createChecker();
  const a = check([...TRI, 'collinear(A,B,C)']);
  const b = check(['A=(0,0)', 'B=(6,0)', 'C=(2,0)', 'collinear(A,B,C)']);
  assert.equal(a.rows[3].claim.here, 'false');
  assert.equal(b.rows[3].claim.here, 'true');
  assert.equal(b.rows[3].claim.status, 'refuted');
});

test('fixed points switch off the symmetry shortcut and say so', () => {
  const lines = ['A=fixed(0,0)', 'B=fixed(4,0)', 'C=(1,3)', 'M=midpoint(A,B)', 'perpendicular(line(C,M),line(A,B))'];
  assert.equal(planFor(lines.map(parseLine)).normalize, false);
  const result = checkFigure(lines);
  assert.equal(result.normalized, false);
  assert.equal(result.rows.at(-1).claim.status, 'refuted');
});

test('exact descriptions of figures', () => {
  const env = new ActualEnv(IntRing);
  const fig = buildFigure(
    ['A=(0,0)', 'B=(3,0)', 'C=(1,2)', 'l=line(B,C)', 'c=circumcircle(A,B,C)', 'M=midpoint(B,C)'].map(parseLine),
    env,
  );
  const by = Object.fromEntries(fig.rows.map((r) => [r.name, r.value]));
  assert.equal(describeValue(by.l), 'x + y \u2212 3 = 0');
  assert.equal(describeValue(by.M), '(2, 1)');
  assert.equal(describeValue(by.c), 'center (3/2, 1/2), radius\u00b2 = 5/2');
});

test('huge figures fail honestly instead of hanging', () => {
  const lines = ['A=(0,0)', 'B=(1,0)', 'C=(0,1)'];
  for (let i = 0; i < 6; i += 1) {
    const p = 'DEFGHI'[i];
    lines.push(`${p}=on(circumcircle(A,B,C))`);
  }
  lines.push('concyclic(A,B,C,D,E,F,G,H,I)');
  const start = Date.now();
  const rows = checkFigure(lines).rows;
  assert.ok(Date.now() - start < 20000);
  assert.ok(['proved', 'error', 'refuted', 'unproved'].includes(rows.at(-1).claim.status));
});
