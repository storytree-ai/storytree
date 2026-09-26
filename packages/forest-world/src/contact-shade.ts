// contact-shade.ts — CONTACT DARKENING (ambient occlusion), in ground space. Pure,
// browser-free, node:test-provable.
//
// ⚠ IT LIVES IN `src/` BECAUSE IT HAS CROSSED (2026-08-30), moved whole from
// `harness/contact-shade.ts`, which now re-exports it so the experiment and the product cannot
// draw two different pools.
//
// WHY THIS EXISTS AT ALL. The reference board (`docs/research/chapter2-reference-board-
// 2026-08-20/`) named ten mechanisms separating the owner's references from our island and
// ranked contact darkening FIRST: *"Every object in all three references darkens the ground
// where it meets it... it is doing most of the work of making things look placed rather than
// pasted."* It is also the cheapest of the levers, because it is a DARKENING — it lands on the
// shade ladder that already exists rather than needing new hues.
//
// ⚠⚠ AND ON THE SHIPPED MAP IT IS THE SMALLER OF THE TWO TERMS, WHICH INVERTS THAT RANKING.
// The ranking was measured on the EXPERIMENT island, which stands 155 small props on its ground;
// there, 155 tight pools are most of what "placed rather than pasted" means. Until 2026-08-30 the
// shipped canvas drew ONE object — a story tree — and skipped all 1,088 vegetation nodes the
// semantic scene emits, so contact darkening here was a single pool of radius 9.7 units under a
// crown of radius 7, most of it hidden by the crown that cast it, while the CAST shadow leaned
// 13.2 units clear of the canopy and was plainly visible. Both terms still ship, because they
// merge into one texture and one rung and dropping either buys nothing.
//
// ⚠ AND THE PROPS DID COME, WHICH IS WHY THE PARAGRAPH ABOVE IS PAST TENSE. The bought kit landed
// (ADR-0475) and its placements began casting on 2026-09-03; the placeholder tree was retired the
// day after (ADR-0508). So the shipped island now stands its capability trees and blooms — several
// pools rather than one large one, which is the populated-island case the ranking was measured
// on (a grove of dressing pines stood beside them for two days, until ADR-0518). The inversion
// this block records is history; do not read it as a live claim that this module delivers little.
//
// WHY IT IS ITS OWN MODULE RATHER THAN A THIRD TERM IN `land-shadow.ts`. That file computes "how
// much of the authored light is blocked" — a directional question, answered by stamping a swept
// disc away from the light. Contact darkening is not that. It approximates how much of the SKY a
// point cannot see, which is direction-free and lands on the lit side of a prop as well as the
// shaded one. Folding an omnidirectional term into a module whose whole argument is about one
// authored light direction would blur the reasoning in both. They meet in ONE texture (the
// material takes one occlusion field) and nowhere else — see {@link mergeOcclusion}.
//
// WHAT IT IS NOT. It names no colour and picks no rung, exactly as `land-shadow.ts` does not.
// `shadow-rung.ts` owns which rung an occluded pixel lands on, and the closure argument is
// untouched: the material still emits `token x level`.

import {
  assertTerrainDoesNotSelfShadow,
  buildCanopyShadowField,
  occlusionGrid,
  emptyField,
  indices,
  stampBox,
  SHADOW_GRES,
  SHADOW_TEXTURE_MAX,
  type CanopyShadowOptions,
  type GroundBounds,
  type ShadowCaster,
  type ShadowField,
} from './land-shadow.js';

/**
 * How far the contact pool is allowed to spread, as a multiplier on the DERIVED extent — the
 * pool's visible edge sits at `contactReach × CONTACT_SPREAD` from the caster's axis.
 *
 * IT WAS ONE, AND THAT WAS THE POINT — the falloff below is derived from each caster's own
 * geometry rather than dialled, so this exists to make a deliberate change VISIBLE as a change
 * rather than to hide it inside the derivation, and ADR-0392 D2 requires the reason recorded.
 *
 * ⚠⚠ THE REASON (2026-09-06, the owner on the shipped map): *"you have a full circle under the
 * tree that is quite large."* The derivation models every caster as a CYLINDER of its crown's
 * radius from foot to tip, so a pine's pool is the sky a solid 10-unit-wide column would hide —
 * its edge 2.0 units past the crown, a 14-unit disc under an 18-unit tree on an 88-unit island.
 * The pine is a cone on a trunk 8% of that width; near the ground it hides a fraction of the sky
 * the cylinder does, and the pool the reference paints is a tight dark foot. The ladder
 * {@link CONTACT_SPREAD_RUNGS} narrows the pool's edge toward that foot, rendered on the RTX 2060
 * on a green island, an in-progress wheat island and the sand band
 * (`docs/research/chapter2-shadow-scale-back-2026-09-06/`); the pick is this constant, and a
 * scale-back is one edit to a rung already on the sheet.
 */
export const CONTACT_SPREAD = 0.5;

/** The pool ladder the owner was shown, as fractions of the derived reach: 1 is the pool as it
 *  shipped after PR #1841; 0 is no pool at all — the trees casting and not pooling, as the ground
 *  cover already does. Descending, so each rung is a smaller circle than the one before. */
export const CONTACT_SPREAD_RUNGS: readonly number[] = [1, 0.7, 0.5, 0.25, 0];

/**
 * The fraction of the sky a vertical cylinder hides from a ground point at horizontal distance
 * `d` from its axis.
 *
 * DERIVED, NOT DIALLED, AND THE DERIVATION IS THE WHOLE DEFENCE. A tuned radial blob is
 * indistinguishable from this one in a still picture and impossible to argue with later; a
 * derived one prices itself against each prop's own size, which is precisely the property the
 * reference images have and a constant blob does not — a hero tree pools far more ground than a
 * shrub because it hides far more sky, not because someone chose a bigger number.
 *
 * Two independent factors, multiplied, because they are separable:
 *
 *   - AZIMUTH. Seen from distance `d`, a cylinder of radius `r` covers `2*asin(r/d)` of the full
 *     `2*PI` turn, i.e. a fraction `asin(r/d)/PI`. At the surface (`d = r`) that is 1/2: a
 *     cylinder you are touching hides half the horizon.
 *   - ELEVATION. From ground distance `s = d - r` off its flank, a cylinder of height `h` rises
 *     to elevation `atan(h/s)`. For DIFFUSE occlusion the cosine-weighted fraction of the
 *     hemisphere below elevation `t` is `sin^2(t)`, which is the standard result and not a choice
 *     made here.
 *
 * The product is doubled so that the contact limit is 1 rather than 1/2 — a point touching the
 * base of a tall prop is fully occluded on the side the prop is, which is the boundary condition
 * a reader's eye already expects.
 *
 * IT IS AN APPROXIMATION AND SAYING SO IS PART OF THE RECORD. A real hemispherical integral would
 * account for props occluding each other and for the ground's own curvature under the relief;
 * both are second-order against a single rung of a four-rung ladder, and neither could change
 * which side of the material's 0.5 threshold a sample lands on at the distances this island works
 * over.
 */
export function skyOcclusionAt(d: number, radius: number, height: number): number {
  const r = Math.max(radius, 1e-6);
  const h = Math.max(height, 0);
  if (h <= 0) return 0;
  // Stryker disable next-line EqualityOperator: EQUIVALENT, and provably so rather than by
  // inspection. At `d === r` the general path below computes `asin(min(1, 1))/PI = 0.5` and
  // `atan(h / 0) = PI/2`, whose `sin^2` is 1, so it returns `min(1, 2 * 0.5 * 1) = 1` — exactly
  // what this guard returns. `<` and `<=` therefore deliver the same number at every input, and
  // the guard exists for `d < r`, where the general path does NOT (a negative `d - r` swings the
  // elevation below the horizon).
  if (d <= r) return 1;
  const azimuth = Math.asin(Math.min(1, r / d)) / Math.PI;
  const elevation = Math.atan(h / (d - r));
  const sky = Math.sin(elevation) ** 2;
  return Math.min(1, 2 * azimuth * sky);
}

/**
 * The ground distance at which a caster's occlusion falls to `threshold` — the pool's visible
 * EDGE, because the material thresholds the field rather than ramping it.
 *
 * Solved by bisection rather than in closed form: {@link skyOcclusionAt} is monotone decreasing
 * in `d` (both factors are), so a bisection is exact to the tolerance asked for, and the closed
 * form of `asin(r/d) * sin^2(atan(h/(d-r))) = c` is not worth the algebra or the reader's time.
 * It exists so the stamp below can bound its own rasterisation box instead of testing every
 * sample against every caster.
 */
export function contactReach(radius: number, height: number, threshold = 0.5): number {
  const r = Math.max(radius, 1e-6);
  // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero). `<` and `<=` differ
  // only where the occlusion at `r * 1.0001` equals the threshold to the last bit of a double.
  if (skyOcclusionAt(r * 1.0001, r, height) < threshold) return r;
  // ⚠⚠ EVERY MUTANT INSIDE THE BRACKET CONSTRUCTION BELOW IS EQUIVALENT, AND THAT IS A PROPERTY
  // OF BISECTION RATHER THAN A GAP IN THE TESTS. `skyOcclusionAt` is monotone decreasing in `d`,
  // so ANY bracket `[r, hi]` with `occ(hi) < threshold` contains the same single root and 60
  // halvings converge to it within 2^-60 of the interval — a different starting `hi`, one more
  // doubling, or one more halving all deliver the same number to every tolerance a caller can
  // express. What is NOT equivalent is a bracket that does not contain the root at all, and that
  // is why the refusal below exists rather than a comment saying it cannot happen.
  // Stryker disable next-line ArithmeticOperator,MethodExpression,EqualityOperator,UpdateOperator,ConditionalExpression
  let hi = r + Math.max(4, height) * 4;
  // Stryker disable next-line ArithmeticOperator,MethodExpression,EqualityOperator,ConditionalExpression
  for (const _ of indices(40)) {
    // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero) — the occlusion at
    // `hi` equalling the threshold to the last bit of a double.
    if (skyOcclusionAt(hi, r, height) < threshold) break;
    hi *= 2;
  }
  // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero) — the occlusion at
  // `hi` equalling the threshold to the last bit of a double.
  if (skyOcclusionAt(hi, r, height) >= threshold) {
    // The bracket never caught the root. A bisection run anyway converges CONFIDENTLY to the
    // wrong answer — the failure this whole construction exists to avoid — so it is refused
    // rather than returned.
    throw new Error(
      `contact-shade: no bracket contains the reach of a caster of radius ${radius} and height ` +
        `${height} at threshold ${threshold} — 40 doublings reached ${hi} and the occlusion there ` +
        'is still above it',
    );
  }
  return bisectReach(r, hi, r, height, threshold);
}

/** 60 halvings of a bracket known to contain the root. Extracted so the loop's own arithmetic is
 *  one named thing rather than four mutants inside a public function — and so the count can carry
 *  its own note: 60 halvings of any bracket this module builds resolve the root past the last bit
 *  of a double, which makes the count, and the direction of its two comparisons, unobservable. */
function bisectReach(
  lo0: number,
  hi0: number,
  radius: number,
  height: number,
  threshold: number,
): number {
  let lo = lo0;
  let hi = hi0;
  for (const _ of indices(60)) {
    const mid = (lo + hi) / 2;
    // Stryker disable next-line EqualityOperator
    if (skyOcclusionAt(mid, radius, height) >= threshold) lo = mid;
    else hi = mid;
  }
  return hi;
}

export interface ContactFieldOptions {
  /** Ground-space extent to cover — the SAME bounds the cast field is built over, so the two
   *  grids can be merged index-for-index. */
  bounds: GroundBounds;
  /** The upright props. Empty is legal and delivers an identically-zero field. */
  casters: readonly ShadowCaster[];
  gres?: number;
  /** The texture-edge budget this field is allocated under, defaulting to
   *  {@link SHADOW_TEXTURE_MAX} — the SAME one the cast field is built under, for the same
   *  reason the bounds are the same: the merge is index-for-index. */
  max?: number;
  /** Widen (or narrow) the derived pool, as a multiplier on the reach. ⚠ DEFAULTS TO ONE — the
   *  DERIVED pool, which is what this builder's goldens pin; the SHIPPED pick ({@link CONTACT_SPREAD})
   *  is applied by {@link buildGroundOcclusion}, where the shipped field is assembled, so the
   *  derivation and the appearance call stay two things. */
  spread?: number;
}

/**
 * Build the contact field.
 *
 * A STAMP PER CASTER, bounded by {@link contactReach}, for exactly the reason the cast field's
 * canopy term is a stamp: with 155 props over ~285k samples, testing every sample against every
 * caster is 44 million evaluations of an `asin` and an `atan`, and the difference between that
 * and the ~40 thousand a bounded stamp costs is whether the evidence page renders in a second or
 * in a minute.
 *
 * MAX RATHER THAN SUM where two pools overlap. A sum would drive the crowded middle of a dense
 * parcel to a solid slab of the occlusion rung — which is not what stacked occluders do, and on a
 * ONE-RUNG ladder the difference between 0.6 and 1.4 is invisible anyway, so a sum would buy
 * nothing and cost the shape.
 *
 * ALLOCATED BY THE SHARED `occlusionGrid` rather than by four lines copied from the cast field,
 * because the merge below is index-for-index and a field one texel off would slide every contact
 * pool a third of a ground unit away from the prop that casts it — which reads as a rendering bug
 * and would be chased as one.
 *
 * NO RELIEF ARGUMENT, DELIBERATELY, and this is the one asymmetry with the cast field worth
 * stating. That function needs the height field because a cast shadow's LENGTH depends on the
 * ground it lands on. A contact pool does not: it is a function of the occluder's own footprint
 * about its own foot, and every prop is already lifted onto the relief by the caller, so the pool
 * is centred on the land by construction. Taking a relief argument to multiply nothing by it
 * would look like rigour and be the opposite.
 */
export function buildContactField(opts: ContactFieldOptions): ShadowField {
  const grid = occlusionGrid(opts.bounds, opts.gres ?? SHADOW_GRES, opts.max ?? SHADOW_TEXTURE_MAX);
  const field = emptyField(grid);
  const { minX, minZ, w, gres } = grid;
  const data = field.data;
  const spread = opts.spread ?? 1;
  // A spread of nothing pools nothing: the field stays empty rather than each foot's own sample
  // being divided by zero (`d / 0`) and written as whatever `NaN` stores in a byte.
  // Stryker disable next-line ConditionalExpression,EqualityOperator: EQUIVALENT, and provably so
  // rather than by inspection — the guard is legibility, not behaviour. WITHOUT it a spread of 0
  // gives every caster a reach of 0, so `d > reach` skips every sample but a foot standing exactly
  // on a texel, whose `0 / 0` is NaN, whose byte a `Uint8Array` stores as 0 — the same empty field;
  // a NEGATIVE spread inverts the stamp box (`x − reach > x + reach`) so its `span` is empty and
  // nothing is written at all. `<` vs `<=` differs only at exactly 0, which the NaN path delivers
  // identically. No field a test can read separates the three.
  if (spread <= 0) return field;

  for (const c of opts.casters) {
    // A caster that pools nothing (`pool: false`, the ground cover's) is skipped HERE, where the
    // pool is stamped, so the cast term still sees it and the rule lives in one place.
    if (c.pool === false) continue;
    const reach = contactReach(c.radius, c.height) * spread;
    const box = stampBox(grid, c.x - reach, c.x + reach, c.z - reach, c.z + reach);
    for (const j of box.rows) {
      const gz = minZ + j / gres;
      for (const i of box.cols) {
        const gx = minX + i / gres;
        const d = Math.hypot(gx - c.x, gz - c.z);
        // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero) — `>` and `>=`
        // differ only where a grid point's distance equals the reach to the last bit of a double.
        if (d > reach) continue;
        // The spread divides the DISTANCE rather than multiplying the result, so widening a pool
        // moves its edge outward and leaves its contact value at 1 — scaling the value instead
        // would lift the whole field toward the threshold and turn a widening into a
        // brightening-then-darkening of everything at once.
        // Stryker disable next-line ConditionalExpression: EQUIVALENT. Taking the `d / spread`
        // branch unconditionally is the same arithmetic at the default spread of 1, and the
        // branch exists only to keep the common case free of a divide.
        const occ = skyOcclusionAt(spread === 1 ? d : d / spread, c.radius, c.height);
        const v = Math.round(Math.min(1, occ) * 255);
        // `Math.max` rather than a compare-and-assign: `if (v > current)` and `if (v >= current)`
        // write the same byte, so the comparison is an unkillable mutant. Written this way there
        // is no comparison to mutate.
        data[j * w + i] = Math.max(v, data[j * w + i]!);
      }
    }
  }

  return field;
}

/**
 * Combine two occlusion fields into one, taking the greater occlusion at every sample.
 *
 * MAX, NOT SUM, AND THE REASON IS THE LADDER RATHER THAN THE PHYSICS. The material has ONE
 * occlusion rung, so it thresholds; a sum and a max deliver identical pixels wherever either term
 * already passes the threshold, and differ only in how confidently they overshoot it. Max is the
 * form that stays correct if a second rung is ever authored, because the deepest single occluder
 * is a bound a reader can reason about and a sum of approximations is not.
 *
 * IT REFUSES ON A GRID MISMATCH rather than resampling. Two fields that disagree about their
 * origin or resolution cannot be merged into a meaningful third, and silently interpolating one
 * onto the other would put every contact pool a fraction of a unit away from its prop — a defect
 * that looks like a rendering artefact and gets chased as one.
 */
export function mergeOcclusion(a: ShadowField, b: ShadowField): ShadowField {
  if (!sameGrid(a, b)) {
    throw new Error(
      'contact-shade: refusing to merge occlusion fields on different grids ' +
        `(${a.w}x${a.h}@${a.gres} from ${a.minX},${a.minZ} vs ` +
        `${b.w}x${b.h}@${b.gres} from ${b.minX},${b.minZ})`,
    );
  }
  const data = new Uint8Array(a.data.length);
  a.data.forEach((v, p) => {
    data[p] = Math.max(v, b.data[p]!);
  });
  return { minX: a.minX, minZ: a.minZ, w: a.w, h: a.h, gres: a.gres, data };
}

/** Do two fields describe the SAME samples? Five separate comparisons, extracted so each one is
 *  a mutant a test can kill on its own — folded into one boolean expression, a dropped clause is
 *  hidden behind the four that remain. */
export function sameGrid(a: ShadowField, b: ShadowField): boolean {
  if (a.w !== b.w) return false;
  if (a.h !== b.h) return false;
  if (a.gres !== b.gres) return false;
  if (a.minX !== b.minX) return false;
  if (a.minZ !== b.minZ) return false;
  return true;
}

/** How much of the field is occluded past the material's own threshold. Same reasoning as
 *  `shadowCoverage`: measuring at any other threshold reports an effect the picture does not
 *  contain. */
export function contactCoverage(field: ShadowField, threshold = 0.5): number {
  let n = 0;
  // `for…of` for the same reason as `shadowCoverage`: an index bound past the end reads a sample
  // whose `undefined / 255` is NaN, which fails every comparison and makes the bound unkillable.
  for (const v of field.data) if (v / 255 > threshold) n += 1;
  return n / field.data.length;
}

export interface GroundOcclusionOptions {
  /** Ground-space extent to cover. */
  bounds: GroundBounds;
  /** Relief amplitude the land is wearing — the cast term needs it, the contact term does not. */
  relief: number;
  /** Everything standing on the land. Empty is legal and delivers an identically-zero field. */
  casters: readonly ShadowCaster[];
  gres?: number;
  /** The texture-edge budget both terms are allocated under — passed to BOTH, because the merge
   *  below is index-for-index and two fields built under different caps are two different grids.
   *  Defaults to {@link SHADOW_TEXTURE_MAX}. */
  max?: number;
  /** The cast term's soft-edge width, in ground units — the contact term has no edge of its own
   *  to soften. Defaults to `SHADOW_PENUMBRA`; supplied by the ladder that rendered the rungs. */
  penumbra?: number;
  /** WHICH RUNG THE CONTACT TERM LANDS ON — see {@link ContactBand}. Defaults to
   *  {@link SHADOW_CONTACT_BAND}; a comparison's control passes `full`. */
  contactBand?: ContactBand;
  /** HOW FAR THE POOL SPREADS, as a multiplier on the derived reach — {@link CONTACT_SPREAD}
   *  unless the ladder that rendered the rungs passes one. */
  contactSpread?: number;
}

/**
 * WHERE THE CONTACT POOL IS DRAWN. `full`: the contact term is merged at its own value, so a
 * fragment inside a pool (sky occlusion past 0.5) lands on the FULL shadow rung exactly as the
 * sun shadow does — the one mechanism the field had until 2026-09-06, when the full rung was
 * the shallow derived one and the two were indistinguishable. `soft`: the contact term is packed
 * into the material's SOFT band (`0.25 < occ ≤ 0.5`), so a pool darkens to the halfway rung and
 * only the CAST term reaches the full one.
 *
 * ⚠⚠ WHY, MEASURED. With the depth ladder (`SHADOW_DEPTH`) the full rung is deep, and the first
 * run on the RTX 2060 (2026-09-06) merged the pools at full: 51.75% of the island's field sat past
 * the full threshold, every bush and every tree wore a ring of full darkness around its foot
 * (`contactReach` is 1.7 units past a tree's crown radius, 0.75 past a bush's), and the island
 * read as dark blotches. The approved render's contact darkening is the SKY's share — a soft
 * partial darkening under and around an object — while its sun shadow is the deep one. Packing
 * the pool into the soft band is that distinction, and it is what `land-shadow.ts`'s header
 * always said the two terms were.
 */
export type ContactBand = 'full' | 'soft';
export const SHADOW_CONTACT_BAND: ContactBand = 'soft';

/** The soft band's floor and span: a contact value `c ∈ [0.5, 1]` (nothing below the reach is
 *  written) lands at `0.25 + c / 4 ∈ [0.375, 0.5]` — inside `(0.25, 0.5]`, never past it. */
export const CONTACT_SOFT_FLOOR = 0.25;
export const CONTACT_SOFT_SCALE = 0.25;

/** The largest byte the soft band may hold. ⚠ 127, NOT `round(0.5 × 255) = 128`: the material
 *  reads `occ > 0.5` for the full rung and 128 / 255 is 0.502, so a pool packed to the band's own
 *  top would land on the FULL rung — measured on the first test of the packing, not reasoned. */
export const CONTACT_SOFT_MAX_BYTE = 127;

/** The contact field re-packed into the soft band, sample for sample; zero stays zero. */
export function packContactSoft(field: ShadowField): ShadowField {
  const data = new Uint8Array(field.data.length);
  field.data.forEach((v, p) => {
    data[p] =
      v === 0 ? 0 : Math.min(CONTACT_SOFT_MAX_BYTE, Math.round((CONTACT_SOFT_FLOOR + (CONTACT_SOFT_SCALE * v) / 255) * 255));
  });
  return { minX: field.minX, minZ: field.minZ, w: field.w, h: field.h, gres: field.gres, data };
}

/**
 * THE ONE FIELD THE MATERIAL RECEIVES: the cast shadows and the contact pools, merged.
 *
 * ⚠ IT IS ONE FUNCTION RATHER THAN TWO CALLS AND A MERGE AT EVERY CALL SITE, because the merge
 * is index-for-index and there are now three callers — the shipped canvas, the comparison
 * instrument and the tests. Three copies of "build both on the same grid, then max them" is three
 * chances for one of them to pass a different `gres` and get a refusal it then works around.
 *
 * ⚠ IT ASSERTS THE TERRAIN TERM IS STILL ZERO before doing anything else. `src/land-shadow.ts`
 * carries the canopy stamp ONLY, because at the shipped relief amplitude the land is nowhere
 * steeper than the light and a terrain march would contribute nothing to any frame. That is a
 * measurement about one constant, and the constant can move; the assertion is what turns a
 * silently missing term into a loud one.
 */
export function buildGroundOcclusion(opts: GroundOcclusionOptions): ShadowField {
  assertTerrainDoesNotSelfShadow(opts.relief);
  // ⚠ RESOLVED HERE AND PASSED DOWN, so both terms are built on one grid by construction rather
  // than by two calls happening to default the same way.
  const gres = opts.gres ?? SHADOW_GRES;
  // ⚠ RESOLVED HERE TOO, for exactly the reason above one rider further along: the cap decides
  // the grid as surely as the resolution does, so two terms defaulting it separately could be
  // built on grids the merge then refuses.
  const max = opts.max ?? SHADOW_TEXTURE_MAX;
  const castOpts: CanopyShadowOptions = {
    bounds: opts.bounds,
    relief: opts.relief,
    casters: opts.casters,
    gres,
    max,
  };
  // By statement: under `exactOptionalPropertyTypes` an absent `penumbra` and a `penumbra:
  // undefined` are different inputs, and only the first is "the authored width".
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — passing `undefined` through
  // meets the cast builder's own `?? SHADOW_PENUMBRA` default, so the field is byte-identical; the
  // statement exists for the type, not the runtime.
  if (opts.penumbra !== undefined) castOpts.penumbra = opts.penumbra;
  const cast = buildCanopyShadowField(castOpts);
  // ⚠ THE SHIPPED SPREAD IS APPLIED HERE, not defaulted inside the contact builder: that builder's
  // own default is the DERIVED pool (spread 1), so its goldens pin the derivation, and this is the
  // one place the appearance call ({@link CONTACT_SPREAD}) meets the field the material receives.
  const contact = buildContactField({ bounds: opts.bounds, casters: opts.casters, gres, max, spread: opts.contactSpread ?? CONTACT_SPREAD });
  const band = opts.contactBand ?? SHADOW_CONTACT_BAND;
  return mergeOcclusion(cast, band === 'soft' ? packContactSoft(contact) : contact);
}
