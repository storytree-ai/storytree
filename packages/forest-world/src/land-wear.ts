// land-wear.ts — LAYER 3 OF THE APPROVED GROUND: the worn path, transcribed from
// `docs/research/chapter2-land-idiom-2026-08-27/build_land.py:894-911` (the colour, in
// `mat_attribute()`) and `:489-496` (the wear SCALAR the colour is driven by, in `build_land_grid()`).
//
// Pure, browser-free and node-provable — the same shape `land-sand.ts` takes, and for the same
// reason: the constants are authored once in TypeScript and the GLSL that evaluates them on a GPU
// is GENERATED from them, so a shader and a test cannot hold private copies of the numbers that
// decide the look.
//
// ⚠⚠ THE SOURCE IS `mat_attribute()`, AND THE FILE CONTAINS A DECOY. `mat_procedural()` at
// `:697-754` opens with a byte-identical first line and carries different constants from a
// REJECTED variant. It has NO path layer at all — so a transcription that lands on the decoy does
// not get wrong numbers here, it gets NOTHING and looks like an omission. Every constant below is
// anchored on the ENCLOSING FUNCTION NAME, never on a grep hit, and `land-wear.test.ts` pins the
// anchor the same way `land-sand.test.ts` does, plus the decoy's ABSENCE of the block.
//
// ⚠⚠ THE WEAR VALUE ARRIVES AS A GROUND-SPACE TEXTURE, NOT A VERTEX ATTRIBUTE — the same seam the
// sand's shore distance crosses (ADR-0490 D4, `shore-atlas.ts`). In Blender `wear` is a per-vertex
// attribute written by `build_land_grid()` from a distance field to the path polyline; here the
// material samples a field texture for the DISTANCE and this module turns it into the recipe's
// wear scalar (`wearOf`) before the colour arithmetic runs. The field itself is the integrating
// session's to build; this module only states what it must deliver and what is done with it.
//
// ⚠⚠ WHAT THE COLOUR LAYER DOES NOT DELIVER — two things the recipe does with the same scalar,
// named here so their absence is a known gap rather than a quiet one:
//   1. THE GEOMETRY DIP. `build_land.py:496` lowers the mesh under the path, `z -= 0.30 * wear`,
//      with the comment "a path is worn DOWN, not painted on". This module paints it on. The dip
//      is a vertex-displacement concern on `land-relief.ts`'s side of the seam, not a fragment
//      colour, and it is not transcribed here.
//   2. THE PROP-EXCLUSION MASK. `build_land.py:1046` (`scatter()`) refuses to place a prop where
//      `wear >= 0.30`, which is what keeps the path CLEAR — a painted path with a tree standing on
//      it reads as a mistake, not a track. Prop placement lives in `map-dressing.ts`; this module
//      does not reach it.
//
// ⚠ WHAT THIS LAYER IS FOR. The approved render has a worn track through the grass: a warm dark
// brown, its edge broken by noise so it reads as trodden ground rather than as a painted line. It
// is the third of the six absent colour families the arc's family-count gap is made of, and the
// recipe's own note at `:489-493` prices its width — 5.5 units of falloff delivered "a trunk road
// cutting the island in half"; 3.0 is what a worn track through open ground wants.

import {
  SHIPPED_ISLAND_SPAN,
  grassScalar,
  rampLinear,
  type CyclesNoise,
  type LinearRgb,
  type RampStop,
  clamp01,
  grassNoiseField,
  noiseGlsl,
  rampGlsl,
} from './land-grass.js';
import { LAND_SCALE } from './land-per-capability.js';
import { linearToSrgb255 } from './land-grain.js';
import type { Rgb255 } from './shade-ladder.js';

/**
 * THE FALLOFF, `build_land.py:494`: `wear = np.clip(1.0 - pdist / 3.0, 0.0, 1.0)` — the distance
 * from the path centreline, in ground units, at which wear reaches 0. It is also the WIDTH the
 * distance field must carry: a field capped short of it delivers a path that stops and then
 * steps, exactly the failure `land-sand.ts` names for a shore field narrower than its beach.
 *
 * ⚠ THE RECIPE'S OWN PRICING IS IN ITS COMMENT AT `:489-493`: 5.5 units read as "a trunk road
 * cutting the island in half"; a worn track through open ground wants roughly half that. The
 * material takes the width as an OPTION (a ladder the owner chooses from, ADR-0503); this is the
 * transcribed provenance those rungs are stated against.
 */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const WEAR_FALLOFF = 3.0 * LAND_SCALE;

/**
 * THE BREAK NOISE, `build_land.py:900`: `_noise(nt, 9.0, 5.0)` — roughness defaults to 0.5.
 *
 * ⚠⚠ IT MULTIPLIES THE WEAR, IT DOES NOT DISPLACE IT (`wear_break.operation = "MULTIPLY"` at
 * `:898`). This is the OPPOSITE of the sand's edge noise, whose MULTIPLY_ADD is pinned to an add.
 * Under a multiply the noise can only ever REMOVE path: where it is near zero the track breaks
 * up, and where the wear itself is zero no amount of noise can paint one — which is what keeps
 * the path where the polyline put it. Written as an add it would scatter dirt across the whole
 * island wherever the noise alone cleared the ramp's foot.
 *
 * At 233.8 / 9 = 26.0 ground units it is coarser than the sand's edge noise and much coarser than
 * the grain, so the breaks read as gaps in a track rather than as texture on it.
 */
export const WEAR_BREAK: CyclesNoise = { scale: 9, detail: 5, roughness: 0.5 };

/**
 * THE WEAR RAMP, `build_land.py:901`: `_ramp([(0.24, black), (0.55, white)])`.
 *
 * Its output is the MIX FACTOR: Blender's Mix/RGBA at `:906-910` wires the sand-blended ground
 * into input A and the dirt into input B, so 0 delivers the ground and 1 delivers DIRT. The ramp
 * rises with wear — the same sense as the scalar, unlike the sand band, whose factor rises going
 * AWAY from what it paints.
 */
export const WEAR_RAMP: readonly [number, number] = [0.24, 0.55];

/**
 * THE DIRT COLOUR RAMP, `build_land.py:903-904`. Linear RGB, like every stop in the script.
 *
 * ⚠ DRIVEN BY LAYER 1'S OWN BASE SCALAR (`mB` at `:905`), not by a noise of its own — the same
 * choice the sand makes, and for the same reason: the path grains with exactly the field the
 * grass does, so it reads as the same ground worn bare rather than as a decal laid over it.
 *
 * Both stops sit BELOW the sand's dark stop (0.395, 0.350, 0.252): a path is darker than a
 * beach, which is what lets the two families stay distinct where the track reaches the water.
 */
export const DIRT_RAMP: readonly RampStop[] = [
  { at: 0.35, linear: [0.165, 0.128, 0.088] },
  { at: 0.7, linear: [0.322, 0.262, 0.182] },
];

/** How many lattice-noise octaves this layer adds per ground fragment, over layers 1 and 2 — the
 *  number the frame-cost question is asked about, derived rather than counted by hand. */
export const WEAR_OCTAVES = WEAR_BREAK.detail;

/** The lattice spacing the break noise delivers, in ground units — the same conversion
 *  `land-grass.ts` makes, through the island's 233.8-unit span. */
export function wearBreakLattice(): number {
  return SHIPPED_ISLAND_SPAN / WEAR_BREAK.scale;
}

/**
 * THE WEAR SCALAR at a distance from the path centreline — `build_land.py:494-495`:
 *
 *   wear = np.clip(1.0 - pdist / 3.0, 0.0, 1.0)
 *   wear = wear * wear * (3 - 2 * wear)
 *
 * 1 on the centreline, 0 at the falloff and beyond, a smoothstep between: the clip is a linear
 * ramp and the second line is the Hermite `3w² - 2w³`, so the path has no hard shoulder. The
 * falloff is a parameter so the material's width option and this twin share one arithmetic.
 */
export function wearOf(distance: number, falloff: number = WEAR_FALLOFF): number {
  const w = clamp01(1 - distance / falloff);
  return w * w * (3 - 2 * w);
}

/**
 * THE MIX FACTOR at a ground point: 0 is the ground beneath, 1 is pure dirt.
 *
 * `build_land.py:897-902` — the wear scalar MULTIPLIED by the break noise, through the wear ramp.
 * The noise multiplies rather than displaces (see {@link WEAR_BREAK}), so `wear = 0` delivers 0
 * at every point regardless of the noise, and the factor at a fixed point scales with the wear
 * rather than shifting with it.
 */
export function wearFactor(wear: number, x: number, z: number): number {
  const t = wear * grassNoiseField(WEAR_BREAK, x, z);
  const [lo, hi] = WEAR_RAMP;
  return clamp01((t - lo) / (hi - lo));
}

/** The dirt colour in LINEAR space at a given base scalar — the ramp evaluated the way Blender
 *  evaluates it, piecewise linear (`_ramp` never sets `interpolation`, whose default is LINEAR). */
export function dirtLinearOf(t: number): LinearRgb {
  return rampLinear(DIRT_RAMP, t);
}

/** {@link dirtLinearOf} as a delivered sRGB pixel. */
export function dirtColourOf(t: number): Rgb255 {
  const [r, g, b] = dirtLinearOf(t);
  return { r: linearToSrgb255(r), g: linearToSrgb255(g), b: linearToSrgb255(b) };
}

/** The dirt colour at a ground point — the ramp driven by layer 1's own base scalar. */
export function dirtColourAt(x: number, z: number): Rgb255 {
  return dirtColourOf(grassScalar(x, z));
}

// ---------------------------------------------------------------- the GLSL

/**
 * GLSL source for the worn-path layer, with every authored constant written in from this module.
 *
 * ⚠⚠ IT DEPENDS ON `st_grassScalar`, `st_grassSrgb` AND `st_grainOctave`, which `grassGlsl()` and
 * `grainGlsl()` declare — the dirt ramp is driven by layer 1's base scalar and the break noise
 * reuses the one lattice hash. The material REFUSES a `wear` option without a `grass` one for the
 * reason it already refuses sand without grass: a second copy of a field under a third name is a
 * GLSL redefinition error at best and a silent divergence at worst.
 *
 * ⚠⚠ IT READS NO UNIFORM. This block is spliced ABOVE the shader's uniform declarations, so a
 * `uWearWidth` referenced in here is used before it is declared — GLSL ES 1.0 rejects it and the
 * material fails to compile on a real GPU, which no text assertion can see. The falloff and the
 * wear are PARAMETERS: the material samples the field in `main()`, decodes it to ground units,
 * and passes scalars in, exactly as `st_sandBand(vec2 p, float shore, float width)` takes its
 * width. That is also what keeps a page comparing path widths on ONE compiled shader.
 */
export function wearGlsl(): string {
  return [
    '// GENERATED from land-wear.ts — do not hand-edit these constants.',
    '// Layer 3 of the approved ground: build_land.py:894-911, mat_attribute();',
    '// the wear scalar is build_land.py:494-495, build_land_grid().',
    ...noiseGlsl('st_wearBreak', WEAR_BREAK),
    '',
    ...rampGlsl('st_dirtRamp', DIRT_RAMP),
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
    `  return clamp((t - ${WEAR_RAMP[0].toFixed(6)}) / ${(WEAR_RAMP[1] - WEAR_RAMP[0]).toFixed(
      6,
    )}, 0.0, 1.0);`,
    '}',
    '',
    '// THE DIRT COLOUR as a delivered sRGB triple in 0..1 — the ramp driven by LAYER 1`s own base',
    '// scalar, so the path grains with the same field the grass does.',
    'vec3 st_dirtColour(vec2 p) {',
    '  return st_grassSrgb(st_dirtRamp(st_grassScalar(p)));',
    '}',
  ].join('\n');
}
