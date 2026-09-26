// land-relief.test.ts — the claims the SHIPPED map's land shape rests on.
//
// ⚠ THE MODULE'S OWN TESTS, IN ITS OWN HOME. The relief field crossed from `harness/` into `src/`
// on 2026-08-30 (`put-the-treatment-on-the-shipped-map`), and a module that ships needs its
// evidence where it ships: `harness/land-definition.test.ts` still exercises these symbols through
// the re-export, but it is a harness file, so a mutation sweep over `src/` finds no witness there
// and every line below reads as unproven. That is not a formality — the first sweep after the
// crossing reported the WAVE TABLE ITSELF as an uncaught mutant, meaning it could have been emptied
// (a perfectly flat land, silently) without anything failing.
//
// ⚠ THESE ARE ART CONSTANTS AND THE TESTS TREAT THEM AS SUCH. The wavelengths were chosen against a
// measured cell pitch and the amplitude was chosen by looking; the point of pinning them is not
// that the numbers are provably right, but that CHANGING THE LAND'S SHAPE has to be a deliberate
// act rather than something that falls out of an edit elsewhere.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_SCALE } from './land-per-capability.js';
import {
  LAND_RELIEF_AMPLITUDE,
  landGradient,
  landHeight,
  landHeightRange,
  landNormal,
  landRelief,
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

test('the peak slope crosses the shade ladder — the amplitude earns its number', () => {
  // The amplitude was picked because SLOPE, not height, is what moves a pixel between shade rungs:
  // reaching the next rung up needs the normal tilted about 9 degrees toward the light and the next
  // one down about 11 degrees away. A land whose peak slope fell under that would be relief nobody
  // could see, which is the failure this number exists to avoid.
  let peak = 0;
  for (let x = -20; x <= 260; x += 1) {
    for (let z = -30; z <= 60; z += 1) {
      const g = landGradient(x, z);
      peak = Math.max(peak, Math.hypot(g.dx, g.dz));
    }
  }
  const degrees = (Math.atan(peak) * 180) / Math.PI;
  assert.ok(degrees > 11, `peak slope is only ${degrees.toFixed(1)}° — under the ladder's step`);
  // And the other side of it: this is a SWELL, not terrain. A land steep enough to read as hills
  // would be a different decision than the one that was made.
  assert.ok(degrees < 45, `peak slope is ${degrees.toFixed(1)}° — that is terrain, not a swell`);
});

test('the normal points UP everywhere, however violent the land gets', () => {
  // What `cell-ground-geometry.ts` relies on to give up its derived-normal guarantee for the top
  // face: `y = 1/hypot(dx, 1, dz)` is positive for every finite gradient, so no parcel can ever be
  // lit as though seen from underneath.
  for (const amplitude of [0, 1, LAND_RELIEF_AMPLITUDE, 500]) {
    for (const [x, z] of SAMPLES) {
      const n = landNormal(x, z, amplitude);
      assert.ok(n.y > 0, `the normal at (${x}, ${z}) at amplitude ${amplitude} faces down`);
      assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-12, 'the normal must be a unit vector');
    }
  }
});

test('landRelief is the SHIPPED pair — the same field, at the same amplitude, in both halves', () => {
  // ⚠ THE FAILURE THIS CATCHES LOOKS LIKE ART RATHER THAN LIKE A BUG: a surface lit for a shape it
  // does not have. Both functions default the amplitude, so a caller passing one and not the other
  // gets normals belonging to a different land; the pair binds it once for the map.
  for (const [x, z] of SAMPLES) {
    assert.equal(landRelief.height(x, z), landHeight(x, z));
    assert.deepEqual(landRelief.normal(x, z), landNormal(x, z));
  }
});
