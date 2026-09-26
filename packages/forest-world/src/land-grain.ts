// land-grain.ts — THE HIGH-FREQUENCY GRAIN OCTAVE, as a pure field plus the GLSL that
// evaluates the same field on a GPU. Browser-free and node:test-provable, so it sits in the pure
// half of the package and the root barrel could carry it (it imports no three, no react).
//
// ⚠ IT CROSSED ON 2026-08-30 and `harness/land-grain.ts` is now a RE-EXPORT of this file — the
// shape every crossing on `adopt-the-land-into-the-shipped-map-arc` takes, recorded in
// `harness/scope-fence.test.ts`'s ADOPTED ledger. The experiment and the shipped ground therefore
// evaluate ONE field; a copy would be two that drift, which is how this package once acquired
// three disagreeing status palettes.
//
// ⚠⚠ WHAT SHIPS IS THE NORMAL HALF ONLY, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
// `harness/grain-status-reading.ts` drove all six shipped ground tokens through the colour half's
// mix arithmetically and found its authored fac of 0.13 INADMISSIBLE: the `proposed`/`building`
// yellow at the ladder's two darkest rungs walks into `healthy`'s green under the house reader
// model. The admissible ceiling is 0.031. The normal half is unaffected — it perturbs the lambert
// BEFORE quantisation, so the fragment still writes an authored ramp entry. See that module, and
// the open question it raised, before reaching for `mode: 'both'` on the shipped material.
//
// WHAT THIS IS FOR. Every other noise in the land varies over WHOLE GROUND UNITS — the
// landform at ~123 units, the mid octave at ~34, the fine one at ~8 — so at the zoomed frame
// the ground has no structure at the pixel scale and reads as a watercolour wash beside props
// that are crisply painted. `docs/research/chapter2-land-idiom-2026-08-27` measured the fix:
// one high-frequency octave at low amplitude is worth +54% MICRO on bare land at 1948 px
// (1.19 -> 1.83) and is the only lever in that pass that makes the ground survive being zoomed
// into. It is also the component the owner singled out on 2026-08-27.
//
// ⚠⚠ THE CYCLES GRAIN IS TWO MECHANISMS, NOT ONE, AND THEY LAND ON OPPOSITE SIDES OF OUR
// PALETTE CLOSURE. Read off `build_land.py`'s `mat_attribute`, the approved treatment mixes a
// noise-driven dark ramp over the base colour at fac 0.130 (the COLOUR half) AND drives a bump
// at strength 0.30 from the same noise (the NORMAL half). Our material does not multiply
// colour on the GPU at all: `tokenRamp` rounds the finished colours in TypeScript and the
// shader SELECTS one and writes it through, which is what makes "the delivered pixel is an
// authored entry" a bit-identity rather than an approximation (see `bandLevelIndex`'s
// 929-pixel measurement). So:
//
//   - the NORMAL half perturbs the lambert BEFORE quantisation. Whatever it computes, the
//     fragment still writes a `uRamp[...]` entry, so the palette closure is untouched and
//     `capture.mjs` stays green. `grainKeepsPaletteClosed` states that as a property of the
//     generated SOURCE rather than of a picture.
//   - the COLOUR half is off-palette BY CONSTRUCTION. ADR-0418 D2/D3 permit it on `harness/`,
//     but `capture.mjs` still refuses an off-palette pixel and exits non-zero (PR #1511). It
//     is built here because it is the mechanism Cycles actually used and the crossing question
//     cannot be answered honestly without measuring it — not because it is adoptable today.
//
// ⚠ WHAT IS *NOT* CLAIMED: bit-identity between this TypeScript and the GPU. A `fract(sin(..))`
// hash is not reproducible across vendors, and JavaScript's `Math.sin` and a GPU's `sin` are
// different functions. What IS guaranteed is the thing `bandGlsl` guarantees and for the same
// reason — the CONSTANTS are interpolated into the shader from this module rather than
// hand-typed, so the two halves cannot drift apart on the numbers that decide the look. The
// delivered-pixel measurement is what closes the remaining gap, and that is `grain-measure.mjs`.

import { LAND_SCALE } from './land-per-capability.js';
import { parseHex, toHex, type Rgb255 } from './shade-ladder.js';

/** A unit surface normal in WORLD space — the same shape `rungOfNormal` and `landNormal` speak,
 *  named here so the perturbation's contract is a type rather than a repeated literal. */
export interface GroundNormal {
  x: number;
  y: number;
  z: number;
}

/**
 * The grain's LATTICE SPACING in ground units — the distance between hash sites, NOT the size
 * of a delivered feature. The distinction is the whole reason this constant is not called a
 * wavelength, and reading it as one is a mistake that costs a factor of 2.6.
 *
 * DERIVED RATHER THAN TASTED. `build_land.py` drives the grain from `_noise(scale=95.0,
 * detail=2.0, roughness=0.55)` with nothing wired into its Vector input, so Blender evaluates
 * it on GENERATED coordinates — normalised 0..1 across the object's bounding box. A scale of 95
 * is therefore 95 LATTICE CELLS across the island, and the island's measured bounding box is
 * 233.8 units on its long axis, so the authored spacing is 233.8 / 95 = 2.46 ground units. The
 * independent cross-check is the detail normal one block below it in the same material, whose
 * own comment tiles at "~2.4 ground units so it lands between the grain and the landform".
 *
 * ⚠ GENERATED COORDINATES NORMALISE PER AXIS, so the Blender grain is ANISOTROPIC — 2.46 units
 * along x and 1.42 along z on a 233.8 x 135.1 bounding box. That is an artefact of the
 * coordinate space, not a decision, and it is deliberately NOT reproduced: this field is
 * isotropic and authored at a round 2.5.
 */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const GRAIN_LATTICE = 2.5 * LAND_SCALE;

/**
 * How much LARGER a delivered feature is than the lattice that generated it — MEASURED on this
 * field, not assumed, and pinned by `land-grain.test.ts`.
 *
 * ⚠⚠ THIS EXISTS BECAUSE THE OBVIOUS READING OF `GRAIN_LATTICE` IS WRONG AND SILENTLY SO. A
 * smoothstep value-noise field does not turn over once per lattice cell: successive hash sites
 * are independent, so the field wanders across its mean roughly once every 1.3 cells, giving a
 * mean-crossing PERIOD of about 2.6 lattice spacings. Measured on three independent scan lines
 * over a 2,000-unit span: 2.52, 2.60, 2.90.
 *
 * So the delivered grain feature is ~6.5 ground units, not 2.5, and anyone sizing the grain
 * against the ~16.5-unit cell pitch or the delivered-pixel budget needs THAT number. It is
 * exposed as {@link grainFeaturePeriod} rather than left for a reader to multiply.
 *
 * ⚠ WHAT IS NOT CLAIMED: that Blender's Perlin has the same ratio. Both are lattice noises and
 * both take a Scale that sets the lattice, so transcribing 95 as a lattice spacing is the
 * correct reading of the source either way — but the delivered comparison between the two
 * renderers is settled by `grain-measure.mjs` against the committed Cycles table, not by
 * asserting the two constructions agree.
 */
export const GRAIN_FEATURE_RATIO = 2.6;

/**
 * The size of a delivered grain feature, in ground units.
 *
 * The two floors it has to clear, and it clears both: below ~1 ground unit a feature is
 * aliasing shimmer rather than detail, and above the ~16.5-unit mean cell pitch a field is
 * REGIONAL variation rather than grain (that is `ground-variation.ts`'s job, at 96 and 61
 * units). At ~6.5 units the feature is ~14 device px at the 487 px overview and ~54 px at the
 * 1948 px zoom, which is the asymmetry the whole component exists to exploit.
 */
export function grainFeaturePeriod(): number {
  return GRAIN_LATTICE * GRAIN_FEATURE_RATIO;
}

/** Octaves, from Cycles `detail = 2.0`. */
export const GRAIN_OCTAVES = 2;

/** Per-octave amplitude falloff, from Cycles `roughness = 0.55`. */
export const GRAIN_ROUGHNESS = 0.55;

/** The COLOUR half's mix factor, from Cycles `grain.inputs[0] = 0.130`. */
export const GRAIN_COLOUR_MIX = 0.13;

/**
 * The NORMAL half's bump strength — OURS, calibrated here, and NOT Cycles' 0.30.
 *
 * ⚠⚠ THE ONE CONSTANT ON THIS PAGE THAT MAY NOT BE TRANSCRIBED, and transcribing it produces a
 * component that does exactly nothing while every test around it stays green. Cycles' 0.30 is a
 * Bump node's Strength, which blends between the true normal and a height-derived one inside
 * Blender's own shading; ours multiplies a gradient measured in field-units per GROUND unit.
 * They are different quantities that happen to share a name, so the number does not carry.
 *
 * MEASURED, on flat ground under the authored light, as the fraction of the surface the grain
 * moves to a neighbouring rung:
 *
 *   strength  0.3 -> 0.00%   0.6 -> 1.35%   1.0 -> 14.4%   1.5 -> 32.6%   2.0 -> 44.4%
 *
 * At Cycles' own 0.30 the grain is INVISIBLE: the field's median gradient is 0.138 per ground
 * unit, so the normal tilts about 2.4 degrees, and flat ground needs 9 to 11 degrees to reach a
 * neighbouring rung (half-lambert 0.9105 sits on rung 2; rung 3 needs +0.0395, rung 1 needs
 * -0.0605). 1.0 is chosen as the smallest strength that delivers a grain a viewer can see while
 * leaving ~85% of the ground on its own rung — above ~1.5 this stops being a grain and becomes a
 * repaint of a third of the island.
 *
 * ⚠ That band is a property of the FOUR-RUNG LADDER, not of the field. It is the quantitative
 * form of this component's ceiling: a banded material can only express grain as a threshold
 * crossing, so the knob controls HOW MUCH ground flips, never how much any point changes.
 */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the strength multiplies a GRADIENT PER GROUND UNIT,
// and the lattice it is taken over shrank by LAND_SCALE, so the gradient grew by 1 / LAND_SCALE
// — unscaled, the effective strength would have been 2.65, past the ~1.5 "repaint" line above.
// Scaled, the delivered tilt at every island-relative point is what it was on the tuned island.
export const GRAIN_NORMAL_STRENGTH = 1.0 * LAND_SCALE;

/**
 * The colour ramp's two stop POSITIONS, from Cycles `_ramp([(0.30, ...), (0.70, ...)])`.
 * The field is remapped across this span before it picks a grain colour, so the ramp's ends are
 * flat and the grain does not spend its amplitude on the noise's rare extremes.
 *
 * ⚠⚠ A MEMOISED FUNCTION RATHER THAN A MODULE-SCOPE CONSTANT, and that is a mutation-rung finding
 * rather than a preference. Stryker files anything evaluated during IMPORT as STATIC coverage —
 * attributed to no test — so a mutated module-scope initializer comes back "killed, but the report
 * named no test", which `check:mutation-diff` counts as neither a pass nor a survivor and reds the
 * rung over well-tested code. ⚠ It surfaced ONLY IN CI: the same commit ran clean on Windows and
 * reported two of these on Linux, so a local green does not clear it. Deferring evaluation to
 * first use puts the initializer back inside a test. See {@link grainTerms} and
 * `harness/grain-status-reading.ts`'s own `stops()` for the same fix in two other places.
 */
let rampMemo: readonly [number, number] | null = null;
export function GRAIN_RAMP(): readonly [number, number] {
  return (rampMemo ??= [0.3, 0.7]);
}

/**
 * The two grain colours, AUTHORED IN CYCLES' LINEAR SPACE and converted here rather than
 * transcribed as hex.
 *
 * ⚠ THIS CONVERSION IS LOAD-BEARING AND IT IS THE EASIEST THING IN THIS FILE TO GET WRONG.
 * `build_land.py` writes colour-ramp stops as Blender RGBA, which is LINEAR. Our pipeline is
 * the exact opposite by design — `configureExactColour` disables colour management outright so
 * that an authored sRGB token arrives at the framebuffer unmodified. Dropping the linear
 * numbers straight into a shader here would deliver a grain roughly 2.5x too dark at the dark
 * stop and read as dirt rather than as grain, while looking like an amplitude mistake.
 */
const GRAIN_LINEAR: readonly [readonly [number, number, number], readonly [number, number, number]] =
  [
    [0.055, 0.062, 0.03],
    [0.56, 0.56, 0.43],
  ];

/** The delivered byte for a transfer-function output in [0, 1], clamped rather than wrapped — the
 *  grain stops are authored by hand and a typo outside the range would otherwise reach a shader as
 *  a wrapped byte, which looks like an art choice. A NAMED function rather than a nested chain:
 *  `check:mutation-diff` cannot attribute a killing test to an inline `Math.min(Math.max(...))` and
 *  reports it UNPROVEN, which is neither a pass nor a survivor
 *  (`mutation-rung-misreports-inline-chains`). */
function toByte(v: number): number {
  const scaled = Math.round(v * 255);
  const floored = Math.max(0, scaled);
  const capped = Math.min(255, floored);
  return capped;
}

/** Linear -> sRGB, the standard piecewise transfer, to a 0..255 byte. Exported so the conversion
 *  {@link grainStops} performs is a tested function rather than five numbers someone has to trust.
 *
 *  ⚠ TWO STATEMENTS RATHER THAN A TERNARY, for the same attribution reason as {@link toByte}: the
 *  branch condition and the two arithmetic bodies each need a line a test can be pinned to. */
export function linearToSrgb255(c: number): number {
  // Stryker disable next-line EqualityOperator: EQUIVALENT AT THE OUTPUT, and provably rather than
  // by inspection. The two branches are equal AT the knee by construction — that is what makes it
  // the knee — so `<=` and `<` can differ only for c === 0.0031308 exactly, where both give 10.31
  // and this function returns a BYTE. No input can separate them. ⚠ The claim is about the KNEE
  // VALUE: if 0.0031308 is ever retuned away from the true crossing, DELETE this line rather than
  // updating it — a stale equivalence claim suppresses a mutant a test could kill.
  if (c <= 0.0031308) return toByte(12.92 * c);
  return toByte(1.055 * Math.pow(c, 1 / 2.4) - 0.055);
}


/** The grain's dark and light stops as delivered sRGB, derived from {@link GRAIN_LINEAR}. */
export function grainStops(): readonly [Rgb255, Rgb255] {
  const [lo, hi] = GRAIN_LINEAR;
  const conv = (c: readonly [number, number, number]): Rgb255 => ({
    r: linearToSrgb255(c[0]),
    g: linearToSrgb255(c[1]),
    b: linearToSrgb255(c[2]),
  });
  return [conv(lo), conv(hi)];
}

/** The stops as `#rrggbb`, the form the evidence sheets print. */
export function grainStopHexes(): readonly [string, string] {
  const [lo, hi] = grainStops();
  return [toHex(lo), toHex(hi)];
}

// ---------------------------------------------------------------- the field

/**
 * The lattice hash, in [0, 1).
 *
 * ⚠ A `fract(sin(...))` hash is the one construction here that is NOT portable, and saying so
 * is more useful than pretending otherwise: `Math.sin` and a GPU's `sin` are different
 * functions, and the multiply by 43758.5 amplifies any disagreement to the full output range.
 * It is used anyway because the alternative on GLSL ES 1.0 — integer bit mixing — is not
 * available, and because nothing downstream needs the two to agree pixel-for-pixel. What needs
 * to agree is the field's SHAPE (wavelength, octave count, amplitude), and that is carried by
 * the constants this module interpolates into the shader.
 *
 * ⚠⚠ THE NON-PORTABILITY NOW HAS A NUMBER, AND IT IS LARGER THAN "not bit-identical" SUGGESTS.
 * Measured 2026-08-27 on the same commit and the same page, SwiftShader against an RTX 2060
 * (`docs/research/chapter2-ground-cover-2026-08-27/` §10): ungrained land agrees to **0.025%** of
 * pixels, grained land disagrees on **24.5%** — a quarter of the surface lands on a different
 * ladder rung, because `sin`'s argument reduction differs and the normal perturbation pushes a
 * different quarter across a boundary. The palette closure is UNAFFECTED (0 off-palette pixels on
 * both), so the fence holds; what does not survive is the PICTURE. A committed PNG of grained
 * land is one renderer's mottle, and a pixel-baseline regression check over it would be locked to
 * whichever machine produced the baseline. Do not build one without reading that section.
 *
 * The lattice is small on purpose: the island spans ~94 grain cells, so the arguments stay in
 * a range where the hash is well-behaved rather than out where `sin`'s argument reduction
 * dominates.
 */
export function grainHash(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smoothstep interpolant, the standard `3t^2 - 2t^3`. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise on the unit lattice, in [0, 1]. */
export function grainOctave(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fade(fx);
  const uy = fade(fy);
  const a = grainHash(ix, iy);
  const b = grainHash(ix + 1, iy);
  const c = grainHash(ix, iy + 1);
  const d = grainHash(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/**
 * The grain field at a GROUND point, in [0, 1].
 *
 * NORMALISED BY THE AMPLITUDE SUM, so the field's range does not move when the octave count or
 * the roughness is retuned. An unnormalised fbm would quietly change the grain's amplitude
 * whenever someone changed its detail, which is a different lever wearing the same name.
 */
export function grainField(x: number, z: number): number {
  let sum = 0;
  for (const { amp, freq } of grainTerms()) sum += amp * grainOctave(x * freq, z * freq);
  return sum / grainAmplitudeSum();
}

/** ONE OCTAVE'S CONTRIBUTION: its amplitude and its lattice frequency. */
export interface GrainTerm {
  amp: number;
  freq: number;
}

/**
 * THE OCTAVE TERMS, DERIVED ONCE — and shared by the field and by the GLSL that evaluates the same
 * field on a GPU.
 *
 * ⚠⚠ IT IS ONE DERIVATION FOR TWO CONSUMERS, WHICH IS THIS MODULE'S OWN RULE APPLIED TO ITSELF.
 * `grainGlsl` already interpolates the constants rather than re-typing them, on the argument that
 * a shader and a test holding private copies of one number prove nothing about each other — but
 * the two were still running private LOOPS over those constants, so an octave count that agreed
 * and an amplitude falloff that did not would have been unrepresentable in one place and perfectly
 * possible in the other.
 *
 * ⚠ IT ALSO REMOVES TWO LOOP COUNTERS the mutation rung could not attribute. An indexed `for` over
 * `GRAIN_OCTAVES` came back UNPROVEN in both consumers — killed, but with no test named — which is
 * neither a pass nor a survivor (`mutation-rung-misreports-inline-chains`). With the counter gone
 * there is nothing left to mis-attribute, and the arithmetic is identical: amplitude
 * `GRAIN_ROUGHNESS^o`, frequency `2^o / GRAIN_LATTICE`, which is what the multiply-in-place loop
 * accumulated.
 */
let termsMemo: readonly GrainTerm[] | null = null;
export function grainTerms(): readonly GrainTerm[] {
  return (termsMemo ??= Array.from({ length: GRAIN_OCTAVES }, (_, o) => ({
    amp: grainOctaveAmplitude(o),
    freq: grainOctaveFrequency(o),
  })));
}

/** Octave `o`'s amplitude — the roughness compounded once per octave. */
export function grainOctaveAmplitude(o: number): number {
  return GRAIN_ROUGHNESS ** o;
}

/** Octave `o`'s LATTICE FREQUENCY, in cycles per ground unit: the base lattice doubled once per
 *  octave. Octave 0 is `1 / GRAIN_LATTICE` by definition — the whole field is authored against that
 *  spacing — so a multiply here instead of a divide would size the grain by a factor of
 *  `GRAIN_LATTICE` squared and deliver regional variation under the grain's name.
 *
 *  ⚠ A NAMED FUNCTION rather than an expression inside the `Array.from` callback, because
 *  `check:mutation-diff` could swap that divide for a multiply with the whole suite green: the
 *  mutant sat inside a callback the rung could attribute to no test, so a field 6x too coarse was
 *  unrepresentable in the goldens and perfectly possible in the code. */
export function grainOctaveFrequency(o: number): number {
  return 2 ** o / GRAIN_LATTICE;
}

/** The amplitude sum the field is normalised by, so its range does not move when the octave count
 *  or the roughness is retuned. Derived from {@link GRAIN_TERMS} rather than accumulated beside
 *  them — a normaliser that could disagree with the terms it normalises is the one arithmetic
 *  error here that would look like an amplitude choice. */
export function grainAmplitudeSum(): number {
  return grainTerms().reduce((n, t) => n + t.amp, 0);
}

/** The field remapped across the authored ramp span and clamped — the scalar that actually
 *  picks a grain colour, and the same scalar the shader ramps. */
export function grainRamped(x: number, z: number): number {
  const [lo, hi] = GRAIN_RAMP();
  const t = (grainField(x, z) - lo) / (hi - lo);
  // CLAMP THEN FADE, rather than three branches. `fade(0)` is 0 and `fade(1)` is 1, so the two
  // spellings deliver identical values — but the branch form carried two boundary comparisons that
  // no input on this field could distinguish (`check:mutation-diff` survivors, measured), i.e. two
  // decisions the code was making that nothing could ever hold it to. Fewer decisions is the fix.
  return fade(Math.min(1, Math.max(0, t)));
}

/**
 * The finite-difference step used for the bump gradient, in ground units.
 *
 * A QUARTER of the wavelength rather than an epsilon, and the reason is not precision. A true
 * derivative of a value-noise field is dominated by the lattice's own smoothstep and reports
 * the slope of one cell face; sampling a quarter period apart measures the slope of the
 * FEATURE, which is what a bump is supposed to shade. It also keeps the gradient stable when
 * the field is evaluated at the coarser 487 px sampling.
 */
export const GRAIN_GRAD_STEP = GRAIN_LATTICE / 4;

/**
 * The grain's height gradient at a ground point, per ground unit — `[dh/dx, dh/dz]`.
 *
 * Central differences, so a constant slope is reported exactly and the result does not lean
 * one way at a feature's crest.
 */
export function grainGradient(x: number, z: number): readonly [number, number] {
  const e = GRAIN_GRAD_STEP;
  const dx = (grainField(x + e, z) - grainField(x - e, z)) / (2 * e);
  const dz = (grainField(x, z + e) - grainField(x, z - e)) / (2 * e);
  return [dx, dz];
}

/**
 * The NORMAL half: a surface normal perturbed by the grain's gradient.
 *
 * The linearised heightfield normal. For a ground plane a displacement `h(x,z)` has normal
 * `normalize(vec3(-dh/dx, 1, -dh/dz))`, so subtracting `strength * (dh/dx, 0, dh/dz)` from an
 * arbitrary normal is that construction generalised to a surface that is not already flat —
 * which the relief'd land is not.
 *
 * ⚠ WHAT THIS BUYS ON A FOUR-RUNG LADDER IS A BINARY FLIP, NOT A GRADIENT, and that is the
 * whole reason this increment is a measurement rather than a port. Flat ground sits at
 * half-lambert 0.9105 under the authored light, which is rung 2; rung 3 needs +0.0395 and rung
 * 1 needs -0.0605, i.e. roughly a 9-11 degree tilt. So the delivered grain is a stipple between
 * two authored colours where the Cycles grain is continuous micro-variation. Whether that
 * delivers the MICRO lift, or delivers a number while looking wrong, is what
 * `grain-measure.mjs` exists to answer.
 */
export function grainPerturbNormal(
  n: GroundNormal,
  x: number,
  z: number,
  strength: number = GRAIN_NORMAL_STRENGTH,
): GroundNormal {
  const [dx, dz] = grainGradient(x, z);
  const px = n.x - strength * dx;
  const py = n.y;
  const pz = n.z - strength * dz;
  const len = Math.hypot(px, py, pz) || 1;
  return { x: px / len, y: py / len, z: pz / len };
}

// ---------------------------------------------------------------- the GLSL

/**
 * GLSL source for the grain field, with every authored constant written in from this module.
 *
 * A function rather than a constant string for exactly the reason `bandGlsl` is: a test can
 * call it and assert the interpolation actually happened. The octaves are UNROLLED at
 * generation time because `GRAIN_OCTAVES` is a TypeScript constant and GLSL ES 1.0 wants
 * constant loop bounds — generating the unroll is also what stops the shader and this module
 * disagreeing about how many octaves there are.
 */
export function grainGlsl(): string {
  const octaves = grainTerms().map(
    ({ amp, freq }) => `  s += ${amp.toFixed(6)} * st_grainOctave(p * ${freq.toFixed(6)});`,
  );
  const norm = grainAmplitudeSum();
  const [lo, hi] = GRAIN_RAMP();
  return [
    '// GENERATED from land-grain.ts — do not hand-edit these constants.',
    `// wavelength ${GRAIN_LATTICE} ground units, ${GRAIN_OCTAVES} octaves, roughness ${GRAIN_ROUGHNESS}`,
    'float st_grainHash(vec2 i) {',
    '  return fract(sin(i.x * 127.1 + i.y * 311.7) * 43758.5453123);',
    '}',
    '',
    'float st_grainOctave(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = p - i;',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    // ⚠ NAMED h00..h11 RATHER THAN a..d ON PURPOSE. `c` is the fragment stage's own delivered
    // colour, and a local of the same name here shadowed it well enough to make
    // `grainKeepsPaletteClosed` report a closed shader as OPEN — a false alarm on the one
    // property this module exists to state. Corner-indexed names cannot collide with it.
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
    ...octaves,
    `  return s / ${norm.toFixed(6)};`,
    '}',
    '',
    '// The field across the authored ramp span, smoothstepped and clamped.',
    'float st_grainRamped(vec2 p) {',
    `  return smoothstep(${lo.toFixed(6)}, ${hi.toFixed(6)}, st_grainField(p));`,
    '}',
    '',
    '// The grain gradient, per ground unit. The step is a QUARTER WAVELENGTH rather than an',
    '// epsilon: it measures the slope of the FEATURE, not of one lattice cell face.',
    'vec2 st_grainGradient(vec2 p) {',
    `  float e = ${GRAIN_GRAD_STEP.toFixed(6)};`,
    '  float gx = st_grainField(p + vec2(e, 0.0)) - st_grainField(p - vec2(e, 0.0));',
    '  float gz = st_grainField(p + vec2(0.0, e)) - st_grainField(p - vec2(0.0, e));',
    '  return vec2(gx, gz) / (2.0 * e);',
    '}',
  ].join('\n');
}

/**
 * Does a generated fragment shader still write ONLY an authored ramp entry?
 *
 * THE POINT OF ASKING IT OF THE SOURCE RATHER THAN OF A PICTURE. The palette closure is the
 * one property of this material that a screenshot can only ever sample: a capture proves the
 * pixels it photographed were on-palette, never that no reachable pixel is off it. The source
 * carries the stronger claim — if the only expression reaching `gl_FragColor` is a `uRamp`
 * element, then no lighting term, no noise and no amplitude can produce a colour outside the
 * closure, because none of them is ever added to a colour.
 *
 * So this is deliberately a SYNTACTIC check with a narrow remit, and it is honest about it: it
 * answers "does this shader mix anything into its output colour", which is exactly the
 * difference between the grain's normal half and its colour half.
 *
 * ⚠ IT READS ONLY `main()`, and that is a correctness requirement rather than an optimisation.
 * The helper functions above it declare locals of their own, and a local sharing a name with
 * the delivered colour made this report a closed shader as OPEN — the shape that turns a
 * genuine guard into noise a later reader learns to ignore. The locals were renamed AND the
 * scope narrowed, because either fix alone leaves the next collision waiting.
 */
export function grainKeepsPaletteClosed(fragmentSource: string): boolean {
  const mainAt = fragmentSource.indexOf('void main(');
  // Stryker disable next-line ConditionalExpression: EQUIVALENT, and the argument is structural.
  // Removing this guard leaves `slice(-1)` — a ONE-CHARACTER body — and the assignment pattern
  // below needs at least `gl_FragColor=vec4(x,1.0)`, 23 characters, so it cannot match and the
  // function returns false down the other path. The guard is kept because reasoning about
  // `slice(-1)` at every later line is worse than one explicit early return, not because any
  // input can tell the two apart.
  if (mainAt < 0) return false;
  const body = fragmentSource.slice(mainAt);
  const assignment = /gl_FragColor\s*=\s*vec4\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*1\.0\s*\)/.exec(
    body,
  );
  if (!assignment) return false;
  const written = assignment[1]!;
  // Every assignment to the written variable must be a bare `uRamp[...]` read. A `mix(...)`,
  // a `+` or a `*` on that variable is the colour half and is not closed.
  const writes = [...body.matchAll(new RegExp(`\\b${written}\\s*=\\s*([^;=]+);`, 'g'))];
  if (writes.length === 0) return false;
  return writes.every((m) => /^\s*uRamp\[\s*\d+\s*\]\s*$/.test(m[1]!));
}

/** The grain colour a ground point delivers under the COLOUR half, as delivered sRGB — the
 *  pure twin of the shader's `mix(c, grainCol, GRAIN_COLOUR_MIX)`, so a test can state what is
 *  off-palette rather than only that something is. */
export function grainColourAt(base: string, x: number, z: number, mixAmount = GRAIN_COLOUR_MIX): Rgb255 {
  const b = parseHex(base);
  const [dark, light] = grainStops();
  const t = grainRamped(x, z);
  const g = {
    r: dark.r + (light.r - dark.r) * t,
    g: dark.g + (light.g - dark.g) * t,
    b: dark.b + (light.b - dark.b) * t,
  };
  return {
    r: Math.round(b.r + (g.r - b.r) * mixAmount),
    g: Math.round(b.g + (g.g - b.g) * mixAmount),
    b: Math.round(b.b + (g.b - b.b) * mixAmount),
  };
}
