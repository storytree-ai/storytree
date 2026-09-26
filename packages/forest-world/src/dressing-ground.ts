// dressing-ground.ts — WHERE DRESSING MAY STAND: the island's own numbers (its area, its bounding
// box), the ray cast that says whether a point is on one of its cells, the exclusion that keeps
// scenery off the beach band and the worn path, and the one gate every dressing layer on this arc
// passes through. Pure, browser-free, node:test-provable.
//
// ⚠⚠ WHAT THIS MODULE WAS, AND WHY IT IS SMALLER NOW. Until 2026-09-05 this file was
// `grove-dressing.ts` and its bulk was the GROVE: thirteen stands of dressing pines per
// recipe-island of area, four to eight members each at 0.55–0.80 of a capability tree's height,
// grown on every healthy island after the vocabulary had stood everything that reports something
// (ADR-0507 D2). **ADR-0518 retired that role outright.** The owner looked at a dressed island and
// asked why it carried ~100 trees when no story holds that many capabilities, then ruled: *"1 tree
// per a capability it needs to look good not like a forest"*. The form-and-size guarantee — the
// capability's own tree is always the tallest on its parcel — held in the geometry and failed
// against the most informed reader there is, so the answer was to remove the role rather than tune
// its constant (the density ladder's lowest rung still stood 61 dressing pines beside 11 capability
// trees). A tree on the map now means a capability, with no qualifier a reader has to know, and
// nothing in `src/` places a pine that is not one. The stand placement survives ONLY as
// `harness/grove-history.ts`, a comparison page's control arm reproducing the map as it shipped
// until that landing — never on the shipped path, never behind a flag.
//
// What stayed is everything the GROUND COVER (`cover-dressing.ts`) reads: the recipe's island area
// the counts are proportioned against, the shoelace and the bounding box, the ray cast, and the
// exclusion. They were the grove's by authorship and the cover's by import; now the cover is their
// one caller and they are named for what they do rather than for who wrote them.
//
// ⚠ THE EXCLUSION IS THE GROUND'S OWN. Nothing dressing stands on the beach band the sand layer
// draws or on the worn path the wear layer paints, through the SAME `shoreField` and `wearField`
// the ground samples per fragment — so the layer and the scenery cannot come to disagree about
// where the beach is.

import { SHIPPED_COAST, clipToCoast, coastalIsland, type CoastPoint } from './coast-clip.js';
import { islandPaths } from './island-path.js';
import { LAND_AREA_PER_CAPABILITY, TUNED_FIXTURE } from './land-per-capability.js';
import { SAND_SHIPPED_BEACH_WIDTH } from './land-sand.js';
import { WEAR_FALLOFF, wearOf } from './land-wear.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';
import { shoreField } from './shore-fall.js';
import { wearField } from './trail-wear.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

/** The one story status whose islands wear dressing at all (ADR-0507 D1 / ADR-0492 D1). */
export const DRESSING_STATUS = 'healthy';

/**
 * THE GROUND THE RECIPE'S COUNTS WERE SCATTERED OVER, in this map's placement units — the
 * denominator every "per recipe-island of area" count divides by (`build_land.py`'s island, 70
 * undergrowth / 120 grass / 26 flowers over it).
 *
 * ⚠⚠ RE-DERIVED WITH THE FOOTPRINT (ADR-0517), AND NOT A DENSITY CHANGE. The mapper delivered the
 * 2D drawing's SQUASHED footprint until 2026-09-05 (the hex cluster projected at the drawing's
 * 20°, 234 × 46 units), and this constant was 8,424.6 — the fixture island's rings in that basis.
 * `world-to-3d.ts` now restores the true footprint (234 × 135), so the same thirteen hexes measure
 * 2.9238× more; left at 8,424.6 the cover would have grown 2.92× the recipe's density under a rule
 * still claiming to transcribe the recipe. `harness/true-footprint-routes.test.ts` holds it to the
 * fixture's own area through the shipped mapper.
 */
// ⚠ RE-BASED BY THE RATIO (`land-per-capability.ts`): the recipe's thirteen hexes are 24,631.8 units²
// as the drawing lays them (the true basis); the shipped mapper sizes that island — the fixture's
// eleven capabilities — to EXACTLY `11 × LAND_AREA_PER_CAPABILITY`, and this is its area THROUGH the
// shipped mapper (`24,631.8 × LAND_SCALE²` to within the coast's 0.04%) —
// `harness/true-footprint-routes.test.ts` re-derives it. The cover's per-recipe-island counts therefore still mean "on the recipe island as
// this map draws it", which is what makes `x1` the recipe's own count rather than a seventh of it.
export const RECIPE_ISLAND_AREA = TUNED_FIXTURE.capabilities * LAND_AREA_PER_CAPABILITY;

/**
 * The beach band dressing keeps off — the SHIPPED sand band, by import. The recipe insets its
 * cover from the coast by 0.6–1.0 units, but our beach is a drawn 9-unit band and grass growing
 * over drawn sand is a defect the recipe never had to consider, so the row's own rule — "never on
 * the beach band or the worn path" — is what binds.
 */
export const DRESSING_BEACH = SAND_SHIPPED_BEACH_WIDTH;

/** The recipe's `wear < 0.30`: a point worn harder than this is ON the path. */
export const DRESSING_WEAR_CEILING = 0.3;

// ---------------------------------------------------------------- the island's own numbers

/** A ring's area by the shoelace formula — orientation-free, zero for fewer than three points. */
export function ringArea(points: readonly GPoint[]): number {
  let twice = 0;
  for (const [i, a] of points.entries()) {
    const b = points[(i + 1) % points.length]!;
    // Stryker disable next-line AssignmentOperator: EQUIVALENT — `-=` accumulates `-Σterm` rather
    // than `Σterm`, and the `Math.abs` below erases exactly that sign. The shoelace is
    // orientation-free ON PURPOSE (a ring wound the other way is the same ground), so no input
    // can distinguish them and no test can be written that does.
    twice += a.x * b.z - b.x * a.z;
  }
  return Math.abs(twice) / 2;
}

/** The ground an island's cells cover, in placement units. */
export function cellsArea(cells: readonly LayoutCell[]): number {
  let area = 0;
  for (const c of cells) area += ringArea(c.points);
  return area;
}

/** The island's extent along each axis of the placement basis. Infinite-and-inverted over no
 *  points at all, which is what makes an empty island's bounding area zero rather than negative. */
export interface CellsBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function cellsBounds(cells: readonly LayoutCell[]): CellsBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of cells) {
    for (const p of c.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

/** May this island wear dressing? Every cell healthy, and at least one cell to be healthy. An
 *  island whose cells disagree about their status is a scene defect, and it fails CLOSED here.
 *  `unknown` wears nothing, which is the vocabulary's load-bearing entry one rung up. */
export function dressingEligible(cells: readonly LayoutCell[]): boolean {
  return cells.length > 0 && cells.every(isHealthyCell);
}

function isHealthyCell(c: LayoutCell): boolean {
  return c.status === DRESSING_STATUS;
}

// ---------------------------------------------------------------- where a point stands

/** Is `p` inside the ring? Ray casting — the same test `kit-vocabulary.test.ts` holds the
 *  capability trees to their parcels with, here as a module function so the cover can ask it. */
export function insideRing(points: readonly GPoint[], p: GPoint): boolean {
  let inside = false;
  for (const [i, a] of points.entries()) {
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT — `+ 1` pairs each vertex with its
    // SUCCESSOR instead of its predecessor, which enumerates the same edge SET (every edge, once,
    // read from its other end) and the crossing test below is symmetric in `a` and `b`. Probed
    // over 400,000 random rings and points: not one disagreement.
    const b = points[(i + points.length - 1) % points.length]!;
    if (straddles(a, b, p.z) && crossingIsRight(p.x, crossingX(a, b, p.z))) inside = !inside;
  }
  return inside;
}

/**
 * DOES THE EDGE `a`→`b` CROSS THE HORIZONTAL LINE THROUGH `z`? Half-open on purpose: a vertex
 * exactly ON the line counts for the edge BELOW it and not for the edge above, so a ray through a
 * vertex crosses the ring once rather than twice or not at all.
 *
 * ⚠ THE `>=` VARIANTS ARE NOT EQUIVALENT and are killed by a fixture — a ring with a vertex whose
 * z is exactly the probe's, which is the only input the convention can be seen through.
 */
export function straddles(a: GPoint, b: GPoint, z: number): boolean {
  return a.z > z !== b.z > z;
}

/** Where that edge meets the horizontal line through `z`, along x. */
export function crossingX(a: GPoint, b: GPoint, z: number): number {
  return ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x;
}

/**
 * IS THE CROSSING ON THE SIDE THIS RAY COUNTS? To the right of `px`, by convention.
 *
 * ⚠⚠ BOTH MUTANTS OF THIS OPERATOR ARE UNKILLABLE HERE, FOR TWO DIFFERENT REASONS, WHICH IS WHY
 * THE MUTATOR IS DISABLED RATHER THAN THE TEST WEAKENED.
 * `>=` counts the crossings on the LEFT instead, and a closed ring's crossings on the two sides of
 * a point always have the SAME parity — so it is a genuinely equivalent ray cast, and 400,000
 * random rings and points produced no disagreement.
 * `<=` differs only where `px` lands EXACTLY on a crossing, i.e. where the probe sits on the ring's
 * own boundary. That case is real and IS pinned, by
 * `insideRing pins the boundary convention: a probe exactly on a vertex is INSIDE` — but by a test
 * rather than by this rung, because one `Stryker disable` cannot keep one mutant of a mutator and
 * drop the other.
 */
// Stryker disable next-line EqualityOperator: EQUIVALENT / pinned by test — see the doc comment.
export function crossingIsRight(px: number, x: number): boolean {
  return px < x;
}

/** The first cell containing `p`, or `null` when it stands on none — off the island. */
export function cellAt(cells: readonly LayoutCell[], p: GPoint): LayoutCell | null {
  for (const c of cells) if (insideRing(c.points, p)) return c;
  return null;
}

// ---------------------------------------------------------------- where dressing may not stand

/** Where dressing may NOT stand — the beach band and the worn path, as one predicate. */
export interface DressingExclusion {
  clear(x: number, z: number): boolean;
}

/** Clear of the beach: at least {@link DRESSING_BEACH} from the clipped coast. The shore field
 *  caps its distance at the width it was built for, so "at the cap" IS clear. */
export function beachClear(distance: number): boolean {
  return distance >= DRESSING_BEACH;
}

/** Clear of the path: the recipe's `wear < 0.30`, through the wear layer's own smoothstep. */
export function pathClear(distance: number): boolean {
  // Stryker disable next-line EqualityOperator: EQUIVALENT, and MEASURED rather than asserted —
  // `<=` differs only where `wearOf(distance)` is EXACTLY 0.3, and no double is. `wearOf` is a
  // smoothstep, so bisecting it to the last bit brackets the ceiling between 0.30000000000000016
  // and 0.29999999999999993 with nothing between: the equality this mutant turns on is unreachable
  // from any input, so no fixture can be written that separates them.
  return wearOf(distance) < DRESSING_WEAR_CEILING;
}

/**
 * THE EXCLUSION FOR ONE ISLAND, from its CLIPPED ground and its worn paths.
 *
 * ⚠ THE CLIPPED DESCRIPTORS, for the reason `shoreField` states at length: after `clipToCoast`
 * the boundary of the mesh IS the coast, so the distance to the mesh's rim is the distance to the
 * water. Handed the pre-clip parcels the band would sit a beach's width inland of the sand the
 * ground draws, and the cover would stand on the beach it was told to avoid.
 */
export function dressingExclusion(
  clippedIsland: readonly InstanceDescriptor[],
  paths: readonly (readonly CoastPoint[])[],
): DressingExclusion {
  const shore = shoreField(clippedIsland, DRESSING_BEACH);
  const wear = wearField(paths, WEAR_FALLOFF);
  return {
    clear(x: number, z: number): boolean {
      return beachClear(shore.sample(x, z).distance) && pathClear(wear.sample(x, z).distance);
    },
  };
}

/**
 * ONE ISLAND'S EXCLUSION, READ OFF THE MAP'S OWN DESCRIPTOR STREAM: its ground clipped to the
 * SAME coast the shipped ground is clipped to (`SHIPPED_COAST`, the same function), and its worn
 * paths from the SAME connector the wear layer paints from (`islandPaths` over the trail strips in
 * the stream). Nothing here is a second opinion about where the beach or the path is.
 *
 * ⚠ ONE ISLAND'S GROUND ALONE IS CLIPPED, and that is exact rather than an approximation: the coast
 * is seeded on the island's id and displaced from the island's own rim, so an island clipped by
 * itself is clipped as it is in the whole map. Every strip in the stream is offered to the
 * connector, which docks only the ends within reach of THIS island's rim.
 */
export function islandExclusion(descriptors: readonly Descriptor3D[], island: string): DressingExclusion {
  // Stryker disable next-line MethodExpression: EQUIVALENT — dropping the filter passes `skipped`
  // markers straight through, and {@link isInstance}'s own note says why that changes no answer.
  // What it DOES change is the static type, and a type is not an input this rung can vary.
  const instances = descriptors.filter(isInstance);
  // ⚠⚠ `coastalIsland`, NOT A SECOND COPY OF ITS RULE. This read `d.kind === 'cell-ground' &&
  // d.island === island`, and the mutation rung found the first half unkillable — correctly, and for
  // a reason worth keeping written down: every consumer downstream (`clipToCoast`, `shoreField`,
  // `islandRims`) re-asks `coastalIsland`, so a non-ground descriptor that slipped through here was
  // dropped three times over and could not change an answer. A guard no input can exercise is a
  // second copy of somebody else's rule, not a defence. What ONLY this line decides is the ISLAND —
  // hand it two islands' ground and the exclusion would keep cover off the OTHER island's beach.
  const ground = instances.filter((d) => coastalIsland(d) === island);
  const clipped = clipToCoast(ground, SHIPPED_COAST);
  const paths = [...islandPaths(clipped, instances).values()].flat();
  return dressingExclusion(clipped, paths);
}

/** A deterministic stream — `propStream`'s shape. */
export type Stream = () => number;

/**
 * Everything in the stream that IS an instance — i.e. not a `skipped` marker. A type guard rather
 * than an inline filter, so the narrowing the consumer relies on is stated once.
 *
 * ⚠ Stryker disable, with the reason it has always carried: a `skipped` descriptor is neither
 * ground (it has no `kind: 'cell-ground'`) nor a dockable strip, so letting one through changes no
 * answer either consumer gives. The guard exists for the TYPE, and a type is not an input.
 */
function isInstance(d: Descriptor3D): d is InstanceDescriptor {
  // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: EQUIVALENT
  return d.kind !== 'skipped';
}
