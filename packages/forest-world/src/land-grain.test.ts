// land-grain.test.ts — the grain octave's pure half, and the one property of the shader that
// a picture can never establish.
//
// THE TEST THIS FILE IS REALLY FOR is `grain keeps the palette closed`. Everything else here
// is ordinary field arithmetic; that one carries the increment's finding, because the palette
// closure is the property a capture can only ever SAMPLE. A capture proves the pixels it
// photographed were on-palette; it can never prove no reachable pixel is off it. The generated
// SOURCE carries the stronger claim, and the two halves of the grain sit on opposite sides of
// it — which is the whole reason they are separate options.
//
// ⚠ IT LIVES BESIDE THE MODULE IN `src/` BECAUSE THAT IS WHERE THE MODULE LIVES NOW, and the
// mutation rung mutates a project's `src/` only. When the relief crossed, its tests stayed in
// `harness/` and the rung came back with three survivors and four uncovered lines — the sharpest
// of them the WAVE TABLE, which could be emptied for a perfectly flat land in silence. A crossed
// module's tests have to cross with it or the crossing buys no proof
// (`crossing-a-module-into-src-reds-two-rungs`).
//
// The tests that need the HARNESS's own material or its regional field stayed behind in
// `harness/land-grain.test.ts`: they are about the experiment's wiring, not about this module.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GRAIN_COLOUR_MIX,
  GRAIN_NORMAL_STRENGTH,
  GRAIN_OCTAVES,
  GRAIN_RAMP,
  GRAIN_ROUGHNESS,
  GRAIN_LATTICE,
  GRAIN_FEATURE_RATIO,
  grainHash,
  grainOctave,
  grainOctaveAmplitude,
  grainOctaveFrequency,
  grainTerms,
  grainAmplitudeSum,
  grainColourAt,
  grainFeaturePeriod,
  grainField,
  grainGlsl,
  grainGradient,
  grainKeepsPaletteClosed,
  grainPerturbNormal,
  grainRamped,
  grainStopHexes,
  grainStops,
  linearToSrgb255,
} from './land-grain.js';
import { LAND_SCALE } from './land-per-capability.js';
import {
  LEGACY_SHADE_LEVELS,
  SHADE_LEVELS,
  lambertOfNormal,
  nearestLevelIndex,
  rungOfNormal,
  toHex,
} from './shade-ladder.js';

/** A base colour for the colour half to mix INTO. It is the shipped ground's `healthy` token,
 *  written as a literal rather than imported: the harness's `landTokens()` is the experiment's
 *  vocabulary and does not belong in `src/`, and every assertion below is about the MIX moving a
 *  colour rather than about which colour it started from. */
const HEALTHY = '#8cb85e';

test('linearToSrgb255 round-trips every byte through the INVERSE transfer', () => {
  // Stated as a round trip against the inverse rather than against a table of expected
  // outputs, because a table is only ever a second copy of the implementation and goes green
  // for exactly as long as the implementation is stable — including while it is wrong. The
  // inverse below is an independent statement of what sRGB IS, so agreeing with it is a real
  // constraint. (It also catches the whole class of "someone replaced this with a multiply":
  // a linear transfer round-trips only at 0 and 1.)
  const srgbToLinear = (s: number): number =>
    s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  for (let b = 0; b <= 255; b++) {
    assert.equal(linearToSrgb255(srgbToLinear(b / 255)), b, `byte ${b} did not survive the round trip`);
  }
  assert.equal(linearToSrgb255(0), 0);
  assert.equal(linearToSrgb255(1), 255);
  // Out of range is clamped rather than allowed to produce a bogus byte.
  assert.equal(linearToSrgb255(-1), 0);
  assert.equal(linearToSrgb255(5), 255);
});

test('the grain stops are CONVERTED from linear, not transcribed', () => {
  const [dark, light] = grainStops();
  // The trap this guards: dropping Blender's linear numbers straight in. `0.055 * 255` is 14;
  // the correct sRGB byte is 66. A dark stop near 14 would read as dirt, not as grain, and
  // would look like an amplitude mistake rather than a colour-space one.
  assert.ok(dark.r > 50, `dark stop r=${dark.r} looks like a raw linear value, not sRGB`);
  assert.ok(dark.r < 90);
  assert.ok(light.r > 180, `light stop r=${light.r} is too dark to be the 0.560 stop in sRGB`);
  // The two stops must be genuinely far apart or the ramp delivers no grain at all.
  assert.ok(light.r - dark.r > 100);
  // And the pair round-trips to hex, which is the form the evidence sheets print.
  assert.deepEqual(grainStopHexes(), [toHex(dark), toHex(light)]);
});

test('the field stays in [0,1] and is deterministic', () => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = -120; x <= 120; x += 0.37) {
    for (let z = -70; z <= 70; z += 0.53) {
      const v = grainField(x, z);
      assert.ok(Number.isFinite(v), `field is ${v} at (${x}, ${z})`);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  assert.ok(lo >= 0 && hi <= 1, `field range [${lo}, ${hi}] escapes [0,1]`);
  // A normalised fbm should actually USE its range; one that spans 0.48..0.52 is a constant
  // wearing a noise function's name and would deliver no grain.
  assert.ok(hi - lo > 0.4, `field only spans ${(hi - lo).toFixed(3)} — too flat to grain anything`);
  assert.equal(grainField(11.25, -4.5), grainField(11.25, -4.5));
});

test('a delivered feature is GRAIN_FEATURE_RATIO times the lattice, and that ratio is pinned', () => {
  // ⚠ THIS TEST FOUND A REAL DEFECT AND ITS FIRST VERSION ASSERTED THE WRONG MODEL. It was
  // written expecting the delivered period to BE the lattice spacing, and measured 6.3 against
  // an authored 2.5. The field was not wrong — the model was: successive hash sites are
  // independent, so a smoothstep value-noise field crosses its mean about once every 1.3
  // cells, giving a period of ~2.6 spacings. That factor decides whether the grain lands at
  // the pixel scale or up beside the `fine` octave, so it is a named constant with a test
  // under it rather than a fact about noise someone is expected to know.
  //
  // THE INVERSION IT STILL CATCHES: a spacing used where a frequency belongs (or the other way
  // round) produces either a flat wash or pure per-pixel static, and both look like an
  // amplitude problem rather than the frequency problem they are.
  const span = 2000;
  const step = 0.05;
  const periods: number[] = [];
  for (const line of [3.75, -11.2, 40.1]) {
    const samples: number[] = [];
    for (let x = 0; x < span; x += step) samples.push(grainField(x, line));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1]! < mean !== (samples[i]! < mean)) crossings++;
    }
    periods.push(span / (crossings / 2)); // two crossings per period
  }
  const measured = periods.reduce((a, b) => a + b, 0) / periods.length;
  const ratio = measured / GRAIN_LATTICE;
  console.log(
    `  delivered feature period ${measured.toFixed(2)} ground units = ` +
      `${ratio.toFixed(2)} x the ${GRAIN_LATTICE}-unit lattice`,
  );
  assert.ok(
    Math.abs(ratio - GRAIN_FEATURE_RATIO) < 0.35,
    `measured ratio ${ratio.toFixed(2)} disagrees with the declared GRAIN_FEATURE_RATIO ` +
      `${GRAIN_FEATURE_RATIO} — grainFeaturePeriod() is now lying to every caller that sizes ` +
      'the grain against the cell pitch or the pixel budget',
  );
  assert.ok(Math.abs(grainFeaturePeriod() - GRAIN_LATTICE * GRAIN_FEATURE_RATIO) < 1e-9);
});

test('the delivered feature clears both floors it has to clear', () => {
  // Below ~1 ground unit a feature is aliasing shimmer at the overview zoom; above the
  // ~16.5-unit mean cell pitch it is regional variation rather than grain. Both are previously
  // measured constraints, and the grain has to sit between them or it is a different lever.
  const feature = grainFeaturePeriod();
  assert.ok(feature > 1, `a ${feature.toFixed(2)}-unit feature is aliasing shimmer, not grain`);
  // The cell pitch is a distance ON the island, so it follows LAND_SCALE; the 1-unit aliasing
  // floor is about device pixels, which do not.
  assert.ok(feature < 16.5 * LAND_SCALE, `a ${feature.toFixed(2)}-unit feature spans a cell — that is regional drift`);
});

test('the ramp clamps outside its authored span', () => {
  const [lo, hi] = GRAIN_RAMP();
  assert.ok(lo < hi);
  for (let x = 0; x < 200; x += 0.31) {
    const t = grainRamped(x, 12.5);
    assert.ok(t >= 0 && t <= 1, `ramped value ${t} escapes [0,1]`);
  }
});

test('the normal half moves SOME ground between rungs and not all of it', () => {
  // THE MEASUREMENT THIS INCREMENT TURNS ON, stated as a requirement rather than as an
  // observation. `SHADE_LEVELS` is nine rungs at 0.025 from 0.80 and flat ground sits on 0.90
  // (half-lambert 0.9105 under the authored light), so grain on flat ground can only express
  // itself as a rung FLIP. Two ways it can fail, and both are silent:
  //   - flips nothing, and the component is invisible however good the field is;
  //   - flips ALL of it, and it is a repaint rather than a grain — the texture has replaced the
  //     shading it was supposed to modulate, and the land stops reporting relief at all.
  //
  // ⚠⚠ THE UPPER BOUND WAS 0.5 AND THAT NUMBER DID NOT SURVIVE THE LADDER, DELIBERATELY. It was
  // calibrated on the four-rung ladder, where the field flipped 14.4% and half the island was a
  // generous ceiling. The nine-rung ladder is the SAME field flipping 73.1% — and that increase is
  // the entire reason the owner adopted it, so a 0.5 ceiling would now be a guard refusing the
  // thing it was written to protect. What is kept is the FAILURE MODE, re-stated at the standard
  // the refinement was actually judged against: the curve must SATURATE below 1, i.e. some flat
  // ground keeps its own rung. `THE DENSITY LEVER` below holds the same 0.95 ceiling over a whole
  // density sweep, which is where a ladder refined too far would be caught.
  const flat = { x: 0, y: 1, z: 0 };
  const base = rungOfNormal(flat);
  let flipped = 0;
  let total = 0;
  for (let x = -100; x <= 100; x += 1.3) {
    for (let z = -60; z <= 60; z += 1.1) {
      total++;
      // The tuned-island grid, scaled by LAND_SCALE with the lattice: the same island-relative points.
      if (rungOfNormal(grainPerturbNormal(flat, x * LAND_SCALE, z * LAND_SCALE)) !== base) flipped++;
    }
  }
  const fraction = flipped / total;
  // Reported, because the research note quotes it and a number in a log beats one in prose.
  console.log(
    `  grain rung-flip fraction on flat ground at strength ${GRAIN_NORMAL_STRENGTH}: ` +
      `${(fraction * 100).toFixed(1)}% (${flipped}/${total})`,
  );
  assert.ok(fraction > 0.001, `grain flips ${(fraction * 100).toFixed(3)}% of flat ground — invisible`);
  assert.ok(fraction < 0.95, `grain flips ${(fraction * 100).toFixed(1)}% of flat ground — a repaint`);
  // AND THE VALUE ITSELF, pinned — a bound this loose would otherwise absorb a real drift in the
  // field silently. It is the figure the adoption was measured on, and `THE DENSITY LEVER` reaches
  // it by an independent route (its own ladder literal rather than `SHADE_LEVELS`), so the two
  // agreeing is evidence rather than one number restated twice.
  assert.equal((fraction * 100).toFixed(1), '73.1');
});

test('a stronger bump flips strictly more ground', () => {
  // Monotonicity in the strength knob. Without it the measurement sweep cannot be read as a
  // sweep, and a sign error in the gradient would still satisfy the band above.
  const flat = { x: 0, y: 1, z: 0 };
  const base = rungOfNormal(flat);
  const flips = (strength: number): number => {
    let n = 0;
    for (let x = -80; x <= 80; x += 1.7) {
      for (let z = -50; z <= 50; z += 1.3) {
        if (rungOfNormal(grainPerturbNormal(flat, x, z, strength)) !== base) n++;
      }
    }
    return n;
  };
  assert.equal(flips(0), 0, 'zero strength must be a no-op');
  assert.ok(flips(0.6) > flips(0.3), 'doubling the bump strength did not flip more ground');
});

test('the gradient is a central difference of the field', () => {
  // Not tautological: it asserts the SIGN convention, which is the half that a bump gets
  // wrong silently. `addGableRoof` shipped with its normal components swapped and shaded every
  // roof as its own complement — caught by measuring, never by reading.
  for (const [x, z] of [
    [3.1, 7.2],
    [-18.4, 22.9],
    [64.0, -11.5],
  ] as const) {
    const [dx, dz] = grainGradient(x, z);
    const e = 0.01;
    // Step ALONG the reported gradient and the field must rise.
    const mag = Math.hypot(dx, dz);
    if (mag < 1e-6) continue;
    const up = grainField(x + (dx / mag) * e, z + (dz / mag) * e);
    const down = grainField(x - (dx / mag) * e, z - (dz / mag) * e);
    assert.ok(up > down, `field falls along its own gradient at (${x}, ${z})`);
  }
});

test('the colour half produces a colour that is NOT the base token', () => {
  // The mirror of the closure test below, in the pure half: if the mix is a no-op then the
  // "off-palette by construction" claim is false and the whole fork this increment reports
  // would be wrong.
  let differing = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const c = grainColourAt(HEALTHY, i * 1.9, i * 0.7);
    if (toHex(c) !== HEALTHY) differing++;
  }
  assert.ok(
    differing > trials * 0.9,
    `only ${differing}/${trials} points moved off the base token at mix ${GRAIN_COLOUR_MIX}`,
  );
});

test('the GLSL carries the authored constants rather than a private copy', () => {
  // The `bandGlsl` argument, restated where it is executed: a shader and a test holding
  // private copies of the same numbers prove nothing about each other.
  const src = grainGlsl();
  assert.match(src, new RegExp((1 / GRAIN_LATTICE).toFixed(6).replace('.', '\\.')));
  assert.match(src, new RegExp(GRAIN_RAMP()[0].toFixed(6).replace('.', '\\.')));
  assert.match(src, new RegExp(GRAIN_RAMP()[1].toFixed(6).replace('.', '\\.')));
  // The octaves are unrolled at generation time, so the count is visible in the source.
  const octaveCalls = [...src.matchAll(/st_grainOctave\(p \*/g)];
  assert.equal(octaveCalls.length, GRAIN_OCTAVES, 'unrolled octave count disagrees with GRAIN_OCTAVES');
  // The second octave's amplitude IS the roughness, so a retune cannot leave the shader behind.
  assert.match(src, new RegExp(GRAIN_ROUGHNESS.toFixed(6).replace('.', '\\.')));
  // GLSL ES 1.0 has no dynamic loop bounds and no integer bit ops — neither may appear.
  assert.doesNotMatch(src, /for\s*\(/, 'a loop in the grain GLSL will not compile on GLSL ES 1.0');
  assert.doesNotMatch(src, /[^<>]>>[^>]|<<|\^|&(?!&)/, 'bit operators are not available on GLSL ES 1.0');
});

// ---------------------------------------------------------------- the closure

test('grainKeepsPaletteClosed is not vacuous', () => {
  // A check that cannot fail certifies nothing. Both directions, on hand-written sources, so
  // the discriminating power is established before it is pointed at the real shader.
  assert.equal(
    grainKeepsPaletteClosed('void main() { vec3 c = uRamp[0]; gl_FragColor = vec4(c, 1.0); }'),
    true,
  );
  assert.equal(
    grainKeepsPaletteClosed(
      'void main() { vec3 c = uRamp[0]; c = mix(c, vec3(1.0), 0.1); gl_FragColor = vec4(c, 1.0); }',
    ),
    false,
    'a mix into the written colour must be reported as OPEN',
  );
  assert.equal(
    grainKeepsPaletteClosed('void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }'),
    false,
    'a literal colour is not a ramp entry',
  );
  assert.equal(grainKeepsPaletteClosed('nothing that assigns gl_FragColor at all'), false);
});

// ─────────────────────────────────────────────────────────────── PINNED INSTANCE
//
// ⚠⚠ EVERYTHING ABOVE ASSERTS A PROPERTY, AND A PROPERTY CANNOT PIN AN INSTANCE. "the field stays
// in [0,1]", "a stronger bump flips more ground", "the gradient rises along itself" are all true of
// a great many DIFFERENT fields — which is why `check:mutation-diff` could rewrite `x * freq` as
// `x / freq`, or `2 * e` as `e / 2`, and every test above stayed green (37 surviving arithmetic
// mutants, measured on this branch). A retune that silently changed the delivered picture would
// pass the same way.
//
// So the properties stay — they are what says the field is CORRECT — and these pin WHICH field it
// is. Both are needed and neither substitutes for the other: a golden alone is a change detector
// proving nothing about the construction, and the properties alone leave the construction free to
// be any of a family of fields.
//
// ⚠ THE VALUES ARE THIS IMPLEMENTATION'S OWN OUTPUT, recorded rather than derived — which for a
// noise field is the only form a golden can take, and it is honest as long as it is SAID.
// `an-expectation-derived-from-its-subject-cannot-fail` bites an expectation standing ALONE; here
// the correctness claims are made above by construction-independent properties, and these answer a
// different question: did the construction move?
//
// ⚠ AND THEY ARE JS VALUES, NOT GPU VALUES. `grainHash` is `fract(sin(...))`, documented at length
// as NOT portable — `Math.sin` and a GPU's `sin` are different functions. Nothing here claims the
// shader delivers these numbers; what the two share is the field's SHAPE, carried by the constants
// `grainGlsl()` interpolates.
//
// ⚠ THE COORDINATES BELOW ARE IN THE TUNED ISLAND'S GROUND UNITS and every call site scales them by
// `LAND_SCALE` (`land-per-capability.ts`). The field depends on `p / GRAIN_LATTICE` only, and the
// lattice is `2.5 * LAND_SCALE`, so `grainField(x * LAND_SCALE, z * LAND_SCALE)` on the shipped
// island IS the tuned island's `grainField(x, z)` — the recorded values stand unchanged, which is
// the strongest form the rescale can take. A gradient at the scaled point is the tuned gradient
// DIVIDED by `LAND_SCALE` (the same rise over a shorter run), so the gradient goldens compare
// `g * LAND_SCALE` against the tuned figures.

/** `[x, z, expected]` — twelve significant figures, far tighter than any operator swap. */
const FIELD_GOLDEN: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [3.1, 7.2, 0.382063044709],
  [-18.4, 22.9, 0.545826597037],
  [64, -11.5, 0.349969546504],
  [1.25, 0.75, 0.211470748954],
  [-0.5, -0.5, 0.166224687331],
  [123.456, 78.9, 0.388947812413],
];

const RAMPED_GOLDEN: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [3.1, 7.2, 0.108998914633],
  [-18.4, 22.9, 0.668842258193],
  [64, -11.5, 0.042918800275],
  [1.25, 0.75, 0],
  [-0.5, -0.5, 0],
  [123.456, 78.9, 0.126353075202],
];

/** `[x, z, dh/dx, dh/dz]`. */
const GRADIENT_GOLDEN: readonly (readonly [number, number, number, number])[] = [
  [0, 0, -0.077625616119, 0.142141768962],
  [3.1, 7.2, 0.049606703238, -0.069906262774],
  [-18.4, 22.9, -0.134193830844, -0.093034970237],
  [64, -11.5, 0.250727452397, -0.166161980166],
  [1.25, 0.75, 0.07446896682, 0.029670261058],
  [-0.5, -0.5, -0.33444912425, -0.088619105163],
  [123.456, 78.9, -0.043538137186, -0.113464523199],
];

const EPS = 1e-11;

test('the LATTICE HASH delivers this instance — the one construction everything else rests on', () => {
  for (const [ix, iy, expected] of [
    [0, 0, 0],
    [1, 0, 0.325623615965],
    [0, 1, 0.819303973756],
    [1, 1, 0.104671925503],
    [-3, 7, 0.486684472966],
  ] as const) {
    assert.ok(
      Math.abs(grainHash(ix, iy) - expected) < EPS,
      `grainHash(${ix}, ${iy}) = ${grainHash(ix, iy)}, expected ${expected}`,
    );
  }
  // NON-VACUITY: the hash must actually spread. An implementation returning a constant would fail
  // this rather than sail through on a lucky sample.
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) seen.add(Math.floor(grainHash(i, i * 3 + 1) * 10));
  assert.ok(seen.size >= 7, `the hash landed in only ${seen.size} of 10 deciles over 40 sites`);
});

test('one OCTAVE delivers this instance — the smoothstep interpolant, pinned', () => {
  for (const [x, z, expected] of [
    [0, 0, 0],
    [3.1, 7.2, 0.437607282527],
    [-18.4, 22.9, 0.531497602153],
    [64, -11.5, 0.388790066732],
    [1.25, 0.75, 0.242681854545],
    [-0.5, -0.5, 0.437600121194],
    [123.456, 78.9, 0.375729555278],
  ] as const) {
    assert.ok(
      Math.abs(grainOctave(x, z) - expected) < EPS,
      `grainOctave(${x}, ${z}) = ${grainOctave(x, z)}, expected ${expected}`,
    );
  }
});

test('the FIELD delivers this instance — the octave sum, its frequencies and its normaliser', () => {
  // What catches a swapped `*`/`/` on the frequency, a wrong amplitude falloff, or an unnormalised
  // sum — none of which any range or determinism property can see.
  for (const [x, z, expected] of FIELD_GOLDEN) {
    const got = grainField(x * LAND_SCALE, z * LAND_SCALE); // tuned-island point, scaled (LAND_SCALE)
    assert.ok(Math.abs(got - expected) < EPS, `grainField(${x}, ${z}) = ${got}, expected ${expected}`);
  }
});

test('the RAMPED field delivers this instance — the authored span and its smoothstep', () => {
  // Three of the seven land on the ramp's flat ends, which is the behaviour the span exists for,
  // and four land inside it — so a moved span shows up either way.
  for (const [x, z, expected] of RAMPED_GOLDEN) {
    const got = grainRamped(x * LAND_SCALE, z * LAND_SCALE); // tuned-island point, scaled (LAND_SCALE)
    assert.ok(Math.abs(got - expected) < EPS, `grainRamped(${x}, ${z}) = ${got}, expected ${expected}`);
  }
  assert.equal(RAMPED_GOLDEN.filter(([, , v]) => v === 0).length, 3, 'the clamped end is exercised');
  assert.ok(RAMPED_GOLDEN.some(([, , v]) => v > 0.5), 'and so is the interior');
});

test('the GRADIENT delivers this instance — the central difference AND its quarter-period step', () => {
  // The sign convention is asserted above, construction-independently; this pins the MAGNITUDE,
  // which is what `GRAIN_NORMAL_STRENGTH` was calibrated against. Halving or doubling the step
  // changes every number here and no property test above.
  // The step is `GRAIN_LATTICE / 4`, so it scales with the point; the gradient at the scaled point
  // is the tuned one over LAND_SCALE, and multiplying it back recovers the recorded figure.
  for (const [x, z, dx, dz] of GRADIENT_GOLDEN) {
    const [gx, gz] = grainGradient(x * LAND_SCALE, z * LAND_SCALE);
    assert.ok(Math.abs(gx * LAND_SCALE - dx) < EPS, `d/dx at (${x}, ${z}) = ${gx * LAND_SCALE}, expected ${dx}`);
    assert.ok(Math.abs(gz * LAND_SCALE - dz) < EPS, `d/dz at (${x}, ${z}) = ${gz * LAND_SCALE}, expected ${dz}`);
  }
});

test('the GENERATED GLSL is pinned LINE FOR LINE — it is a contract with a compiler', () => {
  // ⚠ A GENERATOR'S OUTPUT IS THE PRODUCT, so pinning it is not change-detection theatre: these
  // lines are compiled by a GPU driver, and a dropped one is a shader that fails to link or, worse,
  // links and shades differently. Nothing else in the suite read them — 44 of the mutants
  // `check:mutation-diff` found surviving on this branch were emitted string literals blanked to
  // "" with every test still green.
  const lines = grainGlsl().split('\n');
  // ⚠ LAND_SCALE moved exactly four numerals here and nothing else (diffed against the pre-scale
  // golden): the wavelength in the header (2.5 -> 2.5 * LAND_SCALE, printed as the raw float the
  // emitter interpolates), the two octave frequencies (0.4 / 0.8 -> 1 / lattice and 2 / lattice)
  // and the quarter-lattice gradient step (0.625 -> lattice / 4).
  assert.deepEqual(lines, [
    '// GENERATED from land-grain.ts — do not hand-edit these constants.',
    `// wavelength ${2.5 * LAND_SCALE} ground units, 2 octaves, roughness 0.55`,
    'float st_grainHash(vec2 i) {',
    '  return fract(sin(i.x * 127.1 + i.y * 311.7) * 43758.5453123);',
    '}',
    '',
    'float st_grainOctave(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = p - i;',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float h00 = st_grainHash(i);',
    '  float h10 = st_grainHash(i + vec2(1.0, 0.0));',
    '  float h01 = st_grainHash(i + vec2(0.0, 1.0));',
    '  float h11 = st_grainHash(i + vec2(1.0, 1.0));',
    '  return mix(mix(h00, h10, u.x), mix(h01, h11, u.x), u.y);',
    '}',
    '',
    '// The field in [0,1], normalised by the amplitude sum so its range does not move when',
    '// the octave count or the roughness is retuned.',
    'float st_grainField(vec2 p) {',
    '  float s = 0.0;',
    '  s += 1.000000 * st_grainOctave(p * 1.061235);',
    '  s += 0.550000 * st_grainOctave(p * 2.122470);',
    '  return s / 1.550000;',
    '}',
    '',
    '// The field across the authored ramp span, smoothstepped and clamped.',
    'float st_grainRamped(vec2 p) {',
    '  return smoothstep(0.300000, 0.700000, st_grainField(p));',
    '}',
    '',
    '// The grain gradient, per ground unit. The step is a QUARTER WAVELENGTH rather than an',
    '// epsilon: it measures the slope of the FEATURE, not of one lattice cell face.',
    'vec2 st_grainGradient(vec2 p) {',
    '  float e = 0.235575;',
    '  float gx = st_grainField(p + vec2(e, 0.0)) - st_grainField(p - vec2(e, 0.0));',
    '  float gz = st_grainField(p + vec2(0.0, e)) - st_grainField(p - vec2(0.0, e));',
    '  return vec2(gx, gz) / (2.0 * e);',
    '}',
  ]);
  // ⚠ THE OCTAVE BLOCK IS UNROLLED FROM `GRAIN_OCTAVES`, so the golden above would go stale
  // SILENTLY if that constant moved — the deepEqual would fail, but a reader would not know which
  // half was wrong. Stated as a derivation so the failure names the cause.
  assert.equal(
    lines.filter((l) => l.includes('st_grainOctave(p *')).length,
    GRAIN_OCTAVES,
    'the unroll must emit exactly GRAIN_OCTAVES accumulate lines',
  );
});

test('grainKeepsPaletteClosed refuses every OPEN shape, one at a time', () => {
  // Its regexes ARE the check, and `check:mutation-diff` found 13 of them survivable on this
  // branch — a rewritten character class went unnoticed because the tests only ever exercised one
  // closed shader and one open one. Each case below moves exactly one thing.
  const closed =
    'void main() { vec3 c = uRamp[0];\nif (idx == 1) c = uRamp[1];\ngl_FragColor = vec4(c, 1.0); }';
  assert.equal(grainKeepsPaletteClosed(closed), true, 'the control must pass');

  const open: readonly (readonly [string, string])[] = [
    ['no main at all', 'vec3 c = uRamp[0]; gl_FragColor = vec4(c, 1.0);'],
    ['no gl_FragColor write', 'void main() { vec3 c = uRamp[0]; }'],
    ['alpha is not 1.0', 'void main() { vec3 c = uRamp[0];\ngl_FragColor = vec4(c, 0.5); }'],
    ['the written name is never assigned', 'void main() { gl_FragColor = vec4(c, 1.0); }'],
    [
      'a mix into the written colour',
      'void main() { vec3 c = uRamp[0];\nc = mix(c, g, 0.13);\ngl_FragColor = vec4(c, 1.0); }',
    ],
    [
      'an add into the written colour',
      'void main() { vec3 c = uRamp[0];\nc = c + vec3(0.1);\ngl_FragColor = vec4(c, 1.0); }',
    ],
    [
      'a multiply into the written colour',
      'void main() { vec3 c = uRamp[0];\nc = c * 0.9;\ngl_FragColor = vec4(c, 1.0); }',
    ],
    [
      'a literal colour rather than a ramp read',
      'void main() { vec3 c = vec3(1.0, 0.0, 0.0);\ngl_FragColor = vec4(c, 1.0); }',
    ],
    ['a NON-NUMERIC ramp index', 'void main() { vec3 c = uRamp[idx];\ngl_FragColor = vec4(c, 1.0); }'],
    [
      'a ramp read with something appended',
      'void main() { vec3 c = uRamp[0] * 2.0;\ngl_FragColor = vec4(c, 1.0); }',
    ],
    ['a different uniform array', 'void main() { vec3 c = uOther[0];\ngl_FragColor = vec4(c, 1.0); }'],
    // ⚠ THE TWO PREPENDED CASES ARE WHAT MAKE THE ANCHORS LOAD-BEARING, and they are not the same
    // case twice. The whole point of the pattern is that the assignment is a BARE ramp read; a
    // factor in front of it is a colour arithmetic the closure forbids just as much as one behind.
    // Spaced and unspaced are both needed: without the spaced one the `^` anchor is free to go,
    // and without the UNSPACED one the leading `\s*` can widen to `\S*` and swallow the factor.
    [
      'a factor in FRONT of the ramp read',
      'void main() { vec3 c = 0.5 * uRamp[0];\ngl_FragColor = vec4(c, 1.0); }',
    ],
    [
      'a factor in front with no space',
      'void main() { vec3 c = 0.5*uRamp[0];\ngl_FragColor = vec4(c, 1.0); }',
    ],
  ];
  for (const [why, src] of open) {
    assert.equal(grainKeepsPaletteClosed(src), false, `should be OPEN — ${why}`);
  }
  // ⚠ AND THE SCOPE IS `main()` ONLY, which is a correctness requirement rather than an
  // optimisation: a HELPER above main declaring a local of the same name once made this report a
  // closed shader as OPEN. A mix inside a helper must not change the verdict.
  assert.equal(
    grainKeepsPaletteClosed(
      `vec3 helper() { vec3 c = vec3(0.0);\nc = mix(c, c, 0.5);\nreturn c; }\n${closed}`,
    ),
    true,
    'a mix inside a HELPER is not a write to the delivered colour',
  );
});

test('the RAMP CLAMPS AT BOTH ENDS, and both ends are reachable on the real field', () => {
  // ⚠ THE POINT IS THE `>= 1` END. Every other test walks ordinary coordinates, where the field
  // sits inside the authored span and the clamp never fires — so a mutated clamp survives while
  // the picture at the field's rare extremes changes. Both ends are exercised here on coordinates
  // the field really visits.
  assert.equal(grainRamped(0, 0), 0, 'the field is 0 at the origin, well below the span');
  // The tuned-island point (-498.52, -199.24), scaled by LAND_SCALE — the same 0.758 field value.
  assert.equal(grainRamped(-498.52 * LAND_SCALE, -199.24 * LAND_SCALE), 1, 'and 0.758 here, above it');
  assert.ok(grainField(-498.52 * LAND_SCALE, -199.24 * LAND_SCALE) >= GRAIN_RAMP()[1], 'that point must really be above the span');
  assert.ok(grainField(0, 0) <= GRAIN_RAMP()[0], 'and the origin really below it');
});

test('linearToSrgb255 uses the LINEAR branch below the knee and the power branch above', () => {
  // The transfer function is two pieces and the join is what a transcription gets wrong. Sampled
  // either side of the knee at values far enough apart to separate the two curves: the linear
  // branch would overshoot badly at 0.5 and the power branch would undershoot at 0.001.
  assert.equal(linearToSrgb255(0), 0);
  assert.equal(linearToSrgb255(1), 255);
  assert.equal(linearToSrgb255(0.001), 3, 'below the knee: 12.92 * 0.001 * 255');
  assert.equal(linearToSrgb255(0.5), 188, 'above it: the 1/2.4 power curve');
  assert.equal(linearToSrgb255(0.0031308), 10, 'at the knee itself, where the two agree');
  // Out of range must CLAMP rather than wrap or throw — the grain stops are authored by hand and a
  // typo outside [0,1] would otherwise reach a shader as a wrapped byte.
  assert.equal(linearToSrgb255(-1), 0);
  assert.equal(linearToSrgb255(2), 255);
});

test('the PERTURBED NORMAL delivers this instance — on a TILTED normal, not just a flat one', () => {
  // ⚠ EVERY OTHER TEST OF THIS FUNCTION USES `{0, 1, 0}` AND READS ONLY THE RUNG, which is a
  // four-valued view of a three-component answer: the whole normalisation, the y component and the
  // sign of each subtraction can move without changing which rung a flat surface lands on. The
  // relief'd land is not flat, so a tilted input is the case that actually ships.
  const n = { x: 0.3, y: 0.9, z: -0.2 };
  // ⚠ Tuned-island points, scaled by LAND_SCALE, at a strength ALSO scaled by LAND_SCALE: the
  // gradient at the scaled point is the tuned gradient over LAND_SCALE, so `strength * LAND_SCALE`
  // subtracts exactly the tuned displacement and the recorded normals stand unchanged. This pins the
  // perturbation ARITHMETIC; the shipped default strength is exercised by the rung-flip tests above.
  for (const [x, z, px, py, pz] of [
    [3.1, 7.2, 0.265472867217, 0.954201185038, -0.137928442474],
    [-18.4, 22.9, 0.432046324283, 0.895548633428, -0.106435984699],
    [64, -11.5, 0.054626931835, 0.997801839822, -0.037515153829],
  ] as const) {
    // The shipped strength IS the tuned 1.0 × LAND_SCALE (`land-grain.ts`), so the default reproduces it.
    const p = grainPerturbNormal(n, x * LAND_SCALE, z * LAND_SCALE, GRAIN_NORMAL_STRENGTH);
    assert.ok(Math.abs(p.x - px) < EPS, `x at (${x}, ${z}) = ${p.x}, expected ${px}`);
    assert.ok(Math.abs(p.y - py) < EPS, `y at (${x}, ${z}) = ${p.y}, expected ${py}`);
    assert.ok(Math.abs(p.z - pz) < EPS, `z at (${x}, ${z}) = ${p.z}, expected ${pz}`);
    // And it must stay a UNIT normal, which is what the shader assumes and what the raw
    // subtraction does not give on its own.
    assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-12, 'the result must be normalised');
  }
  // A DEGENERATE input must not divide by zero — the `|| 1` guard, stated rather than trusted.
  const zero = grainPerturbNormal({ x: 0, y: 0, z: 0 }, 0, 0, 0);
  assert.ok(Number.isFinite(zero.x) && Number.isFinite(zero.y) && Number.isFinite(zero.z));
});

test('the COLOUR HALF delivers this instance — the mix, and the ramp between the two stops', () => {
  // The existing test says only that the result is NOT the base token, which is satisfied by any
  // mix at any factor between any two colours. These pin the arithmetic: the base, the two stops,
  // the ramp position and the 0.13 factor.
  // Tuned-island points, scaled by LAND_SCALE — the ramped field there is unchanged, so the colours are.
  for (const [x, z, r, g, b] of [
    [3.1, 7.2, 132, 171, 90],
    [-18.4, 22.9, 142, 180, 99],
    [64, -11.5, 131, 170, 89],
    [0, 0, 130, 169, 88],
  ] as const) {
    const c = grainColourAt(HEALTHY, x * LAND_SCALE, z * LAND_SCALE);
    assert.deepEqual(c, { r, g, b }, `grainColourAt at (${x}, ${z})`);
  }
  // A ZERO mix must be the base exactly — the boundary the factor is measured from, and the one
  // case where "not the base token" would be the wrong assertion.
  assert.equal(toHex(grainColourAt(HEALTHY, 3.1 * LAND_SCALE, 7.2 * LAND_SCALE, 0)), HEALTHY);
  // A FULL mix must be the ramp colour itself, with the base gone entirely.
  const full = grainColourAt(HEALTHY, -18.4 * LAND_SCALE, 22.9 * LAND_SCALE, 1);
  const [dark, light] = grainStops();
  const t = grainRamped(-18.4 * LAND_SCALE, 22.9 * LAND_SCALE);
  assert.deepEqual(full, {
    r: Math.round(dark.r + (light.r - dark.r) * t),
    g: Math.round(dark.g + (light.g - dark.g) * t),
    b: Math.round(dark.b + (light.b - dark.b) * t),
  });
});

test('grainKeepsPaletteClosed reads the SOURCE it is handed, whatever its spacing', () => {
  // ⚠ THE REGEXES ARE THE CHECK, and a shader's whitespace is a formatter's business rather than
  // the author's — a pattern that only matches one spelling would report a closed shader as OPEN
  // the first time anything reformatted it, which is the false-alarm shape this module's own
  // comments say turns a guard into noise a reader learns to ignore.
  const variants = [
    'void main(){vec3 c=uRamp[0];gl_FragColor=vec4(c,1.0);}',
    'void main( void ) {\n  vec3 c   =  uRamp[ 12 ] ;\n  gl_FragColor  =  vec4( c , 1.0 ) ;\n}',
    'void main() { vec3 _c0 = uRamp[3];\ngl_FragColor = vec4(_c0, 1.0); }',
  ];
  for (const src of variants) {
    assert.equal(grainKeepsPaletteClosed(src), true, `should be CLOSED: ${JSON.stringify(src)}`);
  }
  // ⚠ AND `main()` AT INDEX 0 MUST STILL BE FOUND. The absent case is `indexOf` returning -1, so a
  // guard written as `<= 0` rejects the one source that begins with the function it is looking for
  // — a whole-file fragment, which is exactly what a generator emits.
  assert.equal(grainKeepsPaletteClosed(variants[0]!.trimStart()), true);
  assert.ok(variants[0]!.startsWith('void main('), 'that case must really put main at index 0');
});

test('the OCTAVE LADDER is stated per octave — amplitude compounds, frequency doubles', () => {
  // ⚠ NAMED SEPARATELY BECAUSE THE GOLDENS COULD NOT REACH THEM. Both live inside an `Array.from`
  // callback, and `check:mutation-diff` attributed a swapped divide there to no test at all — so a
  // field six times too coarse would have been a live possibility with every value above green.
  assert.equal(grainOctaveAmplitude(0), 1, 'the first octave carries the full amplitude');
  assert.equal(grainOctaveAmplitude(1), GRAIN_ROUGHNESS);
  assert.equal(grainOctaveFrequency(0), 1 / GRAIN_LATTICE, 'octave 0 IS the authored lattice');
  // The authored 2.5 lattice, scaled by LAND_SCALE (`land-per-capability.ts`): 0.4 / LAND_SCALE.
  assert.equal(grainOctaveFrequency(0), 1 / (2.5 * LAND_SCALE));
  assert.equal(grainOctaveFrequency(1), 2 / (2.5 * LAND_SCALE), 'and each octave doubles it');
  // NON-VACUITY on the direction: a multiply instead of a divide would give the lattice itself
  // (2.5 * LAND_SCALE, under a unit) rather than its reciprocal (over one). A reciprocal sits on
  // the OPPOSITE side of 1 from the spacing it inverts; a multiply lands on the same side.
  assert.ok(
    (grainOctaveFrequency(0) > 1) === (2.5 * LAND_SCALE < 1),
    'the frequency is a RECIPROCAL of the lattice spacing',
  );
  assert.equal(grainTerms().length, GRAIN_OCTAVES);
  assert.equal(grainAmplitudeSum(), 1 + GRAIN_ROUGHNESS);
});

test('THE DENSITY LEVER: the same field flipped 14% of flat ground on four rungs and flips 73% on the nine it now has', () => {
  // ⚠⚠ THE MEASUREMENT THAT DISSOLVED AN OWNER FORK. The approved Cycles render's ground reads
  // as a continuous MOTTLE; the shipped ground reads as a SPECKLE at band edges. That gap was
  // attributed to the missing half of the grain — the off-palette COLOUR mix — and closing it was
  // thought to need a palette move first, because the tint at its authored 0.13 walks the shared
  // `proposed`/`building` yellow into `healthy`'s green
  // (`harness/grain-status-reading.ts`, `move-the-yellow-so-the-ground-texture-can-finish`).
  //
  // IT IS NOT THE TINT. It is the LADDER'S RESOLUTION. The normal half perturbs the lambert
  // BEFORE quantisation, so on flat ground it can only express itself as a rung FLIP — and a
  // four-rung ladder gives it almost nowhere to land: the excursion it produces is ~0.11 in
  // lambert units against rung gaps of 0.02, 0.10 and 0.10, so most of the island sits in the
  // middle of a band and never moves. Halving the gaps does not touch the field, the palette, the
  // shadow or the reading margin — every added rung is an authored `token x level` product inside
  // the span the ladder already spanned — and it takes the same grain from a speckle to a mottle.
  const flat = { x: 0, y: 1, z: 0 };
  const evenly = (lo: number, hi: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => Math.round((lo + ((hi - lo) * i) / (n - 1)) * 1000) / 1000);
  const flipFraction = (ladder: readonly number[]): number => {
    const base = nearestLevelIndex(ladder, lambertOfNormal(flat));
    let flipped = 0;
    let total = 0;
    for (let x = -100; x <= 100; x += 1.3) {
      for (let z = -60; z <= 60; z += 1.1) {
        total++;
        // The tuned-island grid, scaled by LAND_SCALE with the lattice: the same island-relative points.
        const rung = nearestLevelIndex(ladder, lambertOfNormal(grainPerturbNormal(flat, x * LAND_SCALE, z * LAND_SCALE)));
        if (rung !== base) flipped++;
      }
    }
    return flipped / total;
  };

  const legacy = flipFraction(LEGACY_SHADE_LEVELS);
  const shipped = flipFraction(SHADE_LEVELS);
  console.log(
    `  rung-flip fraction: 4 rungs ${(legacy * 100).toFixed(1)}% -> 9 rungs ${(shipped * 100).toFixed(1)}%`,
  );
  assert.equal((legacy * 100).toFixed(1), '14.4');
  assert.equal((shipped * 100).toFixed(1), '73.1');
  // ⚠ THE NINE-RUNG SIDE IS NOW THE LADDER THAT SHIPS, so this pair is a before/after of an
  // adoption rather than a candidate against an incumbent. It is still asked of the generated
  // grid too, because agreeing with `evenly(0.8, 1.0, 9)` is what says the shipped literal really
  // is that grid rather than nine rungs that merely flip about as much.
  assert.equal(flipFraction(evenly(0.8, 1.0, 9)), shipped);

  // MONOTONIC IN DENSITY, so the pair above is a curve rather than two points that happen to
  // differ. Without this a single lucky spacing would satisfy the assertions and prove nothing.
  const curve = [4, 6, 8, 12, 16].map((n) => flipFraction(evenly(0.8, 1.0, n)));
  for (let i = 1; i < curve.length; i++) {
    assert.ok(
      curve[i]! > curve[i - 1]!,
      `density is not monotonic: ${curve.map((c) => c.toFixed(3)).join(' ')}`,
    );
  }
  // ⚠ AND IT SATURATES BELOW 1, which is what keeps it a grain rather than a repaint: some of
  // flat ground must stay on its own rung or the texture has replaced the shading it modulates.
  assert.ok(curve[curve.length - 1]! < 0.95, 'a ladder fine enough to flip everything is a repaint');

  // THE SPAN IS THE OTHER HALF OF THE LEVER, and it is NOT what delivers the texture: the same
  // 0.02 spacing over a shorter span flips about as much. So refining and lifting are genuinely
  // two separate choices, which is why the comparison carries them as two arms.
  const lifted = flipFraction(evenly(0.86, 1.0, 7));
  assert.ok(lifted > 0.65, `a lifted ladder at the same spacing flips ${(lifted * 100).toFixed(1)}%`);
});
