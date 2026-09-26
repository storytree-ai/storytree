// trail-wear.test.ts — the distance-to-path field over OPEN polylines, held to an independent
// brute-force twin that walks consecutive pairs and never closes a path.

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoastPoint } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { WEAR_FALLOFF } from './land-wear.js';
import { polylineEdges, wearField } from './trail-wear.js';

/** The definition: distance to the nearest point of any OPEN polyline, capped. Consecutive pairs
 *  only — written independently of the module, and deliberately without the chord a ring adds. */
function bruteOpenDistance(
  lines: readonly (readonly CoastPoint[])[],
  x: number,
  z: number,
  cap: number,
): number {
  let best = cap;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i]!;
      const b = line[i + 1]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const lenSq = ex * ex + ez * ez;
      const raw = lenSq === 0 ? 0 : ((x - a.x) * ex + (z - a.z) * ez) / lenSq;
      const t = Math.max(0, Math.min(1, raw));
      const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
      if (d < best) best = d;
    }
  }
  return best;
}

/** A wandering open path, off-origin — the shape `islandPaths` actually produces, roughly. */
function wanderingPath(): CoastPoint[] {
  return Array.from({ length: 48 }, (_, i) => ({
    x: 60 + i * 2.1,
    z: -35 + 14 * Math.sin(i * 0.29) + 5 * Math.cos(i * 0.9),
  }));
}

test('the default width IS the wear falloff, so the cap carries everything wearOf can read', () => {
  const field = wearField([wanderingPath()]);
  assert.equal(field.width, WEAR_FALLOFF);
  // The authored 3.0, times LAND_SCALE (`land-per-capability.ts`): the same fraction of the island.
  assert.equal(WEAR_FALLOFF, 3.0 * LAND_SCALE);
  assert.equal(field.segments, 47, 'a 48-point polyline is 47 open segments');
});

test('polylineEdges takes consecutive pairs ONLY — no closing chord, nothing from a lone point', () => {
  const line: CoastPoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];
  assert.deepEqual(polylineEdges([line]), [
    { ax: 0, az: 0, bx: 10, bz: 0 },
    { ax: 10, az: 0, bx: 10, bz: 10 },
  ]);
  assert.deepEqual(polylineEdges([[{ x: 3, z: 4 }]]), [], 'one point bounds no segment');
  assert.deepEqual(polylineEdges([[]]), []);
  assert.deepEqual(polylineEdges([]), []);
  // Two lines concatenate in order, each open.
  const two = polylineEdges([line, [{ x: 50, z: 50 }, { x: 60, z: 50 }]]);
  assert.equal(two.length, 3);
  assert.deepEqual(two[2], { ax: 50, az: 50, bx: 60, bz: 50 });
});

test('⚠⚠ THE FIELD IS EXACT — it agrees with the open brute-force twin at every probe', () => {
  const lines = [wanderingPath(), [{ x: 20, z: 20 }, { x: 40, z: 5 }, { x: 55, z: 30 }]];
  const width = 3.0;
  const field = wearField(lines, width);
  let compared = 0;
  let sawBand = 0;
  let sawCap = 0;
  for (let x = 10; x <= 170; x += 0.55) {
    for (let z = -60; z <= 40; z += 0.55) {
      const expected = bruteOpenDistance(lines, x, z, width);
      const got = field.sample(x, z).distance;
      assert.ok(
        Math.abs(got - expected) < 1e-9,
        `at (${x.toFixed(2)}, ${z.toFixed(2)}) the field said ${got} and the twin said ${expected}`,
      );
      compared += 1;
      if (expected > 0 && expected < width) sawBand += 1;
      if (expected === width) sawCap += 1;
    }
  }
  // ⚠ BOTH REGIMES, or the sweep compared two constants: the band is where the walk resolves a
  // real distance, the cap is where the short-circuit answers without touching an edge.
  assert.ok(compared > 40000, `only ${compared} probes`);
  assert.ok(sawBand > 2000, `only ${sawBand} probes landed inside the falloff band`);
  assert.ok(sawCap > 20000, `only ${sawCap} probes hit the capped far field`);
});

test('⚠⚠ A TWO-POINT PATH NEVER WEARS THE CHORD A RING WOULD HAVE ADDED', () => {
  // ⚠ THE FAILURE THIS PREVENTS. A ring of two points (0,0)-(40,0) is the edge plus its return
  // leg — which here coincides with the edge, so it is invisible. Make the chord VISIBLE instead:
  // a THREE-point open path (0,0) -> (40,0) -> (40,40) has no edge from (40,40) back to (0,0); a
  // ring of the same three points does, and a probe beside that diagonal would read it.
  const path: CoastPoint[] = [
    { x: 0, z: 0 },
    { x: 40, z: 0 },
    { x: 40, z: 40 },
  ];
  const width = 3.0;
  const field = wearField([path], width);
  // Beside the middle of the missing diagonal (20, 20), one unit off it.
  const s = field.sample(20 + 0.7, 20 - 0.7);
  assert.equal(s.distance, width, 'the field wore the closing chord a ring would have added');
  // And the real edges are still there: beside the middle of the first edge, one unit off.
  assert.ok(Math.abs(field.sample(20, -1).distance - 1) < 1e-9);
  assert.ok(Math.abs(field.sample(41, 20).distance - 1) < 1e-9);
  // A two-point path is one segment, and the far side of it is far.
  const two = wearField([[{ x: 0, z: 0 }, { x: 40, z: 0 }]], width);
  assert.equal(two.segments, 1);
  assert.equal(two.sample(20, 20).distance, width);
});

test('the cap is the WIDTH HANDED IN, not the falloff, so a ladder of widths builds its own field', () => {
  const path = wanderingPath();
  for (const width of [1.5, 3.0, 5.5]) {
    const field = wearField([path], width);
    assert.equal(field.width, width);
    // Far from the path: capped at exactly that width.
    assert.equal(field.sample(-500, -500).distance, width);
    // On a vertex: zero, with a zero gradient.
    const v = path[11]!;
    assert.deepEqual(field.sample(v.x, v.z), { distance: 0, gx: 0, gz: 0 });
  }
});

test('an empty path set answers "no wear anywhere" rather than throwing', () => {
  const field = wearField([], 3);
  assert.equal(field.segments, 0);
  assert.equal(field.sample(0, 0).distance, 3);
  assert.equal(field.sample(1e6, -1e6).distance, 3);
});
