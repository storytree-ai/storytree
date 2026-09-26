// leaf-tint.ts — HOW A BOUGHT CROWN CARRIES A CAPABILITY'S STATE, and the one rule that keeps a
// deliberate tint distinguishable from the trap PR #1691 exists to catch.
//
// ⚠ THE PROBLEM THIS SOLVES IN ONE SENTENCE. The owner settled the prop vocabulary on
// 2026-08-29: one object per capability, its SPECIES and its LEAF TINT carrying that
// capability's state — green pine proven, yellow leaves proposed or building, yellowish-brown
// leaves mapped, a bare dead trunk unhealthy, nothing at all unknown. The kit is ENTIRELY PINE
// (42 objects, every tree a conifer, every crown green), so species can only separate LEAFED
// from BARE. The three leafed states have to be separated by tint, and the tint has to be
// applied to a bought, textured, green crown.
//
// ⚠⚠ AND MULTIPLYING A MAP BY A COLOUR IS THE SAME ARITHMETIC AS THE BUG. `MeshStandardMaterial`
// delivers `color x map`, and the failure `texture-convention.ts` was built for is a map coming
// out about 3.5x dark and LOOKING LIKE A DELIBERATE ART DIRECTION. A tint is a second multiplier
// on exactly those pixels, so "the crown is dark because it was tinted" and "the crown is dark
// because the convention broke" become the same picture unless the tint is constrained.
//
// SO THE RULE IS: A LEAF TINT ROTATES A MAP'S HUE AND MAY NOT CHANGE ITS VALUE.
// {@link leafTintGain} answers the per-channel gain whose product with the map's own mean has
// the map's own luminance and the token's own chromaticity. That is not a convention someone
// picked to be tidy — it is what makes the two cases separable:
//
//   - a tinted crown delivers the map's own luminance, so it can never be the 3.5x-dark
//     picture, and `leaf-tint.test.ts` asserts that for every declared tint;
//   - the colour guard's two hypotheses are both rendered THROUGH the same tint
//     (`colour-convention-scene.ts`), so the gain cancels between them and a yellow crown is
//     judged on its convention exactly as an untinted one is.
//
// A tint that wanted to darken a crown would have to say so somewhere else, which is the point:
// this file cannot express one.
//
// ⚠⚠ CROSSED INTO `src/` ON 2026-08-30, whole, with the bought kit — the line above used to say
// this file adopts nothing, and the owner lifted that fence on 2026-08-29. It crosses because the
// shipped canvas cannot draw ADR-0475's vocabulary without it: species alone separates LEAFED from
// BARE (the kit is entirely pine), so the three leafed states are separated by tint, and the tint
// is a claim about a capability's proof state. `harness/leaf-tint.ts` re-exports it.
//
// ⚠ `parseHex` now comes from `src/shade-ladder.ts`, which is where it crossed on 2026-08-30 —
// `harness/palette-band.ts` re-exports the same function from the same place, so this is the same
// arithmetic reached by a shorter path rather than a second copy.

import { parseHex } from './shade-ladder.js';
import type { Rgb } from './texture-convention.js';

/**
 * WHAT EACH STATE'S CROWN IS TINTED TOWARD — and every entry is an EXISTING AUTHORED TOKEN
 * rather than a colour chosen here.
 *
 * ⚠ THAT SOURCING IS THE CLAUSE, not a nicety. ADR-0392 D5 / ADR-0398 D7 hold that an art change
 * may not decide a semantic question, and a crown's colour is a claim about a capability's proof
 * state. Inventing three new hues here would be this file authoring a state vocabulary; pointing
 * at the two the app already draws is not.
 *
 *   healthy ...... ABSENT. The kit's own needles are already a green conifer, and that is the arm
 *                  the owner looked at and approved on 2026-08-29. The zero is the honest entry:
 *                  a tint that reproduced the asset's own colour would be arithmetic pretending
 *                  to be a decision.
 *   proposed ..... `#d8c069`, ADR-0462's own `proposed`/`building` ground token — ONE object under
 *   building ....  two keys, exactly as `STATUS_TOKENS` holds it. The owner: "for proposed you
 *                  can go yellow".
 *   mapped ....... `#7d5f3b`, the app's own `--crown-mapped-lo` (`palette-band.ts`'s
 *                  `TREE_TOKENS`) — the yellowish-brown the shipped map ALREADY paints a `mapped`
 *                  story's crown. The owner named that colour independently.
 *   unhealthy .... ABSENT, because the form carries it: a bare dead trunk has no leaves to tint.
 *   unknown ...... ABSENT, because nothing grows. That is the load-bearing entry of the whole
 *                  vocabulary (ADR-0392 D5) and it is an absence in `state-form.ts`, not here.
 *
 * ⚠ `mapped`'s LAND token is a tilled clay `#b7684e` and its CROWN token is this yellowish-brown.
 * They are different colours on purpose and were before this file existed: the ground and the
 * crown are separate authored vocabularies in the app, and harmonising them here would be
 * inventing a colour the shipped map has never drawn.
 */
export const LEAF_TINT_TOKEN: ReadonlyMap<string, string> = new Map([
  ['proposed', '#d8c069'],
  ['building', '#d8c069'],
  ['mapped', '#7d5f3b'],
]);

/**
 * Rec709 relative luminance of an 0..255 colour, on the same 0..255 scale.
 *
 * The weights are the ones the delivered-pixel instruments on this arc already use, so "same
 * value" here means the same thing it means everywhere else in the harness.
 */
export function luma(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The least a channel of a base-colour map's mean may be before a gain over it is meaningless. */
export const MIN_TINTABLE_CHANNEL = 4;

/**
 * THE PER-CHANNEL GAIN THAT ROTATES `mapMean` ONTO `token`'s CHROMATICITY AT `mapMean`'s OWN
 * LUMINANCE.
 *
 * Closed form, and worth reading rather than trusting: the delivered mean is `gain * mapMean`,
 * and we want that to be `token * s` for the single scalar `s` that puts its luminance back on
 * the map's. Luminance is linear in the colour, so `s = luma(mapMean) / luma(token)` and
 * therefore `gain_c = token_c * s / mapMean_c`. Nothing is fitted and nothing is tuned.
 *
 * ⚠ IT REFUSES A MAP IT CANNOT ROTATE. A base-colour channel at or near zero would send its gain
 * to infinity, and a gain of a thousand delivers a clipped primary rather than the token — a
 * quiet, plausible-looking wrong answer. It throws instead, which is the same fail-closed shape
 * `MIN_HYPOTHESIS_SEPARATION` takes in the colour guard.
 */
export function leafTintGain(token: Rgb, mapMean: Rgb): Rgb {
  const tokenLuma = luma(token);
  const meanLuma = luma(mapMean);
  if (!(tokenLuma > 0)) {
    throw new Error('leaf-tint: a tint token with no luminance cannot be rotated onto');
  }
  if (!(meanLuma > 0)) {
    throw new Error('leaf-tint: a base-colour map with no luminance cannot carry a tint');
  }
  const scale = meanLuma / tokenLuma;
  const gain = (t: number, m: number): number => {
    if (!(m >= MIN_TINTABLE_CHANNEL)) {
      throw new Error(
        `leaf-tint: a base-colour channel of ${m.toFixed(2)} is below ${MIN_TINTABLE_CHANNEL} — ` +
          'a gain over it delivers a clipped primary rather than the token, so this map cannot ' +
          'be tinted and the run refuses rather than drawing a plausible wrong colour',
      );
    }
    return (t * scale) / m;
  };
  return { r: gain(token.r, mapMean.r), g: gain(token.g, mapMean.g), b: gain(token.b, mapMean.b) };
}

/** What a map's mean delivers once the gain is applied — `gain * mapMean`, componentwise. */
export function tintedMean(gain: Rgb, mapMean: Rgb): Rgb {
  return { r: gain.r * mapMean.r, g: gain.g * mapMean.g, b: gain.b * mapMean.b };
}

/** The gain for a state's declared tint over a given map mean, or `null` where no tint applies. */
export function leafTintGainFor(status: string, mapMean: Rgb): Rgb | null {
  const token = LEAF_TINT_TOKEN.get(status);
  if (!token) return null;
  return leafTintGain(parseHex(token), mapMean);
}

/**
 * How far a tinted crown's luminance may sit from the untinted map's before the rotation claim is
 * broken, as a fraction.
 *
 * It absorbs the rounding of three channels through a float multiply and nothing else — the
 * arithmetic above is exact, so this is a floating-point tolerance rather than a modelling
 * allowance. A tint that darkened a crown by an amount a reader could see would clear this by
 * orders of magnitude.
 */
export const TINT_LUMA_TOLERANCE = 0.01;

/** A tint's own key and what it delivers over one map — the row a report prints per tint. */
export interface TintDelivery {
  status: string;
  token: string;
  gain: Rgb;
  /** `gain * mapMean` — what the tinted crown's mean colour is, before lighting. */
  delivered: Rgb;
  /** `luma(delivered) / luma(mapMean)`, which the rule holds at 1. */
  lumaRatio: number;
}

/** Every declared tint's delivery over one base-colour map mean, in declaration order. */
export function tintDeliveries(mapMean: Rgb): TintDelivery[] {
  const meanLuma = luma(mapMean);
  const out: TintDelivery[] = [];
  for (const [status, token] of LEAF_TINT_TOKEN) {
    const gain = leafTintGain(parseHex(token), mapMean);
    const delivered = tintedMean(gain, mapMean);
    out.push({ status, token, gain, delivered, lumaRatio: luma(delivered) / meanLuma });
  }
  return out;
}
