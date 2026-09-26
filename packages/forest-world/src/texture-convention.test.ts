// texture-convention.test.ts — the colour convention a bought texture is SAMPLED under.
//
// ⚠ THIS IS THE CONVENTION HALF ONLY. The delivered-pixel VERDICT — the two-hypothesis judgement,
// its tolerances, and the per-asset material manifest — stayed in `harness/texture-convention.ts`
// and is tested there: it MEASURES this convention, it is not part of it, and instruments do not
// publish. What is here is the rule the SHIPPED canvas samples a bought object under, so it is
// proved where `check:mutation-diff` can see it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLOUR_MAP_SLOTS,
  DATA_MAP_SLOTS,
  OPAQUE_TEXEL_CUT,
  RAW_COLOUR_SPACE,
  applyRawColourConvention,
  srgbToLinearByte,
  srgbToLinearUnit,
} from './texture-convention.js';
import type { ConventionMaterial, ConventionTexture } from './texture-convention.js';

const tex = (colorSpace = 'srgb'): ConventionTexture => ({ colorSpace, needsUpdate: false });

// ---------------------------------------------------------------------------
// the transfer function
// ---------------------------------------------------------------------------

test('the sRGB curve is the piecewise one, and the KNEE is exactly where the standard puts it', () => {
  // ⚠⚠ THE MUTANT THIS CLOSES. The branch is `v <= 0.04045`; the two arms are a linear segment and
  // a power segment, and they MEET at the knee — so a mutant that flips `<=` to `<`, or moves the
  // constant a little, changes the answer by a few parts in a million and every tolerant assertion
  // still passes. The two arms are therefore asserted SEPARATELY, by their own formulas, at points
  // either side of the knee where they disagree by a lot.
  const knee = 0.04045;
  assert.equal(srgbToLinearUnit(0.02), 0.02 / 12.92, 'below the knee is the linear segment');
  assert.equal(srgbToLinearUnit(knee), knee / 12.92, 'the knee itself takes the linear arm');
  assert.equal(srgbToLinearUnit(0.5), Math.pow((0.5 + 0.055) / 1.055, 2.4), 'above it, the power');
  // ⚠ AND THE TWO ARMS REALLY DIFFER off the knee — otherwise the branch would be decoration and
  // every assertion above would hold for a function with only one of them.
  assert.ok(Math.abs(0.5 / 12.92 - srgbToLinearUnit(0.5)) > 0.1, 'the linear arm would do at 0.5');
});

test('the curve fixes its two endpoints and darkens everything between', () => {
  assert.equal(srgbToLinearUnit(0), 0);
  assert.ok(Math.abs(srgbToLinearUnit(1) - 1) < 1e-12);
  for (const v of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(srgbToLinearUnit(v) < v, `${v} was not darkened`);
  }
  // Monotone, which is what makes a mean over it meaningful at all.
  const xs = [0, 0.02, 0.04045, 0.1, 0.5, 0.9, 1];
  for (const [i, v] of xs.entries()) {
    if (i === 0) continue;
    assert.ok(srgbToLinearUnit(v) > srgbToLinearUnit(xs[i - 1]!), `not monotone at ${v}`);
  }
});

test('the byte form is the unit form scaled, and is deliberately NOT rounded', () => {
  // ⚠ It feeds arithmetic — a mean, then a prediction — and rounding at each step accumulates a
  // bias the tolerance downstream would have to absorb.
  for (const b of [0, 10, 70, 128, 255]) {
    assert.equal(srgbToLinearByte(b), srgbToLinearUnit(b / 255) * 255);
  }
  assert.notEqual(srgbToLinearByte(70), Math.round(srgbToLinearByte(70)));
  // The measured case from the first live render: a foliage map whose own mean is rgb(70,90,69)
  // delivered at about rgb(15,26,15) — which is exactly this curve, and is what made it read as a
  // moody art direction rather than as a fault. ⚠ Asserted to a tenth rather than to a rounded
  // byte: the point is that the CURVE predicts the observation, and a rounding boundary (70 →
  // 15.62, which rounds to 16) is not what was observed — it is an artefact of where the rounding
  // happened downstream.
  assert.ok(Math.abs(srgbToLinearByte(70) - 15.6) < 0.1);
  assert.ok(Math.abs(srgbToLinearByte(90) - 26.1) < 0.1);
  assert.ok(Math.abs(srgbToLinearByte(69) - 15.2) < 0.1);
  // ⚠ AND THE DELIVERY IS ABOUT 3.5x DARK — the number the whole convention exists for.
  assert.ok(70 / srgbToLinearByte(70) > 4, 'the observed darkening is not reproduced');
});

// ---------------------------------------------------------------------------
// the convention
// ---------------------------------------------------------------------------

test('every COLOUR slot present is put in the raw convention, and flagged for upload', () => {
  const material: ConventionMaterial = { map: tex(), emissiveMap: tex() };
  const applied = applyRawColourConvention(material);
  assert.deepEqual(applied.colourSlots, [...COLOUR_MAP_SLOTS]);
  for (const slot of COLOUR_MAP_SLOTS) {
    assert.equal(material[slot]?.colorSpace, RAW_COLOUR_SPACE);
    assert.equal(material[slot]?.needsUpdate, true, `${slot} was changed without being re-uploaded`);
  }
});

test('⚠ every DATA slot is LEFT ALONE — forcing those raw is the opposite bug', () => {
  // Normal, roughness, metalness and AO carry linear DATA rather than colour. Putting them in the
  // raw convention would be a second, opposite defect, and one that reads as a lighting problem.
  const material: ConventionMaterial = { normalMap: tex('srgb-linear'), roughnessMap: tex('x') };
  const applied = applyRawColourConvention(material);
  assert.deepEqual(applied.dataSlots, ['normalMap', 'roughnessMap']);
  assert.equal(material.normalMap?.colorSpace, 'srgb-linear', 'a data map was forced raw');
  assert.equal(material.roughnessMap?.colorSpace, 'x');
  assert.equal(material.normalMap?.needsUpdate, false, 'a data map was needlessly re-uploaded');
  assert.deepEqual(applied.colourSlots, []);
});

test('the two slot lists are DIFFERENT lists — the split is the convention', () => {
  // NON-VACUITY. If these two ever became one list the tests above would be checking one belief
  // twice, and the module would have no convention left to hold.
  for (const slot of COLOUR_MAP_SLOTS) {
    assert.ok(!(DATA_MAP_SLOTS as readonly string[]).includes(slot), `${slot} is in both lists`);
  }
  assert.ok(COLOUR_MAP_SLOTS.length > 0 && DATA_MAP_SLOTS.length > 0);
  assert.ok(COLOUR_MAP_SLOTS.includes('map'), 'the base-colour slot is not a colour slot');
});

test('an absent or null slot is reported as absent, never touched', () => {
  // glTF materials leave a slot `null`; hand-built ones leave it off entirely. Both are "empty",
  // and a convention that wrote through either would throw inside a loader.
  const applied = applyRawColourConvention({ map: null, normalMap: null });
  assert.deepEqual(applied, { colourSlots: [], dataSlots: [] });
  assert.deepEqual(applyRawColourConvention({}), { colourSlots: [], dataSlots: [] });
});

test('the raw colour space is three’s NoColorSpace, which is the empty string', () => {
  // Named rather than inlined so a reader is not startled by a comparison against `''` — and
  // asserted, because the whole convention is that one value.
  assert.equal(RAW_COLOUR_SPACE, '');
  const material: ConventionMaterial = { map: tex('srgb') };
  applyRawColourConvention(material);
  assert.notEqual(material.map?.colorSpace, 'srgb', 'the slot kept its sRGB decode');
});

test('the opaque cut is a byte below full alpha, and is the same one map-texels reads', () => {
  // ⚠ A texel at 254 is not solid. The cut is deliberately not 255: an authoring tool that wrote
  // 254 for "opaque" would otherwise remove every texel from the mean, and the module would report
  // "no solid texels at all" for a perfectly ordinary map.
  assert.ok(OPAQUE_TEXEL_CUT > 0 && OPAQUE_TEXEL_CUT <= 255);
  assert.equal(OPAQUE_TEXEL_CUT, 254);
});
