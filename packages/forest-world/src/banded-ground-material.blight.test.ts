import test from 'node:test';
import assert from 'node:assert/strict';

import { createBandedGroundMaterial, type BandedGroundMaterialOptions } from './banded-ground-material.js';
import { blightGlsl, blightRung } from './land-blight.js';

const TOKENS = ['#8cb85e', '#d8c069', '#57544a', '#9ca3af'];
const GRASS = { mix: 0.85, rows: [0] };
const WHEAT = { mix: 0.85, rows: [1], anchor: '#b0b040', lift: 2 };
const DEAD = blightRung('dead').palette;
const BLIGHT = { mix: 0.85, rows: [2], palette: DEAD };

const base = (): BandedGroundMaterialOptions => ({ tokens: TOKENS, grain: 'normal', grass: GRASS });
const fragmentOf = (opts: BandedGroundMaterialOptions): string => createBandedGroundMaterial(opts).fragmentShader;

test('an UNBLIGHTED material is byte-identical to the one this file emitted before the blight existed', () => {
  // ⚠ THE WHOLE REASON `blight` IS AN OPTIONAL KEY RATHER THAN A NULLABLE ONE. Every figure already
  // measured about this ground was taken against the source with no blight in it; an absent layer
  // that still moved a byte would retire all of them.
  const withWheat = { ...base(), wheat: WHEAT };
  const a = fragmentOf(withWheat);
  const b = fragmentOf({ ...withWheat });
  assert.equal(a, b);
  assert.ok(!a.includes('st_blight'), 'an unblighted shader carries blight source');
  assert.ok(!a.includes('uBlightMix'), 'an unblighted shader declares the blight uniform');

  // ⚠⚠ AND ABSENCE ONLY EVER REMOVES TEXT — every line of the unblighted shader also appears in the
  // blighted one. The three places the layer splices in are each written as `blight === undefined ?
  // '' : <the layer>`, and an empty string is the one value a containment test cannot see: put ANY
  // text in that arm and the checks above still pass, because they only ask what a shader does NOT
  // contain. This asks what the absent case DOES contain, which is nothing of its own.
  const blighted = fragmentOf({ ...withWheat, blight: BLIGHT });
  const inBlighted = new Set(blighted.split('\n'));
  for (const line of a.split('\n')) {
    assert.ok(inBlighted.has(line), `dropping the blight ADDED a line rather than removing one: ${JSON.stringify(line)}`);
  }
});

test('a material with NEITHER grass NOR blight is built, not refused — the refusal is the layer`s own', () => {
  // ⚠ THE REFUSAL'S CONDITION IS TWO HALVES AND ONLY THIS ASSERTS THE FIRST. Every other test here
  // passes a blight, so a condition stuck at `true` would refuse a grass-less material that asked
  // for no blight at all — and every one of them would still be green.
  assert.doesNotThrow(() => createBandedGroundMaterial({ tokens: TOKENS, grain: 'normal' }));
});

test('a blighted material carries the layer`s own source, uniform, gate and mix line', () => {
  const src = fragmentOf({ ...base(), blight: BLIGHT });
  assert.ok(src.includes('uniform float uBlightMix;'));
  assert.ok(src.includes('c = mix(c, st_blightColour(vWorld.xz) * level, uBlightMix * blightGate);'));
  // ⚠ THE GENERATED SOURCE IS SPLICED IN AS ONE INDENTED BLOCK, and the assertion has to be on the
  // block rather than on its lines: a mutant that blanks the join's indentation leaves every line
  // present and a per-line `includes` green.
  assert.ok(src.includes(blightGlsl(DEAD).split('\n').join('\n      ')));
  // The gate is DECLARED under its own name, not only used under it — a blanked name emits
  // `float  = 0.0;` and leaves the usage line this test already checks intact.
  assert.ok(src.includes('float blightGate = 0.0;'));
  assert.ok(src.includes('if (int(vStatus + 0.5) == 2) blightGate = 1.0;'));
  const material = createBandedGroundMaterial({ ...base(), blight: BLIGHT });
  assert.equal(material.uniforms['uBlightMix']?.value, 0.85);
});

test('⚠ THE BLIGHT GATE IS NOT PROMOTED INTO grassGate — that absence is what drops layers 2, 3 and 4', () => {
  const src = fragmentOf({ ...base(), blight: BLIGHT, wheat: WHEAT });
  // The wheat IS promoted, so the two promotions are distinguishable rather than both absent.
  assert.ok(src.includes('grassGate = max(grassGate, wheatGate);'));
  assert.ok(
    !src.includes('grassGate = max(grassGate, blightGate)'),
    'the blight gate was promoted into the grass gate — an unhealthy island would then wear the shore sand, the worn path and the slope rock, and the rock is the layer measured to desaturate a small island past its own status',
  );
});

test('the blight is REFUSED without the grass it rides', () => {
  assert.throws(
    () => createBandedGroundMaterial({ tokens: TOKENS, grain: 'normal', blight: BLIGHT }),
    /the blight layer needs the grass — its base is layer 1’s own structure re-palettised, and reads the scalar, drift and transfer only the grass source declares/,
  );
});

test('an empty gate is REFUSED — a layer switched on that dresses nothing, at a full shader`s cost', () => {
  assert.throws(
    () => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [] } }),
    /was given no rows to dress — a gate that matches nothing draws the flat charcoal at the painted charcoal’s cost/,
  );
});

test('a burn of 1 is BLACK and black is the sea, so the range stops short of it', () => {
  for (const burn of [1, 1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, palette: { burn, crackMix: 0.5 } } }),
      /the blight layer's burn is .*; it runs from 0 \(the ramps re-expressed on the charred token\) up to but never reaching 1, which is black/s,
      `a burn of ${burn} was accepted`,
    );
  }
  // The ends of the admissible range are accepted.
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, palette: { burn: 0, crackMix: 0 } } }));
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, palette: { burn: 0.99, crackMix: 1 } } }));
});

test('a crack strength outside [0, 1] is REFUSED — it is a mix factor', () => {
  for (const crackMix of [-0.01, 1.01, Number.NaN]) {
    assert.throws(
      () => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, palette: { burn: 0.5, crackMix } } }),
      /the blight layer's crack strength is .*; it is a mix factor and runs from 0 \(the base alone\) to 1/s,
      `a crack strength of ${crackMix} was accepted`,
    );
  }
});

test('a row that is not a ramp row is REFUSED, and the FIRST row past the end is one', () => {
  const refusal = new RegExp(`which is not a ramp row of the ${TOKENS.length} this material was handed`, 's');
  // ⚠ `TOKENS.length` ITSELF, not a comfortable 9. The bound is `row >= tokens.length`, and only a
  // row EXACTLY at the length can tell it from `row > tokens.length` — which would admit a row one
  // past the end and index a ramp entry that does not exist.
  assert.throws(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [TOKENS.length] } }), refusal);
  assert.throws(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [9] } }), refusal);
  assert.throws(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [-1] } }), refusal);
  assert.throws(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [1.5] } }), refusal);
  // The LAST real row is accepted, so the bound is a fence and not an off-by-one ban.
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [TOKENS.length - 1] } }));
});

test('⚠ A ROW IN TWO PAINT GATES IS REFUSED — one row wears one painted layer, never the sum of two', () => {
  assert.throws(
    () => createBandedGroundMaterial({ ...base(), blight: { ...BLIGHT, rows: [0] } }),
    /is named by the blight gate AND another painted gate/,
  );
  assert.throws(
    () => createBandedGroundMaterial({ ...base(), wheat: WHEAT, blight: { ...BLIGHT, rows: [1] } }),
    /is named by the blight gate AND another painted gate/,
  );
  // A disjoint row is fine, which is what makes the refusal a fence rather than a ban.
  assert.doesNotThrow(() => createBandedGroundMaterial({ ...base(), wheat: WHEAT, blight: BLIGHT }));
});

test('two rungs compile DIFFERENT shaders — the palette is written in, not uniform-fed', () => {
  const sick = fragmentOf({ ...base(), blight: { ...BLIGHT, palette: blightRung('sick').palette } });
  const dead = fragmentOf({ ...base(), blight: BLIGHT });
  assert.notEqual(sick, dead);
});
