import assert from 'node:assert/strict';
import test from 'node:test';

import { grainOctave, linearToSrgb255 } from './land-grain.js';
import { LAND_SCALE } from './land-per-capability.js';
import {
  CYCLES_ISLAND_SPAN,
  GRASS_BROAD,
  GRASS_COOL,
  GRASS_DRIFT,
  GRASS_DRIFT_RAMP,
  GRASS_FINE,
  GRASS_MID,
  GRASS_MIX_BROAD_MID,
  GRASS_MIX_INTO_FINE,
  GRASS_OCTAVES,
  GRASS_WARM,
  clamp01,
  cyclesMixFloat,
  grassAmplitudeSum,
  grassColourAt,
  grassDrift,
  grassGlsl,
  grassLattice,
  grassLinearAt,
  grassLinearOf,
  grassMixedAt,
  grassNoiseField,
  grassOctaveAmplitude,
  grassOctaveFrequency,
  grassScalar,
  grassTerms,
  noiseGlsl,
  rampGlsl,
  rampLinear,
} from './land-grass.js';

// ---------------------------------------------------------------- the transcription

// ⚠⚠ EVERY CONSTANT IS ASSERTED AS ITS OWN LITERAL, NEVER RE-DERIVED FROM THE MODULE. A test
// that computed the expected value the same way the module does would pass on the DECOY's
// numbers exactly as happily as on these — which is the one failure this file exists to prevent
// (ADR-0490 D2). The literals below were read off `build_land.py`'s `mat_attribute()` by hand.

test('the three base octaves are mat_attribute()`s own, not mat_procedural()`s', () => {
  assert.deepEqual(GRASS_BROAD, { scale: 1.9, detail: 8, roughness: 0.62 });
  assert.deepEqual(GRASS_MID, { scale: 6.8, detail: 8, roughness: 0.55 });
  assert.deepEqual(GRASS_FINE, { scale: 28.0, detail: 4, roughness: 0.5 });
  assert.deepEqual(GRASS_DRIFT, { scale: 2.7, detail: 3, roughness: 0.4 });
});

test('the two float mixes carry the authored factors in the authored order', () => {
  assert.equal(GRASS_MIX_BROAD_MID, 0.42);
  assert.equal(GRASS_MIX_INTO_FINE, 0.2);
});

test('the cool ramp is the APPROVED variant`s, and differs from the decoy exactly where it should', () => {
  assert.deepEqual(GRASS_COOL, [
    { at: 0.28, linear: [0.052, 0.126, 0.052] },
    { at: 0.5, linear: [0.124, 0.258, 0.086] },
    { at: 0.74, linear: [0.268, 0.432, 0.14] },
  ]);
  // The decoy's own first stop, spelled out so the guard is a comparison rather than a memory:
  // `mat_procedural()` opens at 0.30 with (0.054, 0.130, 0.054). If a later transcription drifts
  // onto it, THIS is the assertion that fires.
  const decoyFirst = { at: 0.3, linear: [0.054, 0.13, 0.054] };
  assert.notDeepEqual(GRASS_COOL[0], decoyFirst);
});

test('the warm ramp is the authored one', () => {
  assert.deepEqual(GRASS_WARM, [
    { at: 0.28, linear: [0.095, 0.118, 0.04] },
    { at: 0.5, linear: [0.21, 0.248, 0.078] },
    { at: 0.74, linear: [0.362, 0.388, 0.144] },
  ]);
});

test('the drift ramp spans the authored 0.38 to 0.62', () => {
  assert.deepEqual([...GRASS_DRIFT_RAMP], [0.38, 0.62]);
});


// ---------------------------------------------------------------- the lattice conversion

test('a Cycles Scale becomes a lattice spacing by dividing the island span', () => {
  assert.equal(CYCLES_ISLAND_SPAN, 233.8);
  // The recipe's span stays 233.8; the lattice divides the SHIPPED span, `233.8 * LAND_SCALE`
  // (`land-per-capability.ts`), so each spacing is the same fraction of the smaller island.
  assert.equal(grassLattice(GRASS_BROAD), (233.8 * LAND_SCALE) / 1.9);
  assert.equal(grassLattice(GRASS_MID), (233.8 * LAND_SCALE) / 6.8);
  assert.equal(grassLattice(GRASS_FINE), (233.8 * LAND_SCALE) / 28.0);
  assert.equal(grassLattice(GRASS_DRIFT), (233.8 * LAND_SCALE) / 2.7);
});

test('the delivered spacings are the ladder land-grain.ts already describes', () => {
  // land-grain.ts's header, written before this layer was transcribed: "the landform at ~123
  // units, the mid octave at ~34, the fine one at ~8". An independent confirmation of the
  // conversion rather than a restatement of it. Those figures are the TUNED island's, so the
  // shipped spacing is read back in that basis by dividing out LAND_SCALE.
  assert.ok(Math.abs(grassLattice(GRASS_BROAD) / LAND_SCALE - 123) < 1);
  assert.ok(Math.abs(grassLattice(GRASS_MID) / LAND_SCALE - 34) < 1);
  assert.ok(Math.abs(grassLattice(GRASS_FINE) / LAND_SCALE - 8) < 1);
});

test('octave amplitude compounds the roughness and frequency doubles the lattice', () => {
  assert.equal(grassOctaveAmplitude(GRASS_MID, 0), 1);
  assert.equal(grassOctaveAmplitude(GRASS_MID, 1), 0.55);
  assert.equal(grassOctaveAmplitude(GRASS_MID, 2), 0.55 ** 2);
  // Over the SHIPPED span, `233.8 * LAND_SCALE` (`land-per-capability.ts`).
  assert.equal(grassOctaveFrequency(GRASS_MID, 0), 1 / ((233.8 * LAND_SCALE) / 6.8));
  assert.equal(grassOctaveFrequency(GRASS_MID, 1), 2 / ((233.8 * LAND_SCALE) / 6.8));
});

test('a noise carries exactly `detail` octaves and normalises by their amplitude sum', () => {
  assert.equal(grassTerms(GRASS_BROAD).length, 8);
  assert.equal(grassTerms(GRASS_FINE).length, 4);
  assert.equal(grassTerms(GRASS_DRIFT).length, 3);
  assert.equal(grassAmplitudeSum(GRASS_DRIFT), 1 + 0.4 + 0.4 ** 2);
});

test('GRASS_OCTAVES is the summed per-fragment octave load', () => {
  assert.equal(GRASS_OCTAVES, 8 + 8 + 4 + 3);
});

// ---------------------------------------------------------------- the arithmetic

test('Blender`s Mix/FLOAT is A + (B - A) * factor, in that order', () => {
  assert.equal(cyclesMixFloat(0, 1, 0.42), 0.42);
  // The reversed operands must give the COMPLEMENT — a tolerance rather than an equality only
  // because 1 + (0 - 1) * 0.42 is not exactly representable, which is a property of binary
  // floats and not of the arithmetic being asserted.
  assert.ok(Math.abs(cyclesMixFloat(1, 0, 0.42) - 0.58) < 1e-12);
  assert.equal(cyclesMixFloat(0.2, 0.8, 0), 0.2);
  assert.equal(cyclesMixFloat(0.2, 0.8, 1), 0.8);
});

test('clamp01 pins both ends and passes the interior', () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.37), 0.37);
  assert.equal(clamp01(4), 1);
});

test('the ramp is flat outside its stops and linear between them', () => {
  const stops = [
    { at: 0.28, linear: [0, 0, 0] as const },
    { at: 0.5, linear: [1, 0.5, 0] as const },
    { at: 0.74, linear: [1, 1, 1] as const },
  ];
  assert.deepEqual(rampLinear(stops, 0), [0, 0, 0]);
  assert.deepEqual(rampLinear(stops, 0.28), [0, 0, 0]);
  assert.deepEqual(rampLinear(stops, 1), [1, 1, 1]);
  assert.deepEqual(rampLinear(stops, 0.74), [1, 1, 1]);
  // Halfway along the FIRST segment: 0.28 + 0.11 = 0.39.
  const mid = rampLinear(stops, 0.39);
  assert.ok(Math.abs(mid[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(mid[1] - 0.25) < 1e-9);
  assert.equal(mid[2], 0);
  // Exactly ON the middle stop.
  assert.deepEqual(rampLinear(stops, 0.5), [1, 0.5, 0]);
});

test('the field is the OCTAVE FOLD, not merely a number in range', () => {
  // ⚠⚠ A RANGE ASSERTION SURVIVES A FREQUENCY INVERSION. `check:mutation-diff` swapped
  // `x * term.freq` for `x / term.freq` — a field six thousand times too coarse — and every
  // "is it in [0,1]" test stayed green. So the composition is asserted against `grainOctave`
  // with the frequencies written out as LITERALS, not re-derived from the module.
  const x = 11.25;
  const z = -7.5;
  const lattice = (233.8 * LAND_SCALE) / 2.7; // GRASS_DRIFT's own spacing over the SHIPPED span, spelled out
  const terms = [
    { amp: 1, freq: 1 / lattice },
    { amp: 0.4, freq: 2 / lattice },
    { amp: 0.4 ** 2, freq: 4 / lattice },
  ];
  let sum = 0;
  for (const t of terms) sum += t.amp * grainOctave(x * t.freq, z * t.freq);
  const expected = sum / (1 + 0.4 + 0.4 ** 2);
  assert.equal(grassNoiseField(GRASS_DRIFT, x, z), expected);
  // And the inverted spelling really is different here, so the assertion above is load-bearing.
  let wrong = 0;
  for (const t of terms) wrong += t.amp * grainOctave(x / t.freq, z / t.freq);
  assert.notEqual(wrong / (1 + 0.4 + 0.4 ** 2), expected);
});

test('the drift is the authored remap, not merely a number in [0, 1]', () => {
  // Same reason: `(raw - lo) / (hi - lo)` survived three arithmetic mutations under a range-only
  // assertion. The span is written out from the authored stops rather than read back.
  for (const [x, z] of [
    [0, 0],
    [31.5, -12.25],
    [-88.75, 40.5],
  ] as const) {
    const raw = grassNoiseField(GRASS_DRIFT, x, z);
    const expected = clamp01((raw - 0.38) / (0.62 - 0.38));
    assert.equal(grassDrift(x, z), expected, `drift disagreed at ${x},${z}`);
  }
});

test('the two ramps are selected between by a MIX, at the drift`s own ends and midpoint', () => {
  // ⚠ THE SELECTION SURVIVED NINE MUTATIONS under the composition test alone — `+` for `-`,
  // `*` for `/`, and `warm + cool` for `warm - cool` all deliver plausible colours. Pinning the
  // two ends and the midpoint separates every one of them.
  const t = 0.55;
  assert.deepEqual(grassLinearOf(t, 0), rampLinear(GRASS_COOL, t), 'drift 0 is the COOL ramp');
  assert.deepEqual(grassLinearOf(t, 1), rampLinear(GRASS_WARM, t), 'drift 1 is the WARM ramp');
  const cool = rampLinear(GRASS_COOL, t);
  const warm = rampLinear(GRASS_WARM, t);
  const half = grassLinearOf(t, 0.5);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(
      Math.abs(half[i]! - (cool[i]! + warm[i]!) / 2) < 1e-12,
      `channel ${i} is not the midpoint of the two ramps`,
    );
  }
});

test('the ramp is evaluated LINEARLY, not smoothstepped — the divergence from land-grain.ts', () => {
  const stops = [
    { at: 0, linear: [0, 0, 0] as const },
    { at: 1, linear: [1, 1, 1] as const },
  ];
  // A smoothstep would deliver 3t^2 - 2t^3 = 0.15625 at t = 0.25. Linear delivers 0.25.
  assert.equal(rampLinear(stops, 0.25)[0], 0.25);
});

test('a ramp with no stops is refused rather than delivering black', () => {
  assert.throws(() => rampLinear([], 0.5), /no stops/);
});

// ---------------------------------------------------------------- the field

test('every noise field lands in [0, 1]', () => {
  for (let i = 0; i < 40; i += 1) {
    const x = i * 7.3 - 120;
    const z = i * -3.1 + 44;
    for (const noise of [GRASS_BROAD, GRASS_MID, GRASS_FINE, GRASS_DRIFT]) {
      const v = grassNoiseField(noise, x, z);
      assert.ok(v >= 0 && v <= 1, `${v} out of range at ${x},${z}`);
    }
  }
});

test('the base scalar is the two mixes applied in order', () => {
  const x = 17.5;
  const z = -8.25;
  const broad = grassNoiseField(GRASS_BROAD, x, z);
  const mid = grassNoiseField(GRASS_MID, x, z);
  const fine = grassNoiseField(GRASS_FINE, x, z);
  const expected = cyclesMixFloat(
    cyclesMixFloat(broad, mid, GRASS_MIX_BROAD_MID),
    fine,
    GRASS_MIX_INTO_FINE,
  );
  assert.equal(grassScalar(x, z), expected);
});

test('the drift is remapped across its ramp and clamped to [0, 1]', () => {
  for (let i = 0; i < 60; i += 1) {
    const d = grassDrift(i * 11.7, i * -5.3);
    assert.ok(d >= 0 && d <= 1);
  }
});

// ---------------------------------------------------------------- the delivered colour

test('the delivered colour is the linear ramp converted, not the stops converted then mixed', () => {
  const x = 3.5;
  const z = 21.75;
  const lin = grassLinearAt(x, z);
  assert.deepEqual(grassColourAt(x, z), {
    r: linearToSrgb255(lin[0]),
    g: linearToSrgb255(lin[1]),
    b: linearToSrgb255(lin[2]),
  });
});

test('the ramp ends deliver the authored stop colours through the transfer', () => {
  // At the top of both ramps the drift cannot change the answer only if both agree; it does not,
  // so this asserts each ramp's own end directly.
  assert.deepEqual(rampLinear(GRASS_COOL, 1), [0.268, 0.432, 0.14]);
  assert.deepEqual(rampLinear(GRASS_WARM, 0), [0.095, 0.118, 0.04]);
  // ⚠ NOT a transcribed byte here — `linearToSrgb255` is `land-grain.ts`'s and is tested there.
  // What this file owns is that the ramp's ENDS are ordered and separated once converted: a ramp
  // whose dark and light stops delivered the same pixel would satisfy every literal above and
  // still be a flat green.
  const dark = linearToSrgb255(GRASS_COOL[0]!.linear[1]);
  const light = linearToSrgb255(GRASS_COOL[2]!.linear[1]);
  assert.ok(light > dark, 'the cool ramp runs dark to light');
  assert.ok(light - dark > 20, `the cool ramp spans only ${light - dark}/255 in green`);
});

test('the mix seam returns the base at fac 0 and the grass at fac 1', () => {
  const base = '#4f7a3a';
  const x = -12.5;
  const z = 6.5;
  assert.deepEqual(grassMixedAt(base, x, z, 0), { r: 0x4f, g: 0x7a, b: 0x3a });
  assert.deepEqual(grassMixedAt(base, x, z, 1), grassColourAt(x, z));
});

test('the mix seam moves the base TOWARD the grass, monotonically', () => {
  const base = '#d8c069';
  const x = 40.5;
  const z = -22.5;
  const grass = grassColourAt(x, z);
  let previous = Math.abs(0xd8 - grass.r);
  for (const fac of [0.1, 0.2, 0.4, 0.8]) {
    const d = Math.abs(grassMixedAt(base, x, z, fac).r - grass.r);
    assert.ok(d <= previous, `fac ${fac} moved away from the grass`);
    previous = d;
  }
});

// ---------------------------------------------------------------- the layer's own premise

test('THE PREMISE: the grass field delivers many colour families where the shipped ground has one', () => {
  // ⚠ THIS IS THE INCREMENT'S REASON TO EXIST, ASSERTED RATHER THAN ASSUMED. The arc's gap is
  // measured as colour families holding >=0.5% of the island, quantised to 5 bits per channel:
  // 9 for what ships, 36 for the approved render. A layer that delivered one flat colour would
  // pass every transcription test above and close none of that gap — the premise refutable at
  // its own source.
  const families = new Set<number>();
  for (let i = 0; i < 120; i += 1) {
    for (let j = 0; j < 120; j += 1) {
      // A 2-unit step over a 240-unit island: the footprint the fields are authored against.
      const c = grassColourAt(i * 2 - 120, j * 2 - 120);
      families.add(((c.r >> 3) << 10) | ((c.g >> 3) << 5) | (c.b >> 3));
    }
  }
  assert.ok(families.size >= 20, `the grass delivers only ${families.size} colour families`);
});

test('THE PREMISE: the two ramps are separated by more than the visibility threshold', () => {
  // The hue drift is the layer's second half, and it is worth nothing if cool and warm deliver
  // the same pixel. 20/255 is the threshold this arc judges an arm by (ADR-0490 D6).
  const cool = rampLinear(GRASS_COOL, 0.5);
  const warm = rampLinear(GRASS_WARM, 0.5);
  const dr = Math.abs(linearToSrgb255(cool[0]) - linearToSrgb255(warm[0]));
  assert.ok(dr > 20, `cool and warm differ by only ${dr}/255 in red at the middle stop`);
});

// ---------------------------------------------------------------- the GLSL

test('the shader source carries the constants from this module rather than hand-typed ones', () => {
  const src = grassGlsl();
  assert.match(src, /GENERATED from land-grass\.ts/);
  // The mix factors, written in.
  assert.ok(src.includes(GRASS_MIX_BROAD_MID.toFixed(6)));
  assert.ok(src.includes(GRASS_MIX_INTO_FINE.toFixed(6)));
  // Every ramp stop, in LINEAR space, written in.
  for (const stop of [...GRASS_COOL, ...GRASS_WARM]) {
    assert.ok(
      src.includes(`vec3(${stop.linear[0].toFixed(6)}, ${stop.linear[1].toFixed(6)}, ${stop.linear[2].toFixed(6)})`),
      `the shader is missing the stop ${stop.linear.join(', ')}`,
    );
  }
});

test('the shader unrolls exactly the octaves this module declares', () => {
  const src = grassGlsl();
  const taps = [...src.matchAll(/st_grainOctave\(/g)].length;
  assert.equal(taps, GRASS_OCTAVES);
});

test('the shader declares every function the fragment stage calls, and calls st_grainOctave', () => {
  const src = grassGlsl();
  for (const fn of [
    'st_grassBroad',
    'st_grassMid',
    'st_grassFine',
    'st_grassDrift',
    'st_grassScalar',
    'st_grassCool',
    'st_grassWarm',
    'st_grassSrgb',
    'st_grassColour',
  ]) {
    assert.ok(src.includes(`${fn}(`), `the shader never declares ${fn}`);
  }
  // ⚠ The lattice octave is BORROWED from grainGlsl() rather than re-emitted: two spellings of
  // one hash in one shader is a redefinition error at best and a silent divergence at worst.
  // `createBandedGroundMaterial` refuses `grass` without `grain` for exactly this reason.
  assert.ok(src.includes('st_grainOctave('));
  assert.ok(!src.includes('st_grassHash'), 'the grass must not carry a second lattice hash');
});

test('the shader`s sRGB transfer agrees with linearToSrgb255 at the knee it is written around', () => {
  const src = grassGlsl();
  assert.ok(src.includes('0.0031308'));
  assert.ok(src.includes('12.92'));
  assert.ok(src.includes('1.055'));
  assert.ok(src.includes('1.0 / 2.4'));
});

// ---------------------------------------------------------------- the emitters, EXACTLY
//
// ⚠⚠ WHY THESE ARE GOLDENS AND NOT `includes()` CHECKS. Every line of a GLSL emitter is a string
// literal, and `check:mutation-diff` blanked forty of them one at a time. A shader with a blanked
// line still contains every CONSTANT a containment test looks for — the mutants all survived a
// suite that asserted the numbers were present. Only asserting the emitted TEXT can tell a
// present line from an absent one, so the two emitters are held to exact output on inputs small
// enough for a reader to check by eye, and `grassGlsl` is held to CONTAINING what they emit.

test('noiseGlsl emits exactly the unrolled octave sum, header and all', () => {
  // A two-octave noise at a scale that made the lattice a round 100 units on the TUNED island:
  // 233.8 / 2.338. Over the shipped span it is 100 * LAND_SCALE = 37.69 units.
  // ⚠ LAND_SCALE moved exactly three numerals here and nothing else (diffed against the pre-scale
  // golden): the header spacing (100.00 -> 37.69) and the two octave frequencies (0.01 / 0.02 ->
  // 1 / 37.69 and 2 / 37.69).
  const noise = { scale: 2.338, detail: 2, roughness: 0.5 };
  assert.deepEqual(noiseGlsl('st_probe', noise), [
    '// st_probe: Cycles scale 2.338 -> 37.69 ground units,',
    '// 2 octaves, roughness 0.5.',
    'float st_probe(vec2 p) {',
    '  float s = 0.0;',
    '  s += 1.000000 * st_grainOctave(p * 0.026531);',
    '  s += 0.500000 * st_grainOctave(p * 0.053062);',
    '  return s / 1.500000;',
    '}',
  ]);
});

test('rampGlsl emits exactly the chained-clamped-mix form, one segment per stop pair', () => {
  const stops = [
    { at: 0.25, linear: [0, 0, 0] as const },
    { at: 0.75, linear: [1, 0.5, 0.25] as const },
  ];
  assert.deepEqual(rampGlsl('st_probeRamp', stops), [
    'vec3 st_probeRamp(float t) {',
    '  float st_probeRamp_f;',
    '  vec3 st_probeRamp_c = vec3(0.000000, 0.000000, 0.000000);',
    '  st_probeRamp_f = clamp((t - 0.250000) / 0.500000, 0.0, 1.0);',
    '  st_probeRamp_c = mix(st_probeRamp_c, vec3(1.000000, 0.500000, 0.250000), st_probeRamp_f);',
    '  return st_probeRamp_c;',
    '}',
  ]);
});

test('rampGlsl walks the TAIL of the stops — a segment per pair, never one per stop', () => {
  // `stops.slice(1)` -> `stops` survived: it emits a degenerate zero-width first segment whose
  // divisor is 0, which delivers NaN on a GPU and reads as black ground. Counting the segments
  // is what separates them.
  const three = rampGlsl('st_r', GRASS_COOL).join('\n');
  assert.equal([...three.matchAll(/= clamp\(/g)].length, 2, 'three stops make TWO segments');
  const two = rampGlsl('st_r', GRASS_COOL.slice(0, 2)).join('\n');
  assert.equal([...two.matchAll(/= clamp\(/g)].length, 1);
  // And no segment may have a zero span — the shape a slice-off-by-one produces.
  assert.ok(!/\/ 0\.000000/.test(three), 'a zero-width segment divides by zero');
});

test('rampGlsl spans are the DIFFERENCE between adjacent stops, not their sum', () => {
  const src = rampGlsl('st_r', GRASS_COOL).join('\n');
  assert.ok(src.includes('(t - 0.280000) / 0.220000'), 'first segment: 0.50 - 0.28');
  assert.ok(src.includes('(t - 0.500000) / 0.240000'), 'second segment: 0.74 - 0.50');
  assert.ok(!src.includes('/ 0.780000'), 'a summed span would be 0.28 + 0.50');
});

test('a GLSL ramp with no stops is refused rather than emitting an empty function', () => {
  assert.throws(() => rampGlsl('st_r', []), /no stops/);
});

test('grassGlsl SPLICES the emitters` own output — it does not re-spell any of it', () => {
  const src = grassGlsl();
  for (const [name, noise] of [
    ['st_grassBroad', GRASS_BROAD],
    ['st_grassMid', GRASS_MID],
    ['st_grassFine', GRASS_FINE],
    ['st_grassDrift', GRASS_DRIFT],
  ] as const) {
    assert.ok(src.includes(noiseGlsl(name, noise).join('\n')), `${name} is not spliced verbatim`);
  }
  assert.ok(src.includes(rampGlsl('st_grassCool', GRASS_COOL).join('\n')));
  assert.ok(src.includes(rampGlsl('st_grassWarm', GRASS_WARM).join('\n')));
});

test('grassGlsl`s OWN lines — the fold, the transfer and the colour — are emitted exactly', () => {
  const src = grassGlsl();
  for (const line of [
    '// GENERATED from land-grass.ts — do not hand-edit these constants.',
    '// Layer 1 of the approved ground: build_land.py:836-868, mat_attribute().',
    'float st_grassScalar(vec2 p) {',
    '  float mA = mix(st_grassBroad(p), st_grassMid(p), 0.420000);',
    '  return mix(mA, st_grassFine(p), 0.200000);',
    'vec3 st_grassSrgb(vec3 c) {',
    '  vec3 lo = c * 12.92;',
    '  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;',
    '  return mix(lo, hi, step(vec3(0.0031308), c));',
    'vec3 st_grassColour(vec2 p) {',
    '  float t = st_grassScalar(p);',
    '  float d = clamp((st_grassDrift(p) - 0.380000) / 0.240000, 0.0, 1.0);',
    '  vec3 lin = mix(st_grassCool(t), st_grassWarm(t), d);',
    '  return st_grassSrgb(lin);',
  ]) {
    assert.ok(src.includes(line), `the shader is missing its own line: ${line}`);
  }
  // ⚠ THE DRIFT SPAN IS A DIFFERENCE, and the summed spelling is a plausible-looking mutant:
  // 0.62 + 0.38 is 1.0, which would flatten the hue drift to almost nothing while compiling.
  assert.ok(!src.includes('0.380000) / 1.000000'), 'the drift span must be 0.62 - 0.38');
});

test('every line grassGlsl emits is either code or a deliberate blank separator', () => {
  // The blanked-literal mutants all produce an EMPTY line where content was. Counting them pins
  // every one at once: the separators are the only empty lines the emitter authors.
  const lines = grassGlsl().split('\n');
  const blanks = lines.filter((l) => l.length === 0).length;
  assert.equal(blanks, 8, 'eight blank separators: after four noises, two ramps and two helpers');
  assert.ok(lines.length > 60, `the emitter produced only ${lines.length} lines`);
});
