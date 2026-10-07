// Capability 2 · Island ground. Exact-colour settings shared by the globe's React-Three-Fiber canvas and raw-renderer callers.
// `planet/PlanetWorldCanvas.tsx` applies EXACT_COLOUR_CANVAS_PROPS on every configure pass.
// Linear output, no tone curve and no input colour conversion preserve the authored RGB bytes.

import * as THREE from 'three';

/**
 * The three renderer settings that make up exact-colour mode, as plain data.
 *
 * IT IS A VALUE RATHER THAN THREE ASSIGNMENTS so that both spellings below are derived from one
 * place. @react-three/fiber's `<Canvas>` props and configureExactColour's raw-renderer form
 * must agree; keeping their settings together avoids two transfer functions drifting apart.
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
 * The globe's `<Canvas>` (`planet/PlanetWorldCanvas.tsx`) carries this spread rather than three
 * literals, so the derivation stays in one place.
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
 * Checks all three settings, including three.js's global input colour conversion.
 * `exact-colour.test.ts` verifies that changing any one leaves this mode.
 */
export function isExactColour(renderer: ColourConfigurableRenderer): boolean {
  return (
    renderer.outputColorSpace === EXACT_COLOUR.outputColorSpace &&
    renderer.toneMapping === EXACT_COLOUR.toneMapping &&
    THREE.ColorManagement.enabled === EXACT_COLOUR.colorManagement
  );
}
