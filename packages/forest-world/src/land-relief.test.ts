// The live relief field's shape, bound and analytic gradient.
// The frozen samples preserve the inherited tuning while the property tests check its geometry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_SCALE } from './land-per-capability.js';
import {
  LAND_RELIEF_AMPLITUDE,
  landGradient,
  landHeight,
  landHeightRange,
} from './land-relief.js';

/** Ground points spanning the TUNED island (234 units wide, 46 deep) and beyond it. The shipped
 *  island is `LAND_SCALE` of it edge to edge (`land-per-capability.ts`); the pinned table below
 *  maps these onto it, and every property test still sweeps them as written. */
const SAMPLES: readonly (readonly [number, number])[] = [
  [0, 0],
  [10, 0],
  [0, 10],
  [37, -12],
  [-88, 41],
  [201, 19],
  [117, 23],
];

test('the FIELD IS THE FIELD — a frozen table of what the land actually does', () => {
  // ⚠ THE PIN, and the reason it is a table of numbers rather than a property. The wave table is
  // the land's SHAPE: emptying it gives a perfectly flat island, and flipping the sign of one
  // component's `kz` gives a different island that still looks like an island. Both are changes
  // nothing else in this suite can see — measured, as surviving mutants, the day this module
  // moved. If one of these numbers changes, the land changed; say so on purpose.
  //
  // ⚠ THE TABLE IS THE ONE READ ON THE TUNED ISLAND, HELD THROUGH LAND_SCALE. The wavenumbers are
  // `TUNED / LAND_SCALE` and the amplitude `2.2 * LAND_SCALE` (`land-per-capability.ts`), which is
  // exactly the similarity `h_shipped(LAND_SCALE · p) = LAND_SCALE · h_tuned(p)`: the same land,
  // LAND_SCALE smaller in every direction. So the tuned pin is asked at the corresponding point
  // and its height scales with the island — not a regenerated table, the same table.
  const expected = [0.73293, 2.931839, 1.375074, 0.781377, 0.92094, -3.278026, -4.206077];
  SAMPLES.forEach(([x, z], i) => {
    const sx = x * LAND_SCALE;
    const sz = z * LAND_SCALE;
    // The tolerance scales with the heights it bounds, so the pin is exactly as tight as it was.
    assert.ok(
      Math.abs(landHeight(sx, sz) - expected[i]! * LAND_SCALE) < 1e-5 * LAND_SCALE,
      `the land at (${sx}, ${sz}) stands at ${landHeight(sx, sz)}, not ${expected[i]! * LAND_SCALE}`,
    );
  });
});

test('the land is NOT FLAT, and it varies along both axes independently', () => {
  // The non-vacuity behind the table above, stated as a property so it survives a re-authoring of
  // the constants: a field that answered the same height everywhere would satisfy most of this
  // file's other assertions and would be the exact thing relief exists to stop.
  const alongX = SAMPLES.map(([x]) => landHeight(x, 0));
  const alongZ = SAMPLES.map(([, z]) => landHeight(0, z));
  assert.ok(new Set(alongX).size > 1, 'the land must vary as x moves');
  assert.ok(new Set(alongZ).size > 1, 'the land must vary as z moves');
});

test('landHeightRange BOUNDS the field — a camera framing it cannot crop', () => {
  // ⚠ NOT A TRANSCRIPTION OF THE SUM. `landHeightRange` is the number a frame is sized by, so what
  // has to be true is that the FIELD never exceeds it — checked by sweeping the shipped island's
  // own extent rather than by re-adding the weights, which would be the formula grading itself.
  const range = landHeightRange();
  let worst = 0;
  for (let x = -20; x <= 260; x += 1) {
    for (let z = -30; z <= 60; z += 1) worst = Math.max(worst, Math.abs(landHeight(x, z)));
  }
  assert.ok(worst <= range, `the land reaches ${worst} units, past its stated range of ${range}`);
  // NON-VACUITY: a range of Infinity, or one ten times the field, would bound it just as well and
  // would waste the frame it sizes. The island genuinely gets close to it.
  assert.ok(worst > range * 0.9, `the range ${range} is loose — the land only reaches ${worst}`);
});

test('the range scales with the amplitude, and zero amplitude is a flat land', () => {
  assert.ok(Math.abs(landHeightRange(1) * LAND_RELIEF_AMPLITUDE - landHeightRange()) < 1e-12);
  assert.equal(landHeightRange(0), 0);
  // `assert.equal` distinguishes -0 from 0 and the wave sum lands on either depending on the
  // sample; the claim is that the land is FLAT, which both spellings of zero satisfy.
  for (const [x, z] of SAMPLES) assert.ok(Object.is(Math.abs(landHeight(x, z, 0)), 0));
});

test('the gradient is the field ANALYTIC — it agrees with a finite difference of it', () => {
  // ⚠ WHY ANALYTIC AT ALL: a finite-difference normal is a function of the step someone happened to
  // pick, and on a banded material a slightly-wrong normal is not a slightly-wrong colour, it is a
  // different rung. This test is the other direction — it holds the closed form to the field it
  // claims to differentiate, which is what would catch a dropped `kx` factor or a `cos`/`sin` swap.
  const h = 1e-4;
  for (const [x, z] of SAMPLES) {
    const g = landGradient(x, z);
    assert.ok(Math.abs(g.dx - (landHeight(x + h, z) - landHeight(x - h, z)) / (2 * h)) < 1e-5);
    assert.ok(Math.abs(g.dz - (landHeight(x, z + h) - landHeight(x, z - h)) / (2 * h)) < 1e-5);
  }
});
