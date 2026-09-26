// land-grass.ts — LAYER 1 OF THE APPROVED GROUND: the grass base and its cool/warm hue drift,
// transcribed from `docs/research/chapter2-land-idiom-2026-08-27/build_land.py:836-868`.
//
// Pure, browser-free and node:test-provable — the same shape `land-grain.ts` takes, and for the
// same reason: the field is authored once in TypeScript and the GLSL that evaluates it on a GPU
// is GENERATED from these constants, so a shader and a test cannot hold private copies of the
// numbers that decide the look.
//
// ⚠⚠ THE SOURCE IS `mat_attribute()`, AND THE FILE CONTAINS A DECOY. `mat_procedural()` at
// `build_land.py:697-754` opens with a BYTE-IDENTICAL first line (`broad = _noise(nt, 1.9, 8.0,
// 0.62)`) and a `cool = _ramp(...)` that looks like this one but carries different numbers —
// stops at 0.30 rather than 0.28, and `(0.054, 0.130, 0.054)` rather than `(0.052, 0.126,
// 0.052)`. It belongs to the `procedural` variant, one of the four REJECTED in favour of
// `combined`. Every constant below is anchored on the ENCLOSING FUNCTION NAME, never on a grep
// hit, and `land-grass.test.ts` pins the pair that differ so a re-transcription from the losing
// variant fails rather than looking right (ADR-0490 D2).
//
// WHAT THIS LAYER IS FOR, and it is the arc's whole premise. Colour families holding >=0.5% of
// the island, quantised to 5 bits per channel: the shipped ground has 9, one green holding 27.8%
// and three shades holding 63.3%; the approved render has 36, none above 5.2%. That gap is
// absent colour LAYERS rather than a green needing adjustment, and this is the first of them —
// the floor the sand, the path, the rock and the grain all composite over (ADR-0490 D3).
//
// ⚠⚠ IT ENTERS AS A MIX INTO THE STATUS COLOUR, NEVER AS A REPLACEMENT (ADR-0490 D5). The
// shipped shader SELECTS an authored `(token x level)` entry by the parcel's status attribute,
// and the map's obligation to report capability health outranks the look (ADR-0392 D5 /
// ADR-0398 D7 / ADR-0475). So the delivered colour is `mix(statusColour, grassColour, fac)` and
// the whole crossing question is what `fac` may be — which is a MEASUREMENT
// (`harness/grass-status-reading.ts`), not a taste. ADR-0489 permits the grass to report nothing
// of its own; what it does not permit is the grass removing the report the parcel already
// carries.
//
// ⚠ WHAT IS NOT CLAIMED: that this delivers the Cycles image. Cycles is a path tracer with no
// frame budget; transcribing constants gives the same INTENT, not the same picture (ADR-0490's
// stated cost). Where this lands visibly short the gap is reported against the approved render
// rather than argued away.

import { LAND_SCALE } from './land-per-capability.js';
import { grainOctave, linearToSrgb255 } from './land-grain.js';
import { parseHex, type Rgb255 } from './shade-ladder.js';

/**
 * The island's LONG-AXIS SPAN in ground units, as `build_land.py` builds it — the constant that
 * turns a Cycles `Scale` into a lattice spacing this renderer can use.
 *
 * ⚠ IT IS LOAD-BEARING AND IT IS NOT ARBITRARY. Every `_noise` in `mat_attribute()` has nothing
 * wired into its Vector input, so Blender evaluates it on GENERATED coordinates — normalised
 * 0..1 across the object's bounding box. A `Scale` of `s` is therefore `s` LATTICE CELLS ACROSS
 * THE ISLAND, and the island's measured footprint is 233.8 units on its long axis
 * (`build_land.py`'s `ASPECT = 233.8 / 135.1`). So the authored spacing is `233.8 / s`.
 *
 * ⚠ THE SAME DERIVATION `land-grain.ts` ALREADY MADE for the micro octave (95.0 -> 2.46 units),
 * and it is cross-checked inside `build_land.py` itself: the cliff normal one block below the
 * grain is tiled at 2.5 with the comment "~2.4 ground units so it lands between the grain and
 * the landform". Two independent statements of the same spacing.
 *
 * ⚠ GENERATED COORDINATES NORMALISE PER AXIS, so the Blender fields are ANISOTROPIC — the long
 * axis divides by 233.8 and the short one by 135.1. That is an artefact of the coordinate space
 * rather than a decision, and it is deliberately NOT reproduced here, exactly as `land-grain.ts`
 * declined to reproduce it. The fields below are isotropic on the long axis.
 */
export const CYCLES_ISLAND_SPAN = 233.8;

/** The SHIPPED island's span in the same role — the recipe's lattices are island-relative, so the
 *  ground-unit lattice each noise resolves to follows the island's size (`land-per-capability.ts`). */
export const SHIPPED_ISLAND_SPAN = CYCLES_ISLAND_SPAN * LAND_SCALE;

/** One Cycles `ShaderNodeTexNoise` as this module reads it: `_noise(nt, scale, detail, roughness)`
 *  at `build_land.py:655-660`, where `roughness` defaults to 0.5. */
export interface CyclesNoise {
  /** Lattice cells across the island — the node's `Scale` input. */
  scale: number;
  /** Octaves — the node's `Detail` input. Read as an octave COUNT, which is the reading
   *  `land-grain.ts` already established when it transcribed `detail = 2.0` as two octaves. */
  detail: number;
  /** Per-octave amplitude falloff — the node's `Roughness` input. */
  roughness: number;
}

/**
 * THE THREE BASE OCTAVES, `build_land.py:836-838`.
 *
 *   broad = _noise(nt, 1.9, 8.0, 0.62)
 *   mid   = _noise(nt, 6.8, 8.0, 0.55)
 *   fine  = _noise(nt, 28.0, 4.0)          <- roughness defaults to 0.5
 *
 * Their delivered spacings are 123.1, 34.4 and 8.4 ground units, which is the ladder
 * `land-grain.ts`'s own header already describes from the other end — "the landform at ~123
 * units, the mid octave at ~34, the fine one at ~8" — written before this layer was transcribed
 * and therefore an independent confirmation of the conversion rather than a restatement of it.
 */
export const GRASS_BROAD: CyclesNoise = { scale: 1.9, detail: 8, roughness: 0.62 };
export const GRASS_MID: CyclesNoise = { scale: 6.8, detail: 8, roughness: 0.55 };
export const GRASS_FINE: CyclesNoise = { scale: 28.0, detail: 4, roughness: 0.5 };

/**
 * THE HUE-DRIFT SELECTOR, `build_land.py:857`: `hue_drift = _noise(nt, 2.7, 3.0, 0.4)`.
 *
 * ⚠⚠ THE TRAP THE SCRIPT ALREADY PAID FOR, in its own words at `:856`: *"A Voronoi here delivers
 * visible CELLS, which at island scale read as continents rather than as ground. A slow noise
 * gives the same hue drift with no shape to it."* At 86.6 ground units this field turns over
 * about three times across an island — slow enough to have no readable shape, which is the
 * entire point. Anything with an edge here is the failure, not a stronger version of the effect.
 */
export const GRASS_DRIFT: CyclesNoise = { scale: 2.7, detail: 3, roughness: 0.4 };

/** The two float mixes that fold the three octaves into ONE scalar, `build_land.py:839-848`.
 *  `mA = mix(broad, mid, 0.42)` then `mB = mix(mA, fine, 0.20)` — Blender's Mix/FLOAT is
 *  `A + (B - A) * factor`, with `inputs[2]` the A side and `inputs[3]` the B side. */
export const GRASS_MIX_BROAD_MID = 0.42;
export const GRASS_MIX_INTO_FINE = 0.2;

/** One colour-ramp stop as `build_land.py` authors it: a position and a LINEAR RGB triple. */
export interface RampStop {
  at: number;
  linear: readonly [number, number, number];
}

/**
 * THE COOL GRASS RAMP, `build_land.py:850-852`.
 *
 * ⚠⚠ THIS IS THE PAIR THE DECOY DIFFERS ON. `mat_procedural()`'s `cool` opens `(0.30, (0.054,
 * 0.130, 0.054, 1.0))`; this one opens `(0.28, (0.052, 0.126, 0.052, 1.0))`. A session that
 * greps for `cool = _ramp` and takes the first hit gets the losing variant with no error and no
 * visible tell — the numbers are close enough that the picture would look plausible.
 */
export const GRASS_COOL: readonly RampStop[] = [
  { at: 0.28, linear: [0.052, 0.126, 0.052] },
  { at: 0.5, linear: [0.124, 0.258, 0.086] },
  { at: 0.74, linear: [0.268, 0.432, 0.14] },
];

/** THE WARM GRASS RAMP, `build_land.py:853-855`. */
export const GRASS_WARM: readonly RampStop[] = [
  { at: 0.28, linear: [0.095, 0.118, 0.04] },
  { at: 0.5, linear: [0.21, 0.248, 0.078] },
  { at: 0.74, linear: [0.362, 0.388, 0.144] },
];

/**
 * THE DRIFT RAMP'S TWO POSITIONS, `build_land.py:858`: `_ramp([(0.38, black), (0.62, white)])`.
 * The drift field is remapped across this span before it selects between the two grass ramps, so
 * most of the island sits at one end or the other and the blend happens in a band.
 */
export const GRASS_DRIFT_RAMP: readonly [number, number] = [0.38, 0.62];

/**
 * WHICH GROUND STATUSES WEAR THIS LAYER — ADR-0492 D1, and the ONE spelling of that gate.
 *
 * ⚠⚠ IT IS NOT A TRANSCRIPTION. Every other constant in this module is copied from
 * `mat_attribute()`; this one is a DELIVERY decision the recipe knows nothing about, and it is
 * here rather than in the canvas or the harness because BOTH of them need it and two copies of
 * a gate is how an instrument comes to measure a layer the map does not draw. The canvas turns
 * these names into ramp ROWS and the shader tests `vStatus` against them; the harness grasses
 * exactly these statuses' bases and leaves the rest alone. One list, two readers.
 *
 * ⚠ WHY ONLY `healthy`. The layer's admissible mix factor is a per-token property, not a
 * property of the layer: measured against the shipped ladder, `healthy` admits 0.406 while the
 * `building`/`proposed` yellow admits 0.0095, because at the ladder's darkest rungs a grassed
 * yellow walks into `healthy`'s green — an in-progress parcel reporting as signed off
 * (ADR-0392 D5 / ADR-0398 D7). Gating the layer to the green DISSOLVES that conflict rather than
 * trading against it: every other token renders exactly as it does today, flat and
 * colour-accurate, and no island's reported state changes. The 14 yellow islands are a DEPLOY
 * gate (ADR-0492 D3), not a debt this layer owes.
 *
 * ⚠ THE CEILINGS ARE PALETTE-DERIVED AND MOVE WHEN THE PALETTE DOES. They are a function of
 * `SHIPPED_GROUND_COLOUR` and the shadow ladder, so any token edit or any ladder rung added
 * re-opens both this gate and the factor below it. `harness/grass-status-reading.ts` re-derives
 * them; nothing here may be inherited from a table.
 */
export const GRASS_STATUS_GATE: readonly string[] = ['healthy'];

// ---------------------------------------------------------------- the field

/** The lattice spacing one Cycles noise delivers, in ground units. */
export function grassLattice(noise: CyclesNoise): number {
  return SHIPPED_ISLAND_SPAN / noise.scale;
}

/** ONE OCTAVE'S CONTRIBUTION: its amplitude and its lattice frequency — the same shape
 *  `land-grain.ts`'s `GrainTerm` carries, and deliberately the same arithmetic. */
export interface GrassTerm {
  amp: number;
  freq: number;
}

/** Octave `o`'s amplitude — the roughness compounded once per octave. */
export function grassOctaveAmplitude(noise: CyclesNoise, o: number): number {
  return noise.roughness ** o;
}

/** Octave `o`'s LATTICE FREQUENCY, in cycles per ground unit: the base lattice doubled once per
 *  octave. A multiply where this divides would size every field by the lattice squared and
 *  deliver regional variation under the grass's name — the mutant `land-grain.ts` names as the
 *  reason its own twin is a NAMED function rather than an expression in a callback. */
export function grassOctaveFrequency(noise: CyclesNoise, o: number): number {
  return 2 ** o / grassLattice(noise);
}

/** The octave terms for one Cycles noise — ONE derivation, shared by the field below and by the
 *  GLSL that evaluates the same field on a GPU. */
export function grassTerms(noise: CyclesNoise): readonly GrassTerm[] {
  return Array.from({ length: noise.detail }, (_, o) => ({
    amp: grassOctaveAmplitude(noise, o),
    freq: grassOctaveFrequency(noise, o),
  }));
}

/** The amplitude sum a field is normalised by, so its range does not move when the octave count
 *  or the roughness is retuned. */
export function grassAmplitudeSum(noise: CyclesNoise): number {
  return grassTerms(noise).reduce(addAmplitude, 0);
}

/** One step of {@link grassAmplitudeSum}'s fold. A named function rather than an inline arrow:
 *  `check:mutation-diff` cannot attribute a mutant inside a callback body to the test that kills
 *  it, and an unattributable mutant reds the rung from inside well-covered arithmetic. */
function addAmplitude(total: number, term: GrassTerm): number {
  return total + term.amp;
}

/**
 * One Cycles noise evaluated at a GROUND point, in [0, 1].
 *
 * The lattice octave itself is `land-grain.ts`'s — imported rather than re-implemented, because
 * two copies of a value-noise hash is precisely how a field and its shader stop being the same
 * field. What differs between the two modules is the SPACING and the OCTAVE LADDER, which is
 * what these constants are.
 */
export function grassNoiseField(noise: CyclesNoise, x: number, z: number): number {
  let sum = 0;
  for (const term of grassTerms(noise)) sum += term.amp * grainOctave(x * term.freq, z * term.freq);
  return sum / grassAmplitudeSum(noise);
}

/** Blender's Mix/FLOAT: `A + (B - A) * factor`. Named so the operand ORDER is a thing a test can
 *  hold — swapping A and B here delivers a plausible field with the octaves' weights inverted. */
export function cyclesMixFloat(a: number, b: number, factor: number): number {
  return a + (b - a) * factor;
}

/**
 * THE BASE SCALAR the two grass ramps are both driven by — `mB` at `build_land.py:844-848`.
 *
 * Three octaves folded by two float mixes, in that order. The fold is NOT commutative: mixing
 * the fine octave in first would give it 0.42 of the result instead of 0.20 and turn a broad
 * landform tint into a high-frequency one.
 */
export function grassScalar(x: number, z: number): number {
  const broad = grassNoiseField(GRASS_BROAD, x, z);
  const mid = grassNoiseField(GRASS_MID, x, z);
  const fine = grassNoiseField(GRASS_FINE, x, z);
  const mA = cyclesMixFloat(broad, mid, GRASS_MIX_BROAD_MID);
  return cyclesMixFloat(mA, fine, GRASS_MIX_INTO_FINE);
}

/** THE DRIFT SCALAR, remapped across {@link GRASS_DRIFT_RAMP} and clamped — 0 selects the cool
 *  ramp, 1 the warm one, and the band between is where the island's hue actually drifts. */
export function grassDrift(x: number, z: number): number {
  const [lo, hi] = GRASS_DRIFT_RAMP;
  const raw = grassNoiseField(GRASS_DRIFT, x, z);
  return clamp01((raw - lo) / (hi - lo));
}

/** Clamp to [0, 1]. A named function for the same attribution reason as {@link addAmplitude}:
 *  an inline `Math.min(Math.max(...))` comes back UNPROVEN from the mutation rung. */
export function clamp01(v: number): number {
  const floored = Math.max(0, v);
  return Math.min(1, floored);
}

// ---------------------------------------------------------------- the ramps

/** A LINEAR RGB triple, the space `build_land.py` authors colour-ramp stops in. */
export type LinearRgb = readonly [number, number, number];

/**
 * A piecewise-linear colour ramp evaluated in LINEAR space, as Blender evaluates it.
 *
 * ⚠ LINEAR, NOT SMOOTHSTEPPED — a DELIBERATE divergence from `land-grain.ts`, stated here
 * because a reader comparing the two modules will otherwise take one of them for a bug.
 * Blender's `ShaderNodeValToRGB` defaults to `interpolation = 'LINEAR'` and `_ramp` at
 * `build_land.py:663-672` never sets it, so every ramp in the script is piecewise linear.
 * `land-grain.ts` evaluates its own two-stop ramp with a smoothstep (`fade` / GLSL
 * `smoothstep`), a slightly different curve on the same stops. That module's choice is not this
 * module's to change — it was measured and crossed as it stands — but transcribing it HERE
 * would be copying a divergence rather than the source (ADR-0490 D1).
 *
 * The chained-clamped-mix form rather than a search for the bracketing pair, and it is the SAME
 * arithmetic the generated GLSL performs rather than a second spelling of it: for stops sorted
 * by position, folding `mix(acc, next, clamp((t - prev) / (next - prev)))` over the tail
 * reproduces the piecewise ramp exactly — before a segment its factor clamps to 0 and after it
 * to 1, so each segment contributes only inside its own span, and the ends are flat.
 */
export function rampLinear(stops: readonly RampStop[], t: number): LinearRgb {
  const first = stops[0];
  if (first === undefined) throw new Error('land-grass: a colour ramp with no stops');
  let acc: LinearRgb = first.linear;
  let prev = first.at;
  for (const stop of stops.slice(1)) {
    const f = clamp01((t - prev) / (stop.at - prev));
    acc = [
      acc[0] + (stop.linear[0] - acc[0]) * f,
      acc[1] + (stop.linear[1] - acc[1]) * f,
      acc[2] + (stop.linear[2] - acc[2]) * f,
    ];
    prev = stop.at;
  }
  return acc;
}

/**
 * THE GRASS COLOUR at a ground point, in LINEAR space — the cool and warm ramps at the base
 * scalar, selected between by the drift.
 *
 * ⚠ THE SELECTION IS A MIX AND NOT A BRANCH, `build_land.py:859-864`: the drift ramp's output
 * drives a Mix/RGBA node's Factor, so the band between 0.38 and 0.62 delivers a blend of the two
 * ramps rather than a hard boundary. A branch here would put a visible edge across the island,
 * which is the same failure the Voronoi trap describes by another route.
 */
export function grassLinearAt(x: number, z: number): LinearRgb {
  return grassLinearOf(grassScalar(x, z), grassDrift(x, z));
}

/**
 * THE SAME COLOUR FROM ITS TWO SCALARS DIRECTLY — the base scalar `t` and the remapped drift `d`.
 *
 * ⚠ IT EXISTS SO THE LAYER'S REACHABLE COLOUR SET IS A PROPERTY OF THE SCALARS' RANGE RATHER
 * THAN OF WHICH GROUND POINTS AN INSTRUMENT HAPPENED TO VISIT. `harness/grass-status-reading.ts`
 * has to enumerate every colour this layer can deliver in order to say whether the island still
 * reports its own state; routing that through {@link grassLinearAt} would make an exhaustive
 * answer depend on a sampling grid, which is the difference between a measurement and a survey.
 * It is the same argument `harness/grain-status-reading.ts` makes about `grainMixed` taking the
 * grain scalar rather than a ground coordinate.
 */
export function grassLinearOf(t: number, d: number): LinearRgb {
  const cool = rampLinear(GRASS_COOL, t);
  const warm = rampLinear(GRASS_WARM, t);
  return [
    cool[0] + (warm[0] - cool[0]) * d,
    cool[1] + (warm[1] - cool[1]) * d,
    cool[2] + (warm[2] - cool[2]) * d,
  ];
}

/** {@link grassLinearOf} as a delivered sRGB pixel. */
export function grassColourOf(t: number, d: number): Rgb255 {
  const [r, g, b] = grassLinearOf(t, d);
  return { r: linearToSrgb255(r), g: linearToSrgb255(g), b: linearToSrgb255(b) };
}

/**
 * THE GRASS COLOUR AS A DELIVERED sRGB PIXEL.
 *
 * ⚠⚠ THE CONVERSION IS LOAD-BEARING AND IT IS THE EASIEST THING HERE TO GET WRONG — the same
 * trap `land-grain.ts` records for its own two stops. `build_land.py` writes ramp stops as
 * Blender RGBA, which is LINEAR. Our pipeline is the exact opposite by design:
 * `configureExactColour` disables colour management outright so an authored sRGB token arrives
 * at the framebuffer unmodified. Dropping the linear numbers into a shader would deliver a grass
 * roughly 2.5x too dark at the dark stops and read as mud, while looking like an amplitude
 * mistake.
 *
 * ⚠ AND THE RAMP IS INTERPOLATED IN LINEAR, THEN CONVERTED — not converted stop-by-stop and
 * interpolated in sRGB, which is the cheaper shortcut and a different arithmetic. On these stops
 * the two disagree by about 2.5/255 mid-segment: below the 20/255 visibility threshold this arc
 * judges by (ADR-0490 D6), and transcribed the faithful way anyway, because a divergence
 * introduced for convenience is one every later comparison has to carry an argument about.
 */
export function grassColourAt(x: number, z: number): Rgb255 {
  return grassColourOf(grassScalar(x, z), grassDrift(x, z));
}

/**
 * THE DELIVERED GROUND PIXEL under this layer: the parcel's authored status colour with the
 * grass mixed into it at `fac`.
 *
 * The pure twin of the shader's `mix(c, grassCol, uGrassMix)`, so a test can state what the
 * layer delivers for a given status without a GPU — which is what
 * `harness/grass-status-reading.ts` needs in order to answer whether the island still reports.
 */
export function grassMixedAt(base: string, x: number, z: number, fac: number): Rgb255 {
  const b = parseHex(base);
  const g = grassColourAt(x, z);
  return {
    r: Math.round(b.r + (g.r - b.r) * fac),
    g: Math.round(b.g + (g.g - b.g) * fac),
    b: Math.round(b.b + (g.b - b.b) * fac),
  };
}

// ---------------------------------------------------------------- the GLSL

/** A linear triple as a GLSL literal. The ramp stops are AUTHORED constants, so they are written
 *  into the source rather than uploaded — the argument `bandGlsl` and `grainGlsl` both make. */
function glslLinear(c: LinearRgb): string {
  return `vec3(${c[0].toFixed(6)}, ${c[1].toFixed(6)}, ${c[2].toFixed(6)})`;
}

/** The GLSL body of one Cycles noise: the octaves UNROLLED at generation time, because the
 *  octave count is a TypeScript constant and GLSL ES 1.0 wants constant loop bounds. Generating
 *  the unroll is also what stops the shader and this module disagreeing about how many octaves
 *  there are.
 *
 *  ⚠ EXPORTED for the reason {@link rampGlsl} gives: an emitter is all string literals, and only
 *  an exact golden distinguishes a blanked line from a present one. */
export function noiseGlsl(name: string, noise: CyclesNoise): string[] {
  const octaves = grassTerms(noise).map(
    (term) => `  s += ${term.amp.toFixed(6)} * st_grainOctave(p * ${term.freq.toFixed(6)});`,
  );
  return [
    `// ${name}: Cycles scale ${noise.scale} -> ${grassLattice(noise).toFixed(2)} ground units,`,
    `// ${noise.detail} octaves, roughness ${noise.roughness}.`,
    `float ${name}(vec2 p) {`,
    '  float s = 0.0;',
    ...octaves,
    `  return s / ${grassAmplitudeSum(noise).toFixed(6)};`,
    '}',
  ];
}

/** The GLSL for one piecewise-linear colour ramp — the chained-clamped-mix form, which is the
 *  same fold {@link rampLinear} performs rather than a second spelling of it.
 *
 *  ⚠ EXPORTED SO IT CAN BE HELD TO AN EXACT GOLDEN, which is a `check:mutation-diff` finding
 *  rather than a preference: every line of an emitter is a string literal, and a mutant that
 *  blanks one produces a shader that still contains all the CONSTANTS a `includes()` test looks
 *  for. Only asserting the emitted text exactly can see the difference. */
export function rampGlsl(name: string, stops: readonly RampStop[]): string[] {
  const first = stops[0];
  if (first === undefined) throw new Error('land-grass: a colour ramp with no stops');
  const body: string[] = [
    `  float ${name}_f;`,
    `  vec3 ${name}_c = ${glslLinear(first.linear)};`,
  ];
  let prev = first.at;
  for (const stop of stops.slice(1)) {
    const span = stop.at - prev;
    body.push(
      `  ${name}_f = clamp((t - ${prev.toFixed(6)}) / ${span.toFixed(6)}, 0.0, 1.0);`,
      `  ${name}_c = mix(${name}_c, ${glslLinear(stop.linear)}, ${name}_f);`,
    );
    prev = stop.at;
  }
  // ONE ARRAY ELEMENT PER LINE, rather than the body joined into a single element. The GLSL is
  // identical, and it is what lets `land-grass.test.ts` hold this emitter to an exact golden a
  // reader can check by eye — the only kind of assertion that can see a BLANKED literal.
  // `check:mutation-diff` emptied forty string literals in this file one at a time and every
  // containment test stayed green, because a shader missing a line still contains the constants.
  return [`vec3 ${name}(float t) {`, ...body, `  return ${name}_c;`, '}'];
}

/**
 * GLSL source for the grass layer, with every authored constant written in from this module.
 *
 * ⚠⚠ IT DEPENDS ON `st_grainOctave`, WHICH `grainGlsl()` DECLARES, and that dependency is
 * enforced rather than remembered: `createBandedGroundMaterial` REFUSES a `grass` option without
 * a `grain` one. The alternative — emitting a second copy of the lattice hash under a grass name
 * — would put two spellings of one field in one shader, and a GLSL redefinition error is the
 * BEST case of that; the worse one is the two quietly diverging when someone retunes the hash.
 *
 * ⚠ THE LINEAR->sRGB TRANSFER RUNS PER FRAGMENT, and it is the whole reason the ramp can be
 * interpolated faithfully. It is the piecewise standard, matching {@link linearToSrgb255}
 * exactly, and its knee branch is written with `step` rather than an `if` so the two channels
 * either side of the knee cost the same.
 */
export function grassGlsl(): string {
  return [
    '// GENERATED from land-grass.ts — do not hand-edit these constants.',
    '// Layer 1 of the approved ground: build_land.py:836-868, mat_attribute().',
    ...noiseGlsl('st_grassBroad', GRASS_BROAD),
    '',
    ...noiseGlsl('st_grassMid', GRASS_MID),
    '',
    ...noiseGlsl('st_grassFine', GRASS_FINE),
    '',
    ...noiseGlsl('st_grassDrift', GRASS_DRIFT),
    '',
    '// The base scalar: three octaves folded by two Blender Mix/FLOAT nodes, in order.',
    'float st_grassScalar(vec2 p) {',
    `  float mA = mix(st_grassBroad(p), st_grassMid(p), ${GRASS_MIX_BROAD_MID.toFixed(6)});`,
    `  return mix(mA, st_grassFine(p), ${GRASS_MIX_INTO_FINE.toFixed(6)});`,
    '}',
    '',
    ...rampGlsl('st_grassCool', GRASS_COOL),
    '',
    ...rampGlsl('st_grassWarm', GRASS_WARM),
    '',
    '// Linear -> sRGB, the standard piecewise transfer, per channel. Branchless so the knee',
    '// costs the same as the body — and so it matches linearToSrgb255 for every channel value',
    '// rather than for the ones a test happened to probe.',
    'vec3 st_grassSrgb(vec3 c) {',
    '  vec3 lo = c * 12.92;',
    '  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;',
    '  return mix(lo, hi, step(vec3(0.0031308), c));',
    '}',
    '',
    '// THE GRASS COLOUR at a ground point, as a delivered sRGB triple in 0..1.',
    'vec3 st_grassColour(vec2 p) {',
    '  float t = st_grassScalar(p);',
    `  float d = clamp((st_grassDrift(p) - ${GRASS_DRIFT_RAMP[0].toFixed(6)}) / ${(
      GRASS_DRIFT_RAMP[1] - GRASS_DRIFT_RAMP[0]
    ).toFixed(6)}, 0.0, 1.0);`,
    '  vec3 lin = mix(st_grassCool(t), st_grassWarm(t), d);',
    '  return st_grassSrgb(lin);',
    '}',
  ].join('\n');
}

/**
 * HOW MANY LATTICE-NOISE OCTAVES THIS LAYER EVALUATES PER FRAGMENT — the number the frame-cost
 * question is asked about, derived rather than counted by hand.
 *
 * ⚠ IT IS THE ARC'S NAMED RISK. ADR-0490's stated cost is that the approved material evaluates
 * several noise octaves per fragment and that "nothing here argues the full stack is affordable".
 * The shipped ground today evaluates the grain's two octaves, five times over (the field plus
 * four gradient taps); this layer adds {@link GRASS_OCTAVES} more, each of which is four hash
 * evaluations. A layer that cannot be afforded is a NAMED gap, not a quiet omission — so the
 * count is exposed as a value the evidence sheet reads rather than a fact someone recomputes.
 */
export const GRASS_OCTAVES =
  GRASS_BROAD.detail + GRASS_MID.detail + GRASS_FINE.detail + GRASS_DRIFT.detail;
