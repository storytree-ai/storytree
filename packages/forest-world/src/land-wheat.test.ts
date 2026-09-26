import assert from 'node:assert/strict';
import test from 'node:test';

import { linearToSrgb255 } from './land-grain.js';
import {
  GRASS_COOL,
  GRASS_DRIFT_RAMP,
  GRASS_STATUS_GATE,
  GRASS_WARM,
  grassDrift,
  grassScalar,
  rampGlsl,
} from './land-grass.js';
import {
  GRASS_TOKEN_REFERENCE,
  WHEAT_ANCHORS,
  WHEAT_LIFTS,
  WHEAT_STATUS_GATE,
  hexToLinear,
  liftChannel,
  liftStop,
  rebaseChannel,
  rebaseStop,
  srgbToLinear,
  wheatAnchor,
  wheatLift,
  wheatColourAt,
  wheatColourOf,
  wheatCool,
  wheatGlsl,
  wheatLinearOf,
  wheatRamp,
  wheatWarm,
  type WheatPalette,
} from './land-wheat.js';
import { toHex } from './shade-ladder.js';

/** A palette at the derivation's own lift, so the yellowness assertions below read as they did. */
const P = (anchor: string, lift = 1): WheatPalette => ({ anchor, lift });

// ---------------------------------------------------------------- the gate

test('the wheat gate is the in-progress pair, both keys of the one authored token, and no other', () => {
  // ⚠ A LITERAL, NEVER DERIVED: this is the delivery decision the whole row rests on (ADR-0492 D1
  // widened by token), and a test that read it back off the module would pass on any list.
  assert.deepEqual([...WHEAT_STATUS_GATE], ['building', 'proposed']);
  // Disjoint from the grass's gate by construction — the material refuses a shared row, and this
  // is the list-level statement of the same fact.
  for (const s of WHEAT_STATUS_GATE) assert.ok(!GRASS_STATUS_GATE.includes(s), `${s} is in both gates`);
});

test('the green reference is the shipped healthy token, as a literal', () => {
  assert.equal(GRASS_TOKEN_REFERENCE, '#8cb85e');
});

// ---------------------------------------------------------------- the transfer

test('srgbToLinear is the exact inverse of linearToSrgb255 on every byte', () => {
  for (let b = 0; b <= 255; b += 1) {
    assert.equal(linearToSrgb255(srgbToLinear(b)), b, `byte ${b} does not round-trip`);
  }
  // The two ends and the knee, as literals — a transfer that round-trips can still be the wrong
  // curve if both halves are wrong together; these pin the curve itself.
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(255), 1);
  assert.ok(Math.abs(srgbToLinear(128) - 0.2158605) < 1e-6);
  // Below the knee the transfer is linear: byte 10 is 10/255/12.92.
  assert.ok(Math.abs(srgbToLinear(10) - 10 / 255 / 12.92) < 1e-12);
  // Monotone, strictly.
  for (let b = 1; b <= 255; b += 1) assert.ok(srgbToLinear(b) > srgbToLinear(b - 1));
});

test('hexToLinear crosses each channel through the transfer', () => {
  const [r, g, b] = hexToLinear('#8cb85e');
  assert.equal(r, srgbToLinear(0x8c));
  assert.equal(g, srgbToLinear(0xb8));
  assert.equal(b, srgbToLinear(0x5e));
  assert.deepEqual(hexToLinear('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToLinear('#ffffff'), [1, 1, 1]);
});

// ---------------------------------------------------------------- the ladder

test('the ladder is four AUTHORED anchors in the 2026-08-27 instrument`s order, as literals', () => {
  // ⚠ LITERALS, never derived. Every hex is a row of a committed table (`chapter2-ground-cover-
  // 2026-08-27/README.md` §4) or the app's own wheat token; a test that built the expected list
  // from the module would pass on any four colours.
  assert.deepEqual(
    WHEAT_ANCHORS.map((a) => [a.id, a.hex]),
    [
      ['straw', '#d9d18a'],
      ['wheat', '#d6b271'],
      ['light-straw', '#c6c06a'],
      ['mustard', '#b0b040'],
    ],
  );
  for (const a of WHEAT_ANCHORS) assert.ok(a.what.length > 20, `${a.id} has no caption`);
  assert.equal(wheatAnchor('mustard').hex, '#b0b040');
  assert.throws(() => wheatAnchor('gold'), /no wheat anchor "gold"/);
  // The mustard is the harness's own `YELLOW_GRASS` and the wheat the app's own token — pinned by
  // hex here so the two authored sources cannot drift from the ladder that cites them.
  assert.equal(wheatAnchor('wheat').hex, '#d6b271');
});

// ---------------------------------------------------------------- the derivation

test('rebaseChannel scales the anchor by the stop`s ratio to the reference — anchor and reference are not interchangeable', () => {
  // The mustard's linear red (0.4342) times the cool light stop's red ratio (0.268 / 0.2622).
  // Literal operands, so a mutant that swaps anchor and reference (0.1618) or drops one (0.268)
  // fails against a number it cannot reproduce.
  assert.ok(Math.abs(rebaseChannel(0.268, 0.4342, 0.2622) - 0.44378) < 1e-4);
  assert.ok(Math.abs(rebaseChannel(0.268, 0.2622, 0.4342) - 0.16184) < 1e-4);
  // A ratio above 1 on a pale anchor CLAMPS at linear white rather than normalising.
  assert.equal(rebaseChannel(0.362, 1.0, 0.2622), 1);
  assert.equal(rebaseChannel(0, 0.5, 0.2622), 0);
});

test('rebaseStop keeps the stop`s POSITION and rebases all three channels', () => {
  const stop = { at: 0.74, linear: [0.268, 0.432, 0.14] as const };
  const out = rebaseStop(stop, [0.5, 0.25, 0.1], [0.25, 0.5, 0.05]);
  assert.equal(out.at, 0.74);
  assert.ok(Math.abs(out.linear[0] - 0.536) < 1e-9);
  assert.ok(Math.abs(out.linear[1] - 0.216) < 1e-9);
  assert.ok(Math.abs(out.linear[2] - 0.28) < 1e-9);
});

test('wheatRamp rebases every stop of a ramp onto the anchor, against the green reference', () => {
  const ramp = wheatRamp(GRASS_COOL, P('#b0b040'));
  assert.equal(ramp.length, GRASS_COOL.length);
  const anchor = hexToLinear('#b0b040');
  const ref = hexToLinear(GRASS_TOKEN_REFERENCE);
  ramp.forEach((stop, i) => {
    const src = GRASS_COOL[i]!;
    assert.equal(stop.at, src.at);
    for (let ch = 0; ch < 3; ch += 1) {
      assert.ok(Math.abs(stop.linear[ch]! - Math.min(1, (anchor[ch]! * src.linear[ch]!) / ref[ch]!)) < 1e-12);
    }
  });
  // The green rebased onto ITSELF is the green ramp — the derivation has no residue.
  const identity = wheatRamp(GRASS_COOL, P(GRASS_TOKEN_REFERENCE));
  identity.forEach((stop, i) => {
    for (let ch = 0; ch < 3; ch += 1) assert.ok(Math.abs(stop.linear[ch]! - GRASS_COOL[i]!.linear[ch]!) < 1e-12);
  });
  assert.deepEqual(wheatCool(P('#b0b040')), wheatRamp(GRASS_COOL, P('#b0b040')));
  assert.deepEqual(wheatWarm(P('#b0b040')), wheatRamp(GRASS_WARM, P('#b0b040')));
});

/** The six delivered stop colours per anchor, cool then warm, dark → light — read off an
 *  independent evaluation of the same rule (a scratch walk, 2026-09-06) and pinned as LITERALS so
 *  a drift in the ratio, the reference, the transfer or the clamp fails against a colour rather
 *  than against itself. */
const STOP_GOLDENS = {
  '#d9d18a': { cool: ['#687260', '#9b9e7a', '#dbc899'], warm: ['#896e55', '#c59b75', '#fabe9b'] },
  '#d6b271': { cool: ['#66604e', '#998664', '#d8aa7d'], warm: ['#875d45', '#c2845f', '#f7a27f'] },
  '#c6c06a': { cool: ['#5e6849', '#8d915e', '#c8b776'], warm: ['#7d6540', '#b38f59', '#e4af77'] },
  '#b0b040': { cool: ['#535f2b', '#7d8538', '#b2a848'], warm: ['#6e5c25', '#9f8235', '#cba049'] },
} satisfies Record<string, { cool: string[]; warm: string[] }>;

test('every anchor`s six stops deliver the pinned colours', () => {
  for (const a of WHEAT_ANCHORS) {
    const golden = STOP_GOLDENS[a.hex as keyof typeof STOP_GOLDENS];
    GRASS_COOL.forEach((stop, i) => {
      assert.equal(toHex(wheatColourOf(P(a.hex), stop.at, 0)), golden.cool[i], `${a.id} cool stop ${i}`);
      assert.equal(toHex(wheatColourOf(P(a.hex), stop.at, 1)), golden.warm[i], `${a.id} warm stop ${i}`);
    });
  }
});

test('the wheat colour LIGHTENS with the base scalar and DRIFTS from cool to warm', () => {
  const luma = (l: readonly number[]): number => 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
  for (const a of WHEAT_ANCHORS) {
    let prev = -1;
    for (let i = 0; i <= 20; i += 1) {
      const l = luma(wheatLinearOf(P(a.hex), i / 20, 0.5));
      assert.ok(l >= prev, `${a.id} darkens between t=${(i - 1) / 20} and ${i / 20}`);
      prev = l;
    }
    // Flat outside the ramp's span, like the recipe's ramps.
    assert.deepEqual(wheatLinearOf(P(a.hex), 0, 0), wheatLinearOf(P(a.hex), 0.28, 0));
    assert.deepEqual(wheatLinearOf(P(a.hex), 1, 1), wheatLinearOf(P(a.hex), 0.74, 1));
    // The drift is a MIX between the two ramps, not a branch: the midpoint is the mean.
    const cool = wheatLinearOf(P(a.hex), 0.5, 0);
    const warm = wheatLinearOf(P(a.hex), 0.5, 1);
    const mid = wheatLinearOf(P(a.hex), 0.5, 0.5);
    for (let ch = 0; ch < 3; ch += 1) assert.ok(Math.abs(mid[ch]! - (cool[ch]! + warm[ch]!) / 2) < 1e-12);
    // And the warm ramp is REDDER than the cool at the same stop — the recipe's own drift direction.
    assert.ok(warm[0]! > cool[0]!, `${a.id}: the warm ramp is not warmer`);
  }
});

test('wheatColourAt reads the GRASS`s own scalar and drift — the structure is the grass`s', () => {
  for (const [x, z] of [
    [0, 0],
    [13.7, -41.2],
    [-88.1, 5.5],
  ] as const) {
    assert.deepEqual(wheatColourAt(P('#b0b040'), x, z), wheatColourOf(P('#b0b040'), grassScalar(x, z), grassDrift(x, z)));
  }
});

// ---------------------------------------------------------------- the GLSL

test('wheatGlsl is an EXACT golden — the header, the two ramps, and the paint function', () => {
  const [lo, hi] = GRASS_DRIFT_RAMP;
  const expected = [
    '// GENERATED from land-wheat.ts — do not hand-edit these constants.',
    "// The wheat field: layer 1's structure (build_land.py:836-868, mat_attribute()) re-palettised",
    "// onto the anchor #b0b040 — each stop is that anchor scaled per channel by the green",
    "// stop's ratio to the green token #8cb85e, then lifted by 1.00 in",
    '// linear space (ratio-preserving; how pale the field is).',
    ...rampGlsl('st_wheatCool', wheatCool(P('#b0b040'))),
    '',
    ...rampGlsl('st_wheatWarm', wheatWarm(P('#b0b040'))),
    '',
    '// THE PAINTED COLOUR at a ground point, as a delivered sRGB triple in 0..1: the grass on a',
    '// grass row, the wheat on a wheat row, both from the ONE base scalar and drift the fragment',
    '// already carries.',
    'vec3 st_paintColour(vec2 p, float grassGate, float wheatGate) {',
    '  float t = st_grassScalar(p);',
    `  float d = clamp((st_grassDrift(p) - ${lo.toFixed(6)}) / ${(hi - lo).toFixed(6)}, 0.0, 1.0);`,
    '  vec3 grass = mix(st_grassCool(t), st_grassWarm(t), d);',
    '  vec3 wheat = mix(st_wheatCool(t), st_wheatWarm(t), d);',
    '  return st_grassSrgb(grass * grassGate + wheat * wheatGate);',
    '}',
  ].join('\n');
  assert.equal(wheatGlsl(P('#b0b040')), expected);
  // The drift remap is the recipe's own two positions, written in at six places.
  assert.ok(wheatGlsl(P('#b0b040')).includes('- 0.380000) / 0.240000'));
  // ⚠ NO OCTAVE OF ITS OWN: the wheat reads the grass's fields and never re-evaluates the lattice.
  assert.ok(!wheatGlsl(P('#b0b040')).includes('st_grainOctave'));
  assert.ok(!/float st_\w+\(vec2 p\)/.test(wheatGlsl(P('#b0b040'))), 'the wheat declares no field of its own');
  // A different anchor writes different stops in — the source is per rung.
  assert.notEqual(wheatGlsl(P('#b0b040')), wheatGlsl(P('#d6b271')));
  assert.ok(wheatGlsl(P('#d6b271')).includes('onto the anchor #d6b271'));
  // And a different LIFT writes different stops in on the SAME anchor — the paleness rung is in
  // the bytes too, and the header names it.
  assert.notEqual(wheatGlsl(P('#b0b040', 2)), wheatGlsl(P('#b0b040')));
  assert.ok(wheatGlsl(P('#b0b040', 2)).includes('then lifted by 2.00 in'));
  assert.ok(wheatGlsl(P('#b0b040', 1.25)).includes('then lifted by 1.25 in'));
});

// ---------------------------------------------------------------- the paleness ladder

test('the paleness ladder is four lifts from 1.0 upward, as literals, each with a caption', () => {
  // ⚠ LITERALS, never derived: the four rungs were chosen against the flat token's own luma on a
  // scratch walk (2026-09-06) and the top rung is where the field's mean reaches it.
  assert.deepEqual(
    WHEAT_LIFTS.map((l) => [l.id, l.lift]),
    [
      ['1.00', 1],
      ['1.50', 1.5],
      ['2.00', 2],
      ['3.00', 3],
    ],
  );
  assert.equal(WHEAT_LIFTS[0]!.lift, 1, 'the first rung is the derivation untouched');
  for (let i = 1; i < WHEAT_LIFTS.length; i += 1) assert.ok(WHEAT_LIFTS[i]!.lift > WHEAT_LIFTS[i - 1]!.lift, 'the ladder ascends');
  for (const l of WHEAT_LIFTS) assert.ok(l.what.length > 20, `${l.id} has no caption`);
  assert.equal(wheatLift('2.00').lift, 2);
  assert.throws(() => wheatLift('1.25'), /no wheat lift "1.25"/);
});

test('liftChannel MULTIPLIES by the lift and clamps at linear white — literal operands the mutants cannot reproduce', () => {
  // 0.268 × 1.5 = 0.402: a mutant dividing (0.1787), adding (1.768 → clamped 1) or subtracting
  // (−1.232 → clamped 0) lands elsewhere.
  assert.ok(Math.abs(liftChannel(0.268, 1.5) - 0.402) < 1e-12);
  assert.equal(liftChannel(0.268, 1), 0.268, 'a lift of 1 is the identity');
  assert.equal(liftChannel(0.6, 2), 1, 'clamped at linear white');
  assert.equal(liftChannel(0, 2), 0);
  assert.equal(liftChannel(0.5, 2), 1, 'exactly white is white');
});

test('liftStop keeps the stop`s POSITION and lifts all three channels by the ONE number', () => {
  const stop = { at: 0.74, linear: [0.268, 0.432, 0.14] as const };
  const out = liftStop(stop, 1.25);
  assert.equal(out.at, 0.74);
  assert.ok(Math.abs(out.linear[0] - 0.335) < 1e-12);
  assert.ok(Math.abs(out.linear[1] - 0.54) < 1e-12);
  assert.ok(Math.abs(out.linear[2] - 0.175) < 1e-12);
  // The channels' ratios to one another are UNCHANGED — that is what ratio-preserving means.
  assert.ok(Math.abs(out.linear[0] / out.linear[1] - 0.268 / 0.432) < 1e-12);
  assert.ok(Math.abs(out.linear[2] / out.linear[1] - 0.14 / 0.432) < 1e-12);
  // A clamped channel is the one place the ratio breaks, and only there.
  const clamped = liftStop(stop, 3);
  assert.equal(clamped.linear[1], 1);
  assert.ok(Math.abs(clamped.linear[0] - 0.804) < 1e-12);
});

test('the lift is applied AFTER the rebase, on every stop of both ramps, and a lift of 1 is the derivation untouched', () => {
  const base = wheatRamp(GRASS_COOL, P('#b0b040'));
  const lifted = wheatRamp(GRASS_COOL, P('#b0b040', 1.5));
  assert.equal(lifted.length, base.length);
  lifted.forEach((stop, i) => {
    assert.equal(stop.at, base[i]!.at);
    for (let ch = 0; ch < 3; ch += 1) assert.ok(Math.abs(stop.linear[ch]! - Math.min(1, base[i]!.linear[ch]! * 1.5)) < 1e-12);
  });
  assert.deepEqual(wheatCool(P('#b0b040', 1.5)), wheatRamp(GRASS_COOL, P('#b0b040', 1.5)));
  assert.deepEqual(wheatWarm(P('#b0b040', 1.5)), wheatRamp(GRASS_WARM, P('#b0b040', 1.5)));
  // Order matters where the rebase clamps: on the mustard nothing clamps below 1.6, so the two
  // orders agree there; the assertion above pins "rebase then lift" through the identity.
  assert.deepEqual(wheatCool(P('#b0b040', 1)), wheatCool(P('#b0b040')));
});

/** The mustard's six stops at each rung of the paleness ladder — read off the same scratch walk
 *  the ladder was chosen on (2026-09-06) and pinned as LITERALS, so a drift in the lift's
 *  arithmetic, its clamp or its order against the rebase fails against a colour. */
const LIFT_GOLDENS = {
  '1.00': { cool: ['#535f2b', '#7d8538', '#b2a848'], warm: ['#6e5c25', '#9f8235', '#cba049'] },
  '1.50': { cool: ['#657335', '#97a045', '#d5c957'], warm: ['#856f2e', '#bf9d41', '#f3c059'] },
  '2.00': { cool: ['#73833e', '#acb64f', '#f2e564'], warm: ['#987f36', '#d9b34c', '#ffda66'] },
  '3.00': { cool: ['#8b9e4c', '#ceda60', '#ffff79'], warm: ['#b79942', '#ffd65c', '#ffff7b'] },
} satisfies Record<string, { cool: string[]; warm: string[] }>;

test('the mustard`s six stops deliver the pinned colours at every rung of the paleness ladder', () => {
  for (const l of WHEAT_LIFTS) {
    const golden = LIFT_GOLDENS[l.id as keyof typeof LIFT_GOLDENS];
    GRASS_COOL.forEach((stop, i) => {
      assert.equal(toHex(wheatColourOf(P('#b0b040', l.lift), stop.at, 0)), golden.cool[i], `lift ${l.id} cool stop ${i}`);
      assert.equal(toHex(wheatColourOf(P('#b0b040', l.lift), stop.at, 1)), golden.warm[i], `lift ${l.id} warm stop ${i}`);
    });
  }
});

test('a lift moves NO hue until a channel clamps — ratio-preserving in linear, on every stop', () => {
  const chroma = (l: readonly number[]): [number, number] => [l[0]! / l[1]!, l[2]! / l[1]!];
  for (const stop of [0.28, 0.5, 0.74]) {
    for (const d of [0, 1]) {
      const base = chroma(wheatLinearOf(P('#b0b040'), stop, d));
      // 1.5 clamps nothing on the mustard: the chromaticity is the derivation's exactly.
      const lifted = chroma(wheatLinearOf(P('#b0b040', 1.5), stop, d));
      assert.ok(Math.abs(lifted[0] - base[0]) < 1e-9 && Math.abs(lifted[1] - base[1]) < 1e-9, `stop ${stop} d=${d} moved its chroma`);
    }
  }
  // Brighter, monotonically, at every stop.
  for (const d of [0, 1]) {
    const l1 = wheatLinearOf(P('#b0b040'), 0.5, d);
    const l2 = wheatLinearOf(P('#b0b040', 2), 0.5, d);
    for (let ch = 0; ch < 3; ch += 1) assert.ok(l2[ch]! > l1[ch]!);
  }
  // And 2.00 clamps exactly ONE channel of the mustard's six stops: the warm light stop's red.
  const warmLight = wheatLinearOf(P('#b0b040', 2), 0.74, 1);
  assert.equal(warmLight[0], 1);
  assert.ok(warmLight[1] < 1 && warmLight[2] < 1);
});
