// exact-colour.ts — THE TRANSFER FUNCTION THE WHOLE MAP IS DRAWN THROUGH.
//
// THE INCREMENT: `cross-the-light-calibration-probe` on `adopt-the-land-into-the-shipped-map-arc`.
// It was parked to cross ONE thing — `calibrateLights`'s renderer probe — on the premise that the
// shipped canvas's crowns read lighter than the approved reference because a `MeshStandardMaterial`
// carries a specular term the authored arithmetic does not model.
//
// ⚠⚠ THAT PREMISE IS TRUE IN ITS DIRECTION AND WRONG IN ITS MECHANISM, AND THE REAL ONE IS THIS
// FILE. The approved reference — `docs/research/chapter2-vocabulary-2026-08-29/island-kit-8px.png`
// — was rendered by `harness/kit-island-scene.ts`, which calls `configureExactColour` FIRST and
// calibrates SECOND. The shipped canvas mounted a default `<Canvas>`, and @react-three/fiber's
// defaults are `outputColorSpace = SRGBColorSpace` and `toneMapping = ACESFilmicToneMapping`
// (`linear` / `flat` are the props that turn each off; `legacy` is the one that turns
// `THREE.ColorManagement` off). So the two surfaces were never in the same transfer function, and
// no light intensity closes that: a white fully-lit standard face delivers **0.318** through the
// reference's linear passthrough and **0.662** through ACES + an sRGB encode, 2.08x, before any
// probe runs.
//
// ⚠⚠ AND IT MADE THE PROBE ITSELF INVALID, WHICH IS WHY THE TWO CROSS TOGETHER. `calibrateLights`
// returns `scale = target / probe` — a correction that is only right where the transfer is LINEAR
// in intensity. It is, exactly, under the settings below: one shot lands a lit white face on the
// ladder's top rung to four decimals. Under ACES it is not; the naive scale delivers 0.764 against
// a target of 1.0, and no iteration fixes it, because ACES asymptotes — reaching 1.0 wants a scale
// of ~1e6. Crossing the probe into an ACES canvas would have shipped a calibration that misses its
// own target by 24% while looking exactly like a calibration.
//
// ⚠ THE GROUND WAS NEVER AFFECTED, AND THAT IS THE OTHER HALF OF THE FINDING. three appends no
// output transform and no tone-mapping chunk to a raw `ShaderMaterial` — both chunks live inside
// the BUILT-IN materials' sources — so `createBandedGroundMaterial` writes its authored sRGB
// straight to the framebuffer whatever the renderer is set to. That is what the arc's
// palette-closure proof rests on, and it is unmoved by this file. What it means, though, is that
// until now the shipped map drew its GROUND through one transfer function and every PROP, tree,
// cave and wisp beside it through another. The ground was right and everything standing on it was
// not.
//
// CROSSED (not copied) from `harness/banded-material.ts`, which re-exports; `scope-fence.test.ts`
// carries the ADOPTED entry. It lives in `src/` because the product needs it: a shipped canvas that
// cannot be put into this mode cannot draw a bought asset the way the approved picture does.

import * as THREE from 'three';

/**
 * The three renderer settings that make up exact-colour mode, as plain data.
 *
 * IT IS A VALUE RATHER THAN THREE ASSIGNMENTS so that both spellings below are derived from one
 * place. The map is configured twice — once by @react-three/fiber from `<Canvas>` props, once by
 * the measurement harness on a raw `THREE.WebGLRenderer` — and a harness measuring a transfer
 * function the product does not have is the exact fault this module was written to close. Two
 * hand-kept copies of these three settings would reopen it.
 */
export interface ExactColourSettings {
  /** No output transform: the shader's rgb is already authored sRGB. */
  outputColorSpace: string;
  /** No filmic curve: ACES is a look, and the palette closure is a claim about exact bytes. */
  toneMapping: number;
  /**
   * No INPUT transform either, or `new THREE.Color('#8cb85e')` is linearised on the way in and the
   * round trip still is not an identity.
   *
   * ⚠ This one is a GLOBAL in three (`THREE.ColorManagement.enabled`), not a renderer field. It is
   * carried here anyway because it is part of the same single decision, and because leaving it out
   * of the value is how it would get set in one of the two spellings and not the other.
   */
  colorManagement: boolean;
}

/** Exact-colour mode: what the shader writes is what the framebuffer holds. */
export const EXACT_COLOUR: ExactColourSettings = {
  outputColorSpace: THREE.LinearSRGBColorSpace,
  toneMapping: THREE.NoToneMapping,
  colorManagement: false,
};

/**
 * The same three settings in @react-three/fiber's own spelling, for `<Canvas {...} />`.
 *
 * ⚠⚠ IT HAS TO BE THE PROPS AND NOT AN `onCreated` HOOK. R3F applies `linear` / `flat` / `legacy`
 * inside the reconciler's configure pass, which runs on every render of the `<Canvas>` element —
 * so a renderer configured in `onCreated` is correct until the first re-render and then silently
 * reverts to the defaults. Expressed as props, the settings are re-applied by the same pass that
 * would otherwise clobber them.
 *
 * `shipped-baseline.test.ts` parses `ForestWorldCanvas.tsx` and refuses a `<Canvas>` that does not
 * carry this spread, so the derivation cannot be quietly replaced by three literals.
 */
export const EXACT_COLOUR_CANVAS_PROPS = {
  /** `THREE.ColorManagement.enabled = !legacy`. */
  legacy: !EXACT_COLOUR.colorManagement,
  /** `outputColorSpace = linear ? LinearSRGBColorSpace : SRGBColorSpace`. */
  linear: EXACT_COLOUR.outputColorSpace === THREE.LinearSRGBColorSpace,
  /** `toneMapping = flat ? NoToneMapping : ACESFilmicToneMapping`. */
  flat: EXACT_COLOUR.toneMapping === THREE.NoToneMapping,
} as const;

/**
 * The narrow shape {@link configureExactColour} writes to.
 *
 * A structural type rather than `THREE.WebGLRenderer` so the write can be proved against an object
 * literal in node — the alternative is a browser-bound body, which is 100+ mutants nothing can
 * address (the shape this package has now paid for three times).
 */
export interface ColourConfigurableRenderer {
  outputColorSpace: string;
  toneMapping: number;
}

/**
 * Put a renderer into exact-colour mode. Call once per renderer, BEFORE building any scene.
 *
 * ⚠ THE ORDER IS LOAD-BEARING AND THE REASON IS THE GLOBAL. `THREE.Color` converts at
 * CONSTRUCTION, so a material built while colour management was still on holds an already-linearised
 * colour and does not go back when the flag flips. A renderer configured after its scene is a
 * renderer in exact-colour mode drawing colours that were not authored for it.
 */
export function configureExactColour(renderer: ColourConfigurableRenderer): void {
  renderer.outputColorSpace = EXACT_COLOUR.outputColorSpace;
  renderer.toneMapping = EXACT_COLOUR.toneMapping;
  THREE.ColorManagement.enabled = EXACT_COLOUR.colorManagement;
}

/**
 * Is this renderer in exact-colour mode?
 *
 * The fence {@link configureExactColour}'s callers are held to — see `light-calibration.ts`, which
 * REFUSES to calibrate outside it. A calibration is an arithmetic claim about a linear transfer,
 * and this predicate is what makes "the transfer is linear here" checkable rather than assumed.
 */
export function isExactColour(renderer: ColourConfigurableRenderer): boolean {
  return (
    renderer.outputColorSpace === EXACT_COLOUR.outputColorSpace &&
    renderer.toneMapping === EXACT_COLOUR.toneMapping &&
    THREE.ColorManagement.enabled === EXACT_COLOUR.colorManagement
  );
}
