// shore-fall.ts — THE LANDFORM FALLS TO THE SHORE, on the SHIPPED side of the package.
//
// The SECOND of the approved treatment's six components to cross, counting from the coast clip
// that made it possible, and the one the arc's own start-order note had lost track of. It is a
// treatment of the GROUND ITSELF rather than an object placed on it, so ADR-0414 D1's
// no-decoration fence does not reach it (the fence is narrow, and the arc says so in terms).
//
// ⚠⚠ THE PREMISE, CHECKED AT SOURCE BEFORE ANY OF THIS WAS WRITTEN, AND IT IS THE OPPOSITE OF
// THE COAST'S. The coast clip turned out to be BUILT and merely unimported — two greps changed
// the increment from "write a coast" to "import one". This component is genuinely ABSENT: a
// repo-wide grep for a shore falloff, a shore height term or a beach dip returns exactly one hit,
// and it is the sentence in the reference README naming the component as wanted. `landRelief` is
// an unbounded sum of three sines with no shore term of any kind, so before this file the new
// beach stood at whatever height the field happened to give it. PR #1776's own README says so.
//
// ⚠ AND IT COULD NOT HAVE BEEN WRITTEN EARLIER. A landform that falls to the shore needs a shore
// to fall to, and until the coast clip landed the shipped mesh ended in raw 120-degree hex
// corners. The coast is what unblocked this; the order was not a preference.
//
// ---------------------------------------------------------------------------------------------
// WHERE THE NUMBERS COME FROM — the approved render's own generator, not taste.
// ---------------------------------------------------------------------------------------------
//
// `docs/research/chapter2-land-idiom-2026-08-27/build_land.py` is the script that produced
// `land-combined-1948px.png`, the picture the owner approved. Its landform block is four lines:
//
//     BEACH = 3.1                                # shore band width, ground units
//     fall  = np.clip(shore / BEACH, 0.0, 1.0)
//     fall  = fall * fall * (3 - 2 * fall)       # smoothstep
//     z     = (...relief...) * fall
//     z    -= 0.62 * (1.0 - fall)                # the beach dips below the grass line
//
// with the comment: "THE LANDFORM. Broad relief that FALLS TO THE COAST -- an island whose ground
// is flat right up to a vertical cut has no shore, and a shore is most of what makes a coast
// read."
//
// ⚠ THE TWO SCALES AGREE, WHICH IS WHY THE CONSTANTS TRANSFER RATHER THAN NEEDING A CONVERSION.
// The generator sets `ASPECT = 233.8 / 135.1` from "the real island's ground footprint", and the
// shipped island measures 234 units across (`land-relief.ts`). Same ground units, same island.
// So 3.1 and 0.62 are used here as authored, and any deviation is an ARM rather than a re-tuning.
//
// ⚠⚠ AND THE ONE PLACE THE TWO GENUINELY DIFFER IS THE ARM VARIABLE. The reference's shore band
// is 3.1 units; the beach this map actually draws is {@link COAST_OUTSET} = 7 units wide, more
// than twice that. So the authored width would leave over half of our own beach flat. That is not
// a defect in either number — it is the question this increment puts to a picture, and it is the
// only thing the arms move.
//
// ---------------------------------------------------------------------------------------------
// ⚠⚠⚠ AND THE MEASUREMENT ANSWERED THAT QUESTION BY DISSOLVING IT. READ THIS BEFORE TUNING A WIDTH.
// ---------------------------------------------------------------------------------------------
//
// On the shipped island, measured rather than reasoned: **253 of 392 distinct ground vertices lie
// EXACTLY on the coast, and the nearest interior vertex is 8.66 ground units away.** There is a
// complete void between — not one vertex at any distance in (0, 8.66).
//
// So a band narrower than 8.66 units acts on the rim vertices ALONE, and **every width in that
// range delivers the bit-identical land.** The reference's authored 3.1 and this map's own 7 are
// indistinguishable here — not approximately, exactly: same moved count, same mean drop, same max
// drop, same rung flips. The smoothstep never gets a sample to curve through; only its endpoint
// value at distance 0 is ever read.
//
// ⚠ ON THE 35-ISLAND FOREST IT IS OVERWHELMING RATHER THAN ABSOLUTE, and the difference was caught
// by the instrument's own refusal rather than reasoned about. The coast wave is seeded per island,
// so 35 copies of one fixture wear 35 different coasts and each samples the rim-to-interior gap
// differently. Across all of them exactly **ONE vertex in 8884** falls between 3.1 and 7 units of
// its shore. Moving the band from the reference's width to ours therefore changes 0.011% of the
// ground — which is a stronger statement about the knob than exact identity on one island was.
//
// ⚠ WHY, AND IT IS STRUCTURAL RATHER THAN A PROPERTY OF THIS ISLAND. The reference generator
// displaces a **0.55-unit grid** (`GRID = 0.55`), so its 3.1-unit band spans about six samples.
// This ground is PARCELS about 16.5 units across whose only vertices are their corners, and 8.66
// is the lattice's own half-pitch. The mesh is roughly thirty times coarser than the surface the
// component was authored on.
//
// ⚠⚠ THE ARC ALREADY MADE THIS CALL ONCE, FOR A DIFFERENT FIELD, AND IT IS WORTH READING TOGETHER.
// For the shadow field it considered a per-vertex attribute and REJECTED it — "the mean cell pitch
// is ~16.5 ground units, coarser than the features it had to represent, so a vertex attribute
// smears" — and used a ground-space TEXTURE sampled in the fragment stage instead. The shore fall
// inherits that constraint and CANNOT inherit its remedy: a texture can shade a surface, it cannot
// move one, and this component's whole subject is where the ground SITS.
//
// ⚠ WHAT STILL LANDS, AND IT IS NOT NOTHING. The land does fall to its shore: 253 vertices drop to
// the waterline, mean 0.668 units and up to 4.208, and 208 of them change SHADE RUNG — a visible
// change in delivered colour, not merely a moved number. What it does not deliver is the falloff's
// SHAPE: the fall is linear across the first triangle because there is nothing between the rim and
// 8.66 units to curve through.
//
// ⚠ SO THE WIDTH IS NOT A TUNING KNOB BELOW 8.66 UNITS, AND A SESSION THAT REACHES FOR ONE IS
// ABOUT TO SPEND A DAY ON A PARAMETER THE MESH CANNOT READ. The remedy is an inset ring of
// vertices inside the band — exactly the move the coast clip's `subdivide` arm made for the
// island's OUTLINE, one dimension over — and it costs triangles, which this component currently
// does not. It is the next increment, not this one.

import { GROUND_COAST_OUTSET, type CoastPoint, coastalIsland, rimLoops } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { landGradient, landHeight } from './land-relief.js';
import type { InstanceDescriptor } from './world-to-3d.js';
import { buildEdgeGrid, nearestOnSegments } from './shore-grid.js';

/** The reference generator's own `BEACH` — the width of the band over which the land rises from
 *  the waterline to its full swell, in ground units. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const AUTHORED_SHORE_WIDTH = 3.1 * LAND_SCALE;

/** The reference generator's own beach dip — how far below the grass line the waterline sits, in
 *  ground units. Independent of the width there, and kept independent here so the arms move one
 *  variable. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const SHORE_DIP = 0.62 * LAND_SCALE;

/**
 * WHICH SHORE BAND THE SHIPPED MAP WEARS.
 *
 * `none` is the CONTROL rather than a fourth option — the map exactly as it drew before this
 * module — so every figure about what the shore fall moved has a denominator that is a picture
 * somebody actually took. The three real arms differ in the band WIDTH and in nothing else.
 */
export type ShoreArm = 'none' | 'authored' | 'beach' | 'shelf' | 'ring' | 'ring-pair';

/** Every arm, control first. A list rather than a union re-spelled at each call site, so an arm
 *  cannot be added to the type and quietly left out of the comparison. */
export const SHORE_ARMS: readonly ShoreArm[] = [
  'none',
  'authored',
  'beach',
  'shelf',
  'ring',
  'ring-pair',
];

/**
 * The band width each arm draws, in ground units.
 *
 *  - `none`     — no band at all. The unbounded field, verbatim.
 *  - `authored` — the reference generator's own 3.1.
 *  - `beach`    — {@link COAST_OUTSET}. The fall covers exactly the land the coast clip added.
 *  - `shelf`    — 16.5, the island's measured mean parcel diameter (`land-relief.ts`). The fall
 *                 reaches a whole parcel inland, so the shore is a shelf rather than a lip.
 *
 * ⚠⚠ `authored` AND `beach` DELIVER THE BIT-IDENTICAL LAND ON THIS MESH, AND THEY ARE BOTH KEPT
 * BECAUSE OF IT RATHER THAN IN SPITE OF IT. Both sit inside the 0-to-8.66-unit void described at
 * the top of this file, so both act on the rim vertices alone. Their equality IS the increment's
 * finding, and deleting either arm would delete the evidence for it — the comparison page shows
 * two pictures a reader can check are the same file.
 *
 * ⚠ `shelf` IS THE FIRST WIDTH THE MESH CAN ACTUALLY READ, and it is the arm that shows what the
 * width would buy if the mesh could carry it: 315 vertices moved against 253, 239 rung flips
 * against 208. It is NOT the shipped arm, and the reason is measured rather than aesthetic — see
 * {@link SHIPPED_SHORE}.
 *
 * ⚠⚠ `ring` AND `ring-pair` MOVE A DIFFERENT VARIABLE, AND THEIR WIDTH IS DELIBERATELY `beach`'s.
 * They are the answer to the void above rather than another guess at the width: both draw the
 * SAME 7-unit band as `beach` and differ from it only in that the mesh gains vertices INSIDE that
 * band for the falloff to bend through (`src/shore-ring.ts` owns which insets, and
 * `SHORE_ARM_INSETS` is the table). So `beach` is their control and the comparison is one thing
 * apart, exactly as `authored` against `beach` is one thing apart on the width axis.
 */
export const SHORE_ARM_WIDTH = {
  none: 0,
  authored: AUTHORED_SHORE_WIDTH,
  beach: GROUND_COAST_OUTSET,
  shelf: 16.5 * LAND_SCALE,
  ring: GROUND_COAST_OUTSET,
  'ring-pair': GROUND_COAST_OUTSET,
} satisfies Record<ShoreArm, number>;

/**
 * WHICH ARM SHIPS, AND THE REASON IS A MEASUREMENT RATHER THAN A PREFERENCE.
 *
 * `beach` and `authored` deliver the same land, so choosing between them is free and `beach` is
 * chosen for saying what it means: its width is this map's own `COAST_OUTSET`, so if the mesh ever
 * gains vertices inside the band (the next increment), the fall covers exactly the land the coast
 * added and stops.
 *
 * ⚠⚠ THE MESH DID GAIN THEM, AND THE SHIPPED ARM IS NOW `ring` — the SAME 7-unit band with one
 * inset chain at its midpoint (`src/shore-ring.ts`). Measured on the Mint box, 2026-09-01, against
 * `beach` on the shipped island: the mesh's departure from the analytic land inside the beach falls
 * from 0.420 to 0.286 ground units mean (−31.9%), 176,784 delivered pixels change at 8 px/unit —
 * MORE than widening the band from 7 to 16.5 changes (130,106) — for 2,264 → 2,962 triangles
 * (+30.8%) and one draw call still.
 *
 * ⚠⚠ AND `ring-pair` IS REFUSED FOR A MEASURED REASON RATHER THAN FOR ITS COST. It has the better
 * average by a distance (mean sag 0.138, −67.1%) and its frame cost is nowhere near a hardware
 * floor, which is the only ground ADR-0415 D1 leaves for rejecting detail. What it loses is
 * COVERAGE: its outer chain at 4.67 units folds on coasts that turn tighter than that, so it
 * divides 36 of the island's 53 coastal parcels against `ring`'s 47 (1,313 of 1,854 against 1,657
 * on the forest). A band delivered on 68% of the shore and absent on the rest reads as a coast that
 * keeps stopping, and a uniformly gentler shore is worth more than a sharper one with gaps.
 *
 * ⚠ THAT IS A PROPERTY OF THIS IMPLEMENTATION AND NOT OF TWO RINGS. The ladder degrades a chain's
 * DEPTH and not the ring COUNT, so a parcel that cannot carry the outer chain falls back to no
 * chain at all rather than to the inner one. Degrading in count would very likely make `ring-pair`
 * the better arm on both measures; it is a separate increment, named here so the refusal is
 * revisitable rather than final.
 *
 * ⚠⚠ `shelf` IS REFUSED FOR A MEASURED REASON AND NOT A LOOK. It lowers ground INLAND of the
 * pre-coast boundary — its highest vertex comes back at 3.871 against the control's 4.034 — and
 * that ground carries PROPS. `dressMapFromKit` still reads the mapper's own descriptors (the coast
 * clip's deliberate scoping, inherited here), so a tree stands where its parcel put it while the
 * ground beneath it moves. `beach` cannot do that: at `COAST_OUTSET` the fall reaches exactly the
 * pre-coast boundary and no further, where the falloff is 1 and the ground has not moved at all.
 */
export const SHIPPED_SHORE: ShoreArm = 'ring';

// ---------------------------------------------------------------------------
// The falloff itself
// ---------------------------------------------------------------------------

/**
 * THE FALLOFF — 0 at the waterline, 1 at `width` inland, smoothstep between.
 *
 * ⚠ A WIDTH OF ZERO IS THE CONTROL AND RETURNS 1 EVERYWHERE, which is what makes `none` the same
 * code path as every other arm rather than a branch around it. It is a reachable, ordinary answer
 * a test asks for directly, not a divide-by-zero guard.
 */
export function shoreFall(distance: number, width: number): number {
  // ⚠⚠ THE `width <= 0` EARLY-OUT THAT USED TO SIT HERE IS GONE, AND REMOVING THE LOWER CLAMP IS
  // WHAT MADE IT DEAD. A distance is never negative, so at width 0 the comparison below is
  // `distance >= 0`, which is always true, which returns 1 — the control's answer, reached by the
  // ordinary path. Two lines answering every input identically are two mutants no test can
  // separate; the second round of the rung reported exactly that and the fix is to keep one.
  //
  // ⚠ THERE IS NO LOWER CLAMP, AND ITS ABSENCE IS DELIBERATE. A `distance <= 0 ? 0 :` branch was
  // written here first and the mutation rung showed it was doing nothing: at distance 0 the
  // division already gives exactly 0, so the guard and the formula agree everywhere in the
  // function's domain and no test could ever separate them. It was a correctness guard's clothes
  // on an arithmetic identity. Deleted rather than annotated — the playbook's own preference.
  //
  // Stryker disable next-line EqualityOperator: EQUIVALENT — `>=` and `>` differ only at
  // `distance === width`, where the division gives exactly 1 and the branch returns 1. There is no
  // input that separates them, for the same reason `nearestOnSegment`'s clamp carries this note.
  const t = distance >= width ? 1 : distance / width;
  return t * t * (3 - 2 * t);
}

/**
 * The falloff's derivative with respect to DISTANCE — `s'(t)/width`, where `s'(t) = 6t(1-t)`.
 *
 * ⚠⚠ THIS IS WHAT KEEPS THE NORMAL HONEST, AND IT IS THE WHOLE RISK OF THIS FILE. `land-relief.ts`
 * warns that a caller supplying a height and a normal computed from different shapes gets "a
 * surface lit for a shape it does not have" — and on a BANDED material a slightly-wrong normal is
 * not a slightly-wrong colour, it is a different rung. The height below is scaled by
 * {@link shoreFall}, so the normal must carry the product rule's second term, and that term is
 * this function.
 *
 * ⚠ IT VANISHES AT BOTH ENDS, which is a property rather than an accident and is worth relying on
 * deliberately. `s'(0) = s'(1) = 0`, so the falloff contributes NOTHING to the slope exactly at
 * the waterline and exactly at the band's inner edge. Two consequences: the surface has no crease
 * where the band ends, and the distance field's own kink along the medial axis — where two coast
 * points are equidistant and the gradient genuinely jumps — is multiplied by a factor heading to
 * zero wherever that axis sits near the band's inner edge.
 */
export function shoreFallSlope(distance: number, width: number): number {
  // ⚠ THE `width <= 0` EARLY-OUT THAT USED TO SIT HERE IS GONE, AND THE LINE BELOW SUBSUMES IT.
  // The mutation rung found it unkillable, and the reason is that it was a DUPLICATE early-out
  // rather than a guard: at width 0 a zero distance is caught by `distance <= 0`, and any positive
  // distance is caught by `distance >= width`. Two branches answering the same input the same way
  // are two mutants no test can separate, so the fix is to keep one.
  //
  // ⚠ AND THE `distance <= 0` HALF WENT WITH IT, for the third time in the same shape. At distance
  // 0 the expression below is `6*0*(1-0)/width`, which is 0 — the branch's own answer — and at
  // width 0 the surviving comparison catches it. Three rounds of this rung on one file, and every
  // one of them found the same thing: a bound that the arithmetic already satisfies is not a guard.
  //
  // Stryker disable next-line EqualityOperator: EQUIVALENT — at `distance === width` the
  // derivative `6t(1-t)/width` is exactly 0, which is what the branch returns, so `>` and `>=` are
  // indistinguishable at the bound by construction. Same note `nearestOnSegment` carries.
  if (distance >= width) return 0;
  const t = distance / width;
  return (6 * t * (1 - t)) / width;
}

// ---------------------------------------------------------------------------
// The distance field
// ---------------------------------------------------------------------------

/** Where a point stands relative to the shore: how far inland, and which way inland is. */
export interface ShoreSample {
  /** Ground units to the nearest shore, CAPPED at the field's band width — beyond the band the
   *  exact distance cannot change any answer, so it is not computed. */
  distance: number;
  /** The unit gradient of the distance field: the direction in which `distance` grows. Zero where
   *  the distance is capped, and zero exactly on the shore, where it is undefined and where
   *  {@link shoreFallSlope} is zero anyway. */
  gx: number;
  gz: number;
}

/** A coast loop with its bounding box precomputed — the unit {@link boxDistance} prunes against.
 *  Exported alongside it because a function you can test needs an argument you can build. */
export interface LoopBounds {
  points: readonly CoastPoint[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * How far a point sits outside a box — 0 when inside it. The prune's own arithmetic, and a lower
 * bound on the distance to anything the box contains, which is what makes skipping exact.
 *
 * ⚠ EXPORTED FOR ITS OWN TESTS, AND THE MUTATION RUNG IS WHY. It is a pure cost OPTIMISATION: it
 * changes which loops the sweep bothers to walk and never which answer comes back, so every mutant
 * in it survives a test that can only see `sample`'s output. That is the playbook's
 * "an optimisation bound cannot be seen from output it does not change".
 *
 * ⚠ AND DELETING IT IS THE WRONG FIX HERE, which the playbook also warns about — the coast clip
 * removed an "unkillable optimisation" once and turned a caught-as-wrong-answer mutant into a
 * TIMEOUT. Without this prune the forest sweep walks 35 loops x 208 segments for every one of
 * 30,240 vertices. So it stays, and it is tested DIRECTLY instead.
 */
export function boxDistance(b: LoopBounds, x: number, z: number): number {
  // Stryker disable next-line EqualityOperator: EQUIVALENT — ON a face the gap is exactly 0, which
  // is what the else-branch returns, so `<` / `<=` and `>` / `>=` cannot be separated at either
  // bound. A point on the boundary is inside the box for this function's purpose, both ways.
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  // Stryker disable next-line EqualityOperator: EQUIVALENT — as above, on the other axis.
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.hypot(dx, dz);
}

/** A loop's bounding box. ⚠ Exported for the same reason {@link boxDistance} is: it feeds a prune,
 *  so its own arithmetic never reaches an answer a caller can observe. */
export function boundsOf(points: readonly CoastPoint[]): LoopBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  // Stryker disable EqualityOperator: EQUIVALENT — a running extremum assigns the same value
  // whether or not it re-assigns on a tie, so `<` / `<=` and `>` / `>=` are indistinguishable on
  // every input. The mutants that are NOT equivalent here — the initial `Infinity` sentinels and
  // the comparison directions — are killed by `boundsOf`'s own tests.
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  // Stryker restore EqualityOperator
  return { points, minX, maxX, minZ, maxZ };
}

/** The shore, as the thing a relief field asks it. */
export interface ShoreFieldReader {
  /** The band width this field was built for, in ground units. */
  readonly width: number;
  /** How many coast loops it holds — one per island that has a shore. */
  readonly loops: number;
  sample(x: number, z: number): ShoreSample;
}

/**
 * THE SHORE OF EVERY ISLAND IN A CLIPPED PARCEL SET.
 *
 * ⚠⚠ IT MUST BE HANDED THE CLIPPED DESCRIPTORS, AND THE ORDER IS THE POINT. After
 * `clipToCoast` the boundary of the mesh IS the coast — the parcels were rewritten to end on it —
 * so the distance to the mesh's own rim is the distance to the shore, with no second coast to keep
 * in step. Handed the PRE-clip descriptors it would measure to the hex silhouette and put the
 * waterline a beach's width inland of the water.
 *
 * ⚠ THE NEAREST LOOP IS ALWAYS THE CONTAINING ISLAND'S, so taking a global minimum over every
 * loop is correct rather than merely convenient — and the reason is geometric, not a convention.
 * A point inside island A at distance `d` from A's rim must cross that rim, then the open sea,
 * to reach B's, so its distance to any other island's shore is at least `d` plus the gap. The
 * coast clip's own suite asserts the antecedent ("a coast never reaches into a neighbouring
 * island"), so islands do not overlap and the argument holds on the map as drawn.
 */
export function shoreField(
  cells: readonly InstanceDescriptor[],
  width: number,
): ShoreFieldReader {
  // ⚠ ONE PASS, NOT filter-THEN-map, AND THE MUTATION RUNG IS WHY. The two-step form ended
  // `.map((d) => (d.points ?? []). …)`, and that `?? []` is UNREACHABLE: `coastalIsland` already
  // returns null for a ringless descriptor, so the filter has removed every one before the map
  // runs. The rung reported it as the file's only NO-COVERAGE mutant, which is what dead code
  // looks like from outside. Reading `points` once and skipping on it removes the fallback rather
  // than leaving a branch no input can take.
  const rings: CoastPoint[][] = [];
  for (const d of cells) {
    if (coastalIsland(d) === null) continue;
    // ⚠ THE NON-NULL ASSERTION IS THE HOUSE PRECEDENT, not a shortcut. `coastalIsland` refuses a
    // descriptor with no ring, so `points` is present on every survivor — and `clipToCoast` writes
    // `ringOf(d.points!)` two lines after the same call for the same reason. A second
    // `points === undefined` check here reads as defensive and is UNREACHABLE, which the mutation
    // rung reported twice: first as the file's only NO-COVERAGE mutant, then as a survivor.
    rings.push(d.points!.map((p) => ({ x: p.x, z: p.z })));
  }
  const bounds = rimLoops(rings).map(boundsOf);
  const grid = buildEdgeGrid(rimLoops(rings), width);
  return {
    width,
    loops: bounds.length,
    sample(x: number, z: number): ShoreSample {
      // ⚠⚠ THE WALK IS `nearestOnSegments` VERBATIM — the far-field short-circuit, the 3x3
      // candidate scan and the clamped projection all live there now, so the worn path's OPEN
      // polyline field (`trail-wear.ts`) is the SAME walk over a differently-flattened edge set.
      // The cap is this field's width, which is exactly the grid's cell, so the short-circuit's
      // proof ({@link edgeGridFarField}) holds here by construction. This is what replaced a walk
      // over every loop's whole ring, which had made the packed shore field cost 26 s over the
      // forest; on the shore the gradient it returns feeds `shoreFallSlope`, which is zero exactly
      // where the gradient is undefined.
      return nearestOnSegments(grid, x, z, width);
    },
  };
}

// ---------------------------------------------------------------------------
// The relief field the ground mesh asks for
// ---------------------------------------------------------------------------

/** A height and a unit normal, structurally what `cellGroundGeometry`'s `GroundRelief` wants.
 *  ⚠ NO IMPORT EITHER WAY, for the same reason `land-relief.ts` gives: the geometry module stays
 *  arithmetic a test can drive with any field it likes. */
export interface ShoreRelief {
  height: (x: number, z: number) => number;
  normal: (x: number, z: number) => ShoreNormal;
}

/** A unit surface normal in ground space — the shape {@link ShoreRelief.normal} returns, named so
 *  the annotation is a contract rather than an anonymous object type re-spelled at each site. */
export interface ShoreNormal {
  x: number;
  y: number;
  z: number;
}

/**
 * THE LAND, FALLING TO ITS SHORE.
 *
 * The height is the reference generator's own two lines, kept in its own form:
 *
 *     z = H * f - D * (1 - f)
 *
 * ⚠⚠ AND KEEPING ITS FORM IS LOAD-BEARING RATHER THAN RESPECTFUL — THE OBVIOUS SIMPLIFICATION IS
 * WRONG, MEASURABLY, AND IT WAS WRITTEN AND CAUGHT HERE. `H * f - D * (1 - f)` is algebraically
 * `(H + D) * f - D`, and the second form is tidier and reads better. It is also not the same
 * function in floating point: at `f = 1` it computes `H + 0.62 - 0.62`, which round-trips a
 * double through a magnitude it does not have and comes back ONE ULP OFF —
 * `0.5928485904943256` where the land field says `0.5928485904943255`. The first form computes
 * `H * 1 - D * 0`, both operations exact, and returns `H` itself.
 *
 * That is the difference between a property and nearly a property. **Inland of the band this
 * field IS `landRelief`, to the last bit** — not approximately and not within a tolerance — so
 * the shore fall is a strict extension of the land already shipping, and the suite asks for that
 * identity with `assert.equal`. A session that meets that assertion failing by an ulp and reaches
 * for a tolerance has changed the claim rather than relaxed it; the fix is this line's shape.
 *
 * At `f = 0` the same form is exact for the same reason: `H * 0 - D * 1` is `-D` on the nose.
 *
 * At `f = 0` it is `-D`: the waterline sits {@link SHORE_DIP} below the grass line, which is the
 * half of the reference's landform that a pure scaling would have dropped. Scaling alone leaves
 * the beach at exactly the height of flat ground, and flat ground is what the generator's comment
 * says has no shore.
 *
 * ⚠⚠ THE NORMAL CARRIES THE PRODUCT RULE, AND THAT IS THE ONLY DIFFICULT LINE IN THIS FILE.
 *
 *     dz/dx = H_x * f + (H + D) * f_x     with     f_x = (df/dd) * gx
 *
 * The second term is the one a transcription drops, and dropping it is invisible in every summary
 * a reader reaches for first — right heights, right bounds, right silhouette, a picture that is
 * recognisably an island — while the ground is lit for the shape it had BEFORE the shore was cut.
 * On a banded material that is a different rung, which is a different delivered colour. The suite
 * holds it to a finite difference of the height this same object returns, which is a conservation
 * law rather than a restatement: the two are computed by entirely different routes.
 */
export function shoreRelief(
  cells: readonly InstanceDescriptor[],
  arm: ShoreArm = SHIPPED_SHORE,
  dip: number = SHORE_DIP,
): ShoreRelief {
  const width = SHORE_ARM_WIDTH[arm];
  const field = shoreField(cells, width);
  const at = (x: number, z: number) => {
    const s = field.sample(x, z);
    return { s, f: shoreFall(s.distance, width) };
  };
  return {
    height(x: number, z: number): number {
      const { f } = at(x, z);
      return landHeight(x, z) * f - dip * (1 - f);
    },
    normal(x: number, z: number): ShoreNormal {
      const { s, f } = at(x, z);
      const g = landGradient(x, z);
      const scale = (landHeight(x, z) + dip) * shoreFallSlope(s.distance, width);
      const dx = g.dx * f + scale * s.gx;
      const dz = g.dz * f + scale * s.gz;
      const len = Math.hypot(dx, 1, dz);
      return { x: -dx / len, y: 1 / len, z: -dz / len };
    },
  };
}
