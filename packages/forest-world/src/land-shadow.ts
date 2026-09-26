// land-shadow.ts — THE CAST SHADOW, as a ground-space field. Pure, browser-free,
// node:test-provable — it imports only the relief field and the authored light.
//
// ⚠ IT LIVES IN `src/` BECAUSE IT HAS CROSSED (2026-08-30). It was the shipping half of
// `harness/land-shadow.ts` until then, fenced out of the public mirror because adoption is a
// separate and deliberate event (ADR-0380 D6 / ADR-0406 D2). The owner authorised it on
// 2026-08-29 — "i'm still hoping for future iterations to improve the ground texture and add
// shadows" — and asked for shadows again by name. `harness/land-shadow.ts` RE-EXPORTS every
// symbol below rather than keeping a copy.
//
// WHAT THIS IS AND WHAT IT IS NOT. It computes, per ground sample, how much of the authored
// light is blocked — a scalar in [0, 1]. It names no colour, picks no rung and touches no
// palette. `shadow-rung.ts` owns which rung a shadowed pixel lands on, and the closure argument
// is untouched: the material still emits `token x level`.
//
// WHY A GROUND-SPACE FIELD RATHER THAN A PER-VERTEX ATTRIBUTE, which was the first idea and is
// a decision already made and measured. The shipped ground is a triangle fan per parcel on
// parcels whose measured mean diameter is 16.57 ground units; the shadow this island throws is
// about 13 units long. A per-vertex attribute on that mesh carries no feature finer than a whole
// parcel, so the shadow would be smeared across entire capabilities and would read as a lighting
// bug. The field is sampled in the FRAGMENT stage instead, so its resolution is set here rather
// than by the mesh. The author-time compositor does the same thing (`shadow.py`'s `GRES`).
//
// WHY NOT A SHADOW MAP. A depth-buffer shadow map is the general answer and the wrong one here:
// it needs a second render pass, it resolves at the shadow camera's resolution rather than in
// ground units, and its bias artefacts (acne, peter-panning) are the class of defect this arc
// keeps mistaking for an art problem. The land is a height field lit by ONE authored direction
// that cannot move (ADR-0380 D6 fence 4 — the projection does not move), so the analytic form is
// both cheaper and provable in a node test, which a depth buffer is not.
//
// ⚠⚠ THE TERRAIN TERM DID NOT CROSS, AND THAT IS A MEASUREMENT RATHER THAN A TRIM. A height
// field self-shadows only where it is STEEPER than the light. The authored light climbs 1.438
// units per ground unit; the shipped relief's steepest slope at its amplitude (2.2 × LAND_SCALE,
// the wavelengths scaled with it) is 0.455.
// So the terrain term is IDENTICALLY ZERO on the land as it ships — not small, zero — and
// crossing an O(samples x steps) march to add nothing would be payload wearing the clothes of
// rigour. {@link terrainSelfShadows} is what says so, {@link assertTerrainDoesNotSelfShadow} is
// the fence that fails loudly if the amplitude ever rises past it, and the march itself stays in
// `harness/land-shadow.ts` where the experiment's own amplitudes can still exercise it.

import { landGradient, landHeight, landHeightRange, LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { LIGHT_DIRECTION } from './shade-ladder.js';

/** Ground-space sampling resolution, in samples per ground unit.
 *
 *  THREE, not the author-time compositor's two, and the reason is the raster rather than taste:
 *  the evidence pages render at 8 delivered px per ground unit as well as at the overview's 2,
 *  and a field coarser than the raster it feeds shows its own texels as a staircase along the
 *  shadow's edge — which reads as a defect in the shadow rather than in the sampling. */
export const SHADOW_GRES = 3;

/**
 * THE SOFT EDGE, in ground units — the width of the field's ramp from fully lit to fully occluded,
 * centred on the caster's true silhouette (0.5 exactly ON the silhouette).
 *
 * ⚠ ITS HISTORY IS THE WRONG SUN. Until 2026-09-06 it carried `blender_tree.py:1948`'s
 * `angle = 26 deg` — *"soft edge: a hard contact rim is CG"* — a decision made for an EARLIER
 * picture. The render the owner stamped (`build_land.py:1141-1147`) lights the land with a
 * `angle = 3°` sun, whose penumbra at the tip of an 18-unit pine is `18 × tan 3°` ≈ 0.94 ground
 * units and zero at its foot — a near-hard edge. The material renders the ramp through ONE
 * intermediate rung (`shadow-rung.ts`'s `SHADOW_EDGE`), so what reaches the picture is a band
 * `penumbra / 2` wide outside the silhouette.
 *
 * THE PICK: 0.6, from the ladder {@link SHADOW_PENUMBRA_RUNGS} rendered on the RTX 2060
 * (`docs/research/chapter2-cast-shadows-2026-09-06/crop-edge.png`). 0.15 and 0.6 both read as the
 * reference's crisp edge; 1.2 (the old value) wears a visible halo and 2.4 is mush. 0.6 over 0.15
 * because a band 0.3 units wide is one texel at `SHADOW_GRES`, which is what hides the field's own
 * staircase along a diagonal edge; the 3° sun's own penumbra is 0.5–0.9 units at the tip of a
 * pine. A scale-back is one edit to a rung already on the sheet.
 */
export const SHADOW_PENUMBRA = 0.6;

/** The penumbra ladder the owner was shown, in ground units. 0.15 is HARD in the picture — its
 *  soft band is 0.075 units, under a quarter of a texel at `SHADOW_GRES` — so the ladder runs
 *  from the 3° sun's own edge to a width twice the old 26° carry-over. */
export const SHADOW_PENUMBRA_RUNGS: readonly number[] = [0.15, 0.6, 1.2, 2.4];

/**
 * A CASTER'S SILHOUETTE, as a profile of revolution: `[heightFraction, radiusFraction]` pairs,
 * ascending in height, each radius a fraction of the caster's `radius` at that fraction of its
 * `height`. Linear between pairs; two pairs at the SAME height are a step (a crown starting
 * abruptly above a trunk). Absent, a caster is the upright cylinder it always was.
 *
 * WHY A PROFILE RATHER THAN A `kind`. The stamp needs exactly one thing from a form — the
 * half-width at a height — and a table of pairs answers it for a pine, a bloom, a bush and a
 * cylinder through one function, which is one code path to prove rather than four.
 */
export type SilhouetteProfile = readonly (readonly [height: number, radius: number])[];

/** The profile every caster wore until 2026-09-06 — full radius from foot to tip. */
export const CYLINDER_PROFILE: SilhouetteProfile = [
  [0, 1],
  [1, 1],
];

/**
 * The half-width of a profile at height fraction `t`, as a fraction of the caster's radius.
 * Linear between pairs; at a step (two pairs at one height) the WIDER of the two wins, because a
 * ray grazing the step is occluded by the wider part. Outside `[0, 1]`, or on an empty profile,
 * no pair brackets `t` and the answer is zero — nothing stands below its own foot or above its
 * own tip — without a guard saying so, because a guard the loop already satisfies is a branch no
 * test can distinguish.
 */
export function profileHalfWidth(profile: SilhouetteProfile, t: number): number {
  let width = 0;
  for (const k of indices(profile.length)) {
    const [h, r] = profile[k]!;
    if (h === t) width = Math.max(width, r);
    const next = profile[k + 1];
    if (next === undefined) continue;
    const [h2, r2] = next;
    // Stryker disable next-line EqualityOperator: EQUIVALENT — at `t === h` or `t === h2` the
    // interpolation returns that pair's own radius, which the `h === t` branch has already taken.
    if (t > h && t < h2) width = Math.max(width, r + ((r2 - r) * (t - h)) / (h2 - h));
  }
  return width;
}

/** The widest a profile ever is, as a fraction of the radius — what sizes the outline's table. */
export function profileMaxWidth(profile: SilhouetteProfile): number {
  let m = 0;
  for (const [, r] of profile) m = Math.max(m, r);
  return m;
}

/**
 * THE OUTLINE OF ONE PROFILE SEGMENT, SOLVED. The ray from a ground sample climbs `1 / perUnit`
 * per ground unit and passes the caster's axis at height `yStar`; at height `y` it sits
 * `perUnit × (yStar − y)` ground units from the axis along the shadow. Against a piece of the form
 * whose half-width runs linearly from `w0` at `y0` to `w1` at `y1`, the widest `across` the ray
 * is still occluded at is the square root of the largest `g(y) = w(y)² − (perUnit × (yStar − y))²`
 * over the segment — and `g` is a quadratic in `y`: concave where the segment's slope is shallower
 * than the light's, so its maximum sits at the stationary point clamped into the segment, and at
 * an end otherwise. A step (`y0 === y1`) is both ends at once. The result may be negative — the
 * ray meets nothing here — and the caller floors it.
 *
 * ⚠ SOLVED RATHER THAN SAMPLED, and the reason is the mutation rung as much as exactness: a
 * sampled maximum carries sampling constants whose mutants move the answer by less than any
 * fixture can see, while a closed form is held to a brute-force maximum to the last bit.
 */
export function segmentEnvelope(
  y0: number,
  w0: number,
  y1: number,
  w1: number,
  yStar: number,
  perUnit: number,
): number {
  const p2 = perUnit * perUnit;
  const g = (y: number, w: number): number => w * w - p2 * (yStar - y) * (yStar - y);
  const ends = Math.max(g(y0, w0), g(y1, w1));
  // THE STATIONARY POINT, taken only when it lies strictly inside the segment — and no guard
  // before it, because every case a guard would name already loses to the ends: a convex
  // segment's stationary point is its MINIMUM and never wins the max; a step (`y1 === y0`) has an
  // infinite or undefined slope, so `ys` is not a number inside any bracket; a segment parallel
  // to the light divides by zero and lands outside likewise. A guard here was three equivalent
  // mutants on the rung, each a branch no fixture can separate from the arithmetic.
  const slope = (w1 - w0) / (y1 - y0);
  const intercept = w0 - slope * y0;
  const ys = (intercept * slope + p2 * yStar) / (p2 - slope * slope);
  // Stryker disable next-line EqualityOperator: EQUIVALENT — at `ys === y0` or `ys === y1` the
  // stationary point IS an end, already in `ends`.
  if (ys > y0 && ys < y1) return Math.max(ends, g(ys, intercept + slope * ys));
  return ends;
}

/**
 * A CASTER'S SILHOUETTE OUTLINE, TABULATED ONCE: for each height `yStar` a ray may pass the axis
 * at, the widest `across` it is still occluded at — the largest {@link segmentEnvelope} over the
 * profile's segments, floored at zero and rooted.
 *
 * ⚠⚠ IT EXISTS BECAUSE A PER-SAMPLE FORM TEST COST THE FOREST TWENTY SECONDS AT MOUNT. Measured
 * on the RTX 2060 box, 2026-09-06: the forest's ground build went from 554 ms with cylinders to
 * 21,081 ms with the form probed at ~30 heights for every sample of every caster's box (2,852
 * casters). The outline is a function of `yStar` alone, so it is tabulated at {@link ENVELOPE_STEP}
 * of a texel's worth of height and a sample then costs one interpolated read and a clamp — the
 * cylinder stamp's cost class. `land-shadow.test.ts` holds the table to a brute-force maximum.
 */
export interface SilhouetteEnvelope {
  /** The `yStar` of `widths[0]`. */
  yMin: number;
  /** Height between entries. */
  step: number;
  /** The occluded half-width at each `yStar`, in ground units; 0 where nothing is met. */
  widths: Float64Array;
}

/** Entries per texel-worth of height along the shadow: four, so the outline is finer than the
 *  field that samples it. */
export const ENVELOPE_STEP = 0.25;

export function silhouetteEnvelope(
  profile: SilhouetteProfile,
  radius: number,
  height: number,
  perUnit: number,
  gres: number = SHADOW_GRES,
): SilhouetteEnvelope {
  const step = ENVELOPE_STEP / (gres * perUnit);
  // Nothing stands at no height: a table of zeros rather than a foot-disc at `yStar = 0`, which
  // is what the segments would deliver (every pair at `y = 0`, each its own width).
  if (height <= 0) return { yMin: 0, step, widths: new Float64Array(2) };
  const widest = radius * profileMaxWidth(profile);
  // A ray can be met while passing the axis up to `widest / perUnit` above the tip or below the
  // foot — the form's own overhang, converted to axis height.
  const overhang = widest / perUnit;
  const yMin = -overhang;
  const n = Math.ceil((height + 2 * overhang) / step) + 1;
  const widths = new Float64Array(n);
  for (const i of indices(n)) {
    const yStar = yMin + i * step;
    let best = 0;
    for (const k of indices(profile.length - 1)) {
      const [h0, r0] = profile[k]!;
      const [h1, r1] = profile[k + 1]!;
      best = Math.max(best, segmentEnvelope(h0 * height, r0 * radius, h1 * height, r1 * radius, yStar, perUnit));
    }
    widths[i] = Math.sqrt(best);
  }
  return { yMin, step, widths };
}

/** The outline's half-width at `yStar`, linearly interpolated between entries; zero before the
 *  table and past it, and the entry past the last is read as zero. */
export function envelopeWidth(env: SilhouetteEnvelope, yStar: number): number {
  const f = (yStar - env.yMin) / env.step;
  const i = Math.floor(f);
  const n = env.widths.length;
  if (i < 0 || i >= n) return 0;
  const a = env.widths[i]!;
  const b = i + 1 < n ? env.widths[i + 1]! : 0;
  return a + (b - a) * (f - i);
}

/** The field's value for a sample against a tabulated outline: the penumbra ramp centred on the
 *  outline, 0.5 exactly on it. Where the outline has NO width the ray meets nothing at all, and
 *  that is 0 rather than the ramp of a zero-width form: the penumbra widens an edge, it does not
 *  lengthen a shadow past its tip. */
export function envelopeOcclusion(env: SilhouetteEnvelope, yStar: number, across: number, penumbra: number): number {
  const w = envelopeWidth(env, yStar);
  if (w <= 0) return 0;
  return Math.max(0, Math.min(1, (w + penumbra - across) / (2 * penumbra)));
}

/** The largest texture edge the occlusion field may be uploaded at.
 *
 *  ⚠ IT EXISTS BECAUSE THE FIELD IS ALLOCATED OVER THE GROUND'S BOUNDS, NOT THE ISLAND'S AREA,
 *  and the shipped canvas draws whatever descriptors it is handed. One island is 234 x 46 units
 *  and costs 107 KB at {@link SHADOW_GRES}; a forest of thirty-five islands spread over a
 *  thousand units square would cost 36 MB of the visitor's memory for a field that is empty
 *  almost everywhere. Clamping the RESOLUTION rather than refusing keeps the shadow correct and
 *  merely coarser on a scene nobody has drawn yet, which is the failure a reader can see. */
export const SHADOW_TEXTURE_MAX = 2048;

/** How far outside the ground's own bounds the field extends, in ground units. A shadow leans
 *  away from the light and a contact pool spreads, so a field clipped to the land itself would
 *  cut both off at the coast; two units is past the reach of either at this island's scale. */
export const OCCLUSION_PAD = 2;

/** A caster: something standing on the land — an upright cylinder unless it carries a
 *  {@link SilhouetteProfile}, in which case its cast shadow is that profile's projection (a pine's
 *  cone, a bloom's stem, a bush's dome). The radius and height bound the profile. */
export interface ShadowCaster {
  /** Ground position (3D x, z). */
  x: number;
  z: number;
  /** Horizontal radius — the profile's `1.0`. */
  radius: number;
  /** Height above the land at its own foot — the profile's `1.0`. */
  height: number;
  /** The form the shadow takes. Absent means the cylinder every caster was until 2026-09-06,
   *  stamped by the closed-form swept disc rather than the sampled silhouette. */
  profile?: SilhouetteProfile;
  /** Does this caster darken the ground it MEETS (`contact-shade.ts`'s pool) as well as the
   *  ground it shades? Absent means yes. `false` is the ground cover's (`ground-casters.ts`'s
   *  `COVER_POOLS`): a knee-high dome casts its sun shadow and no ambient halo. */
  pool?: boolean;
}

export interface GroundBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ShadowField {
  /** Ground coordinate of sample (0, 0). */
  minX: number;
  minZ: number;
  /** Samples across and down. */
  w: number;
  h: number;
  /** Samples per ground unit. */
  gres: number;
  /** Occlusion, 0..255, row-major. A byte because it is uploaded as an 8-bit texture and storing
   *  more precision than the transport carries would be a lie about the field. */
  data: Uint8Array;
}

/**
 * `0 … count - 1`, as a value.
 *
 * ⚠⚠ IT EXISTS TO MAKE A LOOP UNABLE TO HANG, and that is a mutation-rung finding rather than a
 * style preference. A `for (let i = 0; i < n; i += 1)` carries mutants that turn `+=` into `-=`
 * and `<` into `>`, and both of those do not fail a test — they run forever. Stryker reports the
 * result as a TIMEOUT, which `check:mutation-diff` counts as UNPROVEN: killed in spirit, named by
 * no test, and therefore neither a pass nor a survivor. Twelve of this module's mutants landed
 * there. A `for … of` over a materialised range has no counter to mutate, so the same mutants
 * either vanish or fail an assertion like every other.
 */
export function indices(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}

/** Ground distance a caster of unit height throws its shadow — DERIVED from the authored light,
 *  never typed. `|L_ground| / L_y` = cot(the light's elevation). At the authored direction this
 *  is 0.695, so a 19-unit story tree casts 13.2 ground units. */
export function shadowOffsetPerUnitHeight(): number {
  return Math.hypot(LIGHT_DIRECTION.x, LIGHT_DIRECTION.z) / LIGHT_DIRECTION.y;
}

export interface ShadowDirectionResult {
  x: number;
  z: number;
}

/** The unit ground vector a shadow is thrown ALONG — away from the light. Derived in ONE place
 *  because getting the sign backwards produces a picture that is lit and shaded in exactly the
 *  wrong places while looking entirely plausible. */
export function shadowDirection(): ShadowDirectionResult {
  const ground = Math.hypot(LIGHT_DIRECTION.x, LIGHT_DIRECTION.z) || 1;
  return { x: -LIGHT_DIRECTION.x / ground, z: -LIGHT_DIRECTION.z / ground };
}

/** How steeply the authored light comes in: rise over run, i.e. `tan(elevation)`. At the authored
 *  direction the light sits 55.2 degrees above the horizon, so a ray climbs 1.44 units for every
 *  ground unit it travels. */
export function lightSlope(): number {
  return LIGHT_DIRECTION.y / Math.hypot(LIGHT_DIRECTION.x, LIGHT_DIRECTION.z);
}

/** The longest shadow the LAND ALONE could throw at this relief amplitude: the field's whole
 *  peak-to-trough range converted to ground distance. It BOUNDS a terrain march, so the march can
 *  never be shortened into a false "nothing occludes this" — and it is emphatically not a claim
 *  that any terrain shadow exists. See {@link terrainSelfShadows}. */
export function maxTerrainCast(relief: number): number {
  return 2 * landHeightRange(relief) * shadowOffsetPerUnitHeight();
}

/** The steepest slope the relief field reaches, sampled over a patch several wavelengths wide.
 *  Sampled rather than solved: the field is a sum of waves with incommensurate directions, so its
 *  true supremum has no closed form worth trusting, and a sample over many periods is both honest
 *  about that and tight enough to decide the comparison below. */
export function maxTerrainSlope(relief: number, span = 200, step = 0.5): number {
  // ⚠ A MATERIALISED RANGE RATHER THAN TWO COUNTER LOOPS — see {@link indices}. A mutated `+=`
  // here does not fail a test, it runs forever, and a timeout is credited to nobody.
  const axis = indices(Math.floor(span / step) + 1).map((i) => -span / 2 + i * step);
  let peak = 0;
  for (const x of axis) {
    for (const z of axis) {
      const g = landGradient(x, z, relief);
      // `Math.max` rather than a compare-and-assign: `if (m > peak)` and `if (m >= peak)` keep
      // the same running maximum, so the comparison is an unkillable mutant. Written this way
      // there is no comparison to mutate.
      peak = Math.max(peak, Math.hypot(g.dx, g.dz));
    }
  }
  return peak;
}

/**
 * The relief's steepest slope PER UNIT of amplitude.
 *
 * ⚠⚠ A LITERAL, AND THE REASON IS COST RATHER THAN TASTE. {@link maxTerrainSlope} samples 160,801
 * points; the fence below runs on EVERY field build, and a canvas that spent a third of a second
 * of main-thread time re-deriving a constant before drawing anything would be a real defect
 * hiding inside a correctness check. The relief field is a sum of waves scaled by the amplitude,
 * so its gradient is exactly linear in it — measured to the last bit across amplitudes from 0.5 to
 * 40 — which makes the fence a multiply. `land-shadow.test.ts` holds BOTH halves: that this number
 * is what the sampler returns at amplitude 1, and that the linearity it rests on is real.
 */
// ⚠ RE-DERIVED 2026-09-05 with the land-per-capability ratio (`land-per-capability.ts`): the
// relief's wavelengths shrank by LAND_SCALE with the island, so the slope per unit of amplitude
// grew — 0.2067 on the tuned island, 0.5481 on the shipped one (the sampler's own answer at
// amplitude 1). The SHIPPED amplitude shrank by the same factor, so the shipped peak slope is
// unchanged at 0.455 and the finding below stands; only the per-unit number moved.
export const PEAK_SLOPE_PER_UNIT_AMPLITUDE = 0.5481413856707605;

/**
 * CAN THE LAND SHADOW ITSELF AT ALL? A height field self-shadows only where it is STEEPER than
 * the light, and this is that comparison.
 *
 * IT IS FALSE AT THE SHIPPED AMPLITUDE, AND THAT IS THE FINDING THIS MODULE RESTS ON. The
 * authored light comes in at 55.2 degrees; the relief's steepest slope at the shipped amplitude
 * (2.2 on the tuned island, 2.2 × LAND_SCALE ≈ 0.83 on the shipped one — the slope is the same
 * 24.4°, because the wavelengths shrank with the amplitude) is 24.4. Peak slope is linear in
 * amplitude, so the amplitude it would take to reach the light is about 2.6 — more than three
 * times what ships. On this land, at any amplitude this arc will accept, THE SHADOW IS THE CANOPY.
 */
export function terrainSelfShadows(relief: number): boolean {
  // Stryker disable next-line EqualityOperator: EQUIVALENT. `>` and `>=` differ only where the
  // peak slope EQUALS the light's exactly — two irrational-looking floats agreeing bit for bit.
  // There is no amplitude a test can pass to separate them, so the mutant is unreachable rather
  // than untested.
  return peakSlopeAt(relief) > lightSlope();
}

/** The steepest slope this relief reaches, by the linear law above rather than by sampling. */
export function peakSlopeAt(relief: number): number {
  return relief * PEAK_SLOPE_PER_UNIT_AMPLITUDE;
}

/**
 * The fence that keeps the omission above honest as the land changes.
 *
 * ⚠ IT IS A THROW RATHER THAN A COMMENT because the omission is invisible in the picture: a land
 * steep enough to shadow itself, drawn by a field that models only canopies, is simply a land
 * whose ridges are lit on both sides. Nobody looking at it would know a term was missing, and the
 * amplitude is one constant away from moving.
 */
export function assertTerrainDoesNotSelfShadow(relief: number = LAND_RELIEF_AMPLITUDE): void {
  if (terrainSelfShadows(relief)) {
    throw new Error(
      `land-shadow: the relief at amplitude ${relief} is steeper than the authored light ` +
        `(${peakSlopeAt(relief).toFixed(3)} > ${lightSlope().toFixed(3)}), so the land now ` +
        'shadows itself and the canopy stamp alone is no longer the whole field. The terrain ' +
        'march lives in harness/land-shadow.ts and would have to cross before this amplitude ships.',
    );
  }
}

/** The allocation every occlusion field over one scene shares.
 *
 *  ⚠ ONE FUNCTION RATHER THAN THE SAME FOUR LINES IN TWO MODULES, because the cast field and the
 *  contact field are merged INDEX FOR INDEX. A field one texel off would slide every contact pool
 *  a third of a ground unit away from the prop that casts it — a defect that looks like a
 *  rendering artefact and gets chased as one. */
export interface OcclusionGrid {
  minX: number;
  minZ: number;
  w: number;
  h: number;
  gres: number;
}

/** The samples-per-unit a field over these bounds may actually use — {@link SHADOW_GRES} unless
 *  that would exceed {@link SHADOW_TEXTURE_MAX} on either edge. */
/** One axis's padded extent. ONE function rather than the same expression on two lines: written
 *  twice, whichever axis is not the widest carries a mutant nothing can observe, because the
 *  clamp below reads only the larger of the two. */
export function axisSpan(min: number, max: number): number {
  return max - min + OCCLUSION_PAD * 2;
}

export function occlusionGres(
  bounds: GroundBounds,
  gres: number = SHADOW_GRES,
  max: number = SHADOW_TEXTURE_MAX,
): number {
  const spanX = axisSpan(bounds.minX, bounds.maxX);
  const spanZ = axisSpan(bounds.minZ, bounds.maxZ);
  const widest = Math.max(spanX, spanZ, 1e-6);
  return Math.min(gres, max / widest);
}

export function occlusionGrid(
  bounds: GroundBounds,
  gres: number = SHADOW_GRES,
  max: number = SHADOW_TEXTURE_MAX,
): OcclusionGrid {
  const g = occlusionGres(bounds, gres, max);
  return {
    minX: bounds.minX - OCCLUSION_PAD,
    minZ: bounds.minZ - OCCLUSION_PAD,
    // ⚠ THE CAP IS APPLIED HERE AS WELL AS IN `occlusionGres`, and the second clamp is not
    // belt-and-braces. `occlusionGres` chooses a RESOLUTION that keeps the field inside the cap;
    // this makes the cap a property of the GRID, so no resolution — a caller's, a future
    // heuristic's — can hand a builder a buffer bigger than the one budgeted for. The failure it
    // prevents is not a wrong picture but an allocation nobody costed.
    w: cappedEdge((bounds.maxX - bounds.minX + OCCLUSION_PAD * 2) * g, max),
    h: cappedEdge((bounds.maxZ - bounds.minZ + OCCLUSION_PAD * 2) * g, max),
    gres: g,
  };
}

/** One edge of a field, at least one sample and never more than the cap.
 *
 *  ⚠ THE CAP IS AN ARGUMENT AND NOT ONLY A CONSTANT, because {@link SHADOW_TEXTURE_MAX} is a
 *  BUDGET rather than a law of the renderer, and the comparison that decides whether it is the
 *  right budget has to be able to build a field at another one. It defaults to the authored value,
 *  so every caller that does not care is unchanged — which is all of them but the instrument. */
export function cappedEdge(samples: number, max: number = SHADOW_TEXTURE_MAX): number {
  return Math.min(max, Math.max(1, Math.ceil(samples)));
}

/** The clamped index range a stamp writes into, for a ground-space rect. */
export interface StampBox {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  /** The column indices the stamp visits, `i0 … i1`. */
  cols: number[];
  /** The row indices the stamp visits, `j0 … j1`. */
  rows: number[];
}

/**
 * The samples a ground-space rect covers, clamped to the buffer.
 *
 * ⚠⚠ IT IS ONE FUNCTION BECAUSE THE BOX IS OTHERWISE UNOBSERVABLE, which is a mutation-rung
 * finding and a real one. Written inline in each stamp, the box is a pure OPTIMISATION: every
 * sample inside it is tested again against the caster's own geometry, so a box that is too WIDE
 * delivers exactly the same field and merely costs time, and no assertion about the delivered
 * field can see the difference. Half its arithmetic was therefore unkillable — a `/` for a `*`, a
 * `Math.min` for a `Math.max` — not because the tests were weak but because the FIELD is the
 * wrong subject to ask. Named and returned, the box is a value a test can assert on directly.
 *
 * ⚠ AND THE TWO AXES ARE NOT SYMMETRIC, which is worth knowing before trusting either clamp. `i`
 * is a COLUMN: an unclamped `i` past `w - 1` wraps onto the next row and writes a caster's shadow
 * on the far side of the island. `j` is a ROW: an unclamped `j` past `h - 1` addresses past the
 * end of the buffer, where a typed array simply drops the write. So the column clamp prevents a
 * visible defect and the row clamp prevents nothing — both are still asserted here, because a
 * clamp that happens to be harmless is not the same as one that is not there.
 */
export function stampBox(
  grid: OcclusionGrid,
  minGx: number,
  maxGx: number,
  minGz: number,
  maxGz: number,
): StampBox {
  const i0 = Math.max(0, Math.floor((minGx - grid.minX) * grid.gres));
  const i1 = Math.min(grid.w - 1, Math.ceil((maxGx - grid.minX) * grid.gres));
  const j0 = Math.max(0, Math.floor((minGz - grid.minZ) * grid.gres));
  const j1 = Math.min(grid.h - 1, Math.ceil((maxGz - grid.minZ) * grid.gres));
  // ⚠ THE RANGES ARE PART OF THE BOX rather than rebuilt at each of the two call sites, and that
  // is the same finding as the box itself: written inline, `indices(j1 - j0 + 1)` is a loop bound
  // no assertion about the delivered field can see — a box one row short usually loses a row that
  // was going to be rejected anyway. Returned, it is an array a test reads.
  return { i0, i1, j0, j1, cols: span(i0, i1), rows: span(j0, j1) };
}

/** The integers from `lo` to `hi` inclusive, or nothing at all when `hi < lo` — which is what an
 *  empty box looks like and must stay: clamping it to `[lo]` would darken a corner for every
 *  caster that missed the field entirely. */
export function span(lo: number, hi: number): number[] {
  return indices(hi - lo + 1).map((n) => lo + n);
}

/** An empty field over a grid — what a scene with no casters delivers, and the base every stamp
 *  writes into. */
export function emptyField(grid: OcclusionGrid): ShadowField {
  return {
    minX: grid.minX,
    minZ: grid.minZ,
    w: grid.w,
    h: grid.h,
    gres: grid.gres,
    data: new Uint8Array(grid.w * grid.h),
  };
}

export interface CanopyShadowOptions {
  /** Ground-space extent to cover. */
  bounds: GroundBounds;
  /** Relief amplitude the land is wearing — 0 for a flat control. */
  relief: number;
  /** The upright casters. Empty is legal and delivers an identically-zero field. */
  casters: readonly ShadowCaster[];
  gres?: number;
  /** The texture-edge budget this field is allocated under. Defaults to
   *  {@link SHADOW_TEXTURE_MAX}; supplied only by the comparison that costs raising it. */
  max?: number;
  /** The soft edge's width, in ground units. Defaults to {@link SHADOW_PENUMBRA}; supplied by the
   *  ladder that rendered the rungs. */
  penumbra?: number;
}

/**
 * Stamp every caster's cast shadow into one field.
 *
 * A STAMP RATHER THAN A MARCH, and the difference is whether an evidence page renders in a second
 * or in a minute: a cylinder's shadow is a KNOWN shape — the swept disc from its foot to where
 * its tip lands — so each caster is rasterised into its own bounding box instead of every sample
 * being tested against every caster. The result is identical.
 */
export function buildCanopyShadowField(opts: CanopyShadowOptions): ShadowField {
  const grid = occlusionGrid(opts.bounds, opts.gres ?? SHADOW_GRES, opts.max ?? SHADOW_TEXTURE_MAX);
  const field = emptyField(grid);
  const { minX, minZ, w, gres } = grid;
  const data = field.data;
  const dir = shadowDirection();
  const perUnit = shadowOffsetPerUnitHeight();
  const penumbra = opts.penumbra ?? SHADOW_PENUMBRA;

  for (const c of opts.casters) {
    const baseY = landHeight(c.x, c.z, opts.relief);
    // ⚠ `reach` SIZES THE RASTERISATION BOX AND NOTHING ELSE — every sample inside it is still
    // tested against the caster's own form below, so a box that is too WIDE delivers exactly
    // the same field and merely costs time. That makes the arithmetic here unobservable in the
    // widening direction; what a test CAN see is a box too NARROW or in the wrong place, which is
    // what the edge-caster fixture in `land-shadow.test.ts` is for.
    // Stryker disable next-line ArithmeticOperator
    const reach = c.height * perUnit;
    const profile = c.profile;
    // A profile never widens past its own radius, so the cylinder's box holds a profiled caster
    // too — one box rule, whatever the form.
    const rr = c.radius + penumbra;
    // THE OUTLINE, ONCE PER CASTER — see {@link silhouetteEnvelope} for why not per sample.
    const env = profile === undefined ? null : silhouetteEnvelope(profile, c.radius, c.height, perUnit, gres);
    const tipX = c.x + dir.x * reach;
    const tipZ = c.z + dir.z * reach;
    const box = stampBox(
      grid,
      Math.min(c.x, tipX) - rr,
      Math.max(c.x, tipX) + rr,
      Math.min(c.z, tipZ) - rr,
      Math.max(c.z, tipZ) + rr,
    );
    for (const j of box.rows) {
      const gz = minZ + j / gres;
      for (const i of box.cols) {
        const gx = minX + i / gres;
        // Decompose the offset from the caster's foot into "along the shadow" and "across" it.
        const ox = gx - c.x;
        const oz = gz - c.z;
        const along = ox * dir.x + oz * dir.z;
        if (along < 0) continue; // toward the light: in front of the caster, never shadowed
        const across = Math.abs(ox * dir.z - oz * dir.x);
        // Stryker disable next-line EqualityOperator,ConditionalExpression: EQUIVALENT. `>` vs
        // `>=` is measure zero; and REMOVING the skip changes nothing either, because a sample
        // with `across > rr` falls through to a `soft` of `max(0, min(1, (rr - across) / …))`,
        // which is 0, and a 0 never wins the `Math.max` write below.
        if (across > rr) continue;
        // The ray from this sample toward the light reaches the caster's AXIS at this height
        // above the caster's foot. Occluded iff that is inside the form.
        const rayAboveFoot = landHeight(gx, gz, opts.relief) - baseY + along / perUnit;
        let soft: number;
        if (env !== null) {
          // THE SILHOUETTE: the ray is tested against the form at every height it passes
          // through, not only where it meets the axis — a pine's crown occludes a ray that
          // passes the axis above the tip — through the caster's tabulated outline. The axis
          // height may fall outside `[0, height]` here and still be occluded; the table is 0
          // where nothing is met.
          soft = envelopeOcclusion(env, rayAboveFoot, across, penumbra);
        } else {
          // THE CYLINDER, exactly as it was stamped until 2026-09-06 — byte for byte, so the
          // control arm of every comparison on this arc is still the map as it shipped.
          // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero) — a ray passing
          // exactly through the cylinder's foot or exactly through its tip is one double in a
          // continuum, and the sample either side of it is tested.
          if (rayAboveFoot < 0 || rayAboveFoot > c.height) continue;
          // EQUIVALENT, annotated on the condition's own line below. `<=` vs `<` is measure zero;
          // and taking the RAMP branch unconditionally delivers the same byte in the core, because
          // `(rr - across) / (2 * penumbra)` exceeds 1 there and is clamped.
          soft =
            // Stryker disable next-line EqualityOperator,ConditionalExpression
            across <= c.radius - penumbra ? 1 : Math.max(0, Math.min(1, (rr - across) / (2 * penumbra)));
        }
        const v = Math.round(soft * 255);
        // `Math.max` rather than a compare-and-assign, for the reason `buildContactField` gives.
        data[j * w + i] = Math.max(v, data[j * w + i]!);
      }
    }
  }

  return field;
}

/** Sample the field at a ground point, bilinearly, as 0..1. The GPU does this in hardware; this
 *  is the same read for a node test, and having both means a test can assert about the values the
 *  shader will actually see. */
export function sampleShadowField(field: ShadowField, x: number, z: number): number {
  const fx = (x - field.minX) * field.gres;
  const fz = (z - field.minZ) * field.gres;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const tx = fx - i0;
  const tz = fz - j0;
  const at = (i: number, j: number): number => {
    const ci = Math.max(0, Math.min(field.w - 1, i));
    const cj = Math.max(0, Math.min(field.h - 1, j));
    return field.data[cj * field.w + ci]! / 255;
  };
  const a = at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx;
  const b = at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx;
  return a * (1 - tz) + b * tz;
}

/** How much of the field is occluded past the material's own threshold. The material thresholds
 *  at 0.5 (one rung, so the decision is binary), and measuring the coverage at any OTHER
 *  threshold would report a shadow the picture does not contain. */
export function shadowCoverage(field: ShadowField, threshold = 0.5): number {
  let n = 0;
  // `for…of` rather than an index: an off-by-one on `p < length` reads one sample past the end,
  // whose `undefined / 255` is NaN and fails every comparison — so the bound is an unkillable
  // mutant when it is written as an index and simply absent when it is not.
  for (const v of field.data) if (v / 255 > threshold) n += 1;
  return n / field.data.length;
}
