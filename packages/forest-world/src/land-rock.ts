// land-rock.ts — LAYER 4 OF THE APPROVED GROUND: rock on anything steep, transcribed from
// `docs/research/chapter2-land-idiom-2026-08-27/build_land.py:912-925`.
//
// Pure, browser-free and node-provable — the same shape `land-sand.ts` and `land-wear.ts` take,
// and for the same reason: the constants are authored once in TypeScript and the GLSL that
// evaluates them on a GPU is GENERATED from them, so a shader and a test cannot hold private
// copies of the numbers that decide the look.
//
// ⚠⚠ THE SOURCE IS `mat_attribute()`, AND THE FILE CONTAINS A DECOY. `mat_procedural()` at
// `:697-754` opens with a byte-identical first line and carries different constants from a
// REJECTED variant. It has NO rock layer at all, so landing on it delivers an omission rather
// than a wrong number. Every constant below is anchored on the ENCLOSING FUNCTION NAME, never on
// a grep hit, and `land-rock.test.ts` pins the anchor plus the decoy's absence of the block.
//
// ⚠⚠ THE MASK IS DRIVEN BY THE SURFACE'S OWN NORMAL, NOT BY A NOISE — the recipe's own comment
// at `:912`: "rock on anything steep: the surface's own normal, not another noise". Cycles reads
// `Geometry.Normal`, separates Z (up), and runs it through a ramp that is WHITE at 0.72 and BLACK
// at 0.90: a face whose up-component is at or below 0.72 is full rock, one at or above 0.90 wears
// none, and the band between blends.
//
// ⚠⚠ THE MEASURED FACT THE INTEGRATING SESSION ACTS ON: on the shipped mesh the interior's
// up-component NEVER DROPS BELOW 0.91. The relief's steepest slope at the shipped amplitude is
// 0.4546 (`peakSlopeAt(LAND_RELIEF_AMPLITUDE)`, `land-shadow.ts`), and a slope of 0.4546 is an
// up-component of 1 / sqrt(1 + 0.4546²) = 0.910 — ABOVE the recipe's 0.90 ceiling. So at the
// transcribed ends the mask is identically zero across the interior, and the recipe bites only on
// the beach's ring chain, whose authored fall is the one place the land is steep. That is not a
// reason to move the constants here: the ramp ends are OPTIONS on the material (a ladder the
// owner chooses from, ADR-0503), and 0.72 / 0.90 are the provenance those rungs are stated
// against. `interiorMinimumUp()` below states the fact as a value a test holds rather than a
// number in prose.
//
// ⚠⚠ THE MATERIAL USED TO DEPART HERE, AND THAT DEPARTURE IS WITHDRAWN (ADR-0553, 2026-09-08).
// Cycles' `Geometry.Normal` is the UNBUMPED surface normal, evaluated before the normal map and
// the bump; the material fed the mask the BUMPED one instead, so the mask asked "did a texel of a
// 128-texel cliff map tilt this fragment" rather than "is this ground steep". That is what put
// grey across the interior grass, and it is why the measured fact above did not deliver the
// picture it promised: the interior IS flat enough — the bump made it steep anyway. Measured on
// the shipped constants, over an interior grid: on the geometry the mask is 0 everywhere; with
// the grain's bump alone it is non-zero on 6.2% of samples, reaching an up-component of 0.758.
// The detail map at `SHIPPED_DETAIL_STRENGTH` is applied first and adds more.
// `land-rock.test.ts` holds both numbers. `rockMask` itself is the recipe's arithmetic on
// whatever up-component it is handed.

import {
  grassScalar,
  rampLinear,
  type LinearRgb,
  type RampStop,
  clamp01,
  rampGlsl,
} from './land-grass.js';
import { linearToSrgb255 } from './land-grain.js';
import { LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { peakSlopeAt } from './land-shadow.js';
import type { Rgb255 } from './shade-ladder.js';

/**
 * THE SLOPE RAMP'S TWO ENDS, `build_land.py:917`: `_ramp([(0.72, white), (0.90, black)])`, on the
 * normal's UP component. At or below 0.72 the face is full rock; at or above 0.90 it wears none.
 *
 * ⚠ THE RAMP FALLS, so the mask is `(hi - ny) / (hi - lo)` rather than the rising form every other
 * ramp in this stack takes. Reading it as rising delivers rock on the FLATS and grass on the
 * cliffs, which still looks like a material — just the wrong way up.
 */
export const ROCK_SLOPE_RAMP: readonly [number, number] = [0.72, 0.9];

/**
 * THE ROCK COLOUR RAMP, `build_land.py:918-919`. Linear RGB, like every stop in the script.
 *
 * ⚠ DRIVEN BY LAYER 1'S OWN BASE SCALAR (`mB` at `:920`), like the sand and the dirt — so the
 * rock grains with the field the grass does. It is the GREYEST family in the stack: its channel
 * spread is about half the dirt's, which is what separates a rock face from a worn path where the
 * two meet.
 */
export const ROCK_RAMP: readonly RampStop[] = [
  { at: 0.35, linear: [0.14, 0.125, 0.105] },
  { at: 0.7, linear: [0.33, 0.3, 0.255] },
];

/** The up-component of a unit normal on a surface of the given slope (rise over run):
 *  `1 / sqrt(1 + slope²)`. Named so the interior fact below is arithmetic a test can hold. */
export function upComponentOfSlope(slope: number): number {
  return 1 / Math.sqrt(1 + slope * slope);
}

/** THE SMALLEST UP-COMPONENT THE SHIPPED INTERIOR REACHES — derived from the relief's own peak
 *  slope at the shipped amplitude, never typed. At 2.2 it is 0.910, above the recipe's 0.90
 *  ceiling: the transcribed ends bite nowhere in the interior. */
export function interiorMinimumUp(): number {
  return upComponentOfSlope(peakSlopeAt(LAND_RELIEF_AMPLITUDE));
}

/**
 * THE ROCK MASK from a normal's up-component: 1 is full rock, 0 is none.
 *
 * `build_land.py:917` as arithmetic — the falling ramp, clamped. The ends are parameters so the
 * material's ladder and this twin share one expression.
 */
export function rockMask(
  ny: number,
  lo: number = ROCK_SLOPE_RAMP[0],
  hi: number = ROCK_SLOPE_RAMP[1],
): number {
  return clamp01((hi - ny) / (hi - lo));
}

/** The rock colour in LINEAR space at a given base scalar — the ramp evaluated the way Blender
 *  evaluates it, piecewise linear (`_ramp` never sets `interpolation`, whose default is LINEAR). */
export function rockLinearOf(t: number): LinearRgb {
  return rampLinear(ROCK_RAMP, t);
}

/** {@link rockLinearOf} as a delivered sRGB pixel. */
export function rockColourOf(t: number): Rgb255 {
  const [r, g, b] = rockLinearOf(t);
  return { r: linearToSrgb255(r), g: linearToSrgb255(g), b: linearToSrgb255(b) };
}

/** The rock colour at a ground point — the ramp driven by layer 1's own base scalar. */
export function rockColourAt(x: number, z: number): Rgb255 {
  return rockColourOf(grassScalar(x, z));
}

// ---------------------------------------------------------------- the GLSL

/**
 * GLSL source for the rock layer, with the authored colour stops written in from this module.
 *
 * ⚠⚠ IT DEPENDS ON `st_grassScalar` AND `st_grassSrgb`, which `grassGlsl()` declares — the rock
 * ramp is driven by layer 1's base scalar. The material REFUSES a `rock` option without a `grass`
 * one for that reason. It adds NO noise octave of its own: the mask is the normal, which the
 * shader already holds.
 *
 * ⚠⚠ THE RAMP ENDS ARE PARAMETERS, NOT WRITTEN IN AND NOT A UNIFORM THIS BLOCK READS. This
 * source is spliced ABOVE the shader's uniform declarations, so a `uRockLo` in here is used
 * before it is declared and the material fails to compile on a real GPU — a failure no text
 * assertion sees. The material passes its two ends at the call site in `main()`, which is also
 * what lets a page comparing rungs of the ladder vary two numbers on ONE compiled shader.
 */
export function rockGlsl(): string {
  return [
    '// GENERATED from land-rock.ts — do not hand-edit these constants.',
    '// Layer 4 of the approved ground: build_land.py:912-925, mat_attribute().',
    ...rampGlsl('st_rockRamp', ROCK_RAMP),
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
  ].join('\n');
}
