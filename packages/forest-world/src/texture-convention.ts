// texture-convention.ts — THE COLOUR CONVENTION A BOUGHT TEXTURE MUST BE SAMPLED IN, and the
// arithmetic that can catch a texture sampled the other way.
//
// ⚠⚠ THIS FILE CROSSED INTO `src/` ON 2026-08-30 — the CONVENTION half only, and the split is by
// ROLE rather than by size. What is here is the rule a bought texture is SAMPLED under, and the
// shipped canvas cannot draw a bought object without it: the map would decode sRGB, come out
// about 3.5x dark, and look like a deliberate art direction on the public map. What stayed in
// `harness/texture-convention.ts` is the VERDICT — the two-hypothesis judgement over delivered
// pixels, the tolerances, and the per-asset material manifest. That is an INSTRUMENT: it measures
// this convention, it is not part of it, and instruments do not publish (the same line
// `grain-status-reading.ts` and `shadow-ladder.ts` sit on).
//
// The harness file re-exports every name below, so the experiment and the product are sampling
// through one implementation rather than two that can drift.
//
// ⚠⚠ WHAT THIS EXISTS TO CATCH, because it is silent and it looks deliberate.
//
// This renderer is NOT colour-managed, on purpose. `configureExactColour` sets
// `outputColorSpace = LinearSRGBColorSpace` and `ColorManagement.enabled = false` so an authored
// token like `#8cb85e` survives the round trip byte-for-byte — the whole basis of the
// palette-closure claim ADR-0380 / ADR-0406 / ADR-0418 rest on. But `ColorManagement.enabled`
// governs `Color` VALUES, not texture transfer functions: `GLTFLoader` marks a glTF base-colour
// map `SRGBColorSpace` regardless, three decodes it in the shader, the lighting runs in linear,
// and nothing ever encodes the result back out.
//
// Measured on 2026-08-28 (`docs/research/chapter2-textured-asset-2026-08-28/` §5): the first
// live render delivered foliage at rgb(15,26,15) against a base-colour map whose own mean is
// rgb(70,90,69) — which is exactly `srgb_to_linear(70,90,69)`. It was not a lighting error and
// it was not broken-looking. **It looked like a moody art direction.** That is the whole danger:
// a bought asset dropped in the ordinary way comes out about 3.5x dark and reads as a choice.
//
// The convention is therefore: A BASE-COLOUR MAP IS SAMPLED RAW (`NoColorSpace`), which puts a
// bought asset in the same convention `createBandedMaterial` already uses — half-lambert on
// authored sRGB numbers, written out raw. DATA maps (normal, roughness, metalness, AO) are
// genuinely linear data and are LEFT ALONE; forcing them raw would be a second, opposite bug.
//
// ⚠ THE OTHER HORN OF THE FORK IS NOT TAKEN HERE. Colour-managing the whole pipeline instead is
// a materially larger decision reaching across ADR-0380 / ADR-0406 / ADR-0418 and belongs to
// whoever proposes it explicitly. If it is ever taken, THIS FILE is what has to change, and the
// check below is what will notice.

/** A colour as three 0..255 bytes. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The sRGB electro-optical transfer function, on unit values (IEC 61966-2-1).
 *
 * This is the exact curve three's shader applies to a texel it believes is sRGB-encoded. It is
 * here so the check can PREDICT the broken delivery rather than recognise a magic number.
 */
export function srgbToLinearUnit(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** The same curve on a 0..255 byte, answering a 0..255 byte (unrounded — this feeds arithmetic). */
export function srgbToLinearByte(v: number): number {
  return srgbToLinearUnit(v / 255) * 255;
}

/**
 * THE TEXTURE SLOTS, split by what they carry. Hand-authored, and the split is the convention.
 *
 * ⚠ This list is UPSTREAM of any material it is applied to, deliberately. Deriving "which slots
 * are colour" from the material in front of you is the shape
 * `an-expectation-derived-from-its-subject-cannot-fail` warns about: a material that lost its
 * base-colour map would also lose the obligation to sample it raw, and the check would go green
 * for the reason it exists to catch.
 */
export const COLOUR_MAP_SLOTS = ['map', 'emissiveMap'] as const;

/** Slots carrying linear DATA rather than colour. Sampling these raw would be a second bug. */
export const DATA_MAP_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const;

/** three's own `NoColorSpace`, which is the empty string. Named so a reader is not startled. */
export const RAW_COLOUR_SPACE = '';

/** The minimal shape of a texture this convention touches — duck-typed so the pure half of the
 *  harness can reason about it without a GPU. */
export interface ConventionTexture {
  colorSpace: string;
  needsUpdate: boolean;
}

/** The minimal shape of a material. `null` and `undefined` are both "slot empty" — glTF
 *  materials use `null`, hand-built ones sometimes leave the slot off entirely. */
export type ConventionMaterial = Partial<
  Record<(typeof COLOUR_MAP_SLOTS)[number] | (typeof DATA_MAP_SLOTS)[number], ConventionTexture | null>
>;

/** What `applyRawColourConvention` did, so a caller can report it rather than assume it. */
export interface ConventionApplication {
  /** Colour slots that were present and have been put in the raw convention. */
  colourSlots: string[];
  /** Data slots that were present and were deliberately left alone. */
  dataSlots: string[];
}

/**
 * PUT ONE MATERIAL IN THE RAW COLOUR CONVENTION. Every loader path on this surface must route
 * through here — `texture-convention.test.ts` scans the harness and refuses one that does not.
 */
export function applyRawColourConvention(material: ConventionMaterial): ConventionApplication {
  const colourSlots: string[] = [];
  const dataSlots: string[] = [];
  for (const slot of COLOUR_MAP_SLOTS) {
    const tex = material[slot];
    if (!tex) continue;
    tex.colorSpace = RAW_COLOUR_SPACE;
    tex.needsUpdate = true;
    colourSlots.push(slot);
  }
  for (const slot of DATA_MAP_SLOTS) {
    if (material[slot]) dataSlots.push(slot);
  }
  return { colourSlots, dataSlots };
}

/**
 * ONLY FULLY OPAQUE TEXELS ARE COMPARED, and this is not a detail — it is what makes the source
 * mean and the delivered mean means of the SAME SET.
 *
 * ⚠ TWO SEPARATE THINGS BREAK ON A CUT-OUT MAP, and the first one produced a wrong answer before
 * this existed. (1) Reading a map's texels means drawing it into a 2D canvas, and `getImageData`
 * un-premultiplies — so every texel with alpha 0 comes back BLACK whatever its real colour is,
 * while the GPU samples that colour perfectly happily. On the pine's foliage map that dragged the
 * JavaScript mean to rgb(30,38,29) against a frame delivering rgb(72,91,71), and the check
 * reported NEITHER: a real disagreement, about the wrong thing. (2) A partly transparent texel is
 * blended against whatever is behind it, so its delivered colour is not its own.
 *
 * Cutting at fully-opaque removes both at once: `alphaTest` at this level discards every texel
 * that is not solid, and the same predicate selects the texels the source mean is taken over.
 * With nearest filtering at 1:1 the two sets are then EXACTLY equal rather than approximately.
 */
export const OPAQUE_TEXEL_CUT = 254;

/**
 * The least of a map that must be solid for the run to be able to judge it.
 *
 * A map that is almost entirely cut out delivers a handful of pixels, and a mean over a handful
 * is noise. Fail-closed, like the separation floor: refuse rather than report a verdict the frame
 * does not support.
 */
export const MIN_OPAQUE_FRACTION = 0.02;
