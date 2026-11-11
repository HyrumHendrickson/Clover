/**
 * Exact Euclidean geometry engine.
 *
 * Points and lines are stored in homogeneous coordinates: a point is [X : Y : Z]
 * (the position X/Z, Y/Z) and a line is [a : b : c] (ax + by + c = 0). Every
 * construction is a polynomial formula with no division, so a figure is a tree of
 * polynomials in the coordinates of its free points.
 *
 * The same code runs over two rings (see poly.js):
 *
 *  - PolyRing: the free points are indeterminates. A claim is proved when its
 *    polynomial is *identically zero*, so it holds for every position of the free
 *    points at which the construction is defined. This is exact: no tolerance, no
 *    sampling, no floating point anywhere.
 *  - IntRing: the free points are exact rationals (scaled to integers). A claim is
 *    true "in this figure" only when the integer it reduces to is exactly zero.
 *
 * A claim that is not identically zero is refuted by a concrete exact
 * counterexample, found by running the integer ring on small assignments and
 * keeping only figures in which every object is defined.
 *
 * Every claim and construction here is invariant under translation and rotation, so
 * when a figure has no `fixed` points the first free point is placed at the origin
 * and the second on the x-axis. That removes three degrees of freedom without
 * losing generality and keeps proofs small.
 */
import { DslError, formatRational, makeRational, parseLine } from './dsl.js';
import { ComplexityError, IntRing, Poly, PolyRing, ratioToFloat } from './poly.js';

export class GeometryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeometryError';
  }
}

const MAX_VARIABLES = 60;
const KIND_NAME = { point: 'a point', line: 'a line', circle: 'a circle', number: 'a number', polygon: 'a polygon' };

/** Reference for the help panel: name, usage, and what it does. */
export const REFERENCE = {
  points: [
    ['(x, y)', 'A free point. Drag it; it snaps to the grid.'],
    ['fixed(x, y)', 'A point that never moves. Proofs then assume these exact coordinates.'],
    ['midpoint(P, Q)', 'Midpoint of PQ.'],
    ['divide(P, Q, 1/3)', 'The point P + (Q - P) / 3.'],
    ['intersect(l, m)', 'Where two lines meet.'],
    ['second(l, c, Q)', 'The other point where line l meets circle c, given that Q is already on both.'],
    ['second(c, d, Q)', 'The other point where circles c and d meet, given that Q is on both.'],
    ['foot(P, l)', 'Foot of the perpendicular from P to l.'],
    ['reflect(P, l)', 'Reflection of P in a line, or in a point with reflect(P, Q).'],
    ['rotate(P, Q, 90)', 'Rotate P about Q by 90, 180, or 270 degrees.'],
    ['parallelogram(P, Q, R)', 'The point S that makes PQRS a parallelogram.'],
    ['centroid(P, Q, R)', 'Centroid of a triangle.'],
    ['circumcenter(P, Q, R)', 'Circumcenter of a triangle.'],
    ['orthocenter(P, Q, R)', 'Orthocenter of a triangle.'],
    ['center(c)', 'Center of a circle.'],
    ['on(l) or on(c, t)', 'A point that slides along a line or a circle. The optional number t places it.'],
  ],
  lines: [
    ['line(P, Q)', 'The line through two points.'],
    ['segment(P, Q)', 'Like line, but drawn as a segment.'],
    ['parallelto(P, l)', 'Through P, parallel to l.'],
    ['perpto(P, l)', 'Through P, perpendicular to l.'],
    ['perpbisector(P, Q)', 'The perpendicular bisector of PQ.'],
    ['tangentat(P, c)', 'The tangent to circle c at P, which must be on c.'],
    ['radicalaxis(c, d)', 'The radical axis of two circles.'],
  ],
  circles: [
    ['circle(O, A)', 'Center O, through A.'],
    ['circumcircle(P, Q, R)', 'The circle through three points.'],
  ],
  claims: [
    ['collinear(P, Q, R, ...)', 'The points lie on one line.'],
    ['concyclic(P, Q, R, S, ...)', 'The points lie on one circle.'],
    ['concurrent(l, m, n, ...)', 'The lines pass through one point.'],
    ['parallel(l, m)', 'The lines are parallel.'],
    ['perpendicular(l, m)', 'The lines are perpendicular.'],
    ['lies(P, l) or lies(P, c)', 'The point is on the line or circle.'],
    ['touches(l, c)', 'The line is tangent to the circle.'],
    ['same(P, Q)', 'The points coincide.'],
    ['equal(length(P, Q), length(R, S))', 'Two lengths are equal.'],
    ['equal(area(P, Q, R), area(S, T, U))', 'Two triangles have equal area.'],
    ['equal(angle(P, Q, R), angle(S, T, U))', 'Two directed angles are equal, modulo 180 degrees.'],
  ],
};

/* ----------------------------------------------------------------- geometry */

function makeOps(R) {
  const { add, sub, mul, neg, int } = R;
  const two = int(2);
  const sq = (a) => mul(a, a);
  const reduceTriple = (a, b, c) => R.reduce([a, b, c]);

  const point = (X, Y, Z) => {
    const [x, y, z] = reduceTriple(X, Y, Z);
    return { type: 'point', X: x, Y: y, Z: z };
  };
  const line = (a, b, c, extra = {}) => {
    const [x, y, z] = reduceTriple(a, b, c);
    return { type: 'line', a: x, b: y, c: z, ...extra };
  };

  const ops = {
    point,
    line,
    isPointValid: (P) => !R.isZero(P.Z),
    isLineValid: (l) => !(R.isZero(l.a) && R.isZero(l.b)),

    through(P, Q, extra) {
      return line(
        sub(mul(P.Y, Q.Z), mul(P.Z, Q.Y)),
        sub(mul(P.Z, Q.X), mul(P.X, Q.Z)),
        sub(mul(P.X, Q.Y), mul(P.Y, Q.X)),
        { via: [P, Q], ...extra },
      );
    },
    meet(l, m) {
      return point(
        sub(mul(l.b, m.c), mul(l.c, m.b)),
        sub(mul(l.c, m.a), mul(l.a, m.c)),
        sub(mul(l.a, m.b), mul(l.b, m.a)),
      );
    },
    midpoint: (P, Q) =>
      point(add(mul(P.X, Q.Z), mul(Q.X, P.Z)), add(mul(P.Y, Q.Z), mul(Q.Y, P.Z)), mul(two, mul(P.Z, Q.Z))),
    divide(P, Q, n, d) {
      const N = int(n);
      const D = int(d);
      const rest = sub(D, N);
      return point(
        add(mul(rest, mul(P.X, Q.Z)), mul(N, mul(Q.X, P.Z))),
        add(mul(rest, mul(P.Y, Q.Z)), mul(N, mul(Q.Y, P.Z))),
        mul(D, mul(P.Z, Q.Z)),
      );
    },
    perpTo: (P, l) => line(neg(mul(l.b, P.Z)), mul(l.a, P.Z), sub(mul(l.b, P.X), mul(l.a, P.Y))),
    parallelTo: (P, l) => line(mul(l.a, P.Z), mul(l.b, P.Z), neg(add(mul(l.a, P.X), mul(l.b, P.Y)))),
    foot(P, l) {
      return ops.meet(l, ops.perpTo(P, l));
    },
    /** 2F - P: the reflection of P in the point F. */
    reflectPoint: (P, F) =>
      point(sub(mul(two, mul(F.X, P.Z)), mul(P.X, F.Z)), sub(mul(two, mul(F.Y, P.Z)), mul(P.Y, F.Z)), mul(F.Z, P.Z)),
    reflectLine(P, l) {
      return ops.reflectPoint(P, ops.foot(P, l));
    },
    perpBisector(P, Q) {
      const zz = mul(P.Z, Q.Z);
      const nP = add(sq(P.X), sq(P.Y));
      const nQ = add(sq(Q.X), sq(Q.Y));
      return line(
        mul(two, mul(sub(mul(Q.X, P.Z), mul(P.X, Q.Z)), zz)),
        mul(two, mul(sub(mul(Q.Y, P.Z), mul(P.Y, Q.Z)), zz)),
        neg(sub(mul(nQ, sq(P.Z)), mul(nP, sq(Q.Z)))),
      );
    },
    circumcenter(P, Q, S) {
      return ops.meet(ops.perpBisector(P, Q), ops.perpBisector(Q, S));
    },
    orthocenter(P, Q, S) {
      return ops.meet(ops.perpTo(P, ops.through(Q, S)), ops.perpTo(Q, ops.through(P, S)));
    },
    centroid: (P, Q, S) =>
      point(
        add(add(mul(P.X, mul(Q.Z, S.Z)), mul(Q.X, mul(P.Z, S.Z))), mul(S.X, mul(P.Z, Q.Z))),
        add(add(mul(P.Y, mul(Q.Z, S.Z)), mul(Q.Y, mul(P.Z, S.Z))), mul(S.Y, mul(P.Z, Q.Z))),
        mul(int(3), mul(P.Z, mul(Q.Z, S.Z))),
      ),
    parallelogram: (P, Q, S) =>
      point(
        sub(add(mul(P.X, mul(Q.Z, S.Z)), mul(S.X, mul(P.Z, Q.Z))), mul(Q.X, mul(P.Z, S.Z))),
        sub(add(mul(P.Y, mul(Q.Z, S.Z)), mul(S.Y, mul(P.Z, Q.Z))), mul(Q.Y, mul(P.Z, S.Z))),
        mul(P.Z, mul(Q.Z, S.Z)),
      ),
    rotate(P, Q, degrees) {
      const Vx = sub(mul(P.X, Q.Z), mul(Q.X, P.Z));
      const Vy = sub(mul(P.Y, Q.Z), mul(Q.Y, P.Z));
      const W = mul(P.Z, Q.Z);
      const [CX, CY] = degrees === 90 ? [neg(Vy), Vx] : degrees === 180 ? [neg(Vx), neg(Vy)] : [Vy, neg(Vx)];
      return point(add(mul(Q.X, W), mul(Q.Z, CX)), add(mul(Q.Y, W), mul(Q.Z, CY)), mul(Q.Z, W));
    },
    /** The point at parameter n/d on a line with no defining pair of points. */
    onLine(l, n, d) {
      const s = add(sq(l.a), sq(l.b));
      return point(
        sub(neg(mul(mul(l.a, l.c), d)), mul(mul(n, l.b), s)),
        add(neg(mul(mul(l.b, l.c), d)), mul(mul(n, l.a), s)),
        mul(d, s),
      );
    },
    dividePairOrLine(l, n, d) {
      return l.via ? ops.dividePair(l.via[0], l.via[1], n, d) : ops.onLine(l, n, d);
    },
    /** P + (n/d)(Q - P) with ring-valued n and d. */
    dividePair(P, Q, n, d) {
      const rest = sub(d, n);
      return point(
        add(mul(rest, mul(P.X, Q.Z)), mul(n, mul(Q.X, P.Z))),
        add(mul(rest, mul(P.Y, Q.Z)), mul(n, mul(Q.Y, P.Z))),
        mul(d, mul(P.Z, Q.Z)),
      );
    },
    /** The point at tangent-half-angle parameter n/d on a circle: exact and rational. */
    onCircle(c, n, d) {
      const { o, a } = c;
      const Vx = sub(mul(a.X, o.Z), mul(o.X, a.Z));
      const Vy = sub(mul(a.Y, o.Z), mul(o.Y, a.Z));
      const W = mul(a.Z, o.Z);
      const E = add(sq(n), sq(d));
      const F = sub(sq(d), sq(n));
      const G = mul(two, mul(n, d));
      const NX = sub(mul(F, Vx), mul(G, Vy));
      const NY = add(mul(G, Vx), mul(F, Vy));
      const EW = mul(E, W);
      return point(add(mul(o.X, EW), mul(o.Z, NX)), add(mul(o.Y, EW), mul(o.Z, NY)), mul(o.Z, EW));
    },
    radicalAxis(c, d) {
      const K = (k) => {
        const { o, a } = k;
        return {
          N: sub(mul(mul(two, add(mul(a.X, o.X), mul(a.Y, o.Y))), a.Z), mul(add(sq(a.X), sq(a.Y)), o.Z)),
          D: mul(sq(a.Z), o.Z),
        };
      };
      const k1 = K(c);
      const k2 = K(d);
      const DD = mul(k1.D, k2.D);
      const zz = mul(c.o.Z, d.o.Z);
      return line(
        mul(neg(two), mul(sub(mul(c.o.X, d.o.Z), mul(d.o.X, c.o.Z)), DD)),
        mul(neg(two), mul(sub(mul(c.o.Y, d.o.Z), mul(d.o.Y, c.o.Z)), DD)),
        mul(sub(mul(k1.N, k2.D), mul(k2.N, k1.D)), zz),
      );
    },

    /* ---- polynomials that vanish exactly when a relation holds ---- */

    det3: (r1, r2, r3) =>
      add(
        sub(
          mul(r1[0], sub(mul(r2[1], r3[2]), mul(r3[1], r2[2]))),
          mul(r1[1], sub(mul(r2[0], r3[2]), mul(r3[0], r2[2]))),
        ),
        mul(r1[2], sub(mul(r2[0], r3[1]), mul(r3[0], r2[1]))),
      ),
    det(rows) {
      if (rows.length === 1) return rows[0][0];
      let total = R.zero();
      rows[0].forEach((entry, col) => {
        const minor = rows.slice(1).map((row) => row.filter((_, k) => k !== col));
        const term = mul(entry, ops.det(minor));
        total = col % 2 === 0 ? add(total, term) : sub(total, term);
      });
      return total;
    },
    row: (P) => [P.X, P.Y, P.Z],
    collinear: (P, Q, S) => ops.det3(ops.row(P), ops.row(Q), ops.row(S)),
    circleRow: (P) => [add(sq(P.X), sq(P.Y)), mul(P.X, P.Z), mul(P.Y, P.Z), sq(P.Z)],
    distSq(P, Q) {
      const dx = sub(mul(Q.X, P.Z), mul(P.X, Q.Z));
      const dy = sub(mul(Q.Y, P.Z), mul(P.Y, Q.Z));
      return { N: add(sq(dx), sq(dy)), D: sq(mul(P.Z, Q.Z)) };
    },
    onLineRel: (P, l) => add(add(mul(l.a, P.X), mul(l.b, P.Y)), mul(l.c, P.Z)),
    onCircleRel(P, c) {
      const p = ops.distSq(c.o, P);
      const r = ops.distSq(c.o, c.a);
      // |PO|^2 = |AO|^2, with the common Zo^2 cancelled.
      return sub(mul(p.N, sq(c.a.Z)), mul(r.N, sq(P.Z)));
    },
    touches(l, c) {
      const r = ops.distSq(c.o, c.a);
      const side = add(add(mul(l.a, c.o.X), mul(l.b, c.o.Y)), mul(l.c, c.o.Z));
      return sub(mul(sq(side), sq(c.a.Z)), mul(add(sq(l.a), sq(l.b)), r.N));
    },
    angleParts(P, Q, S) {
      const ux = sub(mul(P.X, Q.Z), mul(Q.X, P.Z));
      const uy = sub(mul(P.Y, Q.Z), mul(Q.Y, P.Z));
      const vx = sub(mul(S.X, Q.Z), mul(Q.X, S.Z));
      const vy = sub(mul(S.Y, Q.Z), mul(Q.Y, S.Z));
      return { cross: sub(mul(ux, vy), mul(uy, vx)), dot: add(mul(ux, vx), mul(uy, vy)) };
    },
  };
  return ops;
}

/* ------------------------------------------------------------ environments */

const toInt = (value) => BigInt(value);

/** Free points as exact rationals, scaled to integers: for the figure on screen. */
export class ActualEnv {
  constructor(R = IntRing) {
    this.R = R;
    this.points = [];
  }

  freePoint(name, x, y) {
    this.points.push({ name, x: formatRational(x), y: formatRational(y) });
    return fixedTriple(this.R, x, y);
  }

  fixedPoint(x, y) {
    return fixedTriple(this.R, x, y);
  }

  param(label, t) {
    return { n: this.R.int(toInt(t.n)), d: this.R.int(toInt(t.d)) };
  }
}

function fixedTriple(R, x, y) {
  return {
    X: R.int(toInt(x.n * y.d)),
    Y: R.int(toInt(y.n * x.d)),
    Z: R.int(toInt(x.d * y.d)),
  };
}

/** Free points as indeterminates, for proofs. */
export class SymbolicEnv {
  constructor({ normalize }) {
    this.R = PolyRing;
    this.normalize = normalize;
    this.names = [];
    this.kinds = [];
    this.count = 0;
  }

  newVar(label, kind) {
    if (this.names.length >= MAX_VARIABLES) {
      throw new GeometryError(
        `A figure can have up to ${MAX_VARIABLES} free coordinates. Use fixed(x, y) for points that need not move.`,
      );
    }
    this.names.push(label);
    this.kinds.push(kind);
    return Poly.variable(this.names.length - 1);
  }

  freePoint(name) {
    this.count += 1;
    const one = Poly.int(1);
    if (this.normalize && this.count === 1) return { X: Poly.zero(), Y: Poly.zero(), Z: one };
    if (this.normalize && this.count === 2) return { X: this.newVar(`${name}x`, 'scale'), Y: Poly.zero(), Z: one };
    return { X: this.newVar(`${name}x`, 'coord'), Y: this.newVar(`${name}y`, 'coord'), Z: one };
  }

  fixedPoint(x, y) {
    return fixedTriple(PolyRing, x, y);
  }

  param(label) {
    return { n: this.newVar(label, 'param'), d: Poly.int(1) };
  }
}

/** Replays the symbolic variable layout with integer values, to test a figure. */
export class AssignedEnv {
  constructor({ normalize }, values) {
    this.R = IntRing;
    this.normalize = normalize;
    this.values = values;
    this.next = 0;
    this.count = 0;
    this.points = [];
    this.params = [];
  }

  take() {
    const value = this.values[this.next] ?? 1;
    this.next += 1;
    return BigInt(value);
  }

  freePoint(name) {
    this.count += 1;
    let x = 0n;
    let y = 0n;
    if (!(this.normalize && this.count === 1)) {
      x = this.take();
      if (!(this.normalize && this.count === 2)) y = this.take();
    }
    this.points.push({ name, x: String(x), y: String(y) });
    return { X: x, Y: y, Z: 1n };
  }

  fixedPoint(x, y) {
    return fixedTriple(IntRing, x, y);
  }

  param(label) {
    const n = this.take();
    this.params.push({ name: label, t: String(n) });
    return { n, d: 1n };
  }
}

/* --------------------------------------------------------------- evaluation */

const CLAIMS = new Set([
  'collinear',
  'concyclic',
  'concurrent',
  'parallel',
  'perpendicular',
  'lies',
  'touches',
  'same',
  'equal',
]);

/**
 * Run statements in order. Each row gets `{ statement, value?, error?, claim? }`.
 * `value` is a point, line, circle, or polygon; `claim` holds the polynomials that
 * must all vanish for the claim to hold.
 */
export function buildFigure(statements, env) {
  const R = env.R;
  const ops = makeOps(R);
  const where = R.name === 'poly' ? 'for every position of the free points' : 'in this figure';
  const scope = new Map();
  const rows = [];

  const fail = (message) => {
    throw new GeometryError(message);
  };
  const kindOf = (v) => v?.type ?? 'unknown';
  const describe = (v) => KIND_NAME[kindOf(v)] ?? 'something else';

  function checkValid(value, label) {
    if (value.type === 'point' && !ops.isPointValid(value)) {
      fail(`${label} is undefined ${where}: it is a point at infinity, for example where parallel lines meet.`);
    }
    if (value.type === 'line' && !ops.isLineValid(value)) {
      fail(`${label} is undefined ${where}: the points it goes through coincide.`);
    }
    if (value.type === 'circle') {
      const V = ops.distSq(value.o, value.a).N;
      if (R.isZero(V)) fail(`${label} has radius 0 ${where}.`);
    }
    return value;
  }

  function args(node, name, kinds) {
    const list = node.args;
    if (list.length !== kinds.length) {
      fail(
        `${name} takes ${kinds.length} argument${kinds.length === 1 ? '' : 's'}, but ${list.length} ${list.length === 1 ? 'was' : 'were'} given.`,
      );
    }
    const values = list.map((a) => value(a));
    values.forEach((v, i) => {
      if (kindOf(v) !== kinds[i])
        fail(`${name} needs ${KIND_NAME[kinds[i]]} as argument ${i + 1}, but got ${describe(v)}.`);
    });
    return values;
  }

  const requireOn = (P, other, name, label) => {
    const rel = other.type === 'line' ? ops.onLineRel(P, other) : ops.onCircleRel(P, other);
    if (!R.isZero(rel)) fail(`${name} needs the given point to lie on the ${label} ${where}. Check that it does.`);
  };

  function rational(node, name) {
    if (node?.t !== 'num') fail(`${name} needs a number here, like 1/2.`);
    return makeRational(node.n, node.d);
  }

  function param(node, label, fallback) {
    const t = node === undefined ? fallback : rational(node, 'on');
    return env.param(label, t);
  }

  function value(node) {
    if (node.t === 'id') {
      const found = scope.get(node.name);
      if (!found) fail(`"${node.name}" is not defined. Define it on an earlier line.`);
      return found;
    }
    if (node.t === 'num') return { type: 'number', n: node.n, d: node.d };
    if (node.t === 'tuple') fail('Give a point a name first, like A = (1, 2).');
    return construct(node);
  }

  function construct(node, label = 'This construction') {
    const { name } = node;
    switch (name) {
      case 'fixed': {
        if (node.args.length !== 2) fail('fixed takes two numbers, like fixed(0, 0).');
        return checkValid(
          { type: 'point', ...env.fixedPoint(rational(node.args[0], 'fixed'), rational(node.args[1], 'fixed')) },
          label,
        );
      }
      case 'midpoint': {
        const [P, Q] = args(node, name, ['point', 'point']);
        return checkValid(ops.midpoint(P, Q), label);
      }
      case 'divide': {
        if (node.args.length !== 3) fail('divide takes two points and a ratio, like divide(A, B, 1/3).');
        const [P, Q] = args({ args: node.args.slice(0, 2) }, name, ['point', 'point']);
        const r = rational(node.args[2], name);
        return checkValid(ops.divide(P, Q, r.n, r.d), label);
      }
      case 'intersect': {
        const [l, m] = args(node, name, ['line', 'line']);
        return checkValid(ops.meet(l, m), label);
      }
      case 'second': {
        if (node.args.length !== 3)
          fail('second takes a line or circle, a circle, and a known common point, like second(l, c, Q).');
        const first = value(node.args[0]);
        const second = value(node.args[1]);
        const Q = value(node.args[2]);
        if (kindOf(Q) !== 'point') fail('second needs a point as argument 3.');
        if (kindOf(second) !== 'circle' || !['line', 'circle'].includes(kindOf(first))) {
          fail('second takes a line and a circle, or two circles, then a point on both.');
        }
        requireOn(Q, first, name, kindOf(first));
        requireOn(Q, second, name, 'circle');
        if (first.type === 'line') {
          return checkValid(ops.reflectPoint(Q, ops.foot(second.o, first)), label);
        }
        return checkValid(
          ops.reflectLine(Q, checkValid(ops.through(first.o, second.o), 'The line through the centers')),
          label,
        );
      }
      case 'foot': {
        const [P, l] = args(node, name, ['point', 'line']);
        return checkValid(ops.foot(P, l), label);
      }
      case 'reflect': {
        if (node.args.length !== 2) fail('reflect takes a point and a line or point, like reflect(P, l).');
        const P = value(node.args[0]);
        const over = value(node.args[1]);
        if (kindOf(P) !== 'point' || !['line', 'point'].includes(kindOf(over))) {
          fail('reflect takes a point, then a line or a point to reflect in.');
        }
        return checkValid(over.type === 'line' ? ops.reflectLine(P, over) : ops.reflectPoint(P, over), label);
      }
      case 'rotate': {
        if (node.args.length !== 3) fail('rotate takes a point, a center, and 90, 180, or 270, like rotate(P, Q, 90).');
        const [P, Q] = args({ args: node.args.slice(0, 2) }, name, ['point', 'point']);
        const deg = rational(node.args[2], name);
        const angle = deg.d === 1n ? ((Number(deg.n) % 360) + 360) % 360 : -1;
        if (![90, 180, 270].includes(angle)) fail('rotate is exact only for 90, 180, or 270 degrees.');
        return checkValid(ops.rotate(P, Q, angle), label);
      }
      case 'parallelogram': {
        const [P, Q, S] = args(node, name, ['point', 'point', 'point']);
        return checkValid(ops.parallelogram(P, Q, S), label);
      }
      case 'centroid': {
        const [P, Q, S] = args(node, name, ['point', 'point', 'point']);
        return checkValid(ops.centroid(P, Q, S), label);
      }
      case 'circumcenter': {
        const [P, Q, S] = args(node, name, ['point', 'point', 'point']);
        return checkValid(ops.circumcenter(P, Q, S), label);
      }
      case 'orthocenter': {
        const [P, Q, S] = args(node, name, ['point', 'point', 'point']);
        return checkValid(ops.orthocenter(P, Q, S), label);
      }
      case 'center': {
        const [c] = args(node, name, ['circle']);
        return c.o;
      }
      case 'on': {
        if (node.args.length < 1 || node.args.length > 2)
          fail('on takes a line or circle and an optional number, like on(l, 1/2).');
        const target = value(node.args[0]);
        const tag = `${label}.t`;
        if (kindOf(target) === 'line') {
          const { n, d } = param(node.args[1], tag, { n: 1n, d: 2n });
          const made = ops.dividePairOrLine(target, n, d);
          return { ...checkValid(made, label), slideTarget: target };
        }
        if (kindOf(target) === 'circle') {
          const { n, d } = param(node.args[1], tag, { n: 1n, d: 2n });
          return { ...checkValid(ops.onCircle(target, n, d), label), slideTarget: target };
        }
        return fail(`on needs a line or a circle, but got ${describe(target)}.`);
      }
      case 'line':
      case 'segment': {
        const [P, Q] = args(node, name, ['point', 'point']);
        return checkValid(ops.through(P, Q, name === 'segment' ? { segment: true } : {}), label);
      }
      case 'parallelto': {
        const [P, l] = args(node, name, ['point', 'line']);
        return checkValid(ops.parallelTo(P, l), label);
      }
      case 'perpto': {
        const [P, l] = args(node, name, ['point', 'line']);
        return checkValid(ops.perpTo(P, l), label);
      }
      case 'perpbisector': {
        const [P, Q] = args(node, name, ['point', 'point']);
        return checkValid(ops.perpBisector(P, Q), label);
      }
      case 'tangentat': {
        const [P, c] = args(node, name, ['point', 'circle']);
        requireOn(P, c, name, 'circle');
        return checkValid(ops.perpTo(P, checkValid(ops.through(c.o, P), 'The radius')), label);
      }
      case 'radicalaxis': {
        const [c, d] = args(node, name, ['circle', 'circle']);
        return checkValid(ops.radicalAxis(c, d), label);
      }
      case 'circle': {
        const [O, A] = args(node, name, ['point', 'point']);
        return checkValid({ type: 'circle', o: O, a: A }, label);
      }
      case 'circumcircle': {
        const [P, Q, S] = args(node, name, ['point', 'point', 'point']);
        if (R.isZero(ops.collinear(P, Q, S)))
          fail(`The points of a circumcircle are collinear ${where}, so no circle passes through them.`);
        return checkValid({ type: 'circle', o: checkValid(ops.circumcenter(P, Q, S), label), a: P }, label);
      }
      case 'polygon': {
        if (node.args.length < 3) fail('polygon needs at least three points.');
        const pts = node.args.map((a, i) => {
          const v = value(a);
          if (kindOf(v) !== 'point') fail(`polygon needs a point as argument ${i + 1}, but got ${describe(v)}.`);
          return v;
        });
        return { type: 'polygon', pts };
      }
      default:
        if (CLAIMS.has(name) || ['length', 'angle', 'area'].includes(name)) {
          fail(`${name}(...) states a fact to check, so it cannot be used as an object. Write it on its own line.`);
        }
        return fail(`"${name}" is not a construction Clover knows. Open Help for the list.`);
    }
  }

  function quantity(node) {
    if (node.t !== 'call' || !['length', 'angle', 'area'].includes(node.name)) {
      fail('equal compares length(P, Q), angle(P, Q, R), or area(P, Q, R) on each side.');
    }
    const count = node.name === 'length' ? 2 : 3;
    const pts = args(node, node.name, Array(count).fill('point'));
    return { kind: node.name, pts };
  }

  function claim(node) {
    const { name } = node;
    if (name === 'collinear') {
      if (node.args.length < 3) fail('collinear needs at least three points.');
      const pts = node.args.map((a, i) => {
        const v = value(a);
        if (kindOf(v) !== 'point') fail(`collinear needs a point as argument ${i + 1}, but got ${describe(v)}.`);
        return v;
      });
      return pts.slice(2).map((P) => ops.collinear(pts[0], pts[1], P));
    }
    if (name === 'concyclic') {
      if (node.args.length < 4) fail('concyclic needs at least four points.');
      const pts = node.args.map((a, i) => {
        const v = value(a);
        if (kindOf(v) !== 'point') fail(`concyclic needs a point as argument ${i + 1}, but got ${describe(v)}.`);
        return v;
      });
      if (R.isZero(ops.collinear(pts[0], pts[1], pts[2]))) {
        fail(`The first three points are collinear ${where}, so they do not determine a circle.`);
      }
      return pts
        .slice(3)
        .map((P) => ops.det([ops.circleRow(pts[0]), ops.circleRow(pts[1]), ops.circleRow(pts[2]), ops.circleRow(P)]));
    }
    if (name === 'concurrent') {
      if (node.args.length < 3) fail('concurrent needs at least three lines.');
      const ls = node.args.map((a, i) => {
        const v = value(a);
        if (kindOf(v) !== 'line') fail(`concurrent needs a line as argument ${i + 1}, but got ${describe(v)}.`);
        return v;
      });
      const rowOf = (l) => [l.a, l.b, l.c];
      return ls.slice(2).map((l) => ops.det3(rowOf(ls[0]), rowOf(ls[1]), rowOf(l)));
    }
    if (name === 'parallel' || name === 'perpendicular') {
      const [l, m] = args(node, name, ['line', 'line']);
      return [name === 'parallel' ? R.sub(R.mul(l.a, m.b), R.mul(m.a, l.b)) : R.add(R.mul(l.a, m.a), R.mul(l.b, m.b))];
    }
    if (name === 'lies') {
      if (node.args.length !== 2) fail('lies takes a point and a line or circle, like lies(P, l).');
      const P = value(node.args[0]);
      const other = value(node.args[1]);
      if (kindOf(P) !== 'point' || !['line', 'circle'].includes(kindOf(other)))
        fail('lies takes a point, then a line or a circle.');
      return [other.type === 'line' ? ops.onLineRel(P, other) : ops.onCircleRel(P, other)];
    }
    if (name === 'touches') {
      const [l, c] = args(node, name, ['line', 'circle']);
      return [ops.touches(l, c)];
    }
    if (name === 'same') {
      const [P, Q] = args(node, name, ['point', 'point']);
      return [R.sub(R.mul(P.X, Q.Z), R.mul(Q.X, P.Z)), R.sub(R.mul(P.Y, Q.Z), R.mul(Q.Y, P.Z))];
    }
    if (name === 'equal') {
      if (node.args.length !== 2) fail('equal takes two quantities, like equal(length(A, B), length(C, D)).');
      const [u, v] = node.args.map(quantity);
      if (u.kind !== v.kind) fail(`equal compares two quantities of the same kind, not ${u.kind} and ${v.kind}.`);
      if (u.kind === 'length') {
        const a = ops.distSq(u.pts[0], u.pts[1]);
        const b = ops.distSq(v.pts[0], v.pts[1]);
        return [R.sub(R.mul(a.N, b.D), R.mul(b.N, a.D))];
      }
      if (u.kind === 'area') {
        const side = (q) => {
          const d = ops.collinear(...q.pts);
          const z = R.mul(q.pts[0].Z, R.mul(q.pts[1].Z, q.pts[2].Z));
          return { N: R.mul(d, d), D: R.mul(z, z) };
        };
        const a = side(u);
        const b = side(v);
        return [R.sub(R.mul(a.N, b.D), R.mul(b.N, a.D))];
      }
      const a = ops.angleParts(...u.pts);
      const b = ops.angleParts(...v.pts);
      return [R.sub(R.mul(a.cross, b.dot), R.mul(b.cross, a.dot))];
    }
    return fail(`"${name}" is not a claim Clover knows. Open Help for the list.`);
  }

  for (const statement of statements) {
    const row = { statement };
    rows.push(row);
    try {
      if (statement.kind === 'error') throw new GeometryError(statement.message);
      if (statement.kind === 'assign') {
        const { name, expr } = statement;
        if (scope.has(name)) fail(`"${name}" is already defined. Pick a different name.`);
        if (CLAIMS.has(name) || ['length', 'angle', 'area', 'fixed', 'on'].includes(name))
          fail(`"${name}" is a command, so it cannot be used as a name.`);
        let result;
        if (expr.t === 'tuple') {
          const p = env.freePoint(
            name,
            makeRational(expr.items[0].n, expr.items[0].d),
            makeRational(expr.items[1].n, expr.items[1].d),
          );
          result = checkValid({ type: 'point', ...p }, name);
          result.free = true;
        } else if (expr.t === 'call') {
          result = construct(expr, name);
          if (result.type === 'point' && expr.name === 'fixed') result.fixed = true;
          if (result.type === 'point' && expr.name === 'on') result.sliding = true;
        } else if (expr.t === 'id') {
          result = value(expr);
        } else {
          fail('Define a name with a point (x, y) or a construction like midpoint(A, B).');
        }
        result = { ...result, name };
        scope.set(name, result);
        row.name = name;
        row.value = result;
      } else if (statement.kind === 'claim') {
        if (statement.expr.t !== 'call') fail('A claim is written like collinear(A, B, C). Open Help for the list.');
        row.claim = { name: statement.expr.name, polys: claim(statement.expr) };
      }
    } catch (error) {
      if (error instanceof GeometryError || error instanceof DslError) row.error = error.message;
      else if (error instanceof ComplexityError)
        row.error =
          'This is too large for Clover to work out exactly in the browser. Try fewer or simpler constructions.';
      else throw error;
    }
  }
  return { rows, scope };
}

/* ------------------------------------------------------------------ drawing */

const pt = (P) => {
  const x = ratioToFloat(P.X, P.Z);
  const y = ratioToFloat(P.Y, P.Z);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

/** Floating-point version of an exact integer-ring value, for drawing only. */
export function drawable(value) {
  if (!value) return null;
  if (value.type === 'point') return { type: 'point', ...pt(value) };
  if (value.type === 'line') {
    const scale = value.a * value.a >= value.b * value.b ? value.a : value.b;
    const big = scale < 0n ? -scale : scale;
    const a = ratioToFloat(value.a, big);
    const b = ratioToFloat(value.b, big);
    const c = ratioToFloat(value.c, big);
    const via = value.via ? value.via.map(pt) : null;
    return { type: 'line', a, b, c, segment: Boolean(value.segment), via };
  }
  if (value.type === 'circle') {
    const o = pt(value.o);
    const a = pt(value.a);
    return o && a ? { type: 'circle', x: o.x, y: o.y, r: Math.hypot(a.x - o.x, a.y - o.y), through: a } : null;
  }
  if (value.type === 'polygon') return { type: 'polygon', pts: value.pts.map(pt) };
  return null;
}

/* -------------------------------------------------------------------- prover */

/** Does any figure statement use `fixed(...)`? Then the symmetry normalisation is not valid. */
export function planFor(statements) {
  const usesFixed = statements.some((s) => s.kind === 'assign' && s.expr.t === 'call' && containsCall(s.expr, 'fixed'));
  return { normalize: !usesFixed };
}

function containsCall(node, name) {
  if (node.t !== 'call') return false;
  return node.name === name || node.args.some((a) => containsCall(a, name));
}

function lcg(seed) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Find an exact integer figure, with every object defined, where a claim fails. */
function searchCounterexamples(statements, plan, symbolic, pending) {
  const found = new Map();
  const random = lcg(0x9e3779b9);
  const total = symbolic.env.names.length;
  const kinds = symbolic.env.kinds;
  for (let attempt = 0; attempt < 400 && found.size < pending.length; attempt += 1) {
    const spread = attempt < 150 ? 4 : attempt < 300 ? 9 : 25;
    const values = Array.from({ length: total }, (_, i) => {
      let v = Math.floor(random() * (2 * spread + 1)) - spread;
      if (v === 0 && kinds[i] !== 'param' && random() < 0.8) v = 1 + Math.floor(random() * spread);
      return v;
    });
    const env = new AssignedEnv(plan, values);
    let figure;
    try {
      figure = buildFigure(statements, env);
    } catch {
      continue;
    }
    for (const index of pending) {
      if (found.has(index)) continue;
      const row = figure.rows[index];
      if (row.claim && !row.error && row.claim.polys.some((p) => p !== 0n)) {
        found.set(index, { points: env.points, params: env.params });
      }
    }
  }
  return found;
}

const reviver = (key, value) => (typeof value === 'bigint' ? `${value}n` : value);

/**
 * What a figure *is*, ignoring where its free points sit. Two texts with the same key
 * have the same proofs, so moving a point never repeats the algebra.
 */
export function structureKey(statements) {
  const shape = (node) => {
    if (node.t === 'tuple') return { t: 'tuple' };
    if (node.t === 'call' && node.name === 'on') return { t: 'call', name: 'on', args: [shape(node.args[0])] };
    if (node.t === 'call') return { ...node, args: node.args.map(shape) };
    return node;
  };
  return JSON.stringify(
    statements.map((st) =>
      st.kind === 'assign'
        ? { ...st, expr: shape(st.expr) }
        : st.kind === 'claim'
          ? { ...st, expr: shape(st.expr) }
          : st,
    ),
    reviver,
  );
}

/** Run the proofs: symbolic figure, claim polynomials, counterexamples. Independent of positions. */
function proveStatements(statements) {
  const plan = planFor(statements);
  const env = new SymbolicEnv(plan);
  let figure;
  try {
    figure = buildFigure(statements, env);
  } catch (error) {
    if (error instanceof GeometryError) return { plan, env, failure: error.message, rows: [], pending: [] };
    throw error;
  }
  const pending = [];
  const rows = figure.rows.map((row, index) => {
    const out = { error: row.error ?? null, free: false, sliding: false, fixed: false, claim: null };
    if (row.value?.free) out.free = true;
    if (row.value?.sliding) out.sliding = true;
    if (row.value?.fixed) out.fixed = true;
    if (row.statement.kind === 'claim') {
      if (row.error) out.claim = { status: 'error', message: row.error };
      else if (row.claim.polys.every((p) => p.isZero())) out.claim = { status: 'proved' };
      else {
        out.claim = { status: 'unproved' };
        pending.push(index);
      }
    }
    return out;
  });
  if (pending.length > 0) {
    const examples = searchCounterexamples(statements, plan, { env }, pending);
    for (const index of pending) {
      const example = examples.get(index);
      if (example) rows[index].claim = { status: 'refuted', example };
    }
  }
  return { plan, env, rows, pending };
}

function combine(statements, proof, actualEnv) {
  if (proof.failure) {
    return {
      rows: statements.map((statement) => ({ statement, error: proof.failure })),
      variables: [],
      normalized: proof.plan.normalize,
      env: actualEnv,
    };
  }
  const actual = buildFigure(statements, actualEnv);
  const rows = statements.map((statement, index) => {
    const s = proof.rows[index];
    const a = actual.rows[index];
    const out = {
      statement,
      name: a.value?.name ?? a.statement.name ?? null,
      value: a.value ?? null,
      error: s.error ?? a.error ?? null,
      free: s.free,
      sliding: s.sliding,
      fixed: s.fixed,
      slide: a.value?.slideTarget ? drawable(a.value.slideTarget) : null,
    };
    if (s.claim) {
      out.claim = { ...s.claim };
      const here = a.error ? 'undefined' : a.claim?.polys.every((p) => p === 0n) ? 'true' : 'false';
      out.claim.here = s.claim.status === 'error' ? null : here;
      if (a.error && !s.error) out.claim.hereMessage = a.error;
    }
    return out;
  });
  return { rows, variables: proof.env.names, normalized: proof.plan.normalize, env: actualEnv };
}

/**
 * Check a whole figure from its lines of text. `actualEnv` supplies the free point
 * positions as exact rationals (default: the ones written in the text).
 *
 * @returns {{ rows: object[], variables: string[], normalized: boolean }} one entry per input line
 */
export function checkFigure(lines, actualEnv = new ActualEnv()) {
  const statements = lines.map(parseLine);
  return combine(statements, proveStatements(statements), actualEnv);
}

/** Like `checkFigure`, but remembers the proofs so that moving a point only redraws the figure. */
export function createChecker() {
  let key = null;
  let proof = null;
  return (lines) => {
    const statements = lines.map(parseLine);
    const next = structureKey(statements);
    if (next !== key) {
      proof = proveStatements(statements);
      key = next;
    }
    return combine(statements, proof, new ActualEnv());
  };
}

/* ------------------------------------------------------------ descriptions */

const bigAbs = (n) => (n < 0n ? -n : n);
const gcdBig = (a, b) => {
  let x = bigAbs(a);
  let y = bigAbs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

function fraction(n, d) {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcdBig(n, d) || 1n;
  const [a, b] = [n / g, d / g];
  return b === 1n ? `${a}` : `${a}/${b}`;
}

const minus = (text) => text.replace(/^-/, '\u2212');

/** Exact, readable text for a value from the integer ring. */
export function describeValue(value) {
  if (!value) return '';
  if (value.type === 'point') return `(${minus(fraction(value.X, value.Z))}, ${minus(fraction(value.Y, value.Z))})`;
  if (value.type === 'line') {
    let { a, b, c } = value;
    const g = gcdBig(gcdBig(a, b), c) || 1n;
    [a, b, c] = [a / g, b / g, c / g];
    const lead = a !== 0n ? a : b;
    if (lead < 0n) [a, b, c] = [-a, -b, -c];
    const term = (k, v, first) => {
      if (k === 0n) return '';
      const sign = k < 0n ? '\u2212' : first ? '' : '+';
      const mag = bigAbs(k);
      const body = v === '' ? `${mag}` : mag === 1n ? v : `${mag}${v}`;
      return `${first ? '' : ' '}${sign}${first || sign === '' ? '' : ' '}${body}`;
    };
    const parts = [];
    for (const [k, v] of [
      [a, 'x'],
      [b, 'y'],
      [c, ''],
    ]) {
      const text = term(k, v, parts.length === 0);
      if (text) parts.push(text);
    }
    return `${parts.join('')} = 0`;
  }
  if (value.type === 'circle') {
    const o = describeValue(value.o);
    const dx = value.a.X * value.o.Z - value.o.X * value.a.Z;
    const dy = value.a.Y * value.o.Z - value.o.Y * value.a.Z;
    const w = value.a.Z * value.o.Z;
    return `center ${o}, radius\u00b2 = ${fraction(dx * dx + dy * dy, w * w)}`;
  }
  return '';
}

/** "A = (0, 0), B = (-2, 0)" for a counterexample from the prover. */
export function describeExample(example) {
  const points = example.points.map((p) => `${p.name} = (${minus(p.x)}, ${minus(p.y)})`);
  const params = example.params.map((p) => `${p.name} = ${minus(p.t)}`);
  return [...points, ...params].join(', ');
}
