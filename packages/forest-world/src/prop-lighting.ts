// prop-lighting.ts — HOW MUCH OF A BOUGHT PROP'S LIGHT IS AMBIENT, decoupled from the ground's
// ladder without touching the lights the ground is calibrated against.
//
// WHY A PROP NEEDS ITS OWN SPLIT. `CalibratedLights` (`ForestWorldCanvas.tsx`) derives the scene's
// two lights from the ground's shade ladder — ambient at the ladder's FLOOR, the key at
// `top − floor` (`light-calibration.ts`), so a lit white face lands on the top rung and an unlit
// one on the floor. That is the ground's closure and it is correct for the ground. It also hands
// every bought object the same 80:20 ambient-to-key split (the nine-rung ladder's floor is 0.80),
// so a pine crown's unlit side sits at 80% of its lit side and everything Cycles gave the approved
// render — soft self-shadowing, the dark between branches, a sun over a dim sky — has 20% of the
// range to happen in. The owner read the result as "the trees dont seem to have as much detail as
// our target image" (2026-09-03).
//
// WHAT THIS DOES INSTEAD. The prop's MATERIAL rescales what it received from the ambient term and
// from the directional term, in its own fragment shader, so that:
//
//   lit white face   = floor × indirect + (top − floor) × direct = top      (the calibration's
//                                                                            invariant, KEPT)
//   unlit white face = floor × indirect                          = fraction (what moves)
//
// `fraction` is the share of a lit face's light that reaches an unlit one — the ladder floor
// reproduces today's picture byte for byte; lower is a bolder, more sculpted crown. The
// ground's lights, its ladder and every committed figure about the ground are untouched: the
// scene lights never change, only how the PROP's material weighs the two terms it was given.
//
// ⚠ IT IS A PROPERTY OF THE MATERIAL, NOT OF THE LIGHTS. `three` copies neither `onBeforeCompile`
// nor a program cache key on `Material.clone()`, so a tinted clone of a leaf material must be
// re-installed (`kit-mesh.ts` does) or a tinted capability's pine would be lit differently from
// an untinted one beside it — the one thing a state-carrying crown may never be.
//
// ⚠ THE SEAM IS `#include <lights_fragment_end>`: by then three has accumulated the ambient
// irradiance into `reflectedLight.indirectDiffuse` and every direct light into `directDiffuse`
// (`lights_fragment_begin` / `lights_fragment_end`), and nothing has summed them yet — the sum is
// in `opaque_fragment`. `prop-lighting.test.ts` holds that the anchor exists in three's own
// standard fragment shader, so a three upgrade that moves the seam reds a test rather than
// silently lighting every prop flat again.

import type * as THREE from 'three';

import { ladderEnds, type LadderEnds } from './light-calibration.js';
import { SHADE_LEVELS } from './shade-ladder.js';

/**
 * THE SPLIT EVERY PROP WORE UNTIL THIS MODULE EXISTED — the ground ladder's floor, read off the
 * ladder rather than transcribed, because a transcription is exactly what a nine-rung re-ladder
 * silently invalidates (`moving-a-ladder-splits-its-consumers-in-two`).
 *
 * ⚠ IT IS THE IDENTITY BY CONSTRUCTION: at the floor both scales are exactly 1 and the shader
 * multiplies by one, so a map lit here draws what it drew before this module existed.
 */
export const PROP_INDIRECT_FRACTION_FLOOR: number = ladderEnds(SHADE_LEVELS).floor;

/**
 * THE LADDER RENDERED FOR THE OWNER on `harness/shipped-detail.html` (ADR-0503 D3): the ladder
 * floor, which is today's picture, then three bolder rungs. Composed into one sheet under
 * `docs/research/chapter2-tree-detail-2026-09-04/`.
 */
export const PROP_INDIRECT_FRACTION_RUNGS: readonly number[] = [PROP_INDIRECT_FRACTION_FLOOR, 0.6, 0.45, 0.3];

/**
 * THE SHIPPED SPLIT — the share of a lit face's light an unlit face of a bought prop receives.
 *
 * THE LADDER, rendered on the RTX 2060 on 2026-09-04 (one island at 8 px/unit, the native kit
 * on every rung; `docs/research/chapter2-tree-detail-2026-09-04/`):
 *
 *   unlit face   prop luma p10/p50/p90   spread   MICRO   px moved >20/255 vs today
 *   0.80 (today)      73 / 81 / 88          15     1.86         —
 *   0.60              64 / 79 / 87          23     2.12      1,810
 *   0.45              58 / 78 / 88          30     2.35     13,275
 *   0.30              51 / 76 / 88          37     2.61     28,781      ← SHIPPED
 *   the approved render                            2.54
 *
 * The native texture rung alone (ADR-0508 D1) moved 103 pixels and left the luma distribution
 * exactly where it was — the "detail" the owner missed is the lighting, not the texels. 0.30 is
 * the boldest rung rendered and the one whose crowns read like the reference's (dark cores, lit
 * tips); the fitted forest still opens on clean green blocks (largest colour family 7.7% on every
 * rung, `sheet-forest-fit.png`). Chosen under ADR-0503 D1/D3: apply it boldly, show the picture,
 * let "scale it back" move this ONE constant along rungs already rendered — 0.45 and 0.60 are on
 * the sheet, and no re-measurement is needed to take either.
 */
export const KIT_PROP_INDIRECT_FRACTION: number = 0.3;

/** How the material rescales the two terms it received from the calibrated lights. */
export interface PropLightingScales {
  /** Multiplies what the AMBIENT light delivered. */
  indirect: number;
  /** Multiplies what the DIRECTIONAL light delivered. */
  direct: number;
}

/**
 * The two scales for a fraction, against the ladder the lights were calibrated to.
 *
 * ⚠ REFUSES a fraction outside (0, 1): at 0 an unlit face is black and at 1 the key light is
 * multiplied by zero, and neither is a crown the vocabulary can read a state off. A ladder whose
 * top does not exceed its floor cannot say what "lit" means and is refused for the same reason
 * `calibrationFrom` refuses a probe of zero.
 */
export function propLightingScales(
  fraction: number,
  ends: LadderEnds = ladderEnds(SHADE_LEVELS),
): PropLightingScales {
  if (!(fraction > 0 && fraction < 1)) {
    throw new Error(
      `prop-lighting: the ambient fraction must sit strictly inside (0, 1); ${fraction} is not a ` +
        'split between two lights',
    );
  }
  const range = ends.target - ends.floor;
  if (!(ends.floor > 0) || !(range > 0)) {
    throw new Error(
      `prop-lighting: a ladder from ${ends.floor} to ${ends.target} has no lit/unlit range to split`,
    );
  }
  return { indirect: fraction / ends.floor, direct: (1 - fraction) / range };
}

/** Where the uniforms are DECLARED — the first chunk every three fragment shader includes. */
export const PROP_LIGHTING_DECLARATION_ANCHOR = '#include <common>';

/** Where the terms are RESCALED — after every light has been accumulated and before the sum. */
export const PROP_LIGHTING_ANCHOR = '#include <lights_fragment_end>';

export const PROP_LIGHTING_UNIFORM_INDIRECT = 'uPropIndirectScale';
export const PROP_LIGHTING_UNIFORM_DIRECT = 'uPropDirectScale';

/** The declaration that follows {@link PROP_LIGHTING_DECLARATION_ANCHOR}. */
export const PROP_LIGHTING_DECLARATION_GLSL =
  `uniform float ${PROP_LIGHTING_UNIFORM_INDIRECT};\n` + `uniform float ${PROP_LIGHTING_UNIFORM_DIRECT};`;

/** The rescale that follows {@link PROP_LIGHTING_ANCHOR}: both halves of each term, because a
 *  kit material carries a roughness map and its specular lobe is lit by the same two lights. */
export const PROP_LIGHTING_GLSL =
  `reflectedLight.indirectDiffuse *= ${PROP_LIGHTING_UNIFORM_INDIRECT};\n` +
  `reflectedLight.indirectSpecular *= ${PROP_LIGHTING_UNIFORM_INDIRECT};\n` +
  `reflectedLight.directDiffuse *= ${PROP_LIGHTING_UNIFORM_DIRECT};\n` +
  `reflectedLight.directSpecular *= ${PROP_LIGHTING_UNIFORM_DIRECT};`;

/** Part of every patched material's program cache key, so a patched and an unpatched material of
 *  the same parameters never share one compiled program. */
export const PROP_LIGHTING_CACHE_KEY = 'storytree-prop-lighting';

/**
 * PATCH A FRAGMENT SHADER: declare the two uniforms after `<common>`, rescale after
 * `<lights_fragment_end>`.
 *
 * ⚠ REFUSES a shader missing either anchor, naming it — a shader that silently went unpatched
 * would draw every prop at the ladder floor with no error, which is exactly today's picture and
 * therefore invisible. Refuses a shader already carrying the uniform too: patching twice would
 * declare it twice and the compiler's error names neither this module nor the cause.
 */
export function propLightingFragment(fragmentShader: string): string {
  if (fragmentShader.includes(PROP_LIGHTING_UNIFORM_INDIRECT)) {
    throw new Error('prop-lighting: this fragment shader already carries the prop-lighting patch');
  }
  for (const anchor of [PROP_LIGHTING_DECLARATION_ANCHOR, PROP_LIGHTING_ANCHOR]) {
    if (!fragmentShader.includes(anchor)) {
      throw new Error(
        `prop-lighting: the fragment shader has no ${anchor} to patch at — three moved the seam, ` +
          'and every prop would otherwise be lit at the ladder floor with no error',
      );
    }
  }
  return fragmentShader
    .replace(PROP_LIGHTING_DECLARATION_ANCHOR, `${PROP_LIGHTING_DECLARATION_ANCHOR}\n${PROP_LIGHTING_DECLARATION_GLSL}`)
    .replace(PROP_LIGHTING_ANCHOR, `${PROP_LIGHTING_ANCHOR}\n${PROP_LIGHTING_GLSL}`);
}

/** The live uniforms one material carries — updating `.value` re-lights without a recompile. */
export interface PropLightingUniforms {
  fraction: number;
  indirect: { value: number };
  direct: { value: number };
}

/** The material surface this module needs: what `MeshStandardMaterial` offers for a shader patch. */
export type PropLitMaterial = Pick<
  THREE.MeshStandardMaterial,
  'onBeforeCompile' | 'customProgramCacheKey' | 'needsUpdate'
>;

/** What three hands `onBeforeCompile`, reduced to the two fields the hook touches. */
export interface PropLightingShader {
  uniforms: Record<string, { value: unknown }>;
  fragmentShader: string;
}

const INSTALLED = new WeakMap<PropLitMaterial, PropLightingUniforms>();

/** The uniforms a material carries, or `undefined` for one this module never touched. */
export function propLightingOf(material: PropLitMaterial): PropLightingUniforms | undefined {
  return INSTALLED.get(material);
}

/** The compile hook: wire the SAME two uniform objects into every program and patch the fragment. */
export function propLightingHook(uniforms: PropLightingUniforms): (shader: PropLightingShader) => void {
  return (shader) => {
    shader.uniforms[PROP_LIGHTING_UNIFORM_INDIRECT] = uniforms.indirect;
    shader.uniforms[PROP_LIGHTING_UNIFORM_DIRECT] = uniforms.direct;
    shader.fragmentShader = propLightingFragment(shader.fragmentShader);
  };
}

/**
 * INSTALL THE PATCH ON ONE MATERIAL at a fraction. The uniform objects are created once here and
 * handed to every program the material compiles, so {@link setPropLighting} moves the picture
 * without a recompile. Re-installing replaces the fraction and keeps everything else.
 */
export function installPropLighting(
  material: PropLitMaterial,
  fraction: number = KIT_PROP_INDIRECT_FRACTION,
): PropLightingUniforms {
  const scales = propLightingScales(fraction);
  const existing = INSTALLED.get(material);
  if (existing) {
    existing.fraction = fraction;
    existing.indirect.value = scales.indirect;
    existing.direct.value = scales.direct;
    return existing;
  }
  const uniforms: PropLightingUniforms = {
    fraction,
    indirect: { value: scales.indirect },
    direct: { value: scales.direct },
  };
  INSTALLED.set(material, uniforms);
  material.onBeforeCompile = propLightingHook(uniforms);
  material.customProgramCacheKey = () => PROP_LIGHTING_CACHE_KEY;
  material.needsUpdate = true;
  return uniforms;
}

/** Move an installed material to another fraction in place; install it if it never was. */
export function setPropLighting(material: PropLitMaterial, fraction: number): PropLightingUniforms {
  return installPropLighting(material, fraction);
}
