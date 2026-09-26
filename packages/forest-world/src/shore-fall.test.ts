// shore-fall.test.ts — the pure arithmetic of the landform that falls to the shore.
//
// ⚠ WHAT THIS FILE ASSERTS AND WHAT IT DELIBERATELY DOES NOT. Everything here is a claim about
// the FIELD — the falloff, the distance, the height, the normal — driven by rings written out in
// this file, so it needs no fixture and no renderer. The claims about the REAL island (its rim,
// its parcel count, what each arm costs) live in `harness/shipped-shore-scene.test.ts`, next to
// the instrument that measures them. That division is the one `coast-clip.test.ts` already draws.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GROUND_COAST_OUTSET } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { landGradient, landHeight, landHeightRange } from './land-relief.js';
import {
  AUTHORED_SHORE_WIDTH,
  SHIPPED_SHORE,
  SHORE_ARMS,
  SHORE_ARM_WIDTH,
  SHORE_DIP,
  boundsOf,
  boxDistance,
  shoreFall,
  shoreFallSlope,
  shoreField,
  shoreRelief,
} from './shore-fall.js';
import type { InstanceDescriptor } from './world-to-3d.js';

// ---------------------------------------------------------------------------
// Fixtures — a square island, so every distance in this file is one anybody can check by hand.
// ---------------------------------------------------------------------------

/** One square parcel from (0,0) to (SIDE,SIDE). Its rim is its own outline, so the distance to
 *  the shore from any interior point is the distance to the nearest of four axis-aligned sides. */
const SIDE = 100;

function square(island = 'story-a', ox = 0, oz = 0): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    island,
    parcel: `${island}/only`,
    transform: { x: ox, y: 0, z: oz },
    points: [
      { x: ox, y: 0, z: oz },
      { x: ox + SIDE, y: 0, z: oz },
      { x: ox + SIDE, y: 0, z: oz + SIDE },
      { x: ox, y: 0, z: oz + SIDE },
    ],
  } as InstanceDescriptor;
}

// ---------------------------------------------------------------------------
// The falloff
// ---------------------------------------------------------------------------

test('the falloff is 0 at the waterline, 1 at the band edge, and smoothstep between', () => {
  assert.equal(shoreFall(0, 10), 0);
  assert.equal(shoreFall(10, 10), 1);
  assert.equal(shoreFall(5, 10), 0.5);
  // smoothstep, not linear — a quarter of the way in delivers less than a quarter of the rise.
  assert.ok(shoreFall(2.5, 10) < 0.25);
  assert.equal(shoreFall(2.5, 10), 0.25 * 0.25 * (3 - 2 * 0.25));
});

test('past the band the falloff is exactly 1, and it never overshoots inside it', () => {
  assert.equal(shoreFall(10.0001, 10), 1);
  assert.equal(shoreFall(1e9, 10), 1);
  for (let d = 0; d <= 10; d += 0.25) {
    const f = shoreFall(d, 10);
    assert.ok(f >= 0 && f <= 1, `f(${d}) = ${f} left [0,1]`);
  }
});

test('a band of ZERO width is the control — the falloff is 1 everywhere, including AT the shore', () => {
  // The control is the same code path as every arm rather than a branch around it, so this is an
  // ordinary answer rather than a guard: at width 0 there is no band, so nowhere is in one.
  assert.equal(shoreFall(0, 0), 1);
  assert.equal(shoreFall(50, 0), 1);
  assert.equal(shoreFallSlope(0, 0), 0);
});

test('the falloff SLOPE vanishes at both ends and peaks in the middle', () => {
  assert.equal(shoreFallSlope(0, 10), 0);
  assert.equal(shoreFallSlope(10, 10), 0);
  assert.equal(shoreFallSlope(20, 10), 0);
  // s'(t) = 6t(1-t) peaks at t = 1/2 with value 3/2, divided by the width.
  assert.ok(Math.abs(shoreFallSlope(5, 10) - 1.5 / 10) < 1e-12);
  assert.ok(shoreFallSlope(2.5, 10) < shoreFallSlope(5, 10));
  assert.ok(shoreFallSlope(7.5, 10) < shoreFallSlope(5, 10));
});

test('⚠ THE SLOPE IS THE FALLOFF-OF-DISTANCE DERIVATIVE — held to a finite difference', () => {
  // A transcription that divided by the wrong thing, or dropped the 6, passes every shape test
  // above and fails here.
  const w = 7;
  for (const d of [0.5, 1.5, 3, 4.5, 6, 6.5]) {
    const h = 1e-6;
    const fd = (shoreFall(d + h, w) - shoreFall(d - h, w)) / (2 * h);
    assert.ok(
      Math.abs(fd - shoreFallSlope(d, w)) < 1e-6,
      `at d=${d}: analytic ${shoreFallSlope(d, w)} vs finite difference ${fd}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The distance field
// ---------------------------------------------------------------------------

test('the shore of one square parcel is its own outline', () => {
  const field = shoreField([square()], 40);
  assert.equal(field.loops, 1);
  // Dead centre: 50 units from all four sides, so capped at the band width.
  assert.equal(field.sample(50, 50).distance, 40);
  // Ten in from the west side.
  const s = field.sample(10, 50);
  assert.ok(Math.abs(s.distance - 10) < 1e-9, `distance ${s.distance}`);
  // Inland from the west side is +x.
  assert.ok(Math.abs(s.gx - 1) < 1e-9 && Math.abs(s.gz) < 1e-9, `gradient ${s.gx},${s.gz}`);
});

test('the gradient points inland from whichever side is nearest', () => {
  const field = shoreField([square()], 40);
  assert.ok(Math.abs(field.sample(50, 10).gz - 1) < 1e-9, 'from the north side, inland is +z');
  assert.ok(Math.abs(field.sample(90, 50).gx + 1) < 1e-9, 'from the east side, inland is -x');
  assert.ok(Math.abs(field.sample(50, 90).gz + 1) < 1e-9, 'from the south side, inland is -z');
});

test('ON the shore the distance is zero and the gradient is zero — it is undefined there', () => {
  const s = shoreField([square()], 40).sample(0, 50);
  assert.equal(s.distance, 0);
  assert.equal(s.gx, 0);
  assert.equal(s.gz, 0);
});

test('the distance is CAPPED at the band width, and the cap is the only reason a deep point is cheap', () => {
  assert.equal(shoreField([square()], 5).sample(50, 50).distance, 5);
  assert.equal(shoreField([square()], 12).sample(50, 50).distance, 12);
  // Inside the band the cap is not reached, so the real distance comes back.
  assert.ok(Math.abs(shoreField([square()], 12).sample(3, 50).distance - 3) < 1e-9);
});

test('⚠ A NEIGHBOURING ISLAND NEVER PULLS THE SHORE — the nearest loop is the containing one', () => {
  // Two squares 20 units apart. A point 5 units inside A's east side is 25 from B's west side,
  // so A wins — and it wins for the geometric reason the module's own note gives, not by luck.
  const field = shoreField([square('story-a'), square('story-b', SIDE + 20, 0)], 60);
  assert.equal(field.loops, 2);
  const s = field.sample(SIDE - 5, 50);
  assert.ok(Math.abs(s.distance - 5) < 1e-9, `distance ${s.distance}`);
  assert.ok(s.gx < 0, 'inland from the EAST side of A is -x, not toward B');
});

test('a descriptor that belongs to no coast contributes no shore', () => {
  const tree = { kind: 'uat-bloom', island: 'story-a', transform: { x: 5, y: 0, z: 5 } };
  // ⚠ OMITTED, NOT SET TO `undefined`. Under `exactOptionalPropertyTypes` those are different
  // inputs, and only the first is the shape `worldTo3D` can actually emit.
  const { island: _i, ...homeless } = square();
  const { points: _p, ...ringless } = square('story-c');
  const field = shoreField(
    [square(), tree as InstanceDescriptor, homeless, ringless],
    40,
  );
  assert.equal(field.loops, 1);
});

test('no parcels at all is a field with no shore — everything is inland', () => {
  const field = shoreField([], 40);
  assert.equal(field.loops, 0);
  assert.deepEqual(field.sample(0, 0), { distance: 40, gx: 0, gz: 0 });
});

// ---------------------------------------------------------------------------
// The relief — the two properties the whole increment rests on
// ---------------------------------------------------------------------------

test('⚠⚠ INLAND OF THE BAND THE FIELD IS `landRelief` TO THE LAST BIT', () => {
  // Not "within a tolerance" — the same double. `(H + D) * 1 - D` is `H` exactly, and a session
  // that later reaches for a tolerance here has changed the claim rather than relaxed it.
  const relief = shoreRelief([square()], 'beach');
  for (const [x, z] of [[50, 50], [40, 60], [55, 45], [30, 30], [70, 70]] as const) {
    assert.equal(relief.height(x, z), landHeight(x, z), `height at ${x},${z}`);
    const g = landGradient(x, z);
    const len = Math.hypot(g.dx, 1, g.dz);
    const n = relief.normal(x, z);
    assert.equal(n.x, -g.dx / len, `normal.x at ${x},${z}`);
    assert.equal(n.y, 1 / len);
    assert.equal(n.z, -g.dz / len);
  }
});

test('⚠⚠ AT THE WATERLINE THE LAND SITS EXACTLY `SHORE_DIP` BELOW THE GRASS LINE', () => {
  // The half of the reference's landform a pure scaling drops: scaling alone leaves the beach at
  // the height of flat ground, and flat ground is what its own comment says has no shore.
  const relief = shoreRelief([square()], 'beach');
  assert.ok(Math.abs(relief.height(0, 50) - -SHORE_DIP) < 1e-9);
  assert.ok(Math.abs(relief.height(50, 0) - -SHORE_DIP) < 1e-9);
  assert.ok(Math.abs(relief.height(SIDE, 50) - -SHORE_DIP) < 1e-9);
});

test('⚠⚠ THE HEIGHT ABOVE THE WATERLINE IS THE FALLOFF TIMES THE OLD HEIGHT ABOVE IT', () => {
  // THE COMPONENT, STATED EXACTLY. `h + D == f * (H + D)` for every point, which says the shore
  // fall does one thing: it scales the land's height ABOVE THE WATERLINE by the falloff. Total at
  // the shore, nil at the band edge, smoothstep between.
  //
  // ⚠ THIS REPLACED A MONOTONICITY TEST WHOSE OWN PREMISE WAS FALSE, and the correction is worth
  // keeping. "Walking inland the land only rises" assumed the relief's sine sum moves less than
  // the 0.62 dip over 7 units; it has amplitude 4.2 and moves far more, so the height genuinely
  // falls at d = 5.5 on this line. Monotonicity was never a property of this component — a land
  // with relief has slopes both ways — and asserting it would have pinned an accident of the
  // fixture. The identity below is the thing that IS true, and it holds whatever the swell does.
  const relief = shoreRelief([square()], 'beach');
  for (let d = 0; d <= 10; d += 0.5) {
    const f = shoreFall(Math.min(d, SHORE_ARM_WIDTH.beach), SHORE_ARM_WIDTH.beach);
    const above = relief.height(d, 50) + SHORE_DIP;
    const wasAbove = landHeight(d, 50) + SHORE_DIP;
    assert.ok(
      Math.abs(above - f * wasAbove) < 1e-12,
      `at ${d}: ${above} is not ${f} x ${wasAbove}`,
    );
  }
});

test('the shore fall moves the land TOWARD the waterline and never past it', () => {
  // The corollary, and the one a reader checks against the picture: a beach cannot end up higher
  // than the land behind it, nor dip below the waterline it is falling to.
  const relief = shoreRelief([square()], 'shelf');
  for (let d = 0; d <= 16.5; d += 0.5) {
    const moved = relief.height(d, 50) + SHORE_DIP;
    const was = landHeight(d, 50) + SHORE_DIP;
    assert.ok(Math.abs(moved) <= Math.abs(was) + 1e-12, `at ${d}: |${moved}| > |${was}|`);
    assert.ok(moved * was >= 0, `at ${d}: the fall crossed the waterline`);
  }
});

test('⚠⚠ THE NORMAL IS THE NORMAL OF THE HEIGHT THIS OBJECT RETURNS — the conservation law', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. The normal is computed analytically through the product
  // rule; this drives a CENTRAL DIFFERENCE of the height and demands they agree. The two routes
  // share no arithmetic, so dropping the product rule's second term — the mistake a transcription
  // makes, and one that is invisible in the picture, the bounds and the silhouette — fails here
  // and nowhere else.
  const relief = shoreRelief([square()], 'beach');
  const h = 1e-5;
  // Sample ACROSS the band on all four approaches, plus deep inland. The band is 7 wide.
  const points: readonly (readonly [number, number])[] = [
    [1, 50], [2, 50], [3.5, 50], [5, 50], [6.5, 50],
    [50, 1], [50, 3.5], [50, 6.5],
    [SIDE - 2, 50], [SIDE - 5, 50],
    [50, SIDE - 3.5],
    [50, 50], [30, 40],
  ];
  for (const [x, z] of points) {
    const dx = (relief.height(x + h, z) - relief.height(x - h, z)) / (2 * h);
    const dz = (relief.height(x, z + h) - relief.height(x, z - h)) / (2 * h);
    const len = Math.hypot(dx, 1, dz);
    const n = relief.normal(x, z);
    assert.ok(
      Math.abs(n.x - -dx / len) < 1e-4 && Math.abs(n.z - -dz / len) < 1e-4,
      `at ${x},${z}: analytic (${n.x}, ${n.z}) vs finite difference (${-dx / len}, ${-dz / len})`,
    );
    assert.ok(Math.abs(n.y - 1 / len) < 1e-4, `at ${x},${z}: n.y ${n.y} vs ${1 / len}`);
  }
});

test('the normal is a UNIT vector everywhere, and points up', () => {
  const relief = shoreRelief([square()], 'shelf');
  for (const [x, z] of [[0, 50], [1, 50], [8, 50], [16, 50], [50, 50]] as const) {
    const n = relief.normal(x, z);
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-12, `not unit at ${x},${z}`);
    assert.ok(n.y > 0, `normal points down at ${x},${z}`);
  }
});

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

test('the CONTROL arm is the map exactly as it drew before this module', () => {
  const relief = shoreRelief([square()], 'none');
  // Right at the waterline, where every other arm dips.
  assert.equal(relief.height(0, 50), landHeight(0, 50));
  assert.equal(relief.height(1, 50), landHeight(1, 50));
  const g = landGradient(0, 50);
  const len = Math.hypot(g.dx, 1, g.dz);
  assert.equal(relief.normal(0, 50).x, -g.dx / len);
});

test('every arm is declared, control first, and the widths are the authored ones', () => {
  assert.deepEqual(
    [...SHORE_ARMS],
    ['none', 'authored', 'beach', 'shelf', 'ring', 'ring-pair'],
  );
  assert.equal(SHORE_ARM_WIDTH.none, 0);
  assert.equal(SHORE_ARM_WIDTH.authored, AUTHORED_SHORE_WIDTH);
  // × LAND_SCALE (`land-per-capability.ts`): each literal is the width judged on the TUNED island,
  // and the shipped island is LAND_SCALE of it edge to edge — the band stays the same fraction.
  assert.equal(AUTHORED_SHORE_WIDTH, 3.1 * LAND_SCALE, "the reference generator's own BEACH");
  assert.equal(SHORE_DIP, 0.62 * LAND_SCALE, "the reference generator's own beach dip");
  assert.equal(SHORE_ARM_WIDTH.beach, 7 * LAND_SCALE, 'COAST_OUTSET — the beach this map actually draws');
  assert.equal(SHORE_ARM_WIDTH.beach, GROUND_COAST_OUTSET, 'and it is the GROUND outset by import');
  assert.equal(SHORE_ARM_WIDTH.shelf, 16.5 * LAND_SCALE, 'the mean parcel diameter');
  assert.ok(SHORE_ARMS.includes(SHIPPED_SHORE));
});

test('⚠ THE RING ARMS MOVE THE MESH AND NOT THE BAND — their width is `beach`\'s, exactly', () => {
  // The page carries two axes meeting at one arm, and this is the half that lives in THIS module.
  // `beach → ring → ring-pair` holds the falloff fixed and changes what the mesh can carry; if a
  // ring arm's width ever drifted from `beach`'s, every picture on that axis would be moving two
  // things and the comparison would attribute a mesh's work to a band.
  assert.equal(SHORE_ARM_WIDTH.ring, SHORE_ARM_WIDTH.beach);
  assert.equal(SHORE_ARM_WIDTH['ring-pair'], SHORE_ARM_WIDTH.beach);
  // And the falloff they deliver is `beach`'s own, to the last bit — the only difference between
  // these arms is WHERE the mesh samples it. The probe is 3 TUNED units in, × LAND_SCALE so it
  // stays INSIDE the (scaled) band — inland of it every arm is `landHeight` and the claim is empty.
  for (const arm of ['ring', 'ring-pair'] as const) {
    assert.equal(
      shoreRelief([square()], arm).height(3 * LAND_SCALE, 50),
      shoreRelief([square()], 'beach').height(3 * LAND_SCALE, 50),
      `${arm} changed the falloff as well as the mesh`,
    );
  }
});

test('⚠ THE ARMS ARE THREE DIFFERENT LANDS, and the authored width leaves our own beach standing', () => {
  // The finding this increment puts to a picture: the reference's band is 3.1 units and the beach
  // the coast clip draws is 7, so `authored` has already reached full height less than half way
  // across it, while `beach` is still rising. The probe is 5 TUNED units from the west side,
  // × LAND_SCALE — the same fraction of the (scaled) bands, so it is the same claim.
  const probe = 5 * LAND_SCALE;
  const at = (arm: 'authored' | 'beach' | 'shelf') => shoreRelief([square()], arm).height(probe, 50);
  assert.equal(at('authored'), landHeight(probe, 50), 'authored is already inland at 5 units');
  assert.ok(at('beach') < at('authored'), 'beach is still climbing at 5 units');
  assert.ok(at('shelf') < at('beach'), 'shelf is climbing more slowly still');
});

test('⚠ THE SHORE FALL CANNOT CROP A FRAME — it stays inside `landHeightRange`', () => {
  // `landHeightRange` is the number a camera frames by and the number the ground shadow's reach is
  // derived from (`land-shadow.ts`). Both would be wrong if the shore fall could push the land
  // outside it. It cannot, and the reason is structural rather than lucky: the fall only ever
  // moves the land TOWARD the waterline at `-SHORE_DIP`, and 0.62 is far inside the +/-4.224 the
  // sine sum already reaches. So no framing constant moves in this increment.
  assert.ok(SHORE_DIP < landHeightRange(), `the dip ${SHORE_DIP} escaped the bound`);
  const relief = shoreRelief([square()], 'shelf');
  const bound = landHeightRange();
  for (let d = 0; d <= 20; d += 0.25) {
    for (const z of [20, 50, 80]) {
      const h = relief.height(d, z);
      assert.ok(Math.abs(h) <= bound, `height ${h} at ${d},${z} escaped +/-${bound}`);
    }
  }
});

test('⚠⚠ THE SHIPPED ARM LEAVES EVERY PROP STANDING ON THE GROUND IT WAS PLACED ON', () => {
  // `dressMapFromKit` still reads the MAPPER's descriptors, so a tree stands where its parcel put
  // it and the beach grows underneath — the coast clip's own deliberate scoping, inherited here.
  // That only stays honest because the SHIPPED arm's band is exactly the width the coast outsets
  // by: a prop on the pre-coast boundary sits a full band inland of the new shore, where the
  // falloff is 1 and the ground has not moved at all. The `shelf` arm would undermine it, and
  // this is where that shows.
  const preCoastBoundary = SHORE_ARM_WIDTH.beach; // the coast outsets by exactly this
  const shipped = shoreRelief([square()], SHIPPED_SHORE);
  assert.equal(shipped.height(preCoastBoundary, 50), landHeight(preCoastBoundary, 50));
  const shelf = shoreRelief([square()], 'shelf');
  assert.notEqual(shelf.height(preCoastBoundary, 50), landHeight(preCoastBoundary, 50));
});

// ---------------------------------------------------------------------------
// The prune — tested DIRECTLY, because its result is never observable from `sample`
// ---------------------------------------------------------------------------

test('a loop’s bounds are its extremes on both axes', () => {
  const b = boundsOf([
    { x: 3, z: -2 },
    { x: -5, z: 7 },
    { x: 1, z: 1 },
  ]);
  assert.equal(b.minX, -5);
  assert.equal(b.maxX, 3);
  assert.equal(b.minZ, -2);
  assert.equal(b.maxZ, 7);
});

test('a ONE-POINT loop bounds a point — every extreme is that point', () => {
  // Not hypothetical: the subdivide clip emits zero-length ring edges, and those chain into
  // single-vertex "loops". They sit ON the coastline so they can never win a distance query, but
  // they DO reach `boundsOf`, and a degenerate box must not come back inverted.
  const b = boundsOf([{ x: 4, z: 9 }]);
  assert.deepEqual([b.minX, b.maxX, b.minZ, b.maxZ], [4, 4, 9, 9]);
  // And a point's box is at zero distance from itself and from nowhere else.
  assert.equal(boxDistance(b, 4, 9), 0);
  assert.equal(boxDistance(b, 4, 12), 3);
});

test('⚠ THE PRUNE IS A LOWER BOUND ON THE DISTANCE TO ANYTHING THE BOX CONTAINS', () => {
  // THE PROPERTY THAT MAKES SKIPPING EXACT RATHER THAN HEURISTIC — and the reason `boxDistance` is
  // exported at all. It is a pure cost optimisation, so no assertion about `sample`'s OUTPUT can
  // reach it: the answer is identical whether the prune fires or not, which is precisely what left
  // every mutant in it alive on the first mutation run.
  const b = boundsOf([
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ]);
  // Inside the box: zero, from anywhere in it, edges included.
  assert.equal(boxDistance(b, 5, 5), 0);
  assert.equal(boxDistance(b, 0, 0), 0, 'a corner is inside its own box');
  assert.equal(boxDistance(b, 10, 10), 0);
  // Off one face: the gap on that axis alone, and each of the four faces separately — a sign flip
  // on any one of them is a mutant that survives if only one direction is asked about.
  assert.equal(boxDistance(b, -3, 5), 3);
  assert.equal(boxDistance(b, 14, 5), 4);
  assert.equal(boxDistance(b, 5, -6), 6);
  assert.equal(boxDistance(b, 5, 17), 7);
  // Off a corner: the DIAGONAL, not the larger of the two gaps.
  assert.ok(Math.abs(boxDistance(b, -3, -4) - 5) < 1e-12);
  assert.ok(Math.abs(boxDistance(b, 13, 14) - 5) < 1e-12);
});

test('the prune NEVER over-estimates — it stays under the true distance to every loop vertex', () => {
  // The safety property, spelled as the inequality that makes the skip sound. If a box distance
  // ever exceeded the real distance to a point of that loop, the sweep would skip a loop that
  // should have won, and the waterline would land somewhere the map cannot justify.
  const loop = [
    { x: 0, z: 0 },
    { x: 10, z: 2 },
    { x: 7, z: 11 },
    { x: -2, z: 6 },
  ];
  const b = boundsOf(loop);
  for (const [x, z] of [[-20, -20], [30, 5], [5, 40], [-9, 3], [5, 5], [0, 0]] as const) {
    const nearest = Math.min(...loop.map((p) => Math.hypot(p.x - x, p.z - z)));
    assert.ok(
      boxDistance(b, x, z) <= nearest + 1e-12,
      `at ${x},${z}: the box said ${boxDistance(b, x, z)}, past the true nearest ${nearest}`,
    );
  }
});

test('⚠ THE BOX GAPS ARE MEASURED FROM THE FACE, NOT FROM THE ORIGIN', () => {
  // ⚠ THIS TEST EXISTS BECAUSE THE FIRST FIXTURE ABOVE WAS TOO SYMMETRIC TO SEPARATE A BUG. That
  // box is anchored at (0,0), so `minZ - z` and `minZ + z` agree for every point outside it —
  // `Math.hypot` squares its arguments, so a sign flip vanishes whenever the bound is 0. The
  // mutation rung caught exactly that: the arithmetic mutant survived a test that looked thorough.
  //
  // This box is anchored nowhere near the origin, so each gap is a genuine subtraction.
  const b = boundsOf([
    { x: 20, z: 50 },
    { x: 35, z: 50 },
    { x: 35, z: 80 },
    { x: 20, z: 80 },
  ]);
  assert.equal(boxDistance(b, 20, 62), 0, 'on the west face');
  assert.equal(boxDistance(b, 12, 62), 8, 'west of it — the gap is 20-12, not 12');
  assert.equal(boxDistance(b, 44, 62), 9, 'east of it — the gap is 44-35, not 44');
  assert.equal(boxDistance(b, 27, 43), 7, 'north of it — the gap is 50-43, not 43');
  assert.equal(boxDistance(b, 27, 95), 15, 'south of it — the gap is 95-80, not 95');
});

test('⚠ A POINT IN THE SEA GETS ITS TRUE DISTANCE — which is what the segment clamp is for', () => {
  // The ground mesh never asks about a point outside an island, but the field is total and the
  // clamp is what keeps it honest there. Without it a point off the END of a segment projects onto
  // that segment's infinite LINE, which is nearer than any point of the segment actually is — so
  // the field would UNDER-report the distance and put the waterline out to sea.
  //
  // Off the north-west corner of the square, the nearest point of the whole loop is the corner
  // itself at (0,0), so the honest answer is the diagonal. The unclamped answer would be the
  // perpendicular to one of the two edges, which is shorter.
  const field = shoreField([square()], 100);
  const s = field.sample(-30, -40);
  assert.ok(Math.abs(s.distance - 50) < 1e-9, `distance ${s.distance}, expected the 30-40-50 corner`);
  // And the gradient points AWAY from that corner, back out to sea, since distance grows outward.
  assert.ok(Math.abs(s.gx - -0.6) < 1e-9 && Math.abs(s.gz - -0.8) < 1e-9, `gradient ${s.gx},${s.gz}`);
});

test('a sea point off the MIDDLE of an edge measures to the edge, not to a corner', () => {
  // The other side of the same clamp: here the projection IS inside the segment, so the clamp must
  // not fire. Both halves are needed — a clamp that always fired would pass the test above.
  const s = shoreField([square()], 100).sample(-12, 50);
  assert.ok(Math.abs(s.distance - 12) < 1e-9, `distance ${s.distance}`);
  assert.ok(Math.abs(s.gx - -1) < 1e-9 && Math.abs(s.gz) < 1e-9, `gradient ${s.gx},${s.gz}`);
});

test('⚠ A ZERO-LENGTH COAST EDGE DOES NOT POISON THE FIELD WITH NaN', () => {
  // NOT HYPOTHETICAL. The subdivide coast clip emits six zero-length ring edges on the shipped
  // island — inserted curve points that coincide where the outset loop had a very short edge —
  // and those chain into single-vertex rim "loops". `shoreField` walks them like any other.
  //
  // A degenerate segment has `lenSq === 0`, and the guard is what stops the projection dividing by
  // it. Without the guard the parameter is `0/0` = NaN, the offset is NaN, the distance is NaN,
  // and `NaN >= best` is FALSE — so the NaN is ACCEPTED as the new best and the whole field goes
  // undefined from that point on. Silent, and fatal to every height downstream.
  const duplicated = {
    ...square(),
    points: [
      { x: 0, y: 0, z: 0 },
      { x: SIDE, y: 0, z: 0 },
      { x: SIDE, y: 0, z: 0 },
      { x: SIDE, y: 0, z: SIDE },
      { x: 0, y: 0, z: SIDE },
    ],
  } as InstanceDescriptor;
  const field = shoreField([duplicated], 40);
  for (const [x, z] of [[10, 50], [50, 50], [90, 20], [0, 50], [50, 0]] as const) {
    const s = field.sample(x, z);
    assert.ok(Number.isFinite(s.distance), `distance at ${x},${z} was ${s.distance}`);
    assert.ok(Number.isFinite(s.gx) && Number.isFinite(s.gz), `gradient at ${x},${z}`);
    assert.ok(s.distance >= 0 && s.distance <= 40, `distance at ${x},${z} left its bounds`);
  }
  // And the answer is still the RIGHT one, not merely a number: ten in from the west side.
  assert.ok(Math.abs(field.sample(10, 50).distance - 10) < 1e-9);
});
