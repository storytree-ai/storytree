// cover-dressing.ts — THE GROUND COVER: the bushes, grass tufts and flowers a healthy island
// wears, scattered after everything that reports something has been stood. Pure, browser-free,
// node:test-provable.
//
// ⚠⚠ WHAT THIS IS. The owner stamped a render as the goal
// (`docs/research/chapter2-land-idiom-2026-08-27/land-combined-1948px.png`, ADR-0489 D3's
// look-fence), and that render is not only trees: `build_land.py`'s `scatter()` (`:1087-1090`)
// sprinkles 70 undergrowth objects, 120 grass clumps and 26 flowers over the land for every
// thirteen stands of pines, from the same bought kit. The research README's own finding is that the
// approved island's colour content is almost ENTIRELY its props — so the remaining contrast the
// canopy increment left open (MICRO 1.81 against the approved render's 2.54, 43 colour families
// against 36) is located HERE, in the cover, and this module is what closes it.
//
// ⚠⚠ AND SINCE ADR-0518 IT IS THE WHOLE LOOK. The grove pines that stood beside the cover until
// 2026-09-05 are retired — the owner read them as capabilities, and ruled *"1 tree per a
// capability it needs to look good not like a forest"* — so an island now stands one tree per
// capability (3–6 for most stories) over a footprint ADR-0517 tripled, and what carries the island
// between those trees is THIS layer. ADR-0518 D2 names it the instrument and expects it scaled UP,
// which is why the count now has a ladder of its own ({@link COVER_DENSITY_RUNGS}) beside the size
// ladder that already shipped. The sparseness is the constraint, not the goal.
//
// ⚠⚠ AND WHAT IT IS NOT: NOTHING HERE REPORTS ANYTHING. Every prop this module stands wears a
// `dressing` role (`KIT_ROLE_CLASS`), and a dressing role has no route from any capability's state
// — `stateForm` cannot reach one, which `kit-vocabulary.test.ts` asserts over every state the
// vocabulary and the store can produce. So the map's claim is untouched by everything below: every
// tree on a parcel is a capability's own (ADR-0518 D1 — no dressing role shares the tree's form at
// any scale), a bare trunk is still `unhealthy` alone, and the tall red criterion marker is still
// the only red flower on the map and the only flower at its size (the asset carries no other red
// flower, and the widest patch this can ever draw is 1.23 ground units against the marker's 4).
//
// ⚠ IT GROWS ON GREEN ISLANDS AND NOWHERE ELSE — the gate every dressing layer on this arc keeps,
// by IMPORT from `dressing-ground.ts` (ADR-0492 D1 is the arc's standing rule: an added layer is
// scoped to islands whose every cell is `healthy`, so that what it adds is still a reading rather
// than a decoration). `unknown` grows nothing, and a mixed island fails CLOSED.
//
// ⚠ THE EXCLUSIONS ARE THE GROUND'S, ALSO BY IMPORT. Nothing stands on the beach band the sand
// layer draws or on the worn path the wear layer paints, through the SAME `shoreField` and
// `wearField` the ground samples per fragment. The recipe insets its cover from the coast by less
// than its stands (`margin` 0.6–1.0 against 3.0), but our beach is the SHIPPED sand band at 9 units
// and grass growing over drawn sand is a defect the recipe never had to consider, so the row's own
// rule — "never on the beach band or the worn path" — is what binds.
//
// ⚠⚠ GROUND COVER CASTS ITS SHADOW, SINCE 2026-09-06 — a decision REVERSED, and the reversal is
// recorded where it is enforced: `ground-casters.ts`'s `COVER_CASTS`. The refusal that stood from
// 2026-09-04 rested on two halves, and both moved under it. (a) COST was measured on a 234-unit
// island carrying a grove; ADR-0518 retired the grove and ADR-0520 shrank the island, so the cover
// is ~100 low domes per island rather than ~650 beside sixty pines, and the whole map's stamp is
// measured in `docs/research/chapter2-cast-shadows-2026-09-06/report.txt`. (b) THE LADDER had one
// occlusion rung and thresholded the field into hard dots; the material now renders a soft rung as
// well as a full one (`shadow-rung.ts`'s `SHADOW_EDGE`), so a bush's dome arrives as the small
// soft-edged pool the approved render puts under every bush. Every cover role casts its own form
// (`ROLE_SILHOUETTE`, a low dome), never the cylinder a tree used to.
//
// ⚠ DETERMINISTIC, AND SEEDED PER ISLAND ON ITS OWN KEY. `Math.random` is forbidden on this surface
// (ADR-0380 D6 fence 2). The seed is `islandSeed(`${island}|cover`)` rather than `islandSeed(island)`:
// the key was chosen when the grove consumed the bare island seed, so the cover's draws were not
// the grove's re-read (an island seeded once and consumed twice would have put the first bush
// wherever the first stand went, on every island, forever). The grove is gone; the key stays,
// because changing it would re-scatter every carpet on the map for no reason a picture could show.

import {
  RECIPE_ISLAND_AREA,
  cellAt,
  cellsArea,
  cellsBounds,
  dressingEligible,
  type DressingExclusion,
  type Stream,
} from './dressing-ground.js';
import { islandSeed } from './island-path.js';
import {
  COVER_CAP_ID,
  COVER_SCALE,
  KIT_ROLE_ASSEMBLIES,
  propStream,
  samplePoint,
  type KitAssembly,
  type KitPlacement,
  type KitRole,
} from './kit-vocabulary.js';
import { landHeight } from './land-relief.js';
import { indices } from './land-shadow.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';

/**
 * THE RECIPE'S OWN COUNTS, per recipe-island of ground — `build_land.py:1036`,
 * `forest: under=70, grass=120, flower=26`, transcribed and not tuned.
 *
 * ⚠ THE ORDER IS THE RECIPE'S SCATTER ORDER (`:1087-1089`) and it is stated here rather than
 * inherited from `DRESSING_ROLES`, because that list is the VOCABULARY's declaration order and
 * nothing holds the two together on its own. {@link COVER_ROLES} is the order props are placed in,
 * and `cover-dressing.test.ts` holds it to the vocabulary as a SET so a role added to one and not
 * the other is a loud mismatch rather than a role that silently never grows.
 */
export const COVER_RECIPE_COUNTS = {
  bush: 70,
  tuft: 120,
  flowerPatch: 26,
} as const satisfies Record<'bush' | 'tuft' | 'flowerPatch', number>;

/** The order the recipe sprinkles them in — undergrowth, then grass, then flowers. */
export const COVER_ROLES: readonly KitRole[] = ['bush', 'tuft', 'flowerPatch'];

/**
 * ⚠⚠ THE SIZE LADDER — a multiple of the recipe's own delivered prop width, applied to every
 * ground-cover placement's scale. Rendered and picked on 2026-09-04; the constant it settled is
 * {@link COVER_SIZE}.
 *
 * ⚠⚠ WHY SIZE HAD TO BE LADDERED FIRST, MEASURED RATHER THAN CHOSEN. The recipe's counts and sizes
 * were both ported literally first, and the result was INVISIBLE: on the shipped map at 8 px/unit,
 * doubling the COUNT moved 743 px past ADR-0490 D6's 20/255 bar and tripling it moved 1,130 — on
 * an island where the canopy itself moved 194,440. The eye agreed with the number: at rung 1 the
 * props are dark-green flecks about 8 px across on dark-green ground.
 *
 * THE CAUSE IS A SCALE MISMATCH THE PORT INHERITED, and it is worth writing down because the same
 * trap is waiting for every other transcription off `build_land.py`. The recipe's island is
 * **93.8 ground units wide** — thirteen stands over a 22-hex cluster of `HEX_R = 7.0`, x-stretched
 * by `ASPECT / 1.42` — and its own comment says so: *"circumradius, pack units (a pine is ~4
 * tall)"*. THIS map's island is **234 units wide** in the placement basis, i.e. **2.49x** the
 * recipe's, and its `tree` role is 18 units against the recipe pine's 4.0, i.e. **4.50x**. So every
 * SIGNAL on this map was already scaled up when it crossed, and the ground cover was the one thing
 * transcribed at its literal size — which is
 * `a-faithful-port-under-a-rule-the-source-lacks-under-delivers` exactly: faithful to the source,
 * and wrong against a map that is not the source's size.
 *
 * THE RUNGS ARE THEREFORE THE TWO DEFENSIBLE SCALES AND THE LITERAL ONE:
 *   1     `build_land.py` transcribed — the arm that SHOWS why the literal port is not shipped
 *   2.5   the ISLAND's own linear scale (234 / 93.8 = 2.49) — the same fraction of the island
 *         under cover as the approved render has
 *   4.5   the TREES' own scale (18 / 4.004 = 4.50) — the same proportion to the pines as the
 *         approved render has, which is the ratio a viewer actually reads
 *
 * ⚠ THE BOLDEST RUNG IS WHAT THE CRITERION MARKER'S DISTINCTNESS IS DERIVED AGAINST — see
 * `KIT_ROLE_SIZE.flowerPatch`, whose width is computed BACKWARDS from `4.5` so that no rung of this
 * ladder can put a ground-cover flower at half the marker's width. Adding a bolder rung therefore
 * requires re-deriving that width, and `kit-vocabulary.test.ts` fails if it is not.
 */
export const COVER_SIZE_RUNGS = [1, 2.5, 4.5] as const;

/**
 * THE SIZE RUNG THE SHIPPED MAP WEARS — the boldest rendered, per ADR-0503 D1/D3.
 *
 * ⚠ THE LADDER, MEASURED ON THE RTX 2060 2026-09-04 (`docs/research/chapter2-ground-cover-2026-09-04/`),
 * one island at 8 px/unit, the SAME 216 props at each rung, against the canopy that shipped then:
 *
 *   rung  widest cover prop  px moved >20/255 vs today  prop px  MICRO   ms/frame (fitted forest)
 *   1     1.38 units                              558  166,361   2.65   1.6199
 *   2.5   3.45 units                            6,780  175,233   2.95   1.6319
 *   4.5   6.20 units                           25,620  200,132   3.78   1.6342   ← ships
 *
 * Rung 1 IS `build_land.py` transcribed, and it is the arm that shows why the literal port is not
 * shipped: 558 pixels on an island where the canopy moved 194,440. What it proved is not that the
 * scatter was broken — it is that a prop about eight delivered pixels across, dark green on
 * dark-green ground, is not in the picture however many of them stand.
 *
 * ⚠ A SCALE-BACK IS FREE ON THE FRAME AND COSTS ONLY THE LOOK. The three rungs draw IDENTICAL
 * geometry and differ only in each prop's scale, so their frame times sit inside the runs' own
 * spread. `cover-2.5` is the rung whose widest bush (34% of a pine's footprint) matches the
 * approved render's own proportion; 4.5 (61%) is bolder, which is what D1 asks for. Moving the pick
 * is THIS constant and `SHIPPED_COVER_ARM` in `harness/shipped-cover-scene.ts`, two constants, and
 * no re-measurement.
 */
export const COVER_SIZE = 4.5;

/**
 * ⚠⚠ THE COUNT LADDER — how many of the recipe's props an island wears, as a multiple of the
 * recipe's own counts scaled to the island's area. The SECOND knob, and the one ADR-0518 D2 asks
 * to be scaled UP now that nothing tree-shaped stands beside the cover.
 *
 * ⚠ WHY THE COUNT WAS NOT LADDERED BEFORE, AND WHY IT IS NOW. On 2026-09-04 the size ladder was
 * rendered with the count held at the recipe's own, because laddering both at once hands the owner
 * a grid to read rather than a row, and the row that increment owed was `build_land.py`'s own
 * scatter at a different scale. The size is settled ({@link COVER_SIZE}); this ladder moves the
 * count at that size, so every rung differs from its neighbour in exactly one thing again.
 *
 * ⚠ THE RUNGS ARE MULTIPLES OF THE RECIPE, so rung 1 is still `build_land.py`'s scatter and every
 * rung above it is that scatter repeated — the same three roles in the same proportion, denser —
 * and the rung below it is the scatter thinned. Rung 1 on the fixture island is 216 props (70 /
 * 120 / 26 over exactly 1.0 recipe-islands of ground, the recipe island being the fixture at the
 * shipped ratio). The ladder gained its half rung and lost x4 on 2026-09-05, when the
 * land-per-capability ratio shrank the island under the same cover.
 */
export const COVER_DENSITY_RUNGS = [0.5, 1, 2, 3] as const;

/** The rung that IS `build_land.py`'s own scatter — 70 / 120 / 26 per recipe island of ground. Named
 *  so a page that holds the count at the recipe's own reads it by name rather than by position on a
 *  ladder that now reaches below it. */
export const COVER_RECIPE_DENSITY = 1;

/**
 * THE COUNT RUNG THE SHIPPED MAP WEARS — picked on the LOOK, on the sheet the land-ratio page
 * rendered on the RTX 2060 2026-09-05 (`docs/research/chapter2-land-per-capability-2026-09-05/`),
 * under ADR-0489 D3's outcome test and ADR-0518 D2.
 *
 * ⚠ RE-JUDGED ON THE CORRECTLY-SIZED ISLAND, AND IT WENT DOWN — from the x3 PR #1825 shipped to
 * x0.5. That x3 filled an island seven times too large for its trees (`land-per-capability.ts`);
 * the recipe's own count on the recipe island as this map now draws it (216 props on 88 × 51
 * units, at a prop size 4.5× the recipe's relative to the island) carpets the ground so the
 * story's state stops reading through it, and x3 buries it outright. Half the recipe's count
 * dresses the island evenly while the ground colour — what the land is FOR (ADR-0475 D2) — still
 * reads, which is the outcome test. x1 is the next rung up if the owner wants it bolder; every
 * rung of {@link COVER_DENSITY_RUNGS} is on that sheet, and a scale-up is this constant alone.
 */
export const COVER_DENSITY = 0.5;

/** How many points a prop is offered before it is given up — the recipe's own `for _ in range(400)`
 *  (`build_land.py:1052`). Dropping a prop is the recipe's answer and is honest here for the reason
 *  it is dishonest for a capability's tree: ground cover reports no unit of work. */
export const COVER_TRIES = 400;

/** May this island wear ground cover? THE ARC'S GATE, by import: ADR-0492 D1 scopes every added
 *  layer to islands whose every cell is `healthy`. A mixed island fails closed, and `unknown` wears
 *  nothing. */
export const coverEligible = dressingEligible;

// ---------------------------------------------------------------- how many

/**
 * THIS ISLAND'S GROUND AS A MULTIPLE OF THE RECIPE'S — the one number all three counts scale by.
 *
 * ⚠⚠ AND IT REFUSES A RUNAWAY: `indices(n)` MATERIALISES the count, so a corrupted area does not
 * produce a wrong picture, it produces a hung tab with no message — and `check:mutation-diff`
 * scores a hang as UNPROVEN, credited to nobody. The ceiling is read off the island's BOUNDING BOX,
 * which a simple ring's area can never exceed, so it can never sit below an honest share however
 * large the island; a hex island's box exceeds its area by a further 20–40%, so a real island has
 * roughly 1.5x of headroom to the refusal.
 */
export function coverAreaShare(cells: readonly LayoutCell[], recipeIslandArea: number = RECIPE_ISLAND_AREA): number {
  const share = cellsArea(cells) / recipeIslandArea;
  const ceiling = boxShare(cells, recipeIslandArea);
  if (!Number.isFinite(share) || share > ceiling) {
    throw new Error(
      `cover-dressing: an island asking for ${share} recipe-islands of ground cover, on a bounding ` +
        `box that could hold at most ${ceiling}. That is an arithmetic fault in the area, not a ` +
        'large island — the count is materialised, so this would hang rather than draw.',
    );
  }
  return share;
}

/** The island's BOUNDING BOX as a multiple of the recipe's island — the ceiling above, computed
 *  from `Math.min`/`Math.max` over the same points so the shoelace arithmetic the guard exists to
 *  catch cannot corrupt the ceiling with it. */
export function boxShare(cells: readonly LayoutCell[], recipeIslandArea: number = RECIPE_ISLAND_AREA): number {
  const box = cellsBounds(cells);
  return ((box.maxX - box.minX) * (box.maxZ - box.minZ)) / recipeIslandArea;
}

/** How many of this role this island wears: the recipe's count, in proportion to area, times the
 *  density rung ({@link COVER_DENSITY}, which is what a caller omitting the argument gets). */
export function coverCount(
  role: KitRole,
  cells: readonly LayoutCell[],
  density: number = COVER_DENSITY,
  recipeIslandArea: number = RECIPE_ISLAND_AREA,
): number {
  const recipe = COVER_RECIPE_COUNTS[role as keyof typeof COVER_RECIPE_COUNTS];
  if (recipe === undefined) {
    throw new Error(
      `cover-dressing: ${role} is not a ground-cover role — the recipe declares a count for the ` +
        `three dressing roles only (${COVER_ROLES.join(', ')})`,
    );
  }
  const count = Math.round(recipe * density * coverAreaShare(cells, recipeIslandArea));
  // ⚠ REFUSED PAST AN ABSOLUTE CAP, for the same reason `coverAreaShare` refuses a runaway share:
  // the count is materialised, so an inverted recipe basis (the recipe island divided where it
  // should multiply) would hang the tab rather than draw a wrong picture — and the mutation rung
  // scores a hang as UNPROVEN, credited to nobody. The densest island this map draws wears a few
  // hundred of a role; a count past this is arithmetic, not an island.
  if (count > COVER_COUNT_CAP) {
    throw new Error(
      `cover-dressing: ${count} ${role} on one island (${density}× the recipe's ${recipe} over ${coverAreaShare(cells, recipeIslandArea)} recipe-islands) is past ${COVER_COUNT_CAP} — the recipe basis has inverted`,
    );
  }
  return count;
}

/** The most of one role an island may wear — see the refusal in {@link coverCount}. */
export const COVER_COUNT_CAP = 20_000;

// ---------------------------------------------------------------- the draws

/**
 * One prop's scale: uniform over its role's own renormalised recipe range ({@link COVER_SCALE}),
 * times the size rung.
 *
 * ⚠ THE RUNG MULTIPLIES THE PLACEMENT'S SCALE RATHER THAN THE ROLE'S DECLARED WIDTH. That keeps
 * `KIT_ROLE_SIZE` and the two frozen tables describing the ROLE — what the vocabulary asks the
 * asset for — while the rung stays a per-placement look the comparison page can vary without
 * re-freezing anything.
 */
export function coverScale(role: KitRole, rand: Stream, size: number = COVER_SIZE): number {
  const range = COVER_SCALE[role as keyof typeof COVER_SCALE];
  if (range === undefined) throw new Error(`cover-dressing: ${role} declares no scale range`);
  return (range.min + rand() * (range.max - range.min)) * size;
}

/** One prop's yaw, uniform over a full turn — the recipe's `uniform(0, tau)`. */
export function coverYaw(rand: Stream): number {
  return rand() * Math.PI * 2;
}

/** One prop's assembly — the recipe's `rng.choice(names)` over the shapes serving its role. */
export function coverAssembly(role: KitRole, rand: Stream): KitAssembly {
  const choices = KIT_ROLE_ASSEMBLIES[role];
  return choices[Math.floor(rand() * choices.length)]!;
}

/**
 * WHERE ONE PROP STANDS: sampled points until one is inside a parcel AND clear of the beach and the
 * path, or `null` after {@link COVER_TRIES} — the recipe's `rand_point`, which returns `None` and
 * lets the caller skip the prop.
 *
 * ⚠ NO OCCUPANCY, AND THAT IS THE RECIPE'S RULE RATHER THAN A RELAXATION. `sprinkle`
 * (`build_land.py:1082-1090`) tests a point for `inside` and `wear` and nothing else — no clearance
 * from a tree, none from other cover. Undergrowth grows under and around what stands on the land;
 * that is what makes it ground COVER rather than a fourth kind of object competing for floor, and
 * `clearanceFactor` states the same thing from the detector's side so `dressingOverlaps` does not
 * report a bush at a pine's foot as a defect.
 */
export function coverPoint(
  parcels: readonly LayoutCell[],
  rand: Stream,
  exclusion: DressingExclusion,
): GPoint | null {
  for (const _try of indices(COVER_TRIES)) {
    const p = samplePoint(parcels, rand);
    if (p === null) continue;
    if (cellAt(parcels, p) === null) continue;
    if (!exclusion.clear(p.x, p.z)) continue;
    return p;
  }
  return null;
}

// ---------------------------------------------------------------- the dressing

export interface CoverDressingOptions {
  /** The island's id — the seed, so two islands of one shape wear two different carpets. */
  island: string;
  /** The island's ground cells in the placement basis — `parcelCellsFrom` on the shipped path. */
  cells: readonly LayoutCell[];
  /** The relief amplitude the ground is built at, so cover sits ON the land. */
  relief: number;
  /** Where cover may not stand — `islandExclusion` on the shipped path: the clipped coast's beach
   *  band and the trail docks' worn paths, the same fields the ground samples. */
  exclusion: DressingExclusion;
  /** Which rung of {@link COVER_DENSITY_RUNGS} this island's count is drawn at. Omitted is
   *  {@link COVER_DENSITY}, the shipped pick — the comparison page's ladder arms are what pass it. */
  density?: number;
  /** Which rung of {@link COVER_SIZE_RUNGS} this island's props are drawn at. Omitted is
   *  {@link COVER_SIZE}, the shipped pick — the comparison page's ladder arms are what pass it. */
  size?: number;
  /** The recipe island's area the counts are stated per, in this island's placement units.
   *  Omitted is {@link RECIPE_ISLAND_AREA} — the recipe island THROUGH the shipped mapper. An
   *  INSTRUMENT'S option: a comparison page's control arm standing the map as it shipped at a
   *  PREVIOUS island size passes that size's own recipe area, so the control wears the count it
   *  wore rather than seven times it (`land-per-capability.ts` moved the basis on 2026-09-05). */
  recipeIslandArea?: number;
}

/**
 * SCATTER THE ISLAND'S GROUND COVER — the recipe's 70 bushes, 120 tufts and 26 flower patches per
 * recipe-island of area, at the density rung, every one clear of the beach and the path; or
 * nothing at all on an island that is not healthy.
 *
 * ⚠ ONE STREAM FOR THE WHOLE ISLAND, consumed in the recipe's own scatter order, so a prop's
 * position depends on every prop drawn before it — which is what makes two builds of one island
 * identical and two islands of one shape different. Re-seeding per role would make the three
 * carpets three views of one sequence.
 *
 * ⚠ NO `standing` ARGUMENT. Cover keeps no clearance from anything, so what already stands on the
 * island cannot change where a bush goes — and taking the list in order to ignore it would look
 * like rigour and be the opposite.
 */
export function dressCover(opts: CoverDressingOptions): KitPlacement[] {
  if (!coverEligible(opts.cells)) return [];
  const parcels = opts.cells.filter(hasParcel);
  const rand = propStream(islandSeed(`${opts.island}|cover`));
  const density = opts.density ?? COVER_DENSITY;
  const size = opts.size ?? COVER_SIZE;
  const out: KitPlacement[] = [];

  for (const role of COVER_ROLES) {
    for (const _prop of indices(coverCount(role, parcels, density, opts.recipeIslandArea ?? RECIPE_ISLAND_AREA))) {
      const at = coverPoint(parcels, rand, opts.exclusion);
      if (at === null) continue;
      const scale = coverScale(role, rand, size);
      const yaw = coverYaw(rand);
      const assembly = coverAssembly(role, rand);
      out.push({
        role,
        assembly,
        capId: COVER_CAP_ID,
        // ⚠ NEVER A TINT. A tint is a capability's state worn on a crown; ground cover holds no
        // capability, and a tinted bush would be the map reporting a state through its scenery.
        tint: null,
        at,
        y: landHeight(at.x, at.z, opts.relief),
        yaw,
        scale,
      });
    }
  }
  return out;
}

/** A cell some capability owns — the ground cover may stand on. A cell carrying no parcel is ground
 *  the map does not attribute, and dressing it would decorate land the story does not claim. */
function hasParcel(c: LayoutCell): boolean {
  return c.parcel !== undefined;
}
