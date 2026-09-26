// exact-colour.test.ts — THE TRANSFER FUNCTION THE MAP IS DRAWN THROUGH, proved without a browser.
//
// THE TEST THIS FILE IS REALLY FOR is `the R3F props and the raw-three assignments are the SAME
// three settings`. The shipped canvas and the measurement harness configure the same renderer state
// through two entirely different APIs, and until 2026-08-31 they did not agree: the canvas mounted
// @react-three/fiber's defaults (ACES filmic tone mapping, an sRGB output encode) while the
// approved reference render and this package's whole palette-closure proof were taken in
// exact-colour mode. Two hand-kept copies of three settings is how that happened. One value with a
// test on both of its spellings is what stops it happening again.

import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
  EXACT_COLOUR,
  EXACT_COLOUR_CANVAS_PROPS,
  configureExactColour,
  isExactColour,
  type ColourConfigurableRenderer,
} from './exact-colour.js';

/** A renderer-shaped object. The write is proved against this rather than against a GPU. */
function fakeRenderer(
  outputColorSpace: string = THREE.SRGBColorSpace,
  toneMapping: number = THREE.ACESFilmicToneMapping,
): ColourConfigurableRenderer {
  return { outputColorSpace, toneMapping };
}

test('exact-colour mode is: no output transform, no tone curve, no input conversion', () => {
  // ⚠ THE GOLDENS ARE HERE AND NOT ONLY THE PROPERTIES. A property ("the three fields are set
  // consistently") is satisfied by any three consistent values, including three's own defaults —
  // which is the state this module exists to move the map OFF. The instance has to be pinned.
  assert.equal(EXACT_COLOUR.outputColorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(EXACT_COLOUR.toneMapping, THREE.NoToneMapping);
  assert.equal(EXACT_COLOUR.colorManagement, false);
  // NON-VACUITY: each of the three differs from the default a bare `<Canvas>` would have taken.
  assert.notEqual(EXACT_COLOUR.outputColorSpace, THREE.SRGBColorSpace);
  assert.notEqual(EXACT_COLOUR.toneMapping, THREE.ACESFilmicToneMapping);
});

test("the R3F props are the SAME three settings in @react-three/fiber's spelling", () => {
  // R3F's own mapping, from its reconciler's configure pass:
  //   THREE.ColorManagement.enabled = !legacy
  //   gl.outputColorSpace = linear ? LinearSRGBColorSpace : SRGBColorSpace
  //   gl.toneMapping     = flat   ? NoToneMapping        : ACESFilmicToneMapping
  // Applying it to the props must reproduce EXACT_COLOUR exactly. That is the binding, and it is
  // an assertion rather than a comment because the two spellings live in different files.
  const applied = {
    colorManagement: !EXACT_COLOUR_CANVAS_PROPS.legacy,
    outputColorSpace: EXACT_COLOUR_CANVAS_PROPS.linear
      ? THREE.LinearSRGBColorSpace
      : THREE.SRGBColorSpace,
    toneMapping: EXACT_COLOUR_CANVAS_PROPS.flat
      ? THREE.NoToneMapping
      : THREE.ACESFilmicToneMapping,
  };
  assert.deepEqual(applied, {
    colorManagement: EXACT_COLOUR.colorManagement,
    outputColorSpace: EXACT_COLOUR.outputColorSpace,
    toneMapping: EXACT_COLOUR.toneMapping,
  });
  // ⚠ NON-VACUITY, and it is the assertion the pre-2026-08-31 canvas would have failed. All three
  // props must be PRESENT and true; a `<Canvas>` carrying none of them is the default the map had.
  assert.deepEqual({ ...EXACT_COLOUR_CANVAS_PROPS }, { legacy: true, linear: true, flat: true });
});

test('configureExactColour writes all three, from any starting state', () => {
  const before = THREE.ColorManagement.enabled;
  try {
    THREE.ColorManagement.enabled = true;
    const gl = fakeRenderer();
    configureExactColour(gl);
    assert.equal(gl.outputColorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(gl.toneMapping, THREE.NoToneMapping);
    assert.equal(THREE.ColorManagement.enabled, false);

    // Idempotent: calling it on an already-configured renderer changes nothing.
    configureExactColour(gl);
    assert.equal(gl.outputColorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(gl.toneMapping, THREE.NoToneMapping);
    assert.equal(THREE.ColorManagement.enabled, false);
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

test('isExactColour answers no when ANY ONE of the three is wrong', () => {
  const before = THREE.ColorManagement.enabled;
  try {
    // ⚠ EACH FIELD IS FLIPPED ON ITS OWN. A predicate reading only two of the three answers
    // correctly for every state in which the third happens to agree — and the state that actually
    // shipped (sRGB out AND ACES AND colour management on) disagrees on all three at once, so a
    // fixture built from it alone cannot tell a two-field predicate from a three-field one.
    THREE.ColorManagement.enabled = false;
    assert.equal(
      isExactColour(fakeRenderer(THREE.LinearSRGBColorSpace, THREE.NoToneMapping)),
      true,
    );
    assert.equal(
      isExactColour(fakeRenderer(THREE.SRGBColorSpace, THREE.NoToneMapping)),
      false,
      'an sRGB output encode is not exact colour',
    );
    assert.equal(
      isExactColour(fakeRenderer(THREE.LinearSRGBColorSpace, THREE.ACESFilmicToneMapping)),
      false,
      'a filmic tone curve is not exact colour',
    );
    THREE.ColorManagement.enabled = true;
    assert.equal(
      isExactColour(fakeRenderer(THREE.LinearSRGBColorSpace, THREE.NoToneMapping)),
      false,
      'an input conversion is not exact colour either — it is a global, and it counts',
    );
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

test('configureExactColour then isExactColour is the round trip', () => {
  const before = THREE.ColorManagement.enabled;
  try {
    THREE.ColorManagement.enabled = true;
    const gl = fakeRenderer();
    assert.equal(isExactColour(gl), false);
    configureExactColour(gl);
    assert.equal(isExactColour(gl), true);
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});
