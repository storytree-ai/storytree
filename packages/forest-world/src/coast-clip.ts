// coast-clip.ts — the island's ANGULAR hex silhouette becomes the map's OWN smoothed, story-seeded
// coastline, on the SHIPPED side of the package.
//
// THE COMPONENT. `adopt-the-land-into-the-shipped-map-arc`'s approved treatment is six components,
// and this is the fifth to cross: "grid geometry clipped to a smoothed, gently perturbed coast
// polygon". Until now the shipped 3D ground's outline was the raw hex-union silhouette —
// `substrate.ts:344` says it in terms ("the coastline is the existing hex-silhouette one, outer
// vertices pinned"), so an island ended in 120° corners that read as a cluster of hexes rather than
// as one landmass.
//
// ⚠⚠ THE COMPONENT WAS ALREADY BUILT AND THE SHIPPED RENDERER SIMPLY DID NOT IMPORT IT.
// `smoothCoast()` (`packages/forest-world/src/coast.ts`) has chained the hex-union boundary into
// loops, outset each vertex by a story-seeded noise wave and Chaikin-rounded it since long before
// this arc — and its ONLY caller was the studio's 2D map, which draws it as a separate overlay
// polygon OVER a still-hex-outlined ground. So this module reads that same machinery rather than
// restating it: {@link COAST_OUTSET}, {@link COAST_SMOOTH_ITERS} and {@link jitteredOutset} are
// imported, not transcribed. The 2D panel and the 3D canvas draw ONE map, so they read ONE beach.
//
// ⚠ THE HARNESS'S OWN `coast` POLYLINE IS A DIFFERENT, POORER THING (`harness/island-dressing.ts`)
// — plain Chaikin, no perturbation, used only to place props on top of a still-hex-outlined ground.
// Do not reach for it here and do not read the two as one component.
//
// ⚠⚠ THE SHAPE FORK, WHICH IS WHY THERE ARE THREE MODES AND NOT ONE. `smoothCoast` returns a loop
// with FOUR TIMES the vertices it was handed (52 rim vertices → 208 smooth points), so there is no
// 1:1 displacement of the mesh's existing boundary vertices to reach for. The three honest answers
// trade differently and `harness/shipped-coast-scene.ts` costs them against each other:
//
//   `outset`    — apply only the OUTSET. 1:1, perturbed, watertight for free, ZERO new triangles —
//                 and it keeps every hex corner. The dropped ROUNDING is named rather than
//                 quietly omitted: this arm delivers the bays and headlands and not the blob.
//   `project`   — move each rim vertex onto the smoothed curve. Still 1:1 and still zero new
//                 triangles; the large-scale rounded shape arrives, sampled at 52-vertex
//                 resolution, so the corner is CUT rather than curved.
//   `subdivide` — `project` plus the smooth loop's own intermediate vertices along each rim edge,
//                 so the boundary IS the curve. The real thing, and the only arm that costs
//                 triangles.
//
// ⚠ WHY MOVING A SHARED VERTEX IS SAFE, and it is the property the whole module rests on. The
// relaxed substrate INTERNS its vertices (`substrate.ts` `buildMeshCells`), so two parcels meeting
// at a seam carry bit-identical coordinates — `polyPath` rounds both to one decimal through the
// same `toFixed(1)`. A displacement keyed on the VERTEX therefore moves every ring that shares it
// by the same amount, and the merged ground stays watertight without any parcel knowing about its
// neighbours. Measured on the shipped fixture: 191 distinct vertices, 354 edges, 302 of them
// interior (used twice), 52 boundary (used once), 0 used more than twice.
//
// ⚠ AND THE SUBDIVIDED VERTICES NEED NO SHARING ARGUMENT AT ALL: a boundary edge belongs to
// exactly ONE parcel by definition, so the points inserted along it are that parcel's alone.
//
// ⚠ THIS CLIPS THE GROUND AND NOTHING ELSE. `ForestWorldCanvas` applies it inside `CellGround`,
// so the occlusion atlas and the merged buffer read the clipped parcels while `dressMapFromKit`
// reads the descriptors untouched. A tree stands where its parcel put it; the beach grows
// underneath it. Moving the props too would confound every arm below with a second change.
//
// SEMANTICS DO NOT MOVE (ADR-0367 D5 / ADR-0392 D5). Every parcel keeps its own `material`, its
// own `parcel` and its own `island`; the only thing that changes is where the OUTERMOST ones end.
// A boundary parcel grows by the beach and still reports exactly the capability it reported.

import {
  COAST_OUTSET,
  COAST_SMOOTH_ITERS,
  boundaryRingLoops,
  chaikinClosed,
  jitteredOutset,
  outsetLoop,
  type BoundarySeg,
  type Pt,
} from './core/index.js';

import { LAND_SCALE } from './land-per-capability.js';
import type { InstanceDescriptor, Transform3D } from './world-to-3d.js';

/** A ring vertex on the ground plane. x east, z south — the space the parcel rings arrive in. */
export interface CoastPoint {
  x: number;
  z: number;
}

/**
 * WHICH COAST AN ISLAND WEARS.
 *
 * `none` is the CONTROL rather than a fourth option: the map exactly as it drew before this
 * module, so every figure about what the coast moved has a denominator that is a picture somebody
 * actually took.
 */
export type CoastMode = 'none' | 'outset' | 'project' | 'subdivide';

/** Every mode, control first. A list rather than a union re-spelled at each call site, so an arm
 *  cannot be added to the type and quietly left out of the comparison. */
export const COAST_MODES: readonly CoastMode[] = ['none', 'outset', 'project', 'subdivide'];

/**
 * THE COAST THE SHIPPED MAP WEARS.
 *
 * ⚠ `subdivide`, AND THE CHOICE IS DELIBERATE RATHER THAN THE LAST ARM WRITTEN. The approved
 * treatment asks for "grid geometry clipped to a smoothed, gently perturbed coast polygon", and
 * `subdivide` is the only arm whose boundary IS that polygon. The other two are honest PARTIAL
 * deliveries and they say what they drop — `outset` keeps every hex corner, `project` cuts a corner
 * rather than curving it — so shipping one of those under the name "the coast clip" would be the
 * quiet omission this arc's end-state item 1 forbids.
 *
 * ⚠ IT IS THE ONLY ARM THAT COSTS ANYTHING, and the cost is triangles rather than draw calls: the
 * curve's own points along each rim edge, so the shipped island goes from 1,640 ground triangles to
 * 2,264 (+38%) and a thirty-five-island forest from 57,400 to 79,240. The ground is still ONE mesh
 * and ONE draw call, which is the property `the forest's ground is ONE draw call` actually rests on.
 *
 * ⚠ THERE IS NO FLAG, and that is the arc's end-state item 6: a flag nobody flips is not adoption.
 * The before/after is `clipToCoast` called with `none` — the same function, one argument apart.
 * `harness/shipped-coast-scene.ts` is where the owner's comparison is taken, and if he prefers one
 * of the cheaper shapes, this constant is the whole change.
 */
export const SHIPPED_COAST: CoastMode = 'subdivide';

/**
 * A RING VERTEX'S IDENTITY, and it is what makes a shared seam move as one.
 *
 * ⚠ ROUNDED TO ONE DECIMAL BECAUSE THAT IS THE PRECISION THE DESCRIPTORS CARRY. The core emits
 * every parcel ring through `polyPath`, which writes `toFixed(1)`; two parcels meeting at an
 * interned vertex therefore arrive here as the same decimal string parsed twice, so they are
 * already bit-identical and the rounding costs nothing. Keying on the raw float would still work
 * TODAY and would break silently the day the core emits more digits, which is the failure this
 * spelling forecloses.
 */
export function vertexKey(p: CoastPoint): string {
  return `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
}

/** An undirected edge's identity — its two endpoints' keys in a fixed order, so a seam traversed
 *  one way by one parcel and the other way by its neighbour is ONE edge. */
export function edgeKey(a: CoastPoint, b: CoastPoint): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  // Stryker disable next-line EqualityOperator: EQUIVALENT — only the SYMMETRY of this key is
  // load-bearing, never the direction. `>=` reverses every pair consistently and `<=` differs only
  // where the two keys are equal, which is a self-edge and yields the same string either way. A
  // test that pinned the ordering would be asserting an arbitrary choice.
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * THE ISLAND'S RIM: the closed loop(s) of edges belonging to exactly ONE parcel.
 *
 * A parcel set tiles its island with no gaps and no overlaps, so an edge used TWICE is an interior
 * seam and an edge used ONCE is the shore. Chaining is `boundaryRingLoops`' job — the same function
 * the 2D map's coast is chained with, handed this mesh's finer boundary instead of the raw
 * hex-edge one.
 *
 * ⚠ THE `y`-MEANS-`z` CONVERSION HAPPENS HERE AND IN {@link coastCurve}, AND NOWHERE ELSE. The
 * coast machinery is authored in the 2D drawing basis where the second coordinate is `y`; the
 * ground is a plane where it is `z`. Converting ad hoc downstream is how an island's beach ends up
 * ninety degrees from its shore and the picture looks merely odd rather than wrong. The handedness
 * survives the swap — SVG `y` runs down the page and ground `z` runs south — so `outsetLoop`'s
 * winding test still orients the offset OUTWARD.
 */
export function rimLoops(rings: readonly (readonly CoastPoint[])[]): CoastPoint[][] {
  const uses = new Map<string, number>();
  const segs = new Map<string, BoundarySeg>();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const k = edgeKey(a, b);
      uses.set(k, (uses.get(k) ?? 0) + 1);
      segs.set(k, { x1: a.x, y1: a.z, x2: b.x, y2: b.z });
    }
  }
  const shore: BoundarySeg[] = [];
  for (const [k, n] of uses) {
    if (n !== 1) continue;
    shore.push(segs.get(k)!);
  }
  return boundaryRingLoops(shore).map((loop) => loop.map((p) => ({ x: p.x, z: p.y })));
}

/**
 * THE SMOOTHED, STORY-SEEDED CURVE this rim is to become — the 2D map's own coast, computed over
 * the mesh's boundary rather than over the raw hex silhouette.
 *
 * Two steps, both borrowed whole: outset every vertex along its averaged normal by
 * {@link jitteredOutset} (a low-frequency wave phase-shifted per story, so each island gets its own
 * bays and headlands), then Chaikin-round {@link COAST_SMOOTH_ITERS} times. The outset loop is
 * returned beside the smoothed one because the `outset` arm IS the first step and reading it off
 * this function is what keeps the two arms one call apart.
 */
export interface CoastCurve {
  /** The rim outset by the beach margin — 1:1 with the rim it was built from. */
  outset: CoastPoint[];
  /** That loop Chaikin-rounded: {@link COAST_SMOOTH_ITERS} passes, so `outset.length * 4` points. */
  smooth: CoastPoint[];
}

export function coastCurve(rim: readonly CoastPoint[], island: string): CoastCurve {
  const flat: Pt[] = rim.map((p) => ({ x: p.x, y: p.z }));
  // ⚠ × LAND_SCALE: the 2D map's outset is in the DRAWING's units; the 3D island is LAND_SCALE of
  // the drawing edge to edge (`land-per-capability.ts`), so its beach is the same fraction of it.
  const out = outsetLoop(flat, (i) => jitteredOutset(island, i, flat.length) * LAND_SCALE);
  const smoothed = chaikinClosed(out, COAST_SMOOTH_ITERS);
  return {
    outset: out.map((p) => ({ x: p.x, z: p.y })),
    smooth: smoothed.map((p) => ({ x: p.x, z: p.y })),
  };
}

/**
 * WHERE A POINT LANDS ON A SEGMENT — the nearest point on it, not the nearer of its two ends.
 *
 * ⚠ THE `t` CLAMP IS THE DEFINITION OF A SEGMENT, NOT A DEFENCE. Off either end the nearest point
 * on the segment IS that endpoint, so both branches are ordinary answers a test can ask for.
 */
export function nearestOnSegment(p: CoastPoint, a: CoastPoint, b: CoastPoint): CoastPoint {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const lenSq = ex * ex + ez * ez;
  // A degenerate segment is its own only point, and `0` reaches `a` — which is that point.
  const raw = lenSq === 0 ? 0 : ((p.x - a.x) * ex + (p.z - a.z) * ez) / lenSq;
  // Stryker disable next-line EqualityOperator: EQUIVALENT — at raw exactly 0 or exactly 1 both
  // sides of each comparison return the SAME point, because the clamp's bound IS the parameter
  // there. There is no input that separates `<` from `<=` here.
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return { x: a.x + ex * t, z: a.z + ez * t };
}

/** The rim's landings on the smoothed curve, and the stretch of curve between consecutive ones. */
export interface CoastArcs {
  /** Where rim vertex `i` lands on the curve — 1:1 with the rim it was built from. */
  landings: CoastPoint[];
  /** The curve's own points strictly between landing `i` and landing `i + 1`. */
  arcs: CoastPoint[][];
}

/**
 * MATCH THE RIM TO THE CURVE BY CONSTRUCTION, NOT BY SEARCH.
 *
 * ⚠⚠ A NEAREST-POINT SEARCH IS THE OBVIOUS ANSWER AND IT IS WRONG — measured on the shipped
 * fixture before this function existed. Projecting each outset vertex onto the whole 208-point
 * curve agrees with the construction below for 50 of the island's 52 rim vertices and, at the other
 * two, lands a vertex ONE SEGMENT BEHIND its predecessor. The arc between them then runs 207
 * segments the long way round instead of 1, so two boundary parcels swallow the entire coastline
 * and the island's summed parcel area comes out 3.0x its true value. Non-monotonicity is not a rare
 * degenerate case here; it is what a distance search does wherever the curve is straight enough
 * that two landings compete for one segment.
 *
 * THE CONSTRUCTION. Chaikin doubles a closed loop per pass and each pass is a fixed blend, so the
 * correspondence is arithmetic rather than geometric. One pass sends a loop `A` to `B` with
 * `B[2i] = ¾A_i + ¼A_{i+1}` and `B[2i+1] = ¼A_i + ¾A_{i+1}`, so the two output points STRADDLING
 * vertex `A_i` are `B[2i-1]` and `B[2i]` — the chord that cuts that corner. Composing the pass with
 * itself puts the chord for `A_i` at `(C[4i-2], C[4i-1])`. In general, for `m` passes the stride is
 * `2^m` and the corner chord at vertex `i` begins at `stride·i — stride/2`.
 *
 * So rim vertex `i` lands on ITS OWN corner chord, and the arc from landing `i` to landing `i + 1`
 * is exactly the `stride` curve points that follow it. The arcs therefore partition the curve
 * exactly once — 52 arcs of 4 points over a 208-point curve — which is the property the search
 * could not offer.
 *
 * @throws if the curve is not the outset loop Chaikin-doubled {@link COAST_SMOOTH_ITERS} times.
 * The chord offset above is derived from that pass count; a curve of any other length means the
 * derivation no longer describes it, and inserting the wrong arc draws a coastline that looks
 * plausible and is not the one the 2D map draws.
 */
export function coastArcs(curve: CoastCurve): CoastArcs {
  const n = curve.outset.length;
  const stride = 2 ** COAST_SMOOTH_ITERS;
  if (curve.smooth.length !== n * stride) {
    throw new Error(
      `coastArcs: expected ${n * stride} curve points for ${n} outset points at ` +
        `${COAST_SMOOTH_ITERS} Chaikin passes, got ${curve.smooth.length}`,
    );
  }
  const total = curve.smooth.length;
  const at = (k: number): CoastPoint => curve.smooth[((k % total) + total) % total]!;
  const chord = (i: number): number => stride * i - stride / 2;
  const landings = curve.outset.map((p, i) => nearestOnSegment(p, at(chord(i)), at(chord(i) + 1)));
  // ⚠ `Array.from` RATHER THAN A COUNTED LOOP, and it is a mutation-rung requirement rather than
  // taste. Written `for (let step = 1; step <= stride; step += 1)`, the counter's `+= 1` can be
  // mutated to `-= 1` — which does not produce a wrong answer, it produces an INFINITE LOOP, and a
  // suite that hangs is a detection no rung can attribute to a test (it comes back as a TIMEOUT,
  // scored UNPROVEN). The arc's length is known before it is built, so there is no counter to get
  // wrong. Same remedy `triangulateRing` already carries next door.
  const arcs = curve.outset.map((_p, i) =>
    Array.from({ length: stride }, (_unused, step) => at(chord(i) + step + 1)),
  );
  return { landings, arcs };
}

/**
 * DOES THIS RING CROSS ITSELF?
 *
 * ⚠⚠ IT IS HERE BECAUSE THE COAST GENUINELY FOLDS, AND THE 2D MAP HAS BEEN HIDING IT.
 * `coast.ts`'s own comment says the offset "can never self-intersect" because only the outset
 * MAGNITUDE is perturbed, along the normal. That is false for a polygon offset in general — a
 * convex corner sharper than the offset is wide turns its two neighbouring edges past each other -
 * and it is false on THIS map: the shipped island's outset coast loop crosses itself TWICE. Nobody
 * could see it, because the studio draws that loop as an SVG FILL and the nonzero fill rule paints
 * a doubled-back region exactly like a single one. A triangulated ground has no such mercy: the two
 * boundary parcels at a crossing overlap, so one capability's status colour is drawn over ground
 * that belongs to another. That is a misreport (ADR-0392 D5 / ADR-0398 D7), and it is the one way
 * this component could do real harm.
 *
 * Segment-pair test, edges sharing an endpoint excluded. Rings here are at most twelve vertices, so
 * the quadratic is 66 comparisons at its worst.
 *
 * ⚠ STRICT crossings only — a ring that merely TOUCHES itself (a repeated vertex, a collinear
 * spur) bounds the same ground it did and triangulates to zero-area triangles rather than to
 * overlapping ones. Widening this to touching would cap coasts that are perfectly honest.
 */
export function isSimpleRing(ring: readonly CoastPoint[]): boolean {
  const n = ring.length;
  const side = (o: CoastPoint, a: CoastPoint, b: CoastPoint): number =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const straddles = (a: CoastPoint, b: CoastPoint, c: CoastPoint, d: CoastPoint): boolean => {
    const s1 = side(c, d, a);
    const s2 = side(c, d, b);
    return (s1 > 0 && s2 < 0) || (s1 < 0 && s2 > 0);
  };
  // ⚠⚠ THERE IS NO ADJACENT-PAIR GUARD, AND ITS ABSENCE IS THE POINT. The obvious spelling skips
  // pairs of edges that share an endpoint — and a mutation sweep showed all eight mutants of that
  // guard surviving, because STRICT straddling already answers those pairs `false`: the shared
  // vertex is an endpoint of both segments, so its side is exactly 0 and neither strict comparison
  // can hold. The guard was a cost optimisation wearing a correctness guard's clothes, which is
  // exactly the unreachable-branch shape the rung exists to find. Removed rather than asserted.
  // Stryker disable next-line EqualityOperator: EQUIVALENT — at `i === n` the inner loop's own
  // bound (`j = i + 1 < n`) is already false, so the extra pass reads nothing and compares nothing.
  for (let i = 0; i < n; i += 1) {
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT — starting `j` at `i - 1` adds the
    // pair (i, i) and the pair (i-1, i). Both share endpoints with edge i, so strict straddling
    // returns false for them; the answer is unchanged and only the work grows.
    for (let j = i + 1; j < n; j += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (straddles(a, b, c, d) && straddles(c, d, a, b)) return false;
    }
  }
  return true;
}

/**
 * HOW MUCH OF ITS BEACH A RIM VERTEX MAY KEEP, in descending order.
 *
 * A vertex starts at the top rung and is demoted one rung at a time while any parcel holding it
 * folds. The ladder ENDS AT ZERO, and that is what makes the loop below terminate without a
 * give-up branch: a rim vertex at zero is where the mesh already put it, and the mesh's own rings
 * are simple, so demoting every implicated vertex far enough always reaches a state that holds.
 * Eleven rungs rather than four because the cap is a visible notch in the shore and a coarse
 * ladder spends more beach than it has to.
 */
export const COAST_SCALE_LADDER: readonly number[] = [
  1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0,
];

/** A point moved a fraction of the way from where the mesh put it to where the coast wants it. */
function lerp(from: CoastPoint, to: CoastPoint, s: number): CoastPoint {
  return { x: from.x + (to.x - from.x) * s, z: from.z + (to.z - from.z) * s };
}

/** What the clip does to ONE island: where each rim vertex goes, and what to insert along each rim
 *  edge. Both keyed on the mesh's own identities, so applying it needs no knowledge of which parcel
 *  an edge came from. */
export interface CoastDisplacement {
  /** Rim vertex key → where it moves to. Vertices absent from this map do not move. */
  moved: Map<string, CoastPoint>;
  /** Rim edge key → the points to insert along it, in the RIM's own traversal order, together with
   *  the key of the endpoint that order starts from. A parcel traversing the edge the other way
   *  inserts them reversed. */
  inserted: Map<string, { from: string; points: CoastPoint[] }>;
  /** Rim vertex key → the fraction of its beach the fold cap left it, one entry per rim vertex.
   *
   *  ⚠ IT IS THE CAP'S OWN REPORT AND IT IS WHY THE CAP IS NOT A SILENT CLAMP. Every rim vertex
   *  appears here, capped or not, so {@link coastCapping} can say how often the cap bound and how
   *  hard — a number the evidence quotes rather than a behaviour a reader has to infer from a
   *  picture. */
  scales: Map<string, number>;
}

/** The half of a displacement that REWRITES A RING. The scales beside it are the fold cap's own
 *  report and no ring reads them, so {@link applyDisplacement} asks for this and a caller building
 *  one by hand does not have to invent a capping record it never used. */
export type RingDisplacement = Pick<CoastDisplacement, 'moved' | 'inserted'>;

/** Nothing moves and nothing is inserted — what `none` produces, written out rather than branched
 *  around so there is one code path through {@link applyDisplacement}. */
export const NO_DISPLACEMENT: CoastDisplacement = {
  moved: new Map(),
  inserted: new Map(),
  scales: new Map(),
};

/**
 * THE DISPLACEMENT FOR ONE ISLAND'S PARCEL RINGS, under one mode.
 *
 * The three modes differ in exactly two decisions and nothing else — where a rim vertex lands, and
 * whether the edge between two of them gains the curve's own points — which is what lets the arms
 * be read against each other as one change at a time.
 *
 * ⚠⚠ AND THEN EVERY MODE IS CAPPED SO NO PARCEL FOLDS. See {@link isSimpleRing} for why that
 * is a correctness requirement rather than tidiness: the coast this map has always drawn crosses
 * itself twice, and a mesh cannot hide what a fill hides. The cap is a fixed-point loop over
 * {@link COAST_SCALE_LADDER} — demote every rim vertex of every folded parcel by one rung, repeat -
 * and it terminates by construction, because the bottom rung leaves the mesh exactly as it found it.
 *
 * ⚠ THE CAP IS NOT A CLAMP THAT HIDES A WRONG ANSWER, and the difference is that it is
 * OBSERVABLE: {@link coastCapping} reports which vertices it bound and how far, so a coast that had
 * to give up half its beach says so in the evidence instead of quietly drawing a notch.
 */
export function coastDisplacement(
  rings: readonly (readonly CoastPoint[])[],
  island: string,
  mode: CoastMode,
): CoastDisplacement {
  if (mode === 'none') return NO_DISPLACEMENT;
  const moved = new Map<string, CoastPoint>();
  const inserted = new Map<string, { from: string; points: CoastPoint[] }>();
  const scales = new Map<string, number>();
  for (const rim of rimLoops(rings)) {
    // A loop of fewer than three vertices bounds no area, so it has no outward direction and no
    // shore to smooth. `outsetLoop` already returns such a loop unchanged; skipping keeps
    // `coastArcs` from being handed a curve with no corner chords.
    if (rim.length < 3) continue;
    const curve = coastCurve(rim, island);
    const { landings, arcs } = coastArcs(curve);
    /** Where each rim vertex WANTS to go, before any cap. */
    const target = mode === 'outset' ? curve.outset : landings;
    /** Each rim vertex's rung on {@link COAST_SCALE_LADDER}. */
    const rung = new Map<string, number>();
    for (const v of rim) rung.set(vertexKey(v), 0);
    const scaleOf = (v: CoastPoint): number => COAST_SCALE_LADDER[rung.get(vertexKey(v))!]!;

    /** This island's displacement at the CURRENT rungs. An inserted point scales between the
     *  straight rim edge it subdivides and the curve it should lie on, with the fraction
     *  interpolated between its two endpoints — so a fully capped edge is the edge the mesh already
     *  had, wearing collinear extra vertices, and a half-capped one bends by half. */
    const snapshot = (): RingDisplacement => {
      const at = new Map<string, CoastPoint>();
      const arcsAt = new Map<string, { from: string; points: CoastPoint[] }>();
      rim.forEach((v, i) => at.set(vertexKey(v), lerp(v, target[i]!, scaleOf(v))));
      if (mode === 'subdivide') {
        rim.forEach((a, i) => {
          const b = rim[(i + 1) % rim.length]!;
          const sa = scaleOf(a);
          const sb = scaleOf(b);
          const arc = arcs[i]!;
          const points = arc.map((p, k) => {
            const t = (k + 1) / (arc.length + 1);
            return lerp(lerp(a, b, t), p, sa + (sb - sa) * t);
          });
          arcsAt.set(edgeKey(a, b), { from: vertexKey(a), points });
        });
      }
      return { moved: at, inserted: arcsAt };
    };

    let current = snapshot();
    // ⚠ AT MOST ONE PASS PER RUNG, AND THE LADDER ITSELF IS THE BOUND. A vertex only ever moves
    // DOWN, and the bottom rung restores the mesh's own ring — whose simplicity is a property of
    // the substrate — so the loop cannot run out of rungs with a fold still standing. Iterating the
    // ladder rather than counting to its length is the same mutation-rung remedy `coastArcs` takes:
    // a counted loop's `+= 1` mutates to `-= 1` and hangs, and a hang is scored UNPROVEN.
    //
    // ⚠⚠ ONLY THE RINGS HOLDING ONE OF THIS RIM'S VERTICES ARE CANDIDATES, AND THE NARROWING IS
    // LOAD-BEARING FOR THE MUTATION RUNG ITSELF. An interior-only ring is untouched by the
    // displacement, so it can never fold — which makes this filter look like a pure cost
    // optimisation, and a sweep duly reported it as an unkillable mutant. It was removed on that
    // reading and the removal made things WORSE, measurably: with every parcel a candidate, a
    // mutant that breaks `edgeKey` forges hundreds of spurious rim loops and each one then walks
    // the ladder over all 5,740 forest parcels. The mutant stopped being caught as a wrong answer
    // and started being caught as a TIMEOUT — a detection the rung cannot attribute to any test,
    // because no test fails; the suite simply grinds. So the filter is kept, and what it buys is
    // that a broken neighbour fails FAST enough to be blamed on something.
    // Stryker disable next-line all: EQUIVALENT on the healthy path by construction — an
    // interior-only ring cannot fold — and its absence is observable only as the timeout described
    // above, which is not a verdict a test can carry.
    const touched = rings.filter((r) => r.some((p) => rung.has(vertexKey(p))));
    for (const _rung of COAST_SCALE_LADDER) {
      const folded = touched.filter((r) => !isSimpleRing(applyDisplacement(r, current)));
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — without the break the loop
      // runs its remaining passes over a set that is already simple, finds nothing folded and
      // demotes nobody. It is a cost guard, and the result it produces is identical.
      if (folded.length === 0) break;
      // ⚠ DEMOTE FROM THE RIM SIDE, NOT THE RING SIDE. Walking a folded ring's vertices and
      // skipping the ones that are not on the rim reads naturally and hides an UNOBSERVABLE guard:
      // `rung` is only ever READ at rim keys, so an interior key written into it is never looked at
      // and the skip cannot change an answer. Iterating the rim instead means every key demoted is
      // one that exists, and the only branch left — is this rim vertex on a folded parcel — is the
      // one that carries the meaning.
      const foldedKeys = new Set(folded.flatMap((r) => r.map(vertexKey)));
      for (const v of rim) {
        const k = vertexKey(v);
        if (foldedKeys.has(k)) rung.set(k, rung.get(k)! + 1);
      }
      current = snapshot();
    }
    for (const v of rim) scales.set(vertexKey(v), scaleOf(v));
    for (const [k, v] of current.moved) moved.set(k, v);
    for (const [k, v] of current.inserted) inserted.set(k, v);
  }
  return { moved, inserted, scales };
}

/**
 * WHAT THE FOLD CAP ACTUALLY BOUND, over a whole map.
 *
 * ⚠ A CAP THAT NOBODY CAN SEE IS INDISTINGUISHABLE FROM A COAST THAT NEVER NEEDED ONE. This is
 * the number the evidence quotes: how many rim vertices kept less than their whole beach, and how
 * much the worst of them kept. A run that reports `bound: 0` is a coast that folded nowhere.
 */
export interface CoastCapping {
  /** Rim vertices in total, across every island. */
  rim: number;
  /** How many of them the cap bound at all (kept less than the full beach). */
  bound: number;
  /** The SMALLEST fraction any rim vertex was left with — 1 when nothing was bound, 0 when some
   *  vertex kept no beach at all. */
  least: number;
}

export function coastCapping(
  descriptors: readonly InstanceDescriptor[],
  mode: CoastMode,
): CoastCapping {
  let rim = 0;
  let bound = 0;
  let least = 1;
  for (const [island, cells] of groundByIsland(descriptors)) {
    // `coastalIsland` has already refused every ringless descriptor, so `points` is present on
    // each of these — the non-null assertion is the grouping's own guarantee restated, not a second
    // guard that could disagree with it.
    const rings = cells.map((c) => ringOf(c.points!));
    for (const s of coastDisplacement(rings, island, mode).scales.values()) {
      rim += 1;
      if (s < 1) bound += 1;
      least = Math.min(least, s);
    }
  }
  return { rim, bound, least };
}

/** Rewrite ONE ring under a displacement: every vertex moved if the rim moved it, and every rim
 *  edge followed by the curve's own points in the direction this ring traverses it. */
export function applyDisplacement(
  ring: readonly CoastPoint[],
  d: RingDisplacement,
): CoastPoint[] {
  const out: CoastPoint[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ka = vertexKey(a);
    out.push(d.moved.get(ka) ?? a);
    const insert = d.inserted.get(edgeKey(a, b));
    if (insert === undefined) continue;
    // The stored order runs from `insert.from`. This ring may traverse the edge the other way, in
    // which case the same points still describe the same arc — read backwards.
    const points = insert.from === ka ? insert.points : [...insert.points].reverse();
    for (const p of points) out.push(p);
  }
  return out;
}

/** A descriptor's ring in the ground-plane terms this module works in. The mapper carries a `y`
 *  on every ring vertex and it is always 0 — the ring IS the ground plane — so dropping it here
 *  means nothing downstream has to remember that. */
function ringOf(points: readonly Transform3D[]): CoastPoint[] {
  return points.map((p) => ({ x: p.x, z: p.z }));
}

/**
 * THE ISLAND WHOSE COAST THIS DESCRIPTOR'S RING BELONGS TO, or `null` when it belongs to none.
 *
 * ⚠⚠ ONE PREDICATE, READ BY BOTH THE GROUPING AND THE REWRITE, and that is a mutation-rung
 * requirement rather than tidiness. Spelled twice — once to decide what goes into a rim and once to
 * decide what comes back out — the two copies are mutants no single test can pin: flipping either
 * one alone leaves the OTHER still refusing the descriptor, so the output never moves. Named once,
 * a single fixture separates every branch.
 *
 * ⚠ EXPORTED SINCE THE SHORE FALL (2026-09-01) FOR THAT SAME REASON, one seam wider. The
 * shore field measures distance to the boundary of exactly these descriptors, so a second
 * spelling there would be a third mutant no single test pins — and worse than the two above,
 * because a shore drawn round a different set of parcels than the coast was cut from is a
 * waterline in the wrong place rather than merely an unmoved output.
 *
 * Three ways to belong to no coast, and each is a decision:
 *  - NOT GROUND. A story tree carries a `transform`, not a parcel ring; clipping one would move a
 *    tree to where a shoreline went.
 *  - NO RING. A ground descriptor with no `points` bounds nothing, so it contributes no shore edge
 *    and has nothing to rewrite.
 *  - NO ISLAND. The coast is seeded on the STORY's id, so an island nobody can name has no coast to
 *    draw — inventing a seed would put a shoreline where the map cannot say there is one, and
 *    POOLING the unnamed parcels would compute a rim across the sea between two unrelated ones.
 */
export function coastalIsland(d: InstanceDescriptor): string | null {
  if (d.kind !== 'cell-ground') return null;
  if (d.points === undefined) return null;
  return d.island ?? null;
}

/**
 * THE GROUND PARCELS OF EACH NAMED ISLAND, in first-seen order.
 *
 * ⚠ AN UNHOMED PARCEL IS IN NO BUCKET, so it is never clipped and never contributes a rim edge
 * to somebody else's. The mapper stamps the island on the ground GROUP, so a story's parcels are
 * homed together or not at all and a mixed island is not a shape it can emit — but grouping this
 * way means that if it ever could, the unnamed parcels would be left alone rather than fused into
 * a landmass nobody authored.
 */
function groundByIsland(
  descriptors: readonly InstanceDescriptor[],
): Map<string, InstanceDescriptor[]> {
  const out = new Map<string, InstanceDescriptor[]>();
  for (const d of descriptors) {
    const island = coastalIsland(d);
    if (island === null) continue;
    const list = out.get(island);
    if (list) list.push(d);
    else out.set(island, [d]);
  }
  return out;
}

/**
 * CLIP EVERY ISLAND'S GROUND TO ITS COAST.
 *
 * Parcels are grouped by island, each island's rim is found and displaced, and every ring is
 * rewritten. `none` returns the descriptors unchanged, so the before/after is this same function
 * called twice — the shape every crossing on this arc has taken since the relief.
 *
 * ⚠ ONLY `cell-ground` DESCRIPTORS ARE TOUCHED, and everything else passes through in ORDER. The
 * canvas hands this the ground alone today, but a caller that hands it a whole descriptor stream
 * gets its story trees and its blooms back where it left them rather than dropped.
 *
 * ⚠ IT IS NOT IDEMPOTENT AND IS NOT MEANT TO BE. Feeding clipped ground back in would find a rim
 * made of coast points rather than of mesh vertices and outset it a second time. The canvas calls
 * it once, on the mapper's own output.
 */
export function clipToCoast(
  descriptors: readonly InstanceDescriptor[],
  mode: CoastMode,
): InstanceDescriptor[] {
  if (mode === 'none') return [...descriptors];
  const displacements = new Map<string, CoastDisplacement>();
  for (const [island, cells] of groundByIsland(descriptors)) {
    displacements.set(island, coastDisplacement(cells.map((c) => ringOf(c.points!)), island, mode));
  }
  return descriptors.map((d) => {
    const island = coastalIsland(d);
    if (island === null) return d;
    const points: Transform3D[] = applyDisplacement(
      ringOf(d.points!),
      displacements.get(island)!,
    ).map((p) => ({ x: p.x, y: 0, z: p.z }));
    return { ...d, points };
  });
}

/** The beach width the shipped map draws, in ground units — {@link COAST_OUTSET} under its own
 *  name on this side of the seam, so a reader of the 3D ground does not have to know it is the 2D
 *  panel's constant to find it. Re-exported rather than copied. */
export { COAST_OUTSET, COAST_SMOOTH_ITERS };

/** The beach width the shipped 3D GROUND draws, in ground units: the 2D map's {@link COAST_OUTSET}
 *  scaled by `LAND_SCALE`, because the island under it is scaled by the same (the land-per-capability
 *  ratio, `land-per-capability.ts`). Every band derived from the beach reads THIS, not the 2D one. */
export const GROUND_COAST_OUTSET = COAST_OUTSET * LAND_SCALE;
