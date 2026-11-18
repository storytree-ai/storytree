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

function fakeRenderer(
  outputColorSpace: string = THREE.SRGBColorSpace,
  toneMapping: number = THREE.ACESFilmicToneMapping,
): ColourConfigurableRenderer {
  return { outputColorSpace, toneMapping };
}

test('2.3 exact-colour mode is: no output transform, no tone curve, no input conversion', () => {
  assert.equal(EXACT_COLOUR.outputColorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(EXACT_COLOUR.toneMapping, THREE.NoToneMapping);
  assert.equal(EXACT_COLOUR.colorManagement, false);
  assert.notEqual(EXACT_COLOUR.outputColorSpace, THREE.SRGBColorSpace);
  assert.notEqual(EXACT_COLOUR.toneMapping, THREE.ACESFilmicToneMapping);
});

test("the R3F props are the SAME three settings in @react-three/fiber's spelling", () => {
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

    configureExactColour(gl);
    assert.equal(gl.outputColorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(gl.toneMapping, THREE.NoToneMapping);
    assert.equal(THREE.ColorManagement.enabled, false);
  } finally {
    THREE.ColorManagement.enabled = before;
  }
});

test('2.3 isExactColour answers no when ANY ONE of the three is wrong', () => {
  const before = THREE.ColorManagement.enabled;
  try {
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
