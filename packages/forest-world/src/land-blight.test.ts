import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLIGHT_CRACK_COARSE,
  BLIGHT_CRACK_FINE,
  BLIGHT_CRACK_LIFT,
  BLIGHT_CRACK_WIDTH,
  BLIGHT_OCTAVES,
  BLIGHT_RUNGS,
  BLIGHT_STATUS_GATE,
  BLIGHT_TOKEN,
  blightColourAt,
  blightColourOf,
  blightCool,
  blightCrackAt,
  blightCrackBand,
  blightCrackColour,
  blightCrackLinear,
  blightGlsl,
  blightLinearOf,
  blightRamp,
  blightRung,
  blightWarm,
  burnScale,
  mixLinear,
  type BlightPalette,
} from './land-blight.js';
import {
  GRASS_COOL,
  GRASS_WARM,
  grassDrift,
  grassNoiseField,
  grassScalar,
  noiseGlsl,
  rampGlsl,
  rampLinear,
} from './land-grass.js';
import { GRASS_TOKEN_REFERENCE, hexToLinear, liftStop, rebaseStop } from './land-wheat.js';
import { linearToSrgb255 } from './land-grain.js';

const DEAD: BlightPalette = { burn: 0.65, crackMix: 0.75 };

test('the gate names the one charred token, and nothing else', () => {
  assert.deepEqual([...BLIGHT_STATUS_GATE], ['unhealthy']);
  // The token is a literal in `src/` (the harness's transcription may not be imported here) and is
  // pinned against the shipped palette by `harness/shipped-blight-scene.test.ts`.
  assert.equal(BLIGHT_TOKEN, '#57544a');
});

test('the burn is a multiplier, and 0 leaves the rebasing untouched', () => {
  assert.equal(burnScale(0), 1);
  assert.equal(burnScale(0.65), 0.35);
  // ⚠ THE OPERAND ORDER IS THE WHOLE FUNCTION. `burn - 1` would give a negative scale and paint
  // black at every rung, which is a plausible-looking island and a dead one.
  assert.ok(burnScale(0.2) > burnScale(0.8));
});

test('a ramp is REBASED onto the charred token and THEN burned, in that order', () => {
  const anchor = hexToLinear(BLIGHT_TOKEN);
  const reference = hexToLinear(GRASS_TOKEN_REFERENCE);
  const wanted = GRASS_COOL.map((stop) => liftStop(rebaseStop(stop, anchor, reference), burnScale(DEAD.burn)));
  assert.deepEqual(blightRamp(GRASS_COOL, DEAD), wanted);
  assert.deepEqual(blightCool(DEAD), wanted);
  assert.deepEqual(
    blightWarm(DEAD),
    GRASS_WARM.map((stop) => liftStop(rebaseStop(stop, anchor, reference), burnScale(DEAD.burn))),
  );
  // The stop POSITIONS are the recipe's and are never touched by either operation.
  assert.deepEqual(
    blightCool(DEAD).map((s) => s.at),
    GRASS_COOL.map((s) => s.at),
  );
});

test('a burn of 0 is the grass ramp re-expressed on the charred token — every stop darker than the green`s', () => {
  const noBurn = blightCool({ burn: 0, crackMix: 0 });
  for (let i = 0; i < noBurn.length; i += 1) {
    const green = GRASS_COOL[i]!;
    const blight = noBurn[i]!;
    for (let c = 0; c < 3; c += 1) {
      assert.ok(
        blight.linear[c]! <= green.linear[c]! + 1e-12,
        `stop ${i} channel ${c}: the charred token is darker than the green on every channel, so no rebased stop may exceed the green's`,
      );
    }
  }
});

test('the crack colour is the token lifted, ratio-preserving, and never authored as a hue', () => {
  const token = hexToLinear(BLIGHT_TOKEN);
  assert.deepEqual(blightCrackLinear(), [
    Math.min(1, token[0] * BLIGHT_CRACK_LIFT),
    Math.min(1, token[1] * BLIGHT_CRACK_LIFT),
    Math.min(1, token[2] * BLIGHT_CRACK_LIFT),
  ]);
  // It is PALER than the token it is lifted from, on every channel — a "crack" darker than its own
  // ground would be a shadow, not a crack.
  const crack = blightCrackColour();
  const flat = { r: 0x57, g: 0x54, b: 0x4a };
  assert.ok(crack.r > flat.r && crack.g > flat.g && crack.b > flat.b);
  // And it is not white: a clamped-to-white crack would discard the token's own family.
  assert.ok(crack.r < 255 && crack.g < 255 && crack.b < 255);
  assert.deepEqual(crack, {
    r: linearToSrgb255(blightCrackLinear()[0]),
    g: linearToSrgb255(blightCrackLinear()[1]),
    b: linearToSrgb255(blightCrackLinear()[2]),
  });
});

test('the crack band is an ISO-CONTOUR: full on the median, zero beyond the width, and symmetric', () => {
  assert.equal(blightCrackBand(0.5), 1);
  assert.equal(blightCrackBand(0.5 + BLIGHT_CRACK_WIDTH), 0);
  assert.equal(blightCrackBand(0.5 - BLIGHT_CRACK_WIDTH), 0);
  assert.equal(blightCrackBand(0), 0);
  assert.equal(blightCrackBand(1), 0);
  // Symmetric to within a float ulp — `abs` makes it exact in principle, and the two sides differ
  // only by where the division lands.
  assert.ok(
    Math.abs(blightCrackBand(0.5 + BLIGHT_CRACK_WIDTH / 2) - blightCrackBand(0.5 - BLIGHT_CRACK_WIDTH / 2)) < 1e-12,
  );
  // Monotone away from the contour — a band that rose again would draw a second line nobody authored.
  let prev = 1;
  for (let k = 0; k <= 10; k += 1) {
    const v = blightCrackBand(0.5 + (BLIGHT_CRACK_WIDTH * k) / 10);
    assert.ok(v <= prev + 1e-12, `the band rises again at ${k}/10 of the width`);
    prev = v;
  }
});

test('the network is the UNION of two lattices, so coarse plates are split rather than averaged', () => {
  const x = 3.7;
  const z = -11.2;
  const coarse = blightCrackBand(grassNoiseField(BLIGHT_CRACK_COARSE, x, z));
  const fine = blightCrackBand(grassNoiseField(BLIGHT_CRACK_FINE, x, z));
  assert.equal(blightCrackAt(x, z), Math.max(coarse, fine));
  // ⚠ A `min` HERE WOULD DRAW ONLY WHERE BOTH CONTOURS CROSS — a scatter of dots rather than a
  // network — and an average would halve every line's strength. Both look like "cracks that did
  // not come out", which is why the operator is asserted rather than read.
  assert.notEqual(Math.max(coarse, fine), Math.min(coarse, fine));
  // The two lattices are different, or the union is one field drawn twice.
  assert.notEqual(BLIGHT_CRACK_COARSE.scale, BLIGHT_CRACK_FINE.scale);
});

test('the crack network is REACHED on a real island — not a field that is always zero', () => {
  let hits = 0;
  let full = 0;
  for (let i = 0; i < 400; i += 1) {
    const v = blightCrackAt(i * 0.37, i * -0.61);
    if (v > 0) hits += 1;
    if (v > 0.9) full += 1;
  }
  assert.ok(hits > 20, `only ${hits} of 400 samples touched a crack — the width or the lattice is wrong`);
  assert.ok(full > 0, 'no sample reached the contour itself, so no pixel ever draws the crack colour');
  assert.ok(hits < 400, 'every sample is a crack, so the network is a flood rather than a network');
});

test('the colour is the burned base with the bone mixed over it by the network times the strength', () => {
  const t = 0.4;
  const d = 0.6;
  const crack = 0.8;
  const got = blightLinearOf(DEAD, t, d, crack);
  const bone = blightCrackLinear();
  const f = crack * DEAD.crackMix;
  for (let c = 0; c < 3; c += 1) {
    assert.ok(got[c]! > 0, 'the blight never delivers a channel at exactly zero on a mixed pixel');
    // The result sits between the base and the bone, which is what a mix is.
    assert.ok(got[c]! <= bone[c]! + 1e-12);
  }
  // With no crack the colour is the base alone, whatever the strength.
  const base = blightLinearOf(DEAD, t, d, 0);
  const baseAtZeroStrength = blightLinearOf({ burn: DEAD.burn, crackMix: 0 }, t, d, 1);
  assert.deepEqual(base, baseAtZeroStrength);
  // And at full crack and full strength it IS the bone.
  assert.deepEqual(blightLinearOf({ burn: DEAD.burn, crackMix: 1 }, t, d, 1), [...bone]);
  assert.equal(mixLinear(0.2, 0.8, 0), 0.2);
  assert.equal(mixLinear(0.2, 0.8, 1), 0.8);
  assert.equal(mixLinear(0.2, 0.8, 0.5), 0.5);
  assert.ok(f > 0);
});

test('the drift selects between the two ramps — cool at 0, warm at 1, the midpoint between', () => {
  const t = 0.42;
  const cool = rampLinear(blightCool(DEAD), t);
  const warm = rampLinear(blightWarm(DEAD), t);
  // ⚠ THE TWO RAMPS MUST ACTUALLY DIFFER AT `t`, or every assertion below is vacuous.
  assert.notDeepEqual(cool, warm);
  // No crack, so this is the base alone and the arithmetic under test is the ramp selection.
  assert.deepEqual(blightLinearOf(DEAD, t, 0, 0), [...cool]);
  assert.deepEqual(blightLinearOf(DEAD, t, 1, 0), [...warm]);
  // ⚠ THE MIDPOINT IS WHAT SEPARATES `* d` FROM `/ d`. Both agree at d = 1, and only a d strictly
  // between the ends can tell a scale from its reciprocal.
  const mid = blightLinearOf(DEAD, t, 0.5, 0);
  for (let c = 0; c < 3; c += 1) {
    assert.ok(Math.abs(mid[c]! - (cool[c]! + (warm[c]! - cool[c]!) * 0.5)) < 1e-12, `channel ${c} does not interpolate`);
    assert.ok(Math.abs(mid[c]! - cool[c]!) > 1e-15, `channel ${c} did not move off the cool ramp at all`);
  }
});

test('a delivered pixel is the linear colour through the transfer, once', () => {
  const lin = blightLinearOf(DEAD, 0.3, 0.7, 0.2);
  assert.deepEqual(blightColourOf(DEAD, 0.3, 0.7, 0.2), {
    r: linearToSrgb255(lin[0]),
    g: linearToSrgb255(lin[1]),
    b: linearToSrgb255(lin[2]),
  });
});

test('the ground colour reads the GRASS`s own structure and this module`s network', () => {
  const x = 12.5;
  const z = -7.25;
  assert.deepEqual(
    blightColourAt(DEAD, x, z),
    blightColourOf(DEAD, grassScalar(x, z), grassDrift(x, z), blightCrackAt(x, z)),
  );
});

test('the ladder`s rungs are named, in order — a blanked id is a rung no caption can point at', () => {
  assert.deepEqual(BLIGHT_RUNGS.map((r) => r.id), ['sick', 'dying', 'dead', 'scorched']);
});

test('a bolder rung is DARKER and cracks HARDER than the one below it — the ladder is one signal', () => {
  for (let i = 1; i < BLIGHT_RUNGS.length; i += 1) {
    const lo = BLIGHT_RUNGS[i - 1]!;
    const hi = BLIGHT_RUNGS[i]!;
    assert.ok(hi.palette.burn > lo.palette.burn, `${hi.id} does not burn harder than ${lo.id}`);
    assert.ok(hi.palette.crackMix > lo.palette.crackMix, `${hi.id} does not crack harder than ${lo.id}`);
  }
  // ⚠ NEVER 1 ON THE BURN — a fully burned ground is black, and black is the sea (the material
  // refuses it, and this holds the ladder itself to the same line).
  for (const rung of BLIGHT_RUNGS) {
    assert.ok(rung.palette.burn >= 0 && rung.palette.burn < 1, `${rung.id} burns outside [0, 1)`);
    assert.ok(rung.palette.crackMix >= 0 && rung.palette.crackMix <= 1, `${rung.id} cracks outside [0, 1]`);
    assert.equal(blightRung(rung.id), rung);
    assert.ok(rung.what.length > 0, `${rung.id} carries no caption`);
  }
});

test('a rung id that is not on the ladder is REFUSED, never undefined', () => {
  assert.throws(() => blightRung('charred'), /no blight rung "charred"/);
});

test('the octave count is derived from the two lattices rather than written down', () => {
  assert.equal(BLIGHT_OCTAVES, BLIGHT_CRACK_COARSE.detail + BLIGHT_CRACK_FINE.detail);
});

test('the emitted GLSL is exactly this module`s own lines around the shared emitters', () => {
  const bone = blightCrackLinear();
  const wanted = [
    '// GENERATED from land-blight.ts — do not hand-edit these constants.',
    `// The unhealthy ground: layer 1's structure (build_land.py:836-868, mat_attribute())`,
    `// re-palettised onto the authored token ${BLIGHT_TOKEN} and burned by 0.65`,
    `// in linear space, split by a crack network this module authors (NOT in the recipe — the`,
    `// recipe paints a healthy island) at strength 0.75.`,
    ...noiseGlsl('st_blightCoarse', BLIGHT_CRACK_COARSE),
    '',
    ...noiseGlsl('st_blightFine', BLIGHT_CRACK_FINE),
    '',
    '// One lattice’s crack band: full on the field’s median contour, none beyond the width.',
    'float st_blightBand(float n) {',
    `  float d = clamp(abs(n - 0.5) / ${BLIGHT_CRACK_WIDTH.toFixed(6)}, 0.0, 1.0);`,
    '  return 1.0 - (d * d * (3.0 - 2.0 * d));',
    '}',
    '',
    '// THE CRACK NETWORK — two lattices’ contours unioned, so coarse plates are split by finer.',
    'float st_blightCracks(vec2 p) {',
    '  return max(st_blightBand(st_blightCoarse(p)), st_blightBand(st_blightFine(p)));',
    '}',
    '',
    ...rampGlsl('st_blightCool', blightCool(DEAD)),
    '',
    ...rampGlsl('st_blightWarm', blightWarm(DEAD)),
    '',
    '// THE BLIGHT COLOUR at a ground point, in LINEAR space: the burned base, split by the bone.',
    'vec3 st_blightLinear(vec2 p) {',
    '  float t = st_grassScalar(p);',
    '  float d = clamp((st_grassDrift(p) - 0.380000) / 0.240000, 0.0, 1.0);',
    '  vec3 base = mix(st_blightCool(t), st_blightWarm(t), d);',
    '  float f = st_blightCracks(p) * 0.750000;',
    `  return mix(base, vec3(${bone[0].toFixed(6)}, ${bone[1].toFixed(6)}, ${bone[2].toFixed(6)}), f);`,
    '}',
    '',
    '// The same colour as a delivered sRGB triple, through the grass’s own transfer function —',
    '// one spelling of the transfer in the shader, not a second copy under a blight name.',
    'vec3 st_blightColour(vec2 p) {',
    '  return st_grassSrgb(st_blightLinear(p));',
    '}',
  ].join('\n');
  // ⚠ AN EXACT GOLDEN, not a containment check: every line of an emitter is a string literal, and a
  // mutant that BLANKS one produces a shader that still contains every constant a `includes()` test
  // looks for (`land-grass.ts`'s own finding, forty literals deep).
  assert.equal(blightGlsl(DEAD), wanted);
});

test('the emitted GLSL calls the grass`s fields and declares only its own', () => {
  const src = blightGlsl(DEAD);
  // It rides the grass rather than re-declaring it — the material refuses a blight with no grass.
  assert.ok(src.includes('st_grassScalar(p)'));
  assert.ok(src.includes('st_grassDrift(p)'));
  assert.ok(src.includes('st_grassSrgb('));
  assert.ok(!src.includes('float st_grassScalar'), 'the blight re-declared a grass field');
  assert.ok(!src.includes('float st_grassDrift'), 'the blight re-declared a grass field');
  // Its own field is the crack network and nothing else.
  assert.ok(src.includes('float st_blightCracks(vec2 p)'));
});

test('two rungs emit DIFFERENT shaders — the palette is written in, not uniform-fed', () => {
  assert.notEqual(blightGlsl(BLIGHT_RUNGS[0]!.palette), blightGlsl(BLIGHT_RUNGS[3]!.palette));
});
