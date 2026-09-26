// land-shadow.test.ts — the cast shadow's geometry, proved without a browser.
//
// Every assertion here is about WHERE the shadow falls and HOW LONG it is, which are the two
// things a plausible-looking wrong picture gets wrong silently. A shadow thrown TOWARD the light
// instead of away from it looks completely normal until you notice the whole island is lit from
// the wrong side, and this arc has already paid for one render on exactly that class of sign
// error.
//
// ⚠ IT LIVES BESIDE THE MODULE IN `src/` BECAUSE THAT IS WHERE THE MODULE LIVES NOW, and the
// mutation rung mutates a project's `src/` only. When the relief crossed, its tests stayed in
// `harness/` and the rung came back with three survivors and four uncovered lines — the sharpest
// of them the wave table itself, which could be emptied for a perfectly flat land in silence
// (`crossing-a-module-into-src-reds-two-rungs`).
//
// The tests that need the harness's own island fixture, its plant descriptors or its terrain
// march stayed behind in `harness/land-shadow.test.ts`. A `src/` test cannot import `harness/` —
// `scope-fence.test.ts` refuses it, and the synced public copy would carry a dangling import.

import assert from 'node:assert/strict';
import test from 'node:test';

import { LAND_SCALE } from './land-per-capability.js';
import { LAND_RELIEF_AMPLITUDE, landHeight } from './land-relief.js';
import { LIGHT_DIRECTION } from './shade-ladder.js';
import {
  CYLINDER_PROFILE,
  ENVELOPE_STEP,
  OCCLUSION_PAD,
  SHADOW_GRES,
  SHADOW_PENUMBRA,
  SHADOW_PENUMBRA_RUNGS,
  envelopeOcclusion,
  envelopeWidth,
  profileHalfWidth,
  profileMaxWidth,
  segmentEnvelope,
  silhouetteEnvelope,
  type SilhouetteProfile,
  SHADOW_TEXTURE_MAX,
  assertTerrainDoesNotSelfShadow,
  buildCanopyShadowField,
  emptyField,
  lightSlope,
  maxTerrainCast,
  maxTerrainSlope,
  indices,
  occlusionGres,
  occlusionGrid,
  sampleShadowField,
  shadowCoverage,
  shadowDirection,
  shadowOffsetPerUnitHeight,
  stampBox,
  span,
  cappedEdge,
  axisSpan,
  peakSlopeAt,
  PEAK_SLOPE_PER_UNIT_AMPLITUDE,
  terrainSelfShadows,
  type ShadowCaster,
  type ShadowField,
  type GroundBounds,
  type OcclusionGrid,
} from './land-shadow.js';

const BOUNDS = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };

/**
 * The grid for a fixture, REFUSED if it is not the small one this file's numbers assume.
 *
 * ⚠⚠ IT IS A FAIL-FAST GUARD RATHER THAN AN EXTRA ASSERTION, and it is here because of how the
 * mutation rung scores a hang. A field over these fixtures is ten thousand samples; under a broken
 * resolution cap it is four million, and a suite that grinds through fifteen of those is reported
 * as a TIMEOUT — which `check:mutation-diff` counts as UNPROVEN, credited to no test, neither a
 * pass nor a survivor. Asked FIRST, a wrong grid is reported as a wrong grid.
 */
function smallGrid(bounds: GroundBounds): OcclusionGrid {
  const grid = occlusionGrid(bounds);
  assert.ok(
    grid.w <= 300 && grid.h <= 300,
    `this fixture's grid is ${grid.w}x${grid.h} — the resolution cap is not capping`,
  );
  return grid;
}


test('the shadow points AWAY from the light, and is derived from the ONE authored direction', () => {
  const dir = shadowDirection();
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-9, 'not a unit vector');
  // The sign check that matters. Getting this backwards is invisible in code review and produces
  // a picture that is lit and shaded in exactly the wrong places while looking entirely plausible.
  assert.ok(dir.x * LIGHT_DIRECTION.x + dir.z * LIGHT_DIRECTION.z < 0, 'shadow points at the light');
  const ground = Math.hypot(LIGHT_DIRECTION.x, LIGHT_DIRECTION.z);
  assert.ok(Math.abs(dir.x + LIGHT_DIRECTION.x / ground) < 1e-12);
  assert.ok(Math.abs(dir.z + LIGHT_DIRECTION.z / ground) < 1e-12);
});

test('shadow length per unit of height is cot(the light’s elevation) — 0.6952, not something adjacent', () => {
  const per = shadowOffsetPerUnitHeight();
  assert.ok(Math.abs(per - 0.6952) < 0.0005, `offset per unit height moved: ${per}`);
  // And it is the exact reciprocal of the light's slope: the two are the same fact read two ways,
  // so a mutant that changes one and not the other cannot survive both assertions.
  assert.ok(Math.abs(per * lightSlope() - 1) < 1e-12);
});

test('the light climbs 1.438 units per ground unit — 55.2 degrees above the horizon', () => {
  const slope = lightSlope();
  assert.ok(Math.abs(slope - 1.4382) < 0.0005, `light slope moved: ${slope}`);
  assert.ok(Math.abs((Math.atan(slope) * 180) / Math.PI - 55.2) < 0.1);
});

test('THE FINDING: at the SHIPPED amplitude the land cannot shadow itself AT ALL', () => {
  // Not small — zero. The relief's steepest slope is nowhere near the light's, so the terrain
  // term contributes nothing to any shipped frame, which is why it did not cross.
  const peak = maxTerrainSlope(LAND_RELIEF_AMPLITUDE);
  assert.ok(Math.abs(peak - 0.455) < 0.005, `peak slope moved: ${peak}`);
  assert.ok(peak < lightSlope());
  assert.equal(terrainSelfShadows(LAND_RELIEF_AMPLITUDE), false);
  assert.doesNotThrow(() => assertTerrainDoesNotSelfShadow());
});

test('NON-VACUITY: a steep enough land DOES self-shadow, and the fence then fires', () => {
  // Without this, the finding above is equally satisfied by a predicate that always returns false
  // and an assertion that never throws. Peak slope is linear in amplitude — ~0.548 per unit now
  // that the wavenumbers are `TUNED / LAND_SCALE` (`land-per-capability.ts`; it was ~0.207 on the
  // tuned island) — so the amplitude that reaches the light is about 2.6, more than three times the
  // shipped `2.2 * LAND_SCALE`. The ratio is what held: amplitude × wavenumber is invariant.
  assert.equal(terrainSelfShadows(12), true);
  assert.throws(() => assertTerrainDoesNotSelfShadow(12), /shadows itself/);
  assert.ok(maxTerrainSlope(4.4) > maxTerrainSlope(2.2), 'peak slope must grow with amplitude');
});

test('the terrain cast bound grows with amplitude and is zero on flat land', () => {
  assert.equal(maxTerrainCast(0), 0);
  assert.ok(maxTerrainCast(2.2) > 0);
  assert.ok(maxTerrainCast(4.4) > maxTerrainCast(2.2));
});

test('the grid pads the bounds, is sized at the declared resolution, and is shared', () => {
  const grid = occlusionGrid(BOUNDS);
  assert.equal(OCCLUSION_PAD, 2);
  assert.equal(SHADOW_GRES, 3);
  assert.equal(grid.minX, BOUNDS.minX - OCCLUSION_PAD);
  assert.equal(grid.minZ, BOUNDS.minZ - OCCLUSION_PAD);
  assert.equal(grid.gres, SHADOW_GRES);
  // 80 units + 2 x 2 pad, at 3 samples per unit.
  assert.equal(grid.w, 252);
  assert.equal(grid.h, 252);
  // The island the studio ships, so the number in the evidence is the one a test holds.
  const island = occlusionGrid({ minX: -116.9, maxX: 116.9, minZ: -23.1, maxZ: 23.1 });
  assert.equal(island.w, 714);
  assert.equal(island.h, 151);
  assert.equal(island.w * island.h, 107814);
});

test('THE PAYLOAD FENCE: a huge scene coarsens rather than allocating a 36 MB texture', () => {
  const wide = { minX: -1500, maxX: 1500, minZ: -1500, maxZ: 1500 };
  const gres = occlusionGres(wide);
  assert.ok(gres < SHADOW_GRES, 'a 3000-unit span must not be sampled at full resolution');
  const grid = occlusionGrid(wide);
  assert.ok(grid.w <= SHADOW_TEXTURE_MAX, `w ${grid.w} exceeds the texture cap`);
  assert.ok(grid.h <= SHADOW_TEXTURE_MAX, `h ${grid.h} exceeds the texture cap`);
  // NON-VACUITY: one island is nowhere near the cap, so the clamp is not simply always on.
  assert.equal(occlusionGres(BOUNDS), SHADOW_GRES);
});

test('an empty field is the right size and identically zero', () => {
  smallGrid(BOUNDS);
  const field = emptyField(occlusionGrid(BOUNDS));
  assert.equal(field.data.length, field.w * field.h);
  assert.equal(shadowCoverage(field), 0);
  assert.ok(field.data.every((v) => v === 0));
});

test('FLAT land with no casters is unshadowed — the control that keeps every other test honest', () => {
  smallGrid(BOUNDS);
  const field = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [] });
  assert.equal(shadowCoverage(field), 0);
  // And with the relief on, still nothing: the terrain term is not in this function at all.
  const relieved = buildCanopyShadowField({ bounds: BOUNDS, relief: 12, casters: [] });
  assert.equal(shadowCoverage(relieved), 0);
});

test('a single caster on FLAT land throws its shadow the analytic distance, in the right place', () => {
  smallGrid(BOUNDS);
  const caster: ShadowCaster = { x: 0, z: 0, radius: 2, height: 10 };
  const field = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster] });
  const dir = shadowDirection();
  const reach = caster.height * shadowOffsetPerUnitHeight();
  // Just inside the tip: shadowed. Well past it: not.
  const inX = dir.x * reach * 0.9;
  const inZ = dir.z * reach * 0.9;
  assert.ok(sampleShadowField(field, inX, inZ) > 0.5, 'the shadow does not reach its own tip');
  const outX = dir.x * reach * 1.4;
  const outZ = dir.z * reach * 1.4;
  assert.ok(sampleShadowField(field, outX, outZ) < 0.5, 'the shadow overshoots its analytic tip');
  // TOWARD the light there is never a shadow, whatever the caster.
  assert.equal(sampleShadowField(field, -dir.x * 6, -dir.z * 6), 0);
});

test('a taller caster throws a proportionally longer shadow', () => {
  smallGrid(BOUNDS);
  const short = buildCanopyShadowField({
    bounds: BOUNDS,
    relief: 0,
    casters: [{ x: 0, z: 0, radius: 2, height: 6 }],
  });
  const tall = buildCanopyShadowField({
    bounds: BOUNDS,
    relief: 0,
    casters: [{ x: 0, z: 0, radius: 2, height: 18 }],
  });
  assert.ok(shadowCoverage(tall) > shadowCoverage(short) * 2, 'height must lengthen the shadow');
  const dir = shadowDirection();
  const far = 12 * shadowOffsetPerUnitHeight();
  assert.equal(sampleShadowField(short, dir.x * far, dir.z * far), 0);
  assert.ok(sampleShadowField(tall, dir.x * far, dir.z * far) > 0.5);
});

test('the penumbra softens the EDGE and nothing else — the core is fully occluded', () => {
  smallGrid(BOUNDS);
  assert.equal(SHADOW_PENUMBRA, 0.6);
  assert.ok(SHADOW_PENUMBRA_RUNGS.includes(SHADOW_PENUMBRA), 'the shipped penumbra is not a rung the owner was shown');
  const caster: ShadowCaster = { x: 0, z: 0, radius: 4, height: 10 };
  const field = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster] });
  const dir = shadowDirection();
  const alongX = dir.x * 4;
  const alongZ = dir.z * 4;
  // On the axis, well inside the radius: full occlusion.
  assert.ok(sampleShadowField(field, alongX, alongZ) > 0.95);
  // Across the shadow, past the radius but inside the penumbra: partial.
  const acrossX = alongX + -dir.z * (caster.radius + SHADOW_PENUMBRA * 0.5);
  const acrossZ = alongZ + dir.x * (caster.radius + SHADOW_PENUMBRA * 0.5);
  const edge = sampleShadowField(field, acrossX, acrossZ);
  assert.ok(edge > 0 && edge < 1, `the edge should be soft, got ${edge}`);
});

test('two casters take the GREATER occlusion — a stack never doubles into a slab', () => {
  smallGrid(BOUNDS);
  const a: ShadowCaster = { x: 0, z: 0, radius: 3, height: 10 };
  const b: ShadowCaster = { x: 1, z: 1, radius: 3, height: 10 };
  const both = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [a, b] });
  assert.ok(both.data.every((v) => v <= 255));
  const dir = shadowDirection();
  assert.ok(sampleShadowField(both, dir.x * 3, dir.z * 3) <= 1);
});

test('the relief moves the shadow — the ground it lands on is part of the answer', () => {
  smallGrid(BOUNDS);
  const caster: ShadowCaster = { x: 0, z: 0, radius: 2, height: 10 };
  const flat = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster] });
  const hilly = buildCanopyShadowField({ bounds: BOUNDS, relief: 8, casters: [caster] });
  assert.notEqual(shadowCoverage(flat), shadowCoverage(hilly));
  // And the relief really is the field this module reads, not a number it ignores.
  assert.notEqual(landHeight(3, 3, 8), landHeight(3, 3, 0));
});

test('sampling is bilinear, exact at texel centres, and clamps outside the field', () => {
  smallGrid(BOUNDS);
  const grid = occlusionGrid(BOUNDS);
  const field = emptyField(grid);
  const at = (i: number, j: number): number => j * field.w + i;
  field.data[at(10, 10)] = 255;
  field.data[at(11, 10)] = 255;
  field.data[at(10, 11)] = 255;
  field.data[at(11, 11)] = 255;
  const x = grid.minX + 10 / grid.gres;
  const z = grid.minZ + 10 / grid.gres;
  assert.ok(Math.abs(sampleShadowField(field, x, z) - 1) < 1e-9, 'exact at a texel centre');
  // Halfway to a zero neighbour: half.
  const half = sampleShadowField(field, x - 0.5 / grid.gres, z);
  assert.ok(Math.abs(half - 0.5) < 1e-6, `bilinear midpoint was ${half}`);
  // Far outside: clamped to the edge texel, not an out-of-bounds read.
  assert.equal(sampleShadowField(field, -1e6, -1e6), 0);
  assert.equal(sampleShadowField(field, 1e6, 1e6), 0);
});

test('coverage is a FRACTION past the material’s own 0.5 threshold', () => {
  smallGrid(GOLD_BOUNDS);
  const grid = occlusionGrid(BOUNDS);
  const field = emptyField(grid);
  const total = field.data.length;
  for (let i = 0; i < total / 4; i += 1) field.data[i] = 255;
  assert.ok(Math.abs(shadowCoverage(field) - 0.25) < 1e-9);
  // The threshold is the material's, and a value at it does not count — the shader tests `> 0.5`.
  const halfLit = emptyField(grid);
  halfLit.data.fill(128);
  assert.equal(shadowCoverage(halfLit, 0.9), 0);
  assert.equal(shadowCoverage(halfLit, 0.4), 1);
});

// ---------------------------------------------------------------------------
// THE GOLDENS, and why they sit beside the properties above rather than replacing them.
//
// ⚠ A PROPERTY TEST SAYS THE CODE IS CORRECT; IT DOES NOT PIN WHICH IMPLEMENTATION IS RUNNING.
// "The shadow lengthens with height" and "the pool falls away with distance" are both satisfied by
// a dozen wrong formulas, and the mutation rung charges a crossed module its whole file. So the
// arithmetic below is pinned to numbers read off one run and committed — the properties carry the
// argument, the goldens say which code is making it.
//
// ⚠ AND THE FIXTURE IS DELIBERATELY ASYMMETRIC. A ±40 box makes `maxX - minX` and `maxX + minX`
// deliver 0 and 80, which sounds like a difference and is not: the clamp then reads the OTHER
// axis, which is identical, and the mutant survives. Bounds with four different numbers make each
// span independently observable.
// ---------------------------------------------------------------------------

/** Bounds whose four edges are four different numbers, so no two spans coincide. */
const GOLD_BOUNDS = { minX: -13, maxX: 21, minZ: -7, maxZ: 11 };
const GOLD_CASTER: ShadowCaster = { x: 1, z: 2, radius: 2, height: 10 };

/** A field's exact content, as numbers a mutant cannot slip past. Duplicated in
 *  `contact-shade.test.ts` rather than exported from `src/`: it is a test's summary of a field,
 *  and shipping it would be shipped code only a test calls. */
function fieldSignature(f: ShadowField) {
  let nonZero = 0;
  let sum = 0;
  let max = 0;
  let first = -1;
  let last = -1;
  for (let p = 0; p < f.data.length; p += 1) {
    const v = f.data[p]!;
    if (v === 0) continue;
    nonZero += 1;
    sum += v;
    if (v > max) max = v;
    if (first < 0) first = p;
    last = p;
  }
  return { w: f.w, h: f.h, gres: f.gres, minX: f.minX, minZ: f.minZ, nonZero, sum, max, first, last };
}

test('GOLDEN: the authored light’s two derivations, to full precision', () => {
  // ⚠ A TOLERANCE OF 1e-12 RATHER THAN `equal`, and it is still a golden. These are ratios of
  // transcendental-looking constants, and the exact double a build produces is not something a
  // test should depend on; every mutant that could reach them (a `/` for a `*`, a dropped
  // `Math.hypot`) moves the answer by orders of magnitude, not by an ulp.
  assert.ok(Math.abs(lightSlope() - 1.4383751516635277) < 1e-12, `${lightSlope()}`);
  assert.ok(
    Math.abs(shadowOffsetPerUnitHeight() - 0.6952289177433769) < 1e-12,
    `${shadowOffsetPerUnitHeight()}`,
  );
});

test('GOLDEN: the terrain cast bound and the sampled peak slope', () => {
  // The cast bound is the weight sum × amplitude × the light — no wavenumber in it — so it does not
  // move with the island at an explicit amplitude.
  assert.ok(Math.abs(maxTerrainCast(2.2) - 5.873293897096049) < 1e-12, `${maxTerrainCast(2.2)}`);
  // ⚠ THE SAMPLED SLOPES ARE THE TUNED-ISLAND GOLDENS, HELD THROUGH LAND_SCALE. The wavenumbers are
  // `TUNED / LAND_SCALE` and the shipped amplitude `2.2 * LAND_SCALE` (`land-per-capability.ts`),
  // so the field is the tuned one LAND_SCALE smaller in every direction and its SLOPE at the
  // corresponding point is unchanged. Asking the sampler for the tuned amplitude on the tuned
  // patch, both scaled by LAND_SCALE, visits exactly the tuned sweep's points and returns exactly
  // its numbers — the same goldens, not regenerated ones.
  const T = LAND_SCALE;
  assert.ok(
    Math.abs(maxTerrainSlope(2.2 * T, 200 * T, 0.5 * T) - 0.4546385098147919) < 1e-12,
    `${maxTerrainSlope(2.2 * T, 200 * T, 0.5 * T)}`,
  );
  // ⚠ THE SWEEP'S OWN PARAMETERS MATTER, and a fixed-patch sampler that ignored them would pass
  // every property above. A patch nine units wide sees a fraction of one wavelength; a coarser
  // step misses the crest it lands between.
  assert.ok(Math.abs(maxTerrainSlope(2.2 * T, 9 * T, 0.5 * T) - 0.2717702818871019) < 1e-12);
  assert.ok(Math.abs(maxTerrainSlope(2.2 * T, 200 * T, 3 * T) - 0.45284160144482843) < 1e-12);
});

test('GOLDEN: the grid over an asymmetric rect', () => {
  assert.deepEqual(occlusionGrid(GOLD_BOUNDS), {
    minX: -15,
    minZ: -9,
    w: 114,
    h: 66,
    gres: 3,
  });
});

test('GOLDEN: the clamp reads the WIDEST axis, and each span is its own arithmetic', () => {
  // A rect 3010 units across and 14 deep. Both spans go into `Math.max`, so a mutant in either
  // one moves the answer — which a square fixture hides, because the surviving axis carries it.
  const wide = { minX: -10, maxX: 3000, minZ: -5, maxZ: 5 };
  assert.ok(Math.abs(occlusionGres(wide) - 0.6794956867949569) < 1e-15, `${occlusionGres(wide)}`);
  const wideGrid = occlusionGrid(wide);
  assert.equal(wideGrid.minX, -12);
  assert.equal(wideGrid.minZ, -7);
  assert.equal(wideGrid.w, 2048);
  assert.equal(wideGrid.h, 10);
  assert.equal(wideGrid.gres, occlusionGres(wide));
  // The clamp is exactly the cap, not merely under it — `max / widest` and nothing else.
  assert.ok(
    Math.abs(occlusionGres(wide) * (3010 + OCCLUSION_PAD * 2) - SHADOW_TEXTURE_MAX) < 1e-9,
  );
});

test('GOLDEN: the cast field on flat land, byte for byte', () => {
  // ⚠ `penumbra: 1.2` names the width the field wore until 2026-09-06 — the golden was stamped at
  // it; the shipped width is `SHADOW_PENUMBRA` (0.6, laddered), held by the penumbra test above.
  smallGrid(GOLD_BOUNDS);
  assert.deepEqual(
    fieldSignature(buildCanopyShadowField({ bounds: GOLD_BOUNDS, relief: 0, casters: [GOLD_CASTER], penumbra: 1.2 })),
    { w: 114, h: 66, gres: 3, minX: -15, minZ: -9, nonZero: 400, sum: 63854, max: 255, first: 1653, last: 4614 },
  );
});

test('GOLDEN: the relief moves it, and by exactly this much', () => {
  smallGrid(GOLD_BOUNDS);
  // ⚠ THE PAIR IS THE POINT. The flat golden alone is satisfied by a builder that ignores its
  // relief argument; the relieved one alone is satisfied by one that ignores the caster. Together
  // they say the ground the shadow lands on is part of the answer.
  //
  // ⚠ REGENERATED 2026-09-05 BECAUSE THE RELIEF TERM MOVED WITH LAND_SCALE (`land-per-capability.ts`:
  // the wavenumbers are now `TUNED / LAND_SCALE`), and for that reason ONLY. The caster sits at
  // fixed texels and the amplitude here is an explicit 2.2, so the ground under the shadow is a
  // different land — the same waves, LAND_SCALE shorter — and the ray leaves the cylinder at
  // different samples. Confirmed by diff before regenerating: a copy of the stamp with the relief
  // term pluggable reproduces the OLD signature (nonZero 362, sum 58006, first 1653) with the
  // tuned relief `h(LAND_SCALE·p)` and THIS one with the shipped relief; the flat golden above is
  // untouched, so every non-relief term (grid, box, direction, penumbra) is provably the same.
  assert.deepEqual(
    fieldSignature(
      buildCanopyShadowField({ bounds: GOLD_BOUNDS, relief: 2.2, casters: [GOLD_CASTER], penumbra: 1.2 }),
    ),
    { w: 114, h: 66, gres: 3, minX: -15, minZ: -9, nonZero: 384, sum: 61042, max: 255, first: 1202, last: 4614 },
  );
});

test('an EXPLICIT gres is honoured rather than falling through to the default', () => {
  smallGrid(GOLD_BOUNDS);
  // `opts.gres ?? SHADOW_GRES` and `opts.gres && SHADOW_GRES` agree whenever `gres` is absent —
  // which is every call the shipped canvas makes. Only an explicit value separates them.
  const coarse = buildCanopyShadowField({
    bounds: GOLD_BOUNDS,
    relief: 0,
    casters: [GOLD_CASTER],
    gres: 1,
  });
  assert.equal(coarse.gres, 1);
  assert.equal(coarse.w, 38);
  assert.equal(coarse.h, 22);
});

test('bilinear sampling interpolates in Z as well as in X', () => {
  smallGrid(GOLD_BOUNDS);
  // The X half is asserted above. Without this, `at(i0, j0 + 1)` could read `j0 - 1` and every
  // shadow would sample two thirds of a unit north of where it was stamped.
  const grid = occlusionGrid(GOLD_BOUNDS);
  const field = emptyField(grid);
  const at = (i: number, j: number): number => j * field.w + i;
  field.data[at(10, 10)] = 255;
  field.data[at(11, 10)] = 255;
  const x = grid.minX + 10.5 / grid.gres;
  const z = grid.minZ + 10 / grid.gres;
  assert.ok(Math.abs(sampleShadowField(field, x, z) - 1) < 1e-9, 'on the lit row');
  const half = sampleShadowField(field, x, z + 0.5 / grid.gres);
  assert.ok(Math.abs(half - 0.5) < 1e-6, `halfway to the empty row below: ${half}`);
  const north = sampleShadowField(field, x, z - 0.5 / grid.gres);
  assert.ok(Math.abs(north - 0.5) < 1e-6, `halfway to the empty row above: ${north}`);
});

test('the fence NAMES the two numbers it compared, so the failure is readable', () => {
  // ⚠ AN ERROR MESSAGE IS SOURCE TOO. Blanked to an empty template it still throws, still passes a
  // `assert.throws(fn)`, and tells whoever hits it nothing about which constant moved.
  assert.throws(
    () => assertTerrainDoesNotSelfShadow(12),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.match(message, /amplitude 12/);
      // 12 × PEAK_SLOPE_PER_UNIT_AMPLITUDE (0.5481 since the relief's wavelengths followed LAND_SCALE).
      assert.match(message, /6\.578/, 'the peak slope at that amplitude');
      assert.match(message, /1\.438/, "the authored light's own slope");
      assert.match(message, /harness\/land-shadow\.ts/, 'where the missing term lives');
      return true;
    },
  );
});

test('coverage counts strictly PAST the threshold, and the material tests `> 0.5`', () => {
  smallGrid(GOLD_BOUNDS);
  const grid = occlusionGrid(GOLD_BOUNDS);
  const exact = emptyField(grid);
  // 128/255 = 0.50196…, which is past 0.5; 127/255 = 0.498…, which is not. The boundary is
  // where a `>=` mutant would differ, so it is asked at the two bytes that straddle it.
  exact.data.fill(128);
  assert.equal(shadowCoverage(exact), 1);
  const under = emptyField(grid);
  under.data.fill(127);
  assert.equal(shadowCoverage(under), 0);
  // And at the threshold exactly: `v / 255 > threshold` must be false.
  const onIt = emptyField(grid);
  onIt.data.fill(128);
  assert.equal(shadowCoverage(onIt, 128 / 255), 0, 'a sample AT the threshold does not count');
});

test('GOLDEN: the sweep’s own BOUNDARY row is sampled, not stopped one short of', () => {
  // ⚠ A PATCH WHOSE LAST ROW IS THE PEAK, found by searching for one rather than hoped for. At
  // span 47 the steepest gradient in the patch lies exactly on `z = +span/2`, so `z <= span/2`
  // and `z < span/2` give different answers — which is the only way to tell a sampler that
  // covers its stated patch from one that covers all but the edge of it.
  //
  // ⚠ HELD THROUGH LAND_SCALE like the sampler goldens above: the patch, its step and the
  // amplitude all scale by LAND_SCALE, so the sweep visits the tuned island's own points (the
  // ratio `span / step`, which sizes the axis, is unchanged) and the boundary row is the SAME
  // row, carrying the same peak.
  const T = LAND_SCALE;
  assert.ok(Math.abs(maxTerrainSlope(2.2 * T, 47 * T, 1 * T) - 0.3959299914294673) < 1e-12,
    `${maxTerrainSlope(2.2 * T, 47 * T, 1 * T)}`);
  // And it really is the boundary that carries it: one step narrower and the peak is gone.
  assert.ok(maxTerrainSlope(2.2 * T, 46 * T, 1 * T) < 0.3959299914294673);
});

test('THE BOX, asserted directly — because a delivered field cannot see it', () => {
  // ⚠ THE SUBJECT IS THE BOX, NOT THE FIELD. Every sample inside a stamp box is tested again
  // against the caster's own geometry, so a box that is too wide delivers an identical field and
  // costs only time — which makes half of its arithmetic invisible to any assertion about pixels.
  // Named and returned, it is a value with four numbers in it.
  const grid = occlusionGrid({ minX: 100, maxX: 141, minZ: 60, maxZ: 89 });
  assert.equal(grid.minX, 98);
  assert.equal(grid.minZ, 58);
  assert.equal(grid.w, 135);
  assert.equal(grid.h, 99);
  // An interior rect: all four edges land where the arithmetic puts them.
  const box = stampBox(grid, 110, 120, 70, 80);
  assert.equal(box.i0, 36);
  assert.equal(box.i1, 66);
  assert.equal(box.j0, 36);
  assert.equal(box.j1, 66);
  // ⚠ AND THE RANGES IT WILL WALK, which is the half a delivered field cannot show: a box one row
  // short usually loses a row that was going to be rejected anyway.
  assert.equal(box.rows.length, 31);
  assert.equal(box.cols.length, 31);
  assert.equal(box.rows[0], 36);
  assert.equal(box.rows.at(-1), 66);
  assert.deepEqual(box.cols, box.rows, 'a square rect on a square grid walks the same two ranges');
  // ⚠ THE ORIGIN IS SUBTRACTED, NOT ADDED, AND THE RESOLUTION MULTIPLIES, NOT DIVIDES. With a
  // ground origin of 98 those are three different boxes, which is why this fixture sits far from
  // zero: at the origin, `- minX` and `+ minX` are the same thing.
  assert.notDeepEqual(
    stampBox(grid, 110, 120, 70, 80).cols,
    stampBox(grid, 110 + 98, 120 + 98, 70, 80).cols,
  );
});

test('the box CLAMPS to the buffer on all four sides', () => {
  const grid = occlusionGrid({ minX: 100, maxX: 141, minZ: 60, maxZ: 89 });
  // A rect running off every edge is clamped to the buffer rather than addressing outside it.
  const all = stampBox(grid, -500, 500, -500, 500);
  assert.equal(all.i0, 0);
  assert.equal(all.i1, 134);
  assert.equal(all.j0, 0);
  assert.equal(all.j1, 98);
  assert.equal(all.cols.length, 135);
  assert.equal(all.rows.length, 99);
  // A rect entirely OFF the buffer comes back EMPTY rather than clamped to its first sample:
  // `i1 < i0`, so the stamp loop runs zero times. Clamping it to {0,0} instead would darken the
  // island's corner for every caster that missed the field entirely.
  const off = stampBox(grid, 90, 95, 50, 55);
  assert.equal(off.i1, -9);
  assert.equal(off.j1, -9);
  assert.deepEqual(off.cols, [], 'an empty box walks no columns');
  assert.deepEqual(off.rows, [], 'and no rows');
  // ⚠ THE COLUMN CLAMP IS THE ONE THAT PREVENTS A VISIBLE DEFECT: an `i` past `w - 1` wraps onto
  // the next row and writes a caster's shadow on the far side of the island. A `j` past `h - 1`
  // addresses past the end of the buffer, where a typed array drops the write — harmless, and
  // still clamped, because a clamp that happens to be harmless is not the same as one that is
  // not there.
  const wide = stampBox(grid, 100, 400, 60, 400);
  assert.equal(wide.i1, grid.w - 1);
  assert.equal(wide.j1, grid.h - 1);
});

test('the padded span is ONE function, so neither axis carries an unobservable copy', () => {
  assert.equal(axisSpan(100, 141), 45);
  assert.equal(axisSpan(-13, 21), 38);
  assert.equal(axisSpan(0, 0), OCCLUSION_PAD * 2);
  // And the clamp reads the TALLER axis as readily as the wider one — asked with a rect whose
  // depth dominates, so a mutant in the Z span cannot hide behind the X span carrying the answer.
  const tall = { minX: -5, maxX: 5, minZ: -10, maxZ: 3000 };
  assert.ok(Math.abs(occlusionGres(tall) - SHADOW_TEXTURE_MAX / axisSpan(-10, 3000)) < 1e-15);
  assert.ok(occlusionGres(tall) < SHADOW_GRES);
  assert.equal(occlusionGrid(tall).h, SHADOW_TEXTURE_MAX);
  // ⚠ AND THE CAP IS THE GRID'S OWN, not merely the resolution helper's: whatever resolution it is
  // handed, the buffer it describes stays inside the budget.
  assert.equal(cappedEdge(1e9), SHADOW_TEXTURE_MAX);
  assert.equal(cappedEdge(0), 1, 'and never smaller than one sample');
  assert.equal(cappedEdge(41.2), 42, 'a partial sample still needs a whole one');
  assert.ok(occlusionGrid(tall, 1000).w <= SHADOW_TEXTURE_MAX);
  assert.ok(occlusionGrid(tall, 1000).h <= SHADOW_TEXTURE_MAX);
});

test('THE LINEAR LAW the fence rests on — both halves, because either alone is satisfiable', () => {
  // ⚠ THE FENCE IS A MULTIPLY RATHER THAN A 160,801-POINT SWEEP, because it runs on every field
  // build and a canvas that re-derived a constant before drawing would be a real defect hiding
  // inside a correctness check. That is only honest if BOTH of these hold.
  //
  // ⚠ AND THE LITERAL MUST BE RE-DERIVED WHENEVER THE WAVENUMBERS MOVE — it is `maxTerrainSlope(1)`
  // over the sampler's OWN default patch in whatever ground units the land is in, and it is not a
  // number this test can scale for the source: the wavenumbers went to `TUNED / LAND_SCALE` on
  // 2026-09-05 (`land-per-capability.ts`), so the per-unit slope rose by ~1 / LAND_SCALE, and the
  // default 200-unit patch now spans 2.65× more wavelengths than it did. This half is what says so.
  //
  // (a) the constant IS what the sampler returns at amplitude 1 — to the last representable place
  //     rather than bit for bit, and the slack is ARCHITECTURE, not flake. `landGradient` sums
  //     `Math.sin`/`Math.cos` terms, which ECMA-262 leaves implementation-approximated, so the
  //     sum's final bit belongs to the platform: the arm64 dev box returns 0.5481413856707604
  //     where the x64 CI that pinned this literal returns ...605. One ULP, deterministic on each,
  //     reproducible on every run — and NOT `Math.hypot`, whose correctly-rounded `Math.sqrt`
  //     twin gives arm64 the same ...604. `assert.equal` here does not test the sampler, it
  //     elects an architecture: pinning either value simply chooses whose gate is red.
  //
  // ⚠ AND THE TOLERANCE COSTS THE ASSERTION NOTHING — measured, not hoped. Eight ULP of 0.548 is
  //     9.7e-16, and every drift this half exists to catch clears it by eleven orders of
  //     magnitude: the 2026-09-05 retune above moved the constant by 0.341 (3.5e14x the
  //     tolerance), and the smallest sampling nudge that changes the answer at all — the default
  //     span 200 → 200.5, or the step 0.5 → 0.4 — moves it by 1.2e-4 (1e11x). Nor can a platform
  //     smuggle a real change through the ULP door by winning the max with a DIFFERENT sample:
  //     exactly ONE of the 160,801 samples attains the peak and the runner-up is 1.7e-4 below it,
  //     so there is no near-tie to flip. Scaled by the constant rather than absolute, so a
  //     re-derived literal carries its own slack instead of needing this epsilon re-tuned too.
  const atUnitAmplitude = maxTerrainSlope(1);
  assert.ok(
    Math.abs(atUnitAmplitude - PEAK_SLOPE_PER_UNIT_AMPLITUDE) <=
      PEAK_SLOPE_PER_UNIT_AMPLITUDE * 8 * Number.EPSILON,
    `the sampler says ${atUnitAmplitude} and PEAK_SLOPE_PER_UNIT_AMPLITUDE is ` +
      `${PEAK_SLOPE_PER_UNIT_AMPLITUDE} — further apart than a last-place difference, so the ` +
      'wavenumbers have moved and the constant must be re-derived (see the note above)',
  );
  // (b) and the sampler really is linear in the amplitude, across the whole range this land could
  //     ever wear. The relief is a sum of waves scaled by the amplitude, so its gradient scales
  //     with it exactly — asserted rather than argued, at seven amplitudes.
  for (const relief of [0.5, 2.2, 3.2, 4.4, 7, 12, 40]) {
    const sampled = maxTerrainSlope(relief);
    assert.ok(
      Math.abs(sampled - peakSlopeAt(relief)) < 1e-12,
      `at amplitude ${relief} the sampler says ${sampled} and the law says ${peakSlopeAt(relief)}`,
    );
  }
  // And the law is not vacuously flat: it really does rise with the amplitude.
  assert.ok(peakSlopeAt(4.4) > peakSlopeAt(2.2));
  assert.equal(peakSlopeAt(0), 0);
});

test('a range runs LO to HI inclusive, and an inverted one is empty', () => {
  assert.deepEqual(span(3, 7), [3, 4, 5, 6, 7]);
  assert.deepEqual(span(0, 0), [0]);
  assert.deepEqual(span(5, 4), [], 'hi below lo is a box with nothing in it');
  assert.deepEqual(span(-2, 1), [-2, -1, 0, 1]);
  assert.deepEqual(indices(4), [0, 1, 2, 3]);
  assert.deepEqual(indices(0), []);
  assert.deepEqual(indices(-9), [], 'a negative count is no samples, not a throw');
});

test('⚠ THE TEXTURE BUDGET IS AN ARGUMENT, and passing one really changes the grid', () => {
  // `cappedEdge`, `occlusionGrid`, `buildCanopyShadowField` and `buildGroundOcclusion` each default
  // it with `??`. A mutant turning any of those into `&&` discards the caller's value and uses the
  // authored one — which is invisible unless a test passes a value that DIFFERS from the default.
  // The comparison instrument is the only caller that does, and this is what stands behind it.
  // ⚠⚠ THIN, NOT SQUARE, AND THAT IS A MUTATION-RUNG REQUIREMENT. A CLAMPED field is
  // {@link SHADOW_TEXTURE_MAX} texels on its widest edge whatever the bounds — so a 3000 x 3000
  // fixture allocates 4.2 million samples three times over, per mutant, and the rung reports the
  // resulting timeout as UNPROVEN in the same words an attribution gap produces. Long in x and ten
  // units deep clamps exactly as hard and costs 74 thousand.
  const wide: GroundBounds = { minX: 0, maxX: 800, minZ: 0, maxZ: 10 };
  assert.equal(cappedEdge(5000), SHADOW_TEXTURE_MAX, 'the default cap is the authored one');
  assert.equal(cappedEdge(5000, 4096), 4096, 'and an explicit cap is the one applied');

  const authored = occlusionGrid(wide);
  const raised = occlusionGrid(wide, SHADOW_GRES, 8192);
  assert.ok(raised.gres > authored.gres, 'a bigger budget must buy resolution');
  assert.ok(raised.w > authored.w, 'and a bigger field');

  const field = buildCanopyShadowField({
    bounds: wide,
    relief: 2.2,
    casters: [{ x: 400, z: 5, radius: 7, height: 19 }],
    max: 512,
  });
  assert.ok(field.w <= 512 && field.h <= 512, 'an explicit max must bound the built field');
  assert.ok(field.gres < SHADOW_GRES, 'and cost resolution to get there');
});

// ---------------------------------------------------------------------------
// the silhouette (2026-09-06) — the projected form rather than the swept disc
// ---------------------------------------------------------------------------

const CONE = [
  [0, 0.1],
  [0.2, 0.1],
  [0.2, 1],
  [1, 0],
] as const;

/**
 * THE REFERENCE, BRUTE-FORCED: how occluded a sample is by a profiled caster, as the largest
 * penumbra-ramp value over a fine grid of heights the ray passes through — the definition the
 * source's closed form and table are held to. It lives HERE, in the test, so it carries no
 * sampling constant the mutation rung could move by less than a fixture can see.
 */
function bruteOcclusion(
  profile: SilhouetteProfile,
  radius: number,
  height: number,
  yStar: number,
  across: number,
  perUnit: number,
  penumbra: number,
): number {
  if (height <= 0) return 0;
  let best = 0;
  const steps = 2000;
  for (let i = 0; i <= steps; i += 1) {
    const y = (height * i) / steps;
    const w = profileHalfWidth(profile, y / height) * radius;
    const d = Math.hypot(perUnit * (yStar - y), across);
    best = Math.max(best, (w + penumbra - d) / (2 * penumbra));
  }
  return Math.max(0, Math.min(1, best));
}

/** The brute-force outline: the widest `across` the ray is occluded at, over the same fine grid. */
function bruteWidth(profile: SilhouetteProfile, radius: number, height: number, yStar: number, perUnit: number): number {
  let best = 0;
  const steps = 4000;
  for (let i = 0; i <= steps; i += 1) {
    const y = (height * i) / steps;
    const w = profileHalfWidth(profile, y / height) * radius;
    const sq = w * w - (perUnit * (yStar - y)) ** 2;
    if (sq > best) best = sq;
  }
  return Math.sqrt(best);
}

test('profileHalfWidth interpolates between pairs, takes the WIDER side of a step, and is zero outside the form', () => {
  assert.equal(profileHalfWidth(CYLINDER_PROFILE, 0), 1);
  assert.equal(profileHalfWidth(CYLINDER_PROFILE, 0.5), 1);
  assert.equal(profileHalfWidth(CYLINDER_PROFILE, 1), 1);
  assert.equal(profileHalfWidth(CYLINDER_PROFILE, -0.01), 0);
  assert.equal(profileHalfWidth(CYLINDER_PROFILE, 1.01), 0);
  assert.equal(profileHalfWidth([], 0.5), 0);
  // Interpolation on the cone's taper: halfway from the crown base (1) to the tip (0) is 0.5.
  assert.ok(Math.abs(profileHalfWidth(CONE, 0.6) - 0.5) < 1e-12);
  assert.ok(Math.abs(profileHalfWidth(CONE, 0.1) - 0.1) < 1e-12);
  // The step at 0.2: the wider (crown) side wins, exactly at the step.
  assert.equal(profileHalfWidth(CONE, 0.2), 1);
  assert.ok(profileHalfWidth(CONE, 0.19) < 0.11, 'the trunk widened below the step');
  assert.equal(profileHalfWidth(CONE, 1), 0);
  assert.equal(profileMaxWidth(CONE), 1);
  assert.equal(profileMaxWidth([[0, 0.3], [1, 0.6]]), 0.6);
  assert.equal(profileMaxWidth([]), 0);
});

test('the brute-force reference on the CYLINDER profile reproduces the swept disc: 1 inside, 0.5 on the silhouette, 0 a penumbra out', () => {
  const per = shadowOffsetPerUnitHeight();
  const r = 3;
  const h = 10;
  const pen = 1.2;
  // Beside the axis, at a height the ray passes the axis inside the form.
  assert.equal(bruteOcclusion(CYLINDER_PROFILE, r, h, 5, 0, per, pen), 1);
  assert.equal(bruteOcclusion(CYLINDER_PROFILE, r, h, 5, r - pen, per, pen), 1);
  assert.ok(Math.abs(bruteOcclusion(CYLINDER_PROFILE, r, h, 5, r, per, pen) - 0.5) < 1e-9);
  assert.equal(bruteOcclusion(CYLINDER_PROFILE, r, h, 5, r + pen, per, pen), 0);
  // A ray passing the axis ABOVE the tip is still met by the top of the cylinder where its
  // horizontal distance is inside the radius — the rounded cap the closed form cut flat.
  assert.ok(bruteOcclusion(CYLINDER_PROFILE, r, h, h + 0.5 / per, 0, per, pen) > 0.5);
  // But well above it, nothing.
  assert.equal(bruteOcclusion(CYLINDER_PROFILE, r, h, h + (r + pen + 1) / per, 0, per, pen), 0);
  // No height, no occlusion.
  assert.equal(bruteOcclusion(CYLINDER_PROFILE, r, 0, 0, 0, per, pen), 0);
});

test('a CONE occludes the ray at its crown and NOT beside its trunk — the shadow is thin near the foot and a point at the tip', () => {
  const per = shadowOffsetPerUnitHeight();
  const r = 3;
  const h = 10;
  const pen = 0.3;
  // Beside the FOOT, near the crown's full radius: the ray climbs past the trunk into the crown,
  // whose overhang does not reach out this far at the height the ray gets there — under 0.5,
  // where the cylinder has it fully shadowed. (Closer in, at 1 unit, the crown DOES overhang
  // the ray and both forms shadow it: a pine shades the ground around its own foot.)
  assert.ok(bruteOcclusion(CONE, r, h, 0.1, 2.9, per, pen) < 0.5, 'the cone is as wide as the cylinder at the foot');
  assert.ok(bruteOcclusion(CYLINDER_PROFILE, r, h, 0.1, 2.9, per, pen) > 0.5, 'the cylinder is not occluded inside its own radius');
  assert.equal(bruteOcclusion(CONE, r, h, 1, 1, per, pen), 1, 'the crown does not overhang the foot');
  // A bare stem (no crown) IS clear beside its trunk — the overhang above is what shadowed it.
  assert.equal(bruteOcclusion([[0, 0.1], [1, 0.1]], r, h, 1, 1, per, pen), 0);
  // At the crown's widest height it is as wide as the cylinder.
  assert.equal(bruteOcclusion(CONE, r, h, 2, 2.5, per, pen), 1);
  // Two-thirds of the way to the tip the crown is a third as wide: 2.5 out is clear.
  assert.equal(bruteOcclusion(CONE, r, h, 9, 2.5, per, pen), 0);
  assert.ok(bruteOcclusion(CONE, r, h, 9, 0.2, per, pen) > 0.5);
  // The width narrows monotonically along the crown.
  let last = Infinity;
  for (const y of [3, 5, 7, 9]) {
    let edge = 0;
    for (let a = 0; a <= r; a += 0.05) if (bruteOcclusion(CONE, r, h, y, a, per, pen) >= 0.5) edge = a;
    assert.ok(edge < last, `the cone widened between heights (${edge} at ${y})`);
    last = edge;
  }
});

test('a profiled caster in the FIELD casts a narrower shadow than the same caster as a cylinder, and its box is the profile’s', () => {
  const caster = { x: 0, z: 0, radius: 3, height: 10 };
  const cylinder = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster] });
  const cone = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [{ ...caster, profile: CONE }] });
  const stem = buildCanopyShadowField({
    bounds: BOUNDS,
    relief: 0,
    casters: [{ ...caster, profile: [[0, 0.1], [1, 0.1]] }],
  });
  const cov = (f: ShadowField): number => shadowCoverage(f);
  assert.ok(cov(cone) > 0, 'the cone cast nothing');
  assert.ok(cov(cone) < cov(cylinder), 'the cone is not narrower than the cylinder');
  assert.ok(cov(stem) < cov(cone), 'a tenth-width stem is not narrower than the cone');
  // The cylinder PROFILE, sampled, is the closed-form cylinder PLUS the rounded tip cap the
  // closed form cuts flat (a ray passing the axis above the tip still meets the cylinder's top
  // where its horizontal distance is inside the radius): a half-disc of the radius, and no more.
  const sampled = buildCanopyShadowField({
    bounds: BOUNDS,
    relief: 0,
    casters: [{ ...caster, profile: CYLINDER_PROFILE }],
  });
  const extra = (cov(sampled) - cov(cylinder)) * cylinder.data.length;
  const cap = (Math.PI * caster.radius * caster.radius * 0.5) * SHADOW_GRES * SHADOW_GRES;
  assert.ok(extra > 0, 'the sampled cylinder lost the tip cap');
  assert.ok(extra < cap * 1.5, `the sampled cylinder is a different shape (${extra} extra samples against a ${cap.toFixed(0)}-sample cap)`);
  // And a profile-less caster is stamped by the closed form: byte-identical to itself under the
  // default penumbra, and NOT identical to the sampled one (the closed form cuts the tip flat).
  const again = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster], penumbra: SHADOW_PENUMBRA });
  assert.deepEqual(again.data, cylinder.data);
});

test('the penumbra option sets the ramp’s width: wider means more in-between samples, and the ladder is what it says', () => {
  const caster = { x: 0, z: 0, radius: 3, height: 10, profile: CONE };
  const between = (pen: number): number => {
    const f = buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster], penumbra: pen });
    let n = 0;
    for (const v of f.data) if (v > 0 && v < 255) n += 1;
    return n;
  };
  assert.ok(between(0.6) < between(1.2), 'a wider penumbra did not widen the ramp');
  assert.ok(between(1.2) < between(2.4), 'a wider penumbra did not widen the ramp');
  assert.deepEqual([...SHADOW_PENUMBRA_RUNGS], [0.15, 0.6, 1.2, 2.4]);
  // The 0.5 contour does not move with the penumbra — it is the silhouette itself.
  const c1 = shadowCoverage(buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster], penumbra: 0.6 }));
  const c2 = shadowCoverage(buildCanopyShadowField({ bounds: BOUNDS, relief: 0, casters: [caster], penumbra: 2.4 }));
  assert.ok(Math.abs(c1 - c2) * 10000 < 60, `the silhouette moved with the penumbra (${c1} vs ${c2})`);
});

test('THE ENVELOPE agrees with the brute-force reference on which side of the 0.5 contour every (height, across) falls, to a texel — on the cone and the cylinder', () => {
  const per = shadowOffsetPerUnitHeight();
  const pen = 0.6;
  for (const [name, profile] of [['cone', CONE], ['cylinder', CYLINDER_PROFILE]] as const) {
    const env = silhouetteEnvelope(profile, 3, 10, per);
    let disagreements = 0;
    let checks = 0;
    for (let yStar = -6; yStar <= 16; yStar += 0.25) {
      for (let across = 0; across <= 4; across += 0.1) {
        const exact = bruteOcclusion(profile, 3, 10, yStar, across, per, pen) >= 0.5;
        const table = envelopeOcclusion(env, yStar, across, pen) >= 0.5;
        checks += 1;
        if (exact !== table) {
          // A disagreement is tolerated only within a third of a ground unit of the contour —
          // the per-sample test is itself sampled (six probes a segment) and the table is
          // interpolated; anything further is a different shape.
          const near =
            bruteOcclusion(profile, 3, 10, yStar, across + 0.34, per, pen) >= 0.5 !==
            bruteOcclusion(profile, 3, 10, yStar, Math.max(0, across - 0.34), per, pen) >= 0.5;
          assert.ok(near, `${name}: the envelope disagrees with the reference at yStar ${yStar}, across ${across}, away from the contour`);
          disagreements += 1;
        }
      }
    }
    assert.ok(checks > 3000);
    assert.ok(disagreements < checks * 0.03, `${name}: ${disagreements} of ${checks} disagree`);
  }
});

test('the envelope’s table: a cylinder’s outline is its radius at every height it stands, zero past its overhang; the cone’s tapers; the read interpolates and is zero outside', () => {
  const per = shadowOffsetPerUnitHeight();
  const cyl = silhouetteEnvelope(CYLINDER_PROFILE, 3, 10, per);
  assert.ok(Math.abs(cyl.step - ENVELOPE_STEP / (SHADOW_GRES * per)) < 1e-12);
  assert.ok(Math.abs(cyl.yMin + 3 / per) < 1e-9, 'the table does not start an overhang below the foot');
  // To a hundredth: the table is read between two entries a quarter-texel apart, each the max
  // over 25 sampled heights, so the outline sits a few ten-thousandths under the radius.
  assert.ok(Math.abs(envelopeWidth(cyl, 5) - 3) < 0.01, 'a cylinder is not its radius mid-height');
  assert.ok(Math.abs(envelopeWidth(cyl, 0) - 3) < 0.01);
  assert.ok(Math.abs(envelopeWidth(cyl, 10) - 3) < 0.01);
  // Above the tip the cap shrinks like a circle: at half the overhang, sqrt(1 − 0.25) of r.
  const half = 10 + 1.5 / per;
  assert.ok(Math.abs(envelopeWidth(cyl, half) - 3 * Math.sqrt(0.75)) < 0.05);
  assert.equal(envelopeWidth(cyl, 10 + 3 / per + 1), 0);
  assert.equal(envelopeWidth(cyl, -3 / per - 1), 0);
  const cone = silhouetteEnvelope(CONE, 3, 10, per);
  assert.ok(envelopeWidth(cone, 2.5) > envelopeWidth(cone, 6), 'the cone does not taper');
  assert.ok(envelopeWidth(cone, 6) > envelopeWidth(cone, 9));
  assert.ok(envelopeWidth(cone, 0.5) < 3, 'the cone is as wide as the cylinder at the foot');
  assert.ok(envelopeWidth(cone, 0.5) > 0.3, 'the crown does not overhang the foot at all');
  // The occlusion read: 1 well inside, 0.5 on the outline, 0 a penumbra out — and a short-cut 0
  // where the table is empty and the sample is past the penumbra.
  assert.equal(envelopeOcclusion(cyl, 5, 0, 0.6), 1);
  assert.ok(Math.abs(envelopeOcclusion(cyl, 5, 3, 0.6) - 0.5) < 0.01);
  assert.equal(envelopeOcclusion(cyl, 5, 3.6, 0.6), 0);
  assert.equal(envelopeOcclusion(cyl, 30, 1, 0.6), 0);
  assert.equal(envelopeOcclusion(cyl, 30, 0, 0.6), 0, 'a ray that meets no outline at all is not in anything’s penumbra');
  // An empty profile / no height: a table of zeros.
  const none = silhouetteEnvelope([], 3, 10, per);
  assert.ok([...none.widths].every((w) => w === 0));
  const flat = silhouetteEnvelope(CYLINDER_PROFILE, 3, 0, per);
  assert.ok([...flat.widths].every((w) => w === 0));
});

test('segmentEnvelope is EXACT: the largest w² − (perUnit·(yStar − y))² over a segment, to the last bit against a brute-force maximum, concave and convex alike', () => {
  const per = shadowOffsetPerUnitHeight();
  const brute = (y0: number, w0: number, y1: number, w1: number, yStar: number): number => {
    let best = -Infinity;
    const steps = 20000;
    for (let i = 0; i <= steps; i += 1) {
      const y = y0 + ((y1 - y0) * i) / steps;
      const w = y1 === y0 ? Math.max(w0, w1) : w0 + ((w1 - w0) * (y - y0)) / (y1 - y0);
      best = Math.max(best, w * w - (per * (yStar - y)) ** 2);
    }
    return best;
  };
  const cases: [number, number, number, number][] = [
    [2, 3, 10, 0.12], // the cone's crown: a shallow slope, concave — the maximum is interior
    [0, 0.3, 2, 0.3], // the trunk: flat
    [0, 3, 10, 3], // a cylinder
    [0, 2.36, 0.67, 2.29], // a dome's first piece: steep, convex — the maximum is at an end
    [8, 0.2, 8, 3], // a step: both ends at one height
    [0, 0.5, 10, 6], // slope 0.55 < the light's 0.695: concave, maximum interior for some yStar
    [0, 0.5, 5, 6], // slope 1.1 > the light's: convex
  ];
  for (const [y0, w0, y1, w1] of cases) {
    for (const yStar of [-3, 0, 1, 2.5, 4, 5, 6.3, 8, 9.9, 10, 13]) {
      const exact = segmentEnvelope(y0, w0, y1, w1, yStar, per);
      const b = brute(y0, w0, y1, w1, yStar);
      // The exact maximum is never BELOW the brute one (the grid contains no point above the true
      // maximum), and never above it by more than the grid's own resolution.
      assert.ok(exact >= b - 1e-9, `${[y0, w0, y1, w1]} at ${yStar}: exact ${exact} below brute ${b}`);
      assert.ok(exact - b < 1e-4, `${[y0, w0, y1, w1]} at ${yStar}: exact ${exact} above brute ${b} by ${exact - b}`);
    }
  }
  // The interior stationary point really is taken: on the crown at a yStar where the brute
  // maximum lies strictly between the ends, the ends alone under-read it.
  const ends = Math.max(3 * 3 - (per * (6 - 2)) ** 2, 0.12 * 0.12 - (per * (6 - 10)) ** 2);
  assert.ok(segmentEnvelope(2, 3, 10, 0.12, 6, per) > ends + 0.1, 'the stationary point was not taken');
  // And a negative answer is a segment the ray never meets.
  assert.ok(segmentEnvelope(0, 0.3, 2, 0.3, 30, per) < 0);
});

test('the envelope’s table matches the brute-force outline at every entry, on the cone, the cylinder and a bloom', () => {
  const per = shadowOffsetPerUnitHeight();
  const bloom: SilhouetteProfile = [
    [0, 1],
    [0.12, 1],
    [0.12, 0.06],
    [0.78, 0.06],
    [0.78, 0.28],
    [1, 0.15],
  ];
  for (const [name, profile, r, h] of [
    ['cone', CONE, 3, 10],
    ['cylinder', CYLINDER_PROFILE, 3, 10],
    ['bloom', bloom, 2, 2.445],
  ] as const) {
    const env = silhouetteEnvelope(profile, r, h, per);
    for (let i = 0; i < env.widths.length; i += 1) {
      const yStar = env.yMin + i * env.step;
      const b = bruteWidth(profile, r, h, yStar, per);
      // The table is the EXACT maximum: never below the brute grid's, and above it only by what
      // the grid missed between two of its 4,000 heights.
      assert.ok(env.widths[i]! >= b - 1e-9, `${name} entry ${i} (yStar ${yStar.toFixed(3)}): table ${env.widths[i]} below brute ${b}`);
      assert.ok(env.widths[i]! - b < 5e-3, `${name} entry ${i} (yStar ${yStar.toFixed(3)}): table ${env.widths[i]} vs brute ${b}`);
    }
    // The table's extent is the form's own overhang either side, at the declared step.
    assert.ok(Math.abs(env.yMin + (r * profileMaxWidth(profile)) / per) < 1e-9);
    assert.ok(Math.abs(env.step - ENVELOPE_STEP / (SHADOW_GRES * per)) < 1e-12);
    const span = h + (2 * r * profileMaxWidth(profile)) / per;
    assert.equal(env.widths.length, Math.ceil(span / env.step) + 1);
  }
});

test('envelopeWidth at the table’s edges: zero before the first entry, half the second entry midway into the first cell, zero at and past the end, and a finite number everywhere', () => {
  const per = shadowOffsetPerUnitHeight();
  const env = silhouetteEnvelope(CYLINDER_PROFILE, 3, 10, per);
  const n = env.widths.length;
  assert.equal(envelopeWidth(env, env.yMin - 1e-9), 0);
  // The first entry is zero (the overhang's start meets nothing); midway to the second it is half
  // of the second — a read that fell to zero here would clip the shadow's tip.
  assert.ok(env.widths[1]! > 0);
  assert.ok(Math.abs(envelopeWidth(env, env.yMin + 0.5 * env.step) - 0.5 * env.widths[1]!) < 1e-12);
  // Exactly on the last entry, half a step past it, and a whole step past it: finite, and zero.
  assert.equal(envelopeWidth(env, env.yMin + (n - 1) * env.step), env.widths[n - 1]);
  assert.equal(envelopeWidth(env, env.yMin + (n - 0.5) * env.step), env.widths[n - 1]! * 0.5);
  assert.equal(envelopeWidth(env, env.yMin + n * env.step), 0);
  assert.equal(envelopeWidth(env, env.yMin + (n + 0.5) * env.step), 0);
  for (const y of [-100, env.yMin, 0, 5, 10, env.yMin + n * env.step, 100]) {
    assert.ok(Number.isFinite(envelopeWidth(env, y)), `not finite at ${y}`);
  }
});
