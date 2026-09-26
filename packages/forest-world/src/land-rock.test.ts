import assert from 'node:assert/strict';
import test from 'node:test';

import { grainPerturbNormal, linearToSrgb255 } from './land-grain.js';
import { grassScalar } from './land-grass.js';
import { LAND_RELIEF_AMPLITUDE, landNormal } from './land-relief.js';
import { indices, peakSlopeAt } from './land-shadow.js';
import { DIRT_RAMP } from './land-wear.js';
import {
  ROCK_RAMP,
  ROCK_SLOPE_RAMP,
  interiorMinimumUp,
  rockColourAt,
  rockColourOf,
  rockGlsl,
  rockLinearOf,
  rockMask,
  upComponentOfSlope,
} from './land-rock.js';

// ---------------------------------------------------------------- the transcription

// ⚠⚠ EVERY CONSTANT IS ASSERTED AS ITS OWN LITERAL, NEVER RE-DERIVED FROM THE MODULE — the
// discipline `land-grass.test.ts` states (ADR-0490 D2). The literals below were read off
// `build_land.py`'s `mat_attribute()` by hand.

test('the rock constants are the authored ones', () => {
  assert.deepEqual([...ROCK_SLOPE_RAMP], [0.72, 0.9]);
  assert.deepEqual(ROCK_RAMP, [
    { at: 0.35, linear: [0.14, 0.125, 0.105] },
    { at: 0.7, linear: [0.33, 0.3, 0.255] },
  ]);
});


// ---------------------------------------------------------------- the mask

test('rockMask is 1 at the low end, 0 at the high end, and EXACTLY half between', () => {
  assert.equal(rockMask(0.72), 1);
  assert.equal(rockMask(0.9), 0);
  // Hand-computed on the literal ends: (0.90 - 0.81) / (0.90 - 0.72) = 0.09 / 0.18.
  assert.ok(Math.abs(rockMask(0.81) - 0.5) < 1e-12, `midpoint was ${rockMask(0.81)}`);
  assert.ok(Math.abs(rockMask(0.765) - 0.75) < 1e-12);
  assert.ok(Math.abs(rockMask(0.855) - 0.25) < 1e-12);
});

test('rockMask is clamped: full rock below the low end, none above the high end', () => {
  assert.equal(rockMask(0), 1);
  assert.equal(rockMask(0.5), 1);
  assert.equal(rockMask(1), 0);
  assert.equal(rockMask(0.95), 0);
});

test('rockMask FALLS with the up-component — steeper is rockier', () => {
  // ⚠ THE EASIEST THING HERE TO INVERT, and inverting it still draws rock: on the flats, with
  // grass on the cliffs. The recipe's ramp is WHITE at 0.72 and BLACK at 0.90.
  let prev = 2;
  for (const i of indices(101)) {
    const ny = i / 100;
    const m = rockMask(ny);
    assert.ok(m >= 0 && m <= 1);
    assert.ok(m <= prev, `mask rose from ${prev} to ${m} at ny ${ny}`);
    prev = m;
  }
  assert.ok(rockMask(0.75) > rockMask(0.85));
});

test('the ends are PARAMETERS: the same arithmetic on another rung of the ladder', () => {
  // ADR-0503: the shipped ends are chosen from a rendered ladder, with 0.72 / 0.90 as provenance.
  // A rung that reaches the interior's 0.91-plus normals has to sit above 0.90.
  assert.ok(Math.abs(rockMask(0.95, 0.9, 1) - 0.5) < 1e-12);
  assert.equal(rockMask(0.9, 0.9, 1), 1);
  assert.equal(rockMask(1, 0.9, 1), 0);
  assert.equal(rockMask(0.85, 0.9, 1), 1);
  // And the defaults are the transcribed ends, not something else.
  assert.equal(rockMask(0.81), rockMask(0.81, 0.72, 0.9));
});

test('⚠ the recipe`s ends bite NOWHERE in the shipped interior — the measured fact', () => {
  // A slope of s has an up-component of 1 / sqrt(1 + s²): hand-computed, a 3-4-5 triangle.
  assert.equal(upComponentOfSlope(0), 1);
  assert.ok(Math.abs(upComponentOfSlope(0.75) - 0.8) < 1e-12);
  assert.ok(Math.abs(upComponentOfSlope(4 / 3) - 0.6) < 1e-12);
  // The interior's steepest slope at the shipped amplitude is 0.4546 (land-shadow's linear law
  // at land-relief's amplitude); that is an up-component of 0.910, ABOVE the recipe's 0.90.
  assert.ok(Math.abs(peakSlopeAt(LAND_RELIEF_AMPLITUDE) - 0.4546) < 0.0001);
  assert.equal(interiorMinimumUp(), upComponentOfSlope(peakSlopeAt(LAND_RELIEF_AMPLITUDE)));
  assert.ok(Math.abs(interiorMinimumUp() - 0.9103) < 0.0001, `interior floor ${interiorMinimumUp()}`);
  assert.ok(interiorMinimumUp() > ROCK_SLOPE_RAMP[1], 'the interior now reaches the recipe`s ramp');
  // So at the transcribed ends the mask is identically zero on every interior normal — the rock
  // the recipe paints lands only on the beach's ring chain, which is why the ends are options.
  assert.equal(rockMask(interiorMinimumUp()), 0);
  // Whereas a rung with its ceiling above the interior floor would reach it.
  assert.ok(rockMask(interiorMinimumUp(), 0.9, 0.95) > 0);
});

// ---------------------------------------------------------------- the rock colour

test('the rock ramp is driven by LAYER 1`s base scalar, so the rock grains like the grass', () => {
  for (const [x, z] of [
    [42.5, -17.25],
    [0, 0],
    [-133.7, 208.4],
  ] as const) {
    assert.deepEqual({ ...rockColourAt(x, z) }, { ...rockColourOf(grassScalar(x, z)) });
  }
  assert.notDeepEqual({ ...rockColourAt(0, 0) }, { ...rockColourAt(-133.7, 208.4) });
});

test('the rock ramp is piecewise LINEAR in linear space, flat outside its stops', () => {
  assert.deepEqual([...rockLinearOf(0)], [0.14, 0.125, 0.105]);
  assert.deepEqual([...rockLinearOf(0.35)], [0.14, 0.125, 0.105]);
  assert.deepEqual([...rockLinearOf(0.7)], [0.33, 0.3, 0.255]);
  assert.deepEqual([...rockLinearOf(1)], [0.33, 0.3, 0.255]);
  const mid = rockLinearOf(0.525);
  for (const [i, expected] of [
    [0, (0.14 + 0.33) / 2],
    [1, (0.125 + 0.3) / 2],
    [2, (0.105 + 0.255) / 2],
  ] as const) {
    assert.ok(Math.abs(mid[i] - expected) < 1e-12, `channel ${i} at 0.525 is ${mid[i]}`);
  }
});

test('the delivered rock is sRGB-converted, near-grey, warm-leaning, and lightens', () => {
  assert.deepEqual(
    { ...rockColourOf(0.35) },
    { r: linearToSrgb255(0.14), g: linearToSrgb255(0.125), b: linearToSrgb255(0.105) },
  );
  assert.deepEqual(
    { ...rockColourOf(0.7) },
    { r: linearToSrgb255(0.33), g: linearToSrgb255(0.3), b: linearToSrgb255(0.255) },
  );
  const dark = rockColourOf(0.35);
  const light = rockColourOf(0.7);
  // Delivered, not linear: 0.14 linear is ~105/255 through the transfer; raw it would be 36.
  assert.equal(dark.r, 105);
  assert.ok(dark.r > 90, `the dark stop delivered ${dark.r} — that is the linear value, unconverted`);
  for (const c of [dark, light]) {
    assert.ok(c.r >= c.g && c.g >= c.b, `rock leans warm (r>=g>=b), got ${JSON.stringify(c)}`);
  }
  assert.ok(light.r > dark.r && light.g > dark.g && light.b > dark.b, 'the ramp must lighten');
  // The GREYEST family in the stack: its linear r-b spread is about half the dirt's at each stop,
  // which is what separates a rock face from a worn path where the two meet.
  for (const i of indices(2)) {
    const rock = ROCK_RAMP[i]!.linear;
    const dirt = DIRT_RAMP[i]!.linear;
    assert.ok(rock[0] - rock[2] < (dirt[0] - dirt[2]) * 0.6, `stop ${i} is as warm as the dirt`);
  }
});

// ---------------------------------------------------------------- the GLSL

test('rockGlsl carries the colour stops, takes its ends as parameters, and reads no uniform', () => {
  const glsl = rockGlsl();
  for (const literal of [
    'vec3(0.140000, 0.125000, 0.105000)',
    'vec3(0.330000, 0.300000, 0.255000)',
    'clamp((t - 0.350000) / 0.350000, 0.0, 1.0)',
    'float st_rockMask(float ny, float lo, float hi)',
    'return clamp((hi - ny) / (hi - lo), 0.0, 1.0);',
    'st_grassSrgb(st_rockRamp(st_grassScalar(p)))',
  ]) {
    assert.ok(glsl.includes(literal), `the emitted source is missing: ${literal}`);
  }
  assert.equal([...glsl.matchAll(/st_grassSrgb/g)].length, 1);
  // ⚠⚠ THE ENDS ARE NOT WRITTEN IN, AND NO UNIFORM IS READ: the source is spliced above the
  // uniform block, and the ends are the material's ladder, passed at the call site so one
  // compiled shader serves every rung.
  assert.ok(!/uniform/.test(glsl), 'the emitter is spliced above the uniform block');
  assert.ok(!/uRock/.test(glsl), 'the emitted source must read no rock uniform');
  assert.ok(!glsl.includes('0.720000') && !glsl.includes('0.900000'), 'the ends must not be written in');
  // No noise octave of its own: the mask is the normal the shader already holds.
  assert.equal([...glsl.matchAll(/st_grainOctave/g)].length, 0);
  // Declaration order: the ramp before the colour that calls it.
  assert.ok(glsl.indexOf('st_rockRamp(float t)') < glsl.indexOf('st_rockMask('));
  assert.ok(glsl.indexOf('st_rockMask(') < glsl.indexOf('st_rockColour('));
});

test('rockGlsl is held to an EXACT GOLDEN — the only assertion that sees a blanked line', () => {
  // ⚠⚠ A CONTAINMENT SWEEP CANNOT SEE A BLANKED LITERAL — `check:mutation-diff` proved it on the
  // sand and grass emitters. Written out rather than rebuilt from the constants, so it is the
  // text a reader checks by eye against build_land.py:912-925.
  assert.equal(
    rockGlsl(),
    [
      '// GENERATED from land-rock.ts — do not hand-edit these constants.',
      '// Layer 4 of the approved ground: build_land.py:912-925, mat_attribute().',
      'vec3 st_rockRamp(float t) {',
      '  float st_rockRamp_f;',
      '  vec3 st_rockRamp_c = vec3(0.140000, 0.125000, 0.105000);',
      '  st_rockRamp_f = clamp((t - 0.350000) / 0.350000, 0.0, 1.0);',
      '  st_rockRamp_c = mix(st_rockRamp_c, vec3(0.330000, 0.300000, 0.255000), st_rockRamp_f);',
      '  return st_rockRamp_c;',
      '}',
      '',
      '// THE SLOPE MASK on the normal`s up-component: 1 at or below lo (full rock), 0 at or above',
      '// hi (none). The ramp FALLS with the up-component; the ends are PARAMETERS, so this block',
      '// reads nothing the shader uploads.',
      'float st_rockMask(float ny, float lo, float hi) {',
      '  return clamp((hi - ny) / (hi - lo), 0.0, 1.0);',
      '}',
      '',
      '// THE ROCK COLOUR as a delivered sRGB triple in 0..1 — the ramp driven by LAYER 1`s own base',
      '// scalar, so the rock grains with the same field the grass does.',
      'vec3 st_rockColour(vec2 p) {',
      '  return st_grassSrgb(st_rockRamp(st_grassScalar(p)));',
      '}',
    ].join('\n'),
  );
});

// ------------------------------------------------- WHY THE MASK READS THE GEOMETRIC NORMAL

// ⚠⚠ THE MEASUREMENT ADR-0553's MECHANISM RESTS ON, held as a test rather than as prose in a
// header. `banded-ground-material.ts` feeds `st_rockMask` the normal captured BEFORE the detail
// map and the grain; until 2026-09-08 it fed the BUMPED one. The two assertions below are the
// before and the after of exactly that swap on the shipped constants, and they are the reason the
// interior grass came out grey while `interiorMinimumUp()` said it could not.
//
// ⚠ THE GRAIN IS ONLY HALF THE BUMP. The detail normal map runs FIRST, at
// `SHIPPED_DETAIL_STRENGTH`, and it is a decoded PNG — a browser's job, not this suite's. So the
// figure below is a FLOOR on what the bumped route delivered, never the whole of it.

/** One interior grid, sampled the same way for both arms. Far from any coast, so the shore fall
 *  (`shore-fall.ts`) never enters and the only relief is `landNormal`'s own. */
const interiorSamples = (): readonly { readonly x: number; readonly z: number }[] => {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < 160; i++) {
    for (let j = 0; j < 160; j++) pts.push({ x: -60 + i * 0.75, z: -60 + j * 0.75 });
  }
  return pts;
};

test('ON THE GEOMETRY the interior wears NO rock at all — the ramp ends never open', () => {
  const worst = interiorSamples().reduce((lo, { x, z }) => Math.min(lo, landNormal(x, z).y), 1);
  // The sampler's own answer must agree with the arithmetic `interiorMinimumUp()` states, or one
  // of the two is describing a land the other does not have.
  assert.ok(Math.abs(worst - interiorMinimumUp()) < 1e-3, `sampled ${worst}, derived ${interiorMinimumUp()}`);
  // ⚠ AND IT CLEARS THE CEILING, which is the whole claim: at 0.910 against a `hi` of 0.90 there
  // is no interior fragment the ramp admits, so the mask is exactly zero rather than merely small.
  assert.ok(worst > ROCK_SLOPE_RAMP[1], `${worst} must clear the ramp ceiling ${ROCK_SLOPE_RAMP[1]}`);
  for (const { x, z } of interiorSamples()) {
    assert.equal(rockMask(landNormal(x, z).y, ROCK_SLOPE_RAMP[0], ROCK_SLOPE_RAMP[1]), 0);
  }
});

test('THE GRAIN ALONE opens it across the interior — the departure`s measured cost', () => {
  const pts = interiorSamples();
  let painted = 0;
  let worst = 1;
  for (const { x, z } of pts) {
    const up = grainPerturbNormal(landNormal(x, z), x, z).y;
    worst = Math.min(worst, up);
    if (rockMask(up, ROCK_SLOPE_RAMP[0], ROCK_SLOPE_RAMP[1]) > 0) painted++;
  }
  const share = painted / pts.length;
  // ⚠ A SHARE AND A DEPTH, because either alone is unfalsifiable: a stray fragment at 0.8999 would
  // satisfy a count and paint nothing anybody could see, and one deep fragment would satisfy a
  // depth. Measured 2026-09-08 at the shipped grain strength: 6.2% of samples, reaching 0.758.
  assert.ok(share > 0.04, `the grain must open the ramp across the interior, got ${(share * 100).toFixed(2)}%`);
  assert.ok(worst < 0.8, `and open it deeply, got ${worst.toFixed(4)}`);
  // The bump is what moved: the geometry underneath these very samples cleared the ceiling above.
  assert.ok(worst < interiorMinimumUp(), 'the bump is the only thing that made this ground steep');
});
