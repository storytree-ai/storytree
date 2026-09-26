import assert from 'node:assert/strict';
import test from 'node:test';

import { linearToSrgb255 } from './land-grain.js';
import { grassNoiseField, grassScalar } from './land-grass.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SAND_RAMP } from './land-sand.js';
import { indices } from './land-shadow.js';
import {
  DIRT_RAMP,
  WEAR_BREAK,
  WEAR_FALLOFF,
  WEAR_OCTAVES,
  WEAR_RAMP,
  dirtColourAt,
  dirtColourOf,
  dirtLinearOf,
  wearBreakLattice,
  wearFactor,
  wearGlsl,
  wearOf,
} from './land-wear.js';



// ---------------------------------------------------------------- the transcription

// ⚠⚠ EVERY CONSTANT IS ASSERTED AS ITS OWN LITERAL, NEVER RE-DERIVED FROM THE MODULE — the
// discipline `land-grass.test.ts` states (ADR-0490 D2). The literals below were read off
// `build_land.py`'s `mat_attribute()` and `build_land_grid()` by hand.

test('the wear constants are the authored ones', () => {
  // The authored 3.0, times LAND_SCALE (`land-per-capability.ts`): the same fraction of the island.
  assert.equal(WEAR_FALLOFF, 3.0 * LAND_SCALE);
  assert.deepEqual({ ...WEAR_BREAK }, { scale: 9, detail: 5, roughness: 0.5 });
  assert.deepEqual([...WEAR_RAMP], [0.24, 0.55]);
  assert.deepEqual(DIRT_RAMP, [
    { at: 0.35, linear: [0.165, 0.128, 0.088] },
    { at: 0.7, linear: [0.322, 0.262, 0.182] },
  ]);
  assert.equal(WEAR_OCTAVES, 5);
});



test('the break noise is coarser than the sand`s edge and the grain', () => {
  // At ~26 ground units it turns over about nine times across the island: gaps in a track, not
  // texture on it. Hand-computed: 233.8 / 9.
  // 25.98 on the tuned island; the lattice follows the island (× LAND_SCALE, `land-per-capability.ts`).
  assert.ok(Math.abs(wearBreakLattice() - 25.98 * LAND_SCALE) < 0.01, `lattice was ${wearBreakLattice()}`);
  assert.ok(wearBreakLattice() > 10 * LAND_SCALE, 'a break noise this fine textures the path instead of breaking it');
});

// ---------------------------------------------------------------- the wear scalar

test('wearOf is 1 on the centreline, 0 at the falloff, and EXACTLY 0.5 halfway', () => {
  assert.equal(wearOf(0), 1);
  assert.equal(wearOf(WEAR_FALLOFF), 0);
  // Distances in the authored basis, scaled by LAND_SCALE with the falloff.
  assert.equal(wearOf(3 * LAND_SCALE), 0);
  // w = 0.5 -> 0.25 * (3 - 1) = 0.5, exactly, in binary floating point: 3 * LAND_SCALE is
  // exactly twice 1.5 * LAND_SCALE, so the quotient is exactly one half.
  assert.equal(wearOf(1.5 * LAND_SCALE), 0.5);
  // The falloff is a parameter: the same shape at another width.
  assert.equal(wearOf(2, 4), 0.5);
  assert.equal(wearOf(0, 4), 1);
  assert.equal(wearOf(4, 4), 0);
});

test('wearOf is a SMOOTHSTEP — above the line near the path, below it near the edge, symmetric', () => {
  // Hand-computed Hermite values: w = 0.75 -> 0.5625 * 1.5 = 0.84375; w = 0.25 -> 0.0625 * 2.5.
  // Distances in the authored basis, scaled by LAND_SCALE with the falloff. The far sample is
  // spelled as three quarters OF the scaled falloff (`3 * LAND_SCALE * 0.75`) rather than as
  // `2.25 * LAND_SCALE`, because the latter's quotient against `3 * LAND_SCALE` rounds one ulp off
  // 0.75 and the exact-equality claim is the point.
  assert.equal(wearOf(0.75 * LAND_SCALE), 0.84375);
  assert.equal(wearOf(3 * LAND_SCALE * 0.75), 0.15625);
  // A linear falloff would give 0.75 and 0.25; the smoothstep sits above the line on the near
  // side and below it on the far side, which is what removes the hard shoulder.
  assert.ok(wearOf(0.75 * LAND_SCALE) > 0.75);
  assert.ok(wearOf(3 * LAND_SCALE * 0.75) < 0.25);
  // 3w² - 2w³ is symmetric about the midpoint: wear(d) + wear(falloff - d) = 1.
  for (const i of indices(31)) {
    const d = i * 0.1 * LAND_SCALE;
    assert.ok(Math.abs(wearOf(d) + wearOf(3 * LAND_SCALE - d) - 1) < 1e-12, `asymmetric at ${d}`);
  }
});

test('wearOf is clamped and monotone: 1 behind the centreline, 0 beyond the falloff', () => {
  assert.equal(wearOf(-1), 1);
  assert.equal(wearOf(10), 0);
  let prev = 2;
  for (const i of indices(50)) {
    const w = wearOf(i * 0.1);
    assert.ok(w <= prev, `wear rose from ${prev} to ${w} at distance ${i * 0.1}`);
    prev = w;
  }
});

// ---------------------------------------------------------------- the mix factor

test('⚠ the break noise MULTIPLIES the wear: zero wear is zero dirt at EVERY point', () => {
  // `wear_break.operation = "MULTIPLY"` at build_land.py:898 — the opposite of the sand's edge,
  // whose MULTIPLY_ADD is pinned to an add. Under an add, the noise alone could clear the ramp's
  // foot and paint dirt across the open island; under a multiply it can only ever REMOVE path.
  for (const i of indices(40)) {
    const x = i * 11.3 - 200;
    const z = i * 6.7 - 100;
    assert.equal(wearFactor(0, x, z), 0, `dirt appeared at (${x}, ${z}) with no wear`);
  }
});

test('the mix factor is the wear TIMES the noise through the authored ramp, hand-computed', () => {
  // The claim is stated with the literal ramp ends, never with the module's constants: a test
  // that reused WEAR_RAMP would pass for any pair of numbers.
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  for (const [x, z] of [
    [0, 0],
    [37.5, 12.25],
    [50, 50],
    [-88.1, 210.4],
  ] as const) {
    const noise = grassNoiseField(WEAR_BREAK, x, z);
    for (const wear of [0.2, 0.5, 0.8, 1]) {
      const expected = clamp((wear * noise - 0.24) / 0.31);
      assert.ok(
        Math.abs(wearFactor(wear, x, z) - expected) < 1e-12,
        `factor at (${x}, ${z}) wear ${wear}: ${wearFactor(wear, x, z)} vs ${expected}`,
      );
    }
  }
});

test('the factor scales with the wear rather than shifting with it', () => {
  // The tell that separates a multiply from an add: at a fixed point, doubling the wear doubles
  // the pre-ramp product, so two wears in the ramp's linear interior differ by a slope that
  // depends on the point's noise — whereas an add would give the SAME slope at every point.
  // Both are asserted against the recipe's own arithmetic; the precondition is asserted, not
  // used as a guard, so a constant moving a sample onto a clamp fails rather than vacates.
  const pairAt = (x: number, z: number): readonly [number, number] => [
    wearFactor(0.6, x, z),
    wearFactor(0.7, x, z),
  ];
  // Two points whose break noise sits near 0.56 and 0.61, so wears of 0.6 and 0.7 put the
  // product inside the 0.24..0.55 ramp at both. They are tuned-island points scaled by
  // LAND_SCALE: the break noise's lattice scaled with the island, so the noise there is unchanged.
  const a = pairAt(37.5 * LAND_SCALE, 12.25 * LAND_SCALE);
  const b = pairAt(50 * LAND_SCALE, 50 * LAND_SCALE);
  for (const [label, pair] of [['a', a], ['b', b]] as const) {
    assert.ok(
      pair[0] > 0 && pair[1] < 1,
      `sample ${label} is clamped (${pair[0]}, ${pair[1]}) — the slope comparison would prove nothing`,
    );
  }
  const slopeA = a[1] - a[0];
  const slopeB = b[1] - b[0];
  assert.ok(
    Math.abs(slopeA - 0.1 * grassNoiseField(WEAR_BREAK, 37.5 * LAND_SCALE, 12.25 * LAND_SCALE) / 0.31) < 1e-12,
    `slope at a is ${slopeA}`,
  );
  assert.ok(
    Math.abs(slopeB - 0.1 * grassNoiseField(WEAR_BREAK, 50 * LAND_SCALE, 50 * LAND_SCALE) / 0.31) < 1e-12,
    `slope at b is ${slopeB}`,
  );
  assert.ok(Math.abs(slopeA - slopeB) > 1e-6, 'the two slopes agree — the noise is being ADDED');
});

test('the factor rises MONOTONICALLY with wear at a fixed point, and clamps at both ends', () => {
  for (const [x, z] of [
    [0, 0],
    [37.5, 12.25],
    [-88.1, 210.4],
  ] as const) {
    let prev = -1;
    for (const i of indices(21)) {
      const f = wearFactor(i * 0.05, x, z);
      assert.ok(f >= 0 && f <= 1);
      assert.ok(f >= prev, `factor fell from ${prev} to ${f} at wear ${i * 0.05} on (${x}, ${z})`);
      prev = f;
    }
  }
  // Below the ramp's foot the factor is zero however the noise falls: the largest noise is 1, so
  // a wear of 0.24 puts the product at or under the foot everywhere.
  assert.equal(wearFactor(0.24, 5, 5), 0);
});

// ---------------------------------------------------------------- the dirt colour

test('the dirt ramp is driven by LAYER 1`s base scalar, so the path grains like the grass', () => {
  // The ground-point form IS the scalar form at layer 1's own scalar — both sides named, so the
  // assertion is not the tautology the sand test records finding in its own first version.
  for (const [x, z] of [
    [42.5, -17.25],
    [0, 0],
    [-133.7, 208.4],
  ] as const) {
    assert.deepEqual({ ...dirtColourAt(x, z) }, { ...dirtColourOf(grassScalar(x, z)) });
  }
  assert.notDeepEqual({ ...dirtColourAt(0, 0) }, { ...dirtColourAt(-133.7, 208.4) });
});

test('the dirt ramp is piecewise LINEAR in linear space, flat outside its stops', () => {
  assert.deepEqual([...dirtLinearOf(0)], [0.165, 0.128, 0.088]);
  assert.deepEqual([...dirtLinearOf(0.35)], [0.165, 0.128, 0.088]);
  assert.deepEqual([...dirtLinearOf(0.7)], [0.322, 0.262, 0.182]);
  assert.deepEqual([...dirtLinearOf(1)], [0.322, 0.262, 0.182]);
  // Exactly halfway between the stops the ramp is the arithmetic mean of the two triples —
  // the LINEAR interpolation Blender's default performs, hand-computed.
  const mid = dirtLinearOf(0.525);
  for (const [i, expected] of [
    [0, (0.165 + 0.322) / 2],
    [1, (0.128 + 0.262) / 2],
    [2, (0.088 + 0.182) / 2],
  ] as const) {
    assert.ok(Math.abs(mid[i] - expected) < 1e-12, `channel ${i} at 0.525 is ${mid[i]}`);
  }
});

test('the delivered dirt is sRGB-converted, warm, darker than the sand, and lightens', () => {
  // The stops are linear RGB; delivery is through the standard transfer. Each channel of each
  // stop is the transfer of the authored linear value — the conversion asserted per channel.
  assert.deepEqual(
    { ...dirtColourOf(0.35) },
    { r: linearToSrgb255(0.165), g: linearToSrgb255(0.128), b: linearToSrgb255(0.088) },
  );
  assert.deepEqual(
    { ...dirtColourOf(0.7) },
    { r: linearToSrgb255(0.322), g: linearToSrgb255(0.262), b: linearToSrgb255(0.182) },
  );
  const dark = dirtColourOf(0.35);
  const light = dirtColourOf(0.7);
  // Delivered, not linear: 0.165 linear is ~113/255 through the transfer; raw it would be 42.
  assert.equal(dark.r, 113);
  assert.ok(dark.r > 100, `the dark stop delivered ${dark.r} — that is the linear value, unconverted`);
  for (const c of [dark, light]) {
    assert.ok(c.r > c.g && c.g > c.b, `dirt must run warm (r>g>b), got ${JSON.stringify(c)}`);
  }
  assert.ok(light.r > dark.r && light.g > dark.g && light.b > dark.b, 'the ramp must lighten');
  // A path is darker than a beach: the dirt's LIGHT stop sits below the sand's DARK stop in every
  // channel, which is what keeps the two families apart where the track reaches the water.
  const sandDark = SAND_RAMP[0]!.linear;
  const dirtLight = DIRT_RAMP[1]!.linear;
  for (const i of indices(3)) {
    assert.ok(dirtLight[i]! < sandDark[i]!, `channel ${i}: dirt ${dirtLight[i]} vs sand ${sandDark[i]}`);
  }
});

// ---------------------------------------------------------------- the GLSL

test('wearGlsl carries every transcribed number and reads no uniform', () => {
  const glsl = wearGlsl();
  // Every authored constant reaches the text, at six decimals — the non-vacuity check that the
  // golden below is a golden OF the transcription.
  for (const literal of [
    '0.240000',
    '0.310000',
    'vec3(0.165000, 0.128000, 0.088000)',
    'vec3(0.322000, 0.262000, 0.182000)',
    'clamp((t - 0.350000) / 0.350000, 0.0, 1.0)',
    'w * w * (3.0 - 2.0 * w)',
    'float t = wear * st_wearBreak(p);',
  ]) {
    assert.ok(glsl.includes(literal), `the emitted source is missing: ${literal}`);
  }
  // The break noise is unrolled to its own octave count — five, from the script.
  assert.equal([...glsl.matchAll(/st_grainOctave\(p \* /g)].length, WEAR_OCTAVES);
  // It calls layer 1's scalar and transfer rather than declaring copies of either.
  assert.ok(glsl.includes('st_grassSrgb(st_dirtRamp(st_grassScalar(p)))'));
  assert.equal([...glsl.matchAll(/st_grassSrgb/g)].length, 1);
  // ⚠⚠ NO UNIFORM, AND NO WRITTEN-IN FALLOFF. The source is spliced ABOVE the uniform block, so
  // a uniform read here fails to compile on a real GPU with no text assertion seeing it; and the
  // falloff is the material's width option, passed as a parameter so one shader serves a ladder.
  assert.ok(!/uniform/.test(glsl), 'the emitter is spliced above the uniform block');
  assert.ok(!/uWear/.test(glsl), 'the emitted source must read no wear uniform');
  assert.ok(glsl.includes('float st_wearOf(float d, float falloff)'));
  assert.ok(glsl.includes('float st_wearFactor(vec2 p, float wear)'));
  assert.ok(!/d \/ 3\.0/.test(glsl), 'the falloff must not be written in');
  // Declaration order: the noise and the ramp before the functions that call them.
  const order = ['st_wearBreak(vec2 p)', 'st_dirtRamp(float t)', 'st_wearOf(', 'st_wearFactor(', 'st_dirtColour('];
  const positions = order.map((name) => glsl.indexOf(name));
  for (const i of indices(order.length - 1)) {
    assert.ok(positions[i]! >= 0 && positions[i]! < positions[i + 1]!, `${order[i]} is out of order`);
  }
});

test('wearGlsl is held to an EXACT GOLDEN — the only assertion that sees a blanked line', () => {
  // ⚠⚠ A CONTAINMENT SWEEP CANNOT SEE A BLANKED LITERAL — `check:mutation-diff` proved it on the
  // sand and grass emitters. Written out rather than rebuilt from the constants, so it is the
  // text a reader checks by eye against build_land.py:894-911 and :494-495.
  // ⚠ LAND_SCALE moved exactly six numerals here and nothing else (diffed against the pre-scale
  // golden): the break noise's header spacing (25.98 -> 9.79, the recipe's 233.8 / 9 over the
  // SHIPPED span) and its five octave frequencies, which are that spacing's reciprocal doubled.
  assert.equal(
    wearGlsl(),
    [
      '// GENERATED from land-wear.ts — do not hand-edit these constants.',
      '// Layer 3 of the approved ground: build_land.py:894-911, mat_attribute();',
      '// the wear scalar is build_land.py:494-495, build_land_grid().',
      '// st_wearBreak: Cycles scale 9 -> 9.79 ground units,',
      '// 5 octaves, roughness 0.5.',
      'float st_wearBreak(vec2 p) {',
      '  float s = 0.0;',
      '  s += 1.000000 * st_grainOctave(p * 0.102129);',
      '  s += 0.500000 * st_grainOctave(p * 0.204258);',
      '  s += 0.250000 * st_grainOctave(p * 0.408516);',
      '  s += 0.125000 * st_grainOctave(p * 0.817033);',
      '  s += 0.062500 * st_grainOctave(p * 1.634066);',
      '  return s / 1.937500;',
      '}',
      '',
      'vec3 st_dirtRamp(float t) {',
      '  float st_dirtRamp_f;',
      '  vec3 st_dirtRamp_c = vec3(0.165000, 0.128000, 0.088000);',
      '  st_dirtRamp_f = clamp((t - 0.350000) / 0.350000, 0.0, 1.0);',
      '  st_dirtRamp_c = mix(st_dirtRamp_c, vec3(0.322000, 0.262000, 0.182000), st_dirtRamp_f);',
      '  return st_dirtRamp_c;',
      '}',
      '',
      '// THE WEAR SCALAR from the distance to the path: a clipped linear ramp through a Hermite',
      '// smoothstep. The falloff is a PARAMETER: this block reads nothing the shader uploads.',
      'float st_wearOf(float d, float falloff) {',
      '  float w = clamp(1.0 - d / falloff, 0.0, 1.0);',
      '  return w * w * (3.0 - 2.0 * w);',
      '}',
      '',
      '// THE MIX FACTOR: 0 is the ground beneath, 1 is pure dirt. The break noise MULTIPLIES the',
      '// wear (build_land.py:898), so where the wear is zero no noise can paint a path.',
      'float st_wearFactor(vec2 p, float wear) {',
      '  float t = wear * st_wearBreak(p);',
      '  return clamp((t - 0.240000) / 0.310000, 0.0, 1.0);',
      '}',
      '',
      '// THE DIRT COLOUR as a delivered sRGB triple in 0..1 — the ramp driven by LAYER 1`s own base',
      '// scalar, so the path grains with the same field the grass does.',
      'vec3 st_dirtColour(vec2 p) {',
      '  return st_grassSrgb(st_dirtRamp(st_grassScalar(p)));',
      '}',
    ].join('\n'),
  );
});
