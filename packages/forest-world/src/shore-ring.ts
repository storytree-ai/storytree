// shore-ring.ts — AN INSET RING OF VERTICES INSIDE THE SHORE BAND, so the falloff has something
// to act on.
//
// ⚠⚠ THIS FILE EXISTS BECAUSE A KNOB DISSOLVED UNDER MEASUREMENT, and the measurement is the
// premise. `src/shore-fall.ts` landed the land falling to its coast and then found that its band
// WIDTH is not a knob at all on this mesh: 253 of 392 distinct ground vertices on the shipped
// island lie EXACTLY on the coast, the nearest interior vertex is 8.66 ground units away, and
// there is nothing in between. Every band narrower than that void acts on the rim vertices alone,
// so the reference generator's authored 3.1 and this map's own 7 deliver the BIT-IDENTICAL land —
// same moved count, same drops, same rung flips, and two committed PNGs a reader can check are the
// same file. What the shore fall delivers is its EFFECT; what it cannot deliver is its SHAPE.
//
// ⚠ AND THE CAUSE IS STRUCTURAL RATHER THAN A PROPERTY OF ONE ISLAND. `build_land.py`, which
// produced the approved picture, displaces a 0.55-unit GRID. This ground is PARCELS about 16.5
// units across whose only vertices are their corners, and 8.66 is that lattice's half-pitch. Every
// art constant transcribed off the research renders was authored on a surface roughly thirty times
// finer than the one it is being crossed onto. The remedy for a geometry-valued component is not a
// different constant; it is more vertices.
//
// ⚠⚠ THE ARC ALREADY MADE THE OPPOSITE CALL ONCE, AND IT DOES NOT REACH HERE. For the SHADOW field
// it rejected a per-vertex attribute on exactly this pitch argument and used a ground-space TEXTURE
// in the fragment stage instead. A texture SHADES a surface; it cannot MOVE one. The shore fall's
// whole subject is where the ground sits, so it inherits the constraint and none of the remedy.
//
// ---------------------------------------------------------------------------------------------
// THE MOVE, AND THE PRECEDENT IS ONE DIMENSION OVER
// ---------------------------------------------------------------------------------------------
//
// The coast clip's `subdivide` arm inserted the curve's own points along each rim EDGE, so the
// island's boundary became the curve instead of merely approaching it. This does the same thing
// one dimension in: it inserts, inside each coastal parcel, a chain of vertices at a fixed shore
// distance, and divides the parcel's top face into a shore band and a core along it.
//
// ⚠ IT COSTS TRIANGLES, WHICH THE SHORE FALL DID NOT, and that is the whole reason it is a
// separate increment with its own cost table. A vertical fall creates no geometry; a ring does.
//
// ⚠⚠ THE CHEAP VERSION OF THIS IDEA DOES NOT WORK, AND IT IS WORTH SAYING WHICH ONE. Inserting the
// new points COLLINEARLY into the parcel's own ring — the literal transcription of the `subdivide`
// arm — leaves the polygon's ground-plane shape unchanged, so ear clipping is free to triangulate
// straight past them: a collinear corner is never an ear (`triangulateRing` requires a STRICTLY
// negative turn), and the triangles that span the parcel need not touch the new vertex at all. The
// band only bends if the top face is actually DIVIDED along the chain, which is what this module
// returns.
//
// ⚠⚠ AND THE WALL HAS TO FOLLOW THE SAME BOUNDARY. A top face that bends through a point on an
// edge, over a wall that spans that edge straight, is a hairline crack down the shore — at exactly
// the place this arc is trying to make read. So {@link ShoreRingSplit.wall} carries every inserted
// point too. That costs two triangles per inserted point rather than the whole parcel's worth a
// second descriptor would cost, which is the reason the division is expressed as faces-plus-wall
// (`GroundFaces`) rather than as two parcels.
//
// ---------------------------------------------------------------------------------------------
// ⚠⚠ WHY NEIGHBOURING PARCELS CANNOT DISAGREE — the property the whole thing rests on
// ---------------------------------------------------------------------------------------------
//
// A parcel is not free to insert whatever it likes on a SHARED edge: the parcel on the other side
// must insert the same point, or the two tops meet at different heights and the seam cracks. The
// rule here is deliberately EDGE-LOCAL and therefore automatically agreed: a point goes on edge
// (a, b) for inset `k` exactly when `k` lies strictly between the shore distances of `a` and `b`,
// and its position is bisected in the edge's CANONICAL orientation ({@link crossingOnEdge} orders
// the endpoints by {@link vertexKey}, as `edgeKey` does). Both parcels see the same two endpoints —
// the substrate interns them — so both compute the same float.
//
// The chain's INTERIOR points are a different matter and need no agreement: they are strictly
// inside the parcel, on no shared edge, and no neighbour ever sees them.
//
// ⚠ THE FALLBACK IS THE UNDIVIDED RING, AND IT IS SAFE FOR THE SAME REASON. A parcel that cannot
// be divided honestly still inserts its edge crossings — they are the shared half — and simply
// does not bend. Its neighbours are unaffected, so a fallback is a parcel with no shore shape
// rather than a crack.

import { normalisedRing, type GroundFaces, type P2 } from './cell-ground-geometry.js';
import {
  GROUND_COAST_OUTSET,
  COAST_SCALE_LADDER,
  isSimpleRing,
  vertexKey,
} from './coast-clip.js';
import { shoreField, type ShoreArm, type ShoreFieldReader } from './shore-fall.js';
import { LAND_SCALE } from './land-per-capability.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** How close to the coast a vertex must be to COUNT as on it, in ground units.
 *
 *  ⚠ IT IS A FLOATING-POINT EPSILON RATHER THAN A TOLERANCE ON THE ART. After `clipToCoast` the
 *  rim vertices lie ON the coast polyline by construction, so their measured distance is a rounding
 *  residue and nothing else — the island's next-nearest vertex is eight and a half units out. A
 *  band of 1e-6 therefore separates the two populations with six orders of magnitude to spare, and
 *  widening it would not admit a single additional vertex on any map this repo draws. */
export const SHORE_RING_COAST_EPS = 1e-6;

/**
 * The bisection's own passes, AS AN ARRAY RATHER THAN A COUNT.
 *
 * ⚠ THE SPELLING IS THE MUTATION RUNG'S REMEDY, not a style. A counted `for (let i = 0; i < N;
 * i += 1)` mutates to `i -= 1` and does not produce a wrong answer — it produces an INFINITE LOOP,
 * and a suite that hangs is a detection no rung can attribute to any test. `triangulateRing` and
 * `coastDisplacement` both carry this same shape for the same reason.
 *
 * ⚠ TWENTY-FOUR HALVINGS IS 6e-8 OF AN EDGE, which is far below the 0.1-unit precision the
 * descriptors themselves carry. The point being solved for is where the ring MEETS the band, and
 * the ring is what the field is then re-sampled at, so this only has to be accurate enough that
 * the vertex is inside the band — not exact.
 */
export const SHORE_RING_BISECTIONS: readonly number[] = Array.from(
  { length: 24 },
  // Stryker disable next-line ArrowFunction: EQUIVALENT — the array is iterated for its LENGTH
  // alone and its values are never read, so an element factory returning anything at all (including
  // `undefined`) produces the same twenty-four passes. What is NOT equivalent — the length itself —
  // is asserted directly.
  (_unused, i) => i,
);

/**
 * How far past the widest ring the distance field is asked to measure, as a multiple of it.
 *
 * ⚠ THE FIELD CAPS ITS OWN ANSWER AT THE WIDTH IT WAS BUILT FOR, and every comparison here is
 * `distance < inset`, so any cap STRICTLY above the widest inset gives the right answer for every
 * such comparison — a capped reading is already known to be further out than any ring. Doubling it
 * keeps the prune working (an uncapped field would walk every coast loop for every vertex, which on
 * the thirty-five-island forest is 35 loops x 208 segments x 30,240 vertices).
 */
// ⚠ NOT × LAND_SCALE: this is a DIMENSIONLESS multiple of the widest inset (`widest * MARGIN`),
// not a ground distance — the insets it multiplies already follow the beach, and scaling the
// multiplier too capped the probe field BELOW the widest ring so no coastal parcel divided
// (caught by `shore-ring.test.ts`'s census on 2026-09-05, the day the ratio landed).
export const SHORE_RING_PROBE_MARGIN = 2;

/**
 * WHICH INSET RINGS EACH ARM DRAWS, in ground units from the shore.
 *
 * ⚠ THE RING ARMS SHARE `beach`'s BAND WIDTH ({@link SHORE_ARM_WIDTH}), so `beach` is their
 * control and each comparison is one thing apart. The width axis and the ring axis meet at that
 * one arm, deliberately.
 *
 *  - `ring`      — one chain at HALF the band. That is where the smoothstep is steepest and where
 *                  a single extra vertex buys the most shape per triangle; inland and seaward of it
 *                  the curve is already nearly flat.
 *  - `ring-pair` — two chains at the band's THIRDS, which is the same idea asked whether it keeps
 *                  paying. If a second ring is indistinguishable from the first, one ring is the
 *                  answer and the page says so with two pictures rather than with an argument.
 *
 * ⚠ EVERY INSET IS DERIVED FROM {@link COAST_OUTSET} RATHER THAN WRITTEN AS A NUMBER, so a change
 * to the beach's own width moves the rings with it instead of silently leaving them outside it.
 */
export const SHORE_ARM_INSETS = {
  none: [],
  authored: [],
  beach: [],
  shelf: [],
  ring: [GROUND_COAST_OUTSET / 2],
  'ring-pair': [GROUND_COAST_OUTSET / 3, (GROUND_COAST_OUTSET * 2) / 3],
} satisfies Record<ShoreArm, readonly number[]>;

/** The arms that draw a ring at all — those whose {@link SHORE_ARM_INSETS} entry is non-empty.
 *  DERIVED rather than listed, so an arm cannot gain a ring and be left out of the comparison. */
export const RING_ARMS: readonly ShoreArm[] = (
  Object.keys(SHORE_ARM_INSETS) as ShoreArm[]
).filter((a) => SHORE_ARM_INSETS[a].length > 0);

/** Does this arm divide the ground at all? The one question every counter on the comparison page
 *  has to ask before deciding whether a geometry difference is a bug or the point. */
export function armHasRing(arm: ShoreArm): boolean {
  return SHORE_ARM_INSETS[arm].length > 0;
}

// ---------------------------------------------------------------------------
// The chain's geometry
// ---------------------------------------------------------------------------

/**
 * The INWARD unit normal of edge a→b, for a ring wound the module's way.
 *
 * ⚠ THE CONVENTION IS `cell-ground-geometry.ts`'s AND IS RESTATED NOWHERE ELSE: with the ring
 * normalised to the negative shoelace winding, edge A→B faces `(-dz, 0, dx)` OUTWARD, so inward is
 * `(dz, -dx)`. Every caller here passes a {@link normalisedRing}, which is what makes that true.
 *
 * A zero-length edge has no direction and returns the zero vector — an ordinary answer for a
 * degenerate ring rather than a guard, and the caller sums normals so a zero contributes nothing.
 */
export function inwardNormal(a: P2, b: P2): P2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return { x: 0, z: 0 };
  return { x: dz / len, z: -dx / len };
}

/**
 * Which way is INLAND at a ring vertex: the normalised sum of its two edges' inward normals.
 *
 * ⚠ IT IS THE BISECTOR AND NOT A MITRE, and the difference is measured rather than hidden. A
 * mitred offset would scale by `1/cos(θ/2)` to land the corner exactly `inset` from the shore; this
 * lands it slightly SHORT at a corner instead, by the cosine of the half-turn. The comparison page
 * reports the chain's ACHIEVED distances rather than assuming the authored one, so the residue is
 * visible; and the mitre's own failure mode — an unbounded spike at a sharp corner, which is how a
 * parcel folds — is a worse thing to carry than a few tenths of a unit.
 *
 * When the two normals cancel exactly (a 180-degree spur, where the ring doubles back on itself)
 * the sum has no direction and the INCOMING edge's own inward normal is the honest answer.
 */
export function insetDirection(prev: P2, v: P2, next: P2): P2 {
  const a = inwardNormal(prev, v);
  const b = inwardNormal(v, next);
  const x = a.x + b.x;
  const z = a.z + b.z;
  const len = Math.hypot(x, z);
  if (len === 0) return a;
  return { x: x / len, z: z / len };
}

/**
 * WHERE ALONG EDGE a→b THE SHORE DISTANCE CROSSES `inset` — bisected, in the edge's CANONICAL
 * orientation.
 *
 * ⚠⚠ THE CANONICAL ORIENTATION IS THE POINT OF THIS FUNCTION, not an implementation detail. Two
 * parcels share this edge and traverse it in opposite directions; bisecting in the caller's own
 * direction would give two points a few ulps apart, which is two heights, which is a crack down a
 * seam that runs the length of the shore. Ordering the endpoints by {@link vertexKey} — the same
 * ordering `edgeKey` uses, and for the same reason — makes the answer a property of the EDGE.
 *
 * ⚠ THE CALLER GUARANTEES A BRACKET. This is only ever asked about an edge whose endpoints the
 * caller has already found to straddle `inset`, so a crossing exists by continuity and there is no
 * no-crossing answer to return. Asked about an edge with no crossing it returns a point on it
 * anyway, which is why the caller's straddle test is the check and this is not.
 */
export function crossingOnEdge(
  field: ShoreFieldReader,
  a: P2,
  b: P2,
  inset: number,
): P2 {
  // Stryker disable next-line EqualityOperator: EQUIVALENT — only the SYMMETRY of this ordering is
  // load-bearing, never its DIRECTION. `<=` reverses every pair consistently, which is an equally
  // good canonicalisation and leaves both parcels sharing an edge in agreement; `>=` differs only
  // where the two keys are equal, which is a zero-length edge whose two endpoints are the same
  // point. This is the note `edgeKey` carries verbatim, on the same arithmetic and for the same
  // reason. What is NOT equivalent — dropping the ordering for a CONSTANT — is killed directly.
  const flip = vertexKey(a) > vertexKey(b);
  const from = flip ? b : a;
  const to = flip ? a : b;
  const at = (t: number): P2 => ({
    x: from.x + (to.x - from.x) * t,
    z: from.z + (to.z - from.z) * t,
  });
  /** Which side of the ring `from` is on. Written down once rather than assumed, because the
   *  canonical ordering above is by NAME and says nothing about which end is nearer the water. */
  const fromIsInside = field.sample(from.x, from.z).distance < inset;
  let lo = 0;
  let hi = 1;
  for (const _pass of SHORE_RING_BISECTIONS) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    // Stryker disable next-line EqualityOperator: EQUIVALENT within this function's own
    // resolution. `<` and `<=` differ only for a midpoint landing EXACTLY on the ring, and such a
    // midpoint IS the crossing: both branches then bracket the same point from opposite sides and
    // converge to it, differing by less than the final halving. There is no input that separates
    // them by more than 2^-24 of the edge, and no caller can read a difference that small — the
    // returned point's distance is `inset` either way.
    if ((field.sample(p.x, p.z).distance < inset) === fromIsInside) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}

// ---------------------------------------------------------------------------
// The coast run
// ---------------------------------------------------------------------------

/** A parcel's contiguous run of vertices lying ON the coast: where it starts, and how long. */
export interface CoastRun {
  /** Index into the ring of the run's FIRST vertex, walking the ring's own direction. */
  start: number;
  /** How many vertices are in it. At least one — a parcel may touch the coast at a single corner. */
  length: number;
}

/**
 * THE PARCEL'S COAST RUN, or null when it has none this module can divide along.
 *
 * Three parcels get `null`, and each for its own reason:
 *  - one with NO vertex on the coast — an interior parcel, which has no shore to band;
 *  - one whose vertices are ALL on the coast — it has no inland side to keep, so a band would be
 *    the whole parcel;
 *  - one that meets the coast in TWO OR MORE separate runs — a genuine shape, five parcels in 1,854
 *    on the thirty-five-island forest, and dividing it needs a band per run. Refusing is honest and
 *    the refusal is COUNTED (`ShoreRingCensus.undivided`) rather than silent.
 */
export function coastRun(distances: readonly number[]): CoastRun | null {
  const n = distances.length;
  const on = distances.map((d) => d <= SHORE_RING_COAST_EPS);
  const count = on.filter(Boolean).length;
  // ⚠⚠ THE `count === 0 || count === n` GUARD THAT USED TO SIT HERE IS GONE, AND BOTH HALVES WERE
  // REDUNDANT WITH THE START COUNT BELOW. With NO vertex on the coast there is no index whose
  // predecessor is off it, so `starts` is empty; with EVERY vertex on the coast the same is true
  // for the opposite reason — every predecessor is ON it. Both cases already reach `null` through
  // the one check that carries the meaning, and a guard the arithmetic already satisfies is not a
  // guard. Four mutants of it survived the whole suite, which is what that looks like from outside.
  const starts: number[] = [];
  // ⚠ ITERATED OVER `on` RATHER THAN COUNTED TO `n`. A counted loop's bound is a mutant nobody can
  // kill — at `i === n` the lookup is `undefined`, which is not `true`, so the extra pass pushes
  // nothing — and `triangulateRing` gives the house reason for preferring the array anyway.
  on.forEach((here, i) => {
    if (here && !on[(i + n - 1) % n]) starts.push(i);
  });
  // More than one start is more than one run: the set of on-coast indices is a union of runs, and
  // each run contributes exactly one index whose predecessor is off the coast.
  if (starts.length !== 1) return null;
  return { start: starts[0]!, length: count };
}

// ---------------------------------------------------------------------------
// The division
// ---------------------------------------------------------------------------

/** What {@link shoreRingSplit} decided about ONE parcel. */
export interface ShoreRingSplit extends GroundFaces {
  /** Did the top face actually gain a shore band? False means the parcel fell back to its own
   *  undivided ring — still carrying its shared edge crossings, so no seam can crack. */
  divided: boolean;
  /** Does this parcel meet the coast at all — the DENOMINATOR {@link divided} has to be read
   *  against, because an island is mostly interior and "47 parcels divided" says nothing on its own.
   *
   *  ⚠ FALSE ON AN ARM WITH NO RINGS, and that is an absence rather than an answer: the field such
   *  an arm builds caps at zero, so every vertex reads as on the coast and the question cannot be
   *  asked. A width arm's census reports zero coastal parcels for the same reason it reports zero
   *  divided ones — it did not look. */
  coastal: boolean;
  /** How much of its authored depth this parcel's chain kept, on {@link COAST_SCALE_LADDER}. 1 is
   *  the full inset; below 1 the coast turned tighter than the ring and the chain was demoted.
   *
   *  ⚠ IT IS THE CAP'S OWN REPORT, and it is here for the reason `coastCapping` exists: a cap
   *  nobody can see is indistinguishable from a coast that never needed one. 0 on an undivided
   *  parcel, which is the honest reading — it kept no band at all. */
  scale: number;
}

/**
 * DIVIDE ONE PARCEL along its inset rings.
 *
 * The result is always usable: a parcel that cannot be divided honestly comes back as its own ring
 * — with the shared edge crossings still inserted, because those belong to the EDGE and its
 * neighbour has them either way.
 *
 * ⚠⚠ THE SIMPLICITY CHECK IS THE WHOLE GUARD, AND THE REASON IS A PROOF RATHER THAN A HABIT. The
 * sub-faces are constructed to partition the parcel, but the chain is an OFFSET and an offset can
 * cross itself at a tight corner or push past the parcel's own boundary. **Every way a chain point
 * can leave the parcel makes one of the faces non-simple**, and that is checkable rather than
 * hoped: the band's own ring contains the coast run, the chain, AND both side-edge segments that
 * close it, while the core's contains the chain and the whole inland path. So a chain crossing the
 * coast, a side edge or an inland edge crosses a segment of the very ring it belongs to. A parcel
 * that fails falls back rather than drawing one capability's status colour over another's
 * (ADR-0392 D5 / ADR-0398 D7), which is the one way this component could do real harm.
 *
 * ⚠⚠ AND THE AREA CHECK THAT USED TO SIT BESIDE IT IS GONE, BECAUSE IT COULD NOT FAIL. It summed
 * the sub-faces' unsigned areas and compared them to the parcel's. The faces share their vertices
 * and traverse each chain once in each direction, so the shoelace terms TELESCOPE — the sum equals
 * the parcel's area for every scale, including the ones where a face was folded inside out and the
 * signed areas merely cancelled. Measured across a whole ladder on two fixtures: the error was
 * exactly 0.0 at every rung, while `isSimpleRing` refused eight of ten. A guard the arithmetic
 * already satisfies is not a guard. The conservation it was meant to assert is real and is asserted
 * from OUTSIDE, in the suite, where a construction's property belongs.
 *
 * ⚠ THE `f.length >= 3` CHECK WENT WITH IT, and for the same reason: a band is the run plus its
 * chain (at least one vertex plus two side crossings) and the core is a chain plus at least one
 * inland vertex, so no face this builds can be shorter than three. */
export function shoreRingSplit(
  ring: readonly P2[],
  field: ShoreFieldReader,
  insets: readonly number[],
): ShoreRingSplit {
  const pts = normalisedRing(ring);
  const n = pts.length;
  const sorted = [...insets].sort((a, b) => a - b);
  // ⚠ TWO SEPARATE REFUSALS RATHER THAN ONE `||`, because they are two different facts about the
  // call and a reader meeting a failure needs to know which. A ring of fewer than three vertices
  // bounds no ground; an arm with no insets asked for no division at all, and its answer is the
  // parcel verbatim — the pre-ring buffer, which is what makes the before/after one function twice.
  if (n < 3) return { wall: pts, faces: [pts], divided: false, coastal: false, scale: 0 };
  if (sorted.length === 0) {
    return { wall: pts, faces: [pts], divided: false, coastal: false, scale: 0 };
  }

  const distance = pts.map((p) => field.sample(p.x, p.z).distance);
  /** For each ring edge i→i+1, the crossings on it IN THAT DIRECTION. */
  const after: P2[][] = pts.map((_unused, i) => {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const da = distance[i]!;
    const db = distance[(i + 1) % n]!;
    const lo = Math.min(da, db);
    const hi = Math.max(da, db);
    const hits = sorted.filter((k) => k > lo && k < hi);
    // Ascending inset runs from the seaward end of the edge, so an edge walked inland carries them
    // in order and an edge walked seaward carries them reversed.
    // Stryker disable next-line EqualityOperator: EQUIVALENT — this line only orders a NON-EMPTY
    // `hits`, and `hits` is empty whenever `da === db`, because it selects insets strictly between
    // `min(da, db)` and `max(da, db)` and that interval is empty when the two are equal. So `<=`
    // and `<` are separated by no input this function can be given.
    const along = da <= db ? hits : [...hits].reverse();
    return along.map((k) => crossingOnEdge(field, a, b, k));
  });
  const wall = pts.flatMap((p, i) => [p, ...after[i]!]);

  const run = coastRun(distance);
  if (run === null) return { wall, faces: [wall], divided: false, coastal: false, scale: 0 };
  const { start: s, length: m } = run;
  const e = (s + m - 1) % n;
  const sPrev = (s + n - 1) % n;
  // Both side edges must cross EVERY ring, or the bands they bound are not closed. A parcel whose
  // inland corner sits closer to the water than the widest ring is the case this refuses, and on
  // the forest it is real: one coastal parcel's nearest interior vertex is 0.004 units out.
  //
  // ⚠ IT IS AN EARLY-OUT THAT NAMES ITS REASON, AND IT CANNOT BE KILLED BY A TEST — deliberately.
  // Without it the chain is built from a MISSING crossing: `qs` or `qe` is `undefined`, every
  // coordinate downstream is `NaN`, `isSimpleRing`'s strict comparisons are all false on NaN so no
  // face ever holds, and the ladder falls through to the identical refusal below. The mutation rung
  // reported it as unkillable for exactly that reason. It stays because reaching the same answer
  // through a chain of `undefined` is not the same as declining to build one.
  // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT — see above; the
  // ladder's own exhaustion reaches this same return value on every input that gets here.
  if (after[sPrev]!.length !== sorted.length || after[e]!.length !== sorted.length) {
    return { wall, faces: [wall], divided: false, coastal: true, scale: 0 };
  }

  /** The ring's vertices from the run's start to its end, in ring order. */
  const runPts = Array.from({ length: m }, (_unused, k) => pts[(s + k) % n]!);
  /** Which way is inland at each INTERIOR vertex of the run — computed once, because the ladder
   *  below rebuilds the chains up to eleven times and the direction never changes. */
  const directions = runPts
    .slice(1, -1)
    // `runPts[j]` and `runPts[j + 2]` bracket `runPts[j + 1]`, which is `v`.
    .map((v, j) => insetDirection(runPts[j]!, v, runPts[j + 2]!));

  /** The ring from just past the run's end round to just before its start, carrying the crossings
   *  on every edge between — but NOT the entering edge's, which are the chains' own first points. */
  const inland: P2[] = [];
  for (let j = 0; j < n - m; j += 1) {
    const i = (e + 1 + j) % n;
    inland.push(pts[i]!);
    if (j < n - m - 1) inland.push(...after[i]!);
  }

  /**
   * The whole division at one DEPTH of chain.
   *
   * ⚠⚠ THE SCALE REACHES THE CHAIN'S INTERIOR POINTS AND NOTHING ELSE. `qs` and `qe` sit on
   * SHARED edges and their positions are the property of those edges, agreed with a neighbour that
   * knows nothing about this parcel's corners — scaling them would be exactly the disagreement the
   * canonical bisection exists to prevent, and the seam would crack. The interior points are
   * strictly inside this parcel and no neighbour ever sees them.
   */
  const build = (scale: number): P2[][] => {
    const chains = sorted.map((inset, k) => {
      // The entering edge is walked from inland TOWARD the coast, so its crossings descend.
      const qs = after[sPrev]![sorted.length - 1 - k]!;
      const qe = after[e]![k]!;
      const middle = directions.map((dir, j) => {
        const v = runPts[j + 1]!;
        return { x: v.x + dir.x * inset * scale, z: v.z + dir.z * inset * scale };
      });
      return [qs, ...middle, qe];
    });
    const faces: P2[][] = [[...runPts, ...[...chains[0]!].reverse()]];
    for (let k = 1; k < chains.length; k += 1) {
      faces.push([...chains[k - 1]!, ...[...chains[k]!].reverse()]);
    }
    faces.push([...chains[chains.length - 1]!, ...inland]);
    return faces;
  };

  // ⚠⚠ THE LADDER IS THE COAST CLIP'S OWN, AND SO IS THE REASON FOR IT. An inward offset of a
  // curve self-intersects as soon as the offset exceeds the curve's radius of curvature, and this
  // coast is a noise-perturbed Chaikin curve whose headlands turn tighter than the ring across
  // about half the coastal parcels of the shipped island. Demoting the chain there keeps a
  // SHALLOWER band rather than none, which is what a reader sees as a shore running the whole way
  // round instead of one interrupted every few parcels.
  //
  // ⚠⚠ THE LADDER'S BOTTOM RUNG IS DROPPED, AND THAT IS THE ONE PLACE THIS DIFFERS FROM THE COAST
  // CLIP'S USE OF IT. There, zero means "leave the vertex where the mesh put it" and is the rung
  // that makes the loop terminate. Here it means "put every chain point back ON the coast vertex
  // it came from", which is a band of zero depth: it delivers no falloff shape at all and still
  // costs its triangles. Six parcels of the shipped island and 188 of the thirty-five-island forest
  // land there, and for every one of them the UNDIVIDED ring is the same picture for less. So a
  // parcel that can only be divided at zero is not divided, and the loop terminates on the
  // fallback below rather than on the ladder — which is why the fallback is a return and not a
  // branch that cannot be reached.
  for (const scale of COAST_SCALE_LADDER) {
    if (scale <= 0) continue;
    const faces = build(scale);
    if (faces.every((f) => isSimpleRing(f))) {
      return { wall, faces, divided: true, coastal: true, scale };
    }
  }
  return { wall, faces: [wall], divided: false, coastal: true, scale: 0 };
}

// ---------------------------------------------------------------------------
// The map-wide resolver
// ---------------------------------------------------------------------------

/**
 * The shore distance field an inset ring is measured against.
 *
 * ⚠ IT MUST BE HANDED THE CLIPPED DESCRIPTORS, for the reason `shoreField` gives at length: after
 * `clipToCoast` the boundary of the mesh IS the coast, so the distance to the mesh's own rim is the
 * distance to the shore. Handed the pre-clip descriptors it would measure to the hex silhouette and
 * put every ring a beach's width from where it belongs.
 */
export function shoreRingField(
  cells: readonly InstanceDescriptor[],
  insets: readonly number[],
): ShoreFieldReader {
  const widest = insets.reduce((a, b) => Math.max(a, b), 0);
  return shoreField(cells, widest * SHORE_RING_PROBE_MARGIN);
}

/** What an arm's rings did to a whole map — the numbers the comparison page prints beside the
 *  pictures, so "the ring divided the ground" is counted rather than believed. */
export interface ShoreRingCensus {
  /** Parcels that meet the coast — the DENOMINATOR {@link divided} is read against. An island is
   *  mostly interior (111 of the shipped island's 164 parcels), so a bare divided count says
   *  nothing about how much of the SHORE actually gained a band. Zero on an arm with no rings,
   *  which did not look. */
  coastal: number;
  /** Parcels whose top face gained a shore band. */
  divided: number;
  /** Parcels that fell back to their own ring — interior ones, and the coastal ones this module
   *  refuses (see {@link coastRun}). Counted rather than silent. */
  undivided: number;
  /** Vertices inserted into wall rings, summed over parcels. Zero on an arm with no rings. */
  inserted: number;
  /** The chain vertices' ACHIEVED shore distances, smallest and largest — the bisector's residue
   *  and the ladder's, reported rather than assumed. On an arm with no rings both are zero. */
  nearestChain: number;
  farthestChain: number;
  /** Divided parcels whose chain the ladder DEMOTED — a coast turning tighter than the ring.
   *
   *  ⚠ IT IS THE CAP'S OWN REPORT, and `coastCapping` is the precedent: a cap nobody can see is
   *  indistinguishable from a shore that never needed one. */
  capped: number;
  /** The SHALLOWEST any divided parcel's chain was left at, as a fraction of the authored inset —
   *  1 when nothing was demoted. */
  leastScale: number;
}

/** A resolver plus its own census, because the census is only knowable by doing the work and the
 *  work is only worth doing once. */
export interface ShoreRingPlan {
  decompose: (cell: InstanceDescriptor) => GroundFaces;
  census: ShoreRingCensus;
}

/**
 * BUILD THE DECOMPOSITION FOR A WHOLE MAP, once, and hand back both the resolver
 * `cellGroundGeometry` asks for and the census the page prints.
 *
 * ⚠ EVERY PARCEL IS DIVIDED UP FRONT rather than on demand. The geometry builder asks once per
 * parcel, so laziness would buy nothing — and the census has to see every parcel to be a census
 * rather than a sample of whichever ones a caller happened to draw.
 */
export function shoreRingPlan(
  cells: readonly InstanceDescriptor[],
  insets: readonly number[],
): ShoreRingPlan {
  const field = shoreRingField(cells, insets);
  const splits = new Map<InstanceDescriptor, ShoreRingSplit>();
  let divided = 0;
  let undivided = 0;
  let inserted = 0;
  let nearestChain = Infinity;
  let farthestChain = 0;
  let capped = 0;
  let leastScale = 1;
  let coastal = 0;
  for (const cell of cells) {
    if (cell.points === undefined || cell.points.length < 3) continue;
    const ring: P2[] = cell.points.map((p) => ({ x: p.x, z: p.z }));
    const split = shoreRingSplit(ring, field, insets);
    splits.set(cell, split);
    inserted += split.wall.length - ring.length;
    if (split.coastal) coastal += 1;
    if (!split.divided) {
      undivided += 1;
      continue;
    }
    divided += 1;
    if (split.scale < 1) capped += 1;
    // Stryker disable next-line EqualityOperator: EQUIVALENT — a running minimum assigns the same
    // value whether or not it re-assigns on a tie, so `<` and `<=` cannot be separated on any
    // input. `boundsOf` in `shore-fall.ts` carries this note verbatim, on the same shape.
    if (split.scale < leastScale) leastScale = split.scale;
    // The chain vertices are exactly the wall's absentees: every point of a divided face that is
    // not on the wall ring. Measuring them is what turns "the ring sits at 3.5 units" from an
    // authored intention into a reported fact.
    const onWall = new Set(split.wall.map((p) => vertexKey(p)));
    for (const face of split.faces) {
      for (const p of face) {
        if (onWall.has(vertexKey(p))) continue;
        const d = field.sample(p.x, p.z).distance;
        // Stryker disable next-line EqualityOperator: EQUIVALENT — running extrema, as above: a
        // tie re-assigns the value they already hold.
        if (d < nearestChain) nearestChain = d;
        // Stryker disable next-line EqualityOperator: EQUIVALENT — as above, on the maximum.
        if (d > farthestChain) farthestChain = d;
      }
    }
  }
  return {
    decompose: (cell) => {
      const split = splits.get(cell);
      if (split !== undefined) return split;
      const ring: P2[] = (cell.points ?? []).map((p) => ({ x: p.x, z: p.z }));
      return { wall: ring, faces: [ring] };
    },
    census: {
      coastal,
      divided,
      undivided,
      inserted,
      nearestChain: nearestChain === Infinity ? 0 : nearestChain,
      farthestChain,
      capped,
      leastScale,
    },
  };
}

/** The plan for one ARM — the arm table's own insets, so a page cannot draw an arm with rings the
 *  module does not think it has. */
export function shoreArmRingPlan(
  cells: readonly InstanceDescriptor[],
  arm: ShoreArm,
): ShoreRingPlan {
  return shoreRingPlan(cells, SHORE_ARM_INSETS[arm]);
}
