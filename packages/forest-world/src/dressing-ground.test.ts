// dressing-ground.test.ts — where dressing may stand, proved where it lives.
//
// ⚠ IN `src/` FOR THE MUTATION RUNG'S SAKE, like `kit-vocabulary.test.ts`: `check:mutation-diff`
// mutates a project's `src/` only, and a `src/` module proved from `harness/` buys it nothing.
//
// ⚠ THE ISLANDS HERE ARE BUILT, NOT LOADED. The real exclusion (the clipped coast, the trail
// docks' worn path) is proved on its own fixture below, through the SAME distance walks the ground
// layers sample with.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRESSING_BEACH,
  DRESSING_STATUS,
  DRESSING_WEAR_CEILING,
  RECIPE_ISLAND_AREA,
  beachClear,
  cellAt,
  cellsArea,
  cellsBounds,
  crossingIsRight,
  crossingX,
  dressingEligible,
  dressingExclusion,
  insideRing,
  islandExclusion,
  pathClear,
  ringArea,
  straddles,
} from './dressing-ground.js';
import { LAND_AREA_PER_CAPABILITY, LAND_SCALE } from './land-per-capability.js';
import { SAND_SHIPPED_BEACH_WIDTH } from './land-sand.js';
import { WEAR_FALLOFF, wearOf } from './land-wear.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

// ---------------------------------------------------------------------------
// a built island — the same hostile shape `kit-vocabulary.test.ts` uses
// ---------------------------------------------------------------------------

const CELL_W = 34;
const CELL_D = 26;
const ORIGIN_X = 140;
const ORIGIN_Z = -70;

function parcel(capId: string | undefined, status: string, row: number, cols: number): LayoutCell[] {
  return Array.from({ length: cols }, (_, c) => {
    const x0 = ORIGIN_X + c * CELL_W;
    const z0 = ORIGIN_Z + row * CELL_D;
    return {
      points: [
        { x: x0, z: z0 },
        { x: x0 + CELL_W, z: z0 },
        { x: x0 + CELL_W, z: z0 + CELL_D },
        { x: x0, z: z0 + CELL_D },
      ],
      parcel: capId,
      island: 'built',
      status,
      cellId: `${capId ?? 'none'}-${row}-${c}`,
    } satisfies LayoutCell;
  });
}

/** An island of `states.length` capabilities, one parcel-row each, `cols` cells wide. */
function island(states: readonly string[], cols = 4): LayoutCell[] {
  return states.flatMap((status, row) => parcel(`cap-${row}`, status, row, cols));
}

/** Four healthy parcels, four cells each: 136 x 104 units, 14,144 sq units. */
const HEALTHY = island(['healthy', 'healthy', 'healthy', 'healthy']);

// ---------------------------------------------------------------------------
// the constants a report can quote
// ---------------------------------------------------------------------------

test('the constants: the shipped beach, the recipe’s wear ceiling, the true-footprint recipe island, the one dressed status', () => {
  assert.equal(DRESSING_BEACH, SAND_SHIPPED_BEACH_WIDTH, 'the beach dressing keeps off IS the sand band the ground draws');
  // × LAND_SCALE (`land-per-capability.ts`): the 9-unit beach judged on the TUNED island, the same
  // fraction of the shipped one.
  assert.equal(DRESSING_BEACH, 9 * LAND_SCALE);
  assert.equal(DRESSING_WEAR_CEILING, 0.3, 'build_land.py: wear < 0.30');
  assert.equal(DRESSING_STATUS, 'healthy');
  // The recipe island in the TRUE-footprint basis: the squashed 8,424.6 × 1 / sin 20° (ADR-0517)
  // = 24,631.8 units² — the recipe's thirteen hexes as drawn — held to the fixture's own area
  // through the mapper by `harness/true-footprint-routes.test.ts`. × LAND_SCALE² (an AREA): the
  // shipped mapper sizes that island by the land-per-capability ratio, and this is its area
  // through the shipped mapper.
  // The recipe island THROUGH the shipped mapper: the fixture's eleven capabilities at the shipped
  // ratio, exactly — which is the drawn 24,631.8 × LAND_SCALE² to the coast's 0.04%.
  assert.equal(RECIPE_ISLAND_AREA, 11 * LAND_AREA_PER_CAPABILITY);
  assert.ok(Math.abs(RECIPE_ISLAND_AREA - 24631.8 * LAND_SCALE ** 2) / RECIPE_ISLAND_AREA < 0.001);
  // The drawn island's true basis is 1 / sin 20° of its squashed one (ADR-0517), to the same 0.04%.
  assert.ok(
    Math.abs(RECIPE_ISLAND_AREA / (8424.6 * LAND_SCALE ** 2) - 1 / Math.sin((20 * Math.PI) / 180)) < 3e-3,
  );
});

// ---------------------------------------------------------------------------
// the island's own numbers
// ---------------------------------------------------------------------------

test('a ring’s area is the shoelace, orientation-free, and zero below three points', () => {
  const square: GPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  assert.equal(ringArea(square), 100);
  assert.equal(ringArea([...square].reverse()), 100, 'winding must not flip the sign');
  assert.equal(ringArea([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 0, z: 3 }]), 6);
  // ⚠ Away from the origin, so `x * z` products cannot cancel by accident.
  assert.equal(ringArea([{ x: 100, z: 200 }, { x: 104, z: 200 }, { x: 100, z: 203 }]), 6);
  assert.equal(ringArea([{ x: 5, z: 5 }, { x: 9, z: 9 }]), 0);
  assert.equal(ringArea([]), 0);
});

test('an island’s area is its cells’ areas summed', () => {
  assert.equal(cellsArea(parcel('a', 'healthy', 0, 3)), 3 * CELL_W * CELL_D);
  assert.equal(cellsArea(HEALTHY), 16 * CELL_W * CELL_D);
  assert.equal(cellsArea([]), 0);
});

test('the bounding box is the points’ own extent, and an island with no points bounds nothing', () => {
  const box = cellsBounds(HEALTHY);
  assert.deepEqual(box, { minX: ORIGIN_X, maxX: ORIGIN_X + 4 * CELL_W, minZ: ORIGIN_Z, maxZ: ORIGIN_Z + 4 * CELL_D });
  for (const c of HEALTHY) {
    for (const p of c.points) {
      assert.ok(p.x >= box.minX && p.x <= box.maxX, 'a point outside the bounds');
      assert.ok(p.z >= box.minZ && p.z <= box.maxZ);
    }
  }
  // A single off-axis triangle, so each of the four extremes is read from a DIFFERENT vertex and a
  // min/max swapped on either axis is a different answer.
  const tri: LayoutCell = { ...HEALTHY[0]!, points: [{ x: 3, z: 40 }, { x: 11, z: 44 }, { x: 5, z: 39 }] };
  assert.deepEqual(cellsBounds([tri]), { minX: 3, maxX: 11, minZ: 39, maxZ: 44 });
  // ⚠ INVERTED-INFINITE over nothing, which is what makes an empty island's bounding AREA zero
  // rather than negative — asserted here rather than assumed.
  const empty = cellsBounds([]);
  assert.equal(empty.minX, Infinity);
  assert.equal(empty.maxX, -Infinity);
  assert.equal(empty.minZ, Infinity);
  assert.equal(empty.maxZ, -Infinity);
});

test('only an island whose EVERY cell is healthy wears dressing — and only an island with cells', () => {
  assert.equal(dressingEligible(HEALTHY), true);
  assert.equal(dressingEligible(island(['healthy', 'proposed', 'healthy'])), false, 'one proposed cell');
  assert.equal(dressingEligible(island(['unknown'])), false);
  assert.equal(dressingEligible(island(['unhealthy'])), false);
  assert.equal(dressingEligible(island(['healthy'], 1)), true, 'one healthy cell is enough');
  assert.equal(dressingEligible([]), false, 'no cells is not "every cell healthy"');
});

// ---------------------------------------------------------------------------
// where a point stands
// ---------------------------------------------------------------------------

test('insideRing is a ray cast — in, out, and out of a concave notch', () => {
  const square: GPoint[] = [{ x: 10, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 20 }, { x: 10, z: 20 }];
  assert.equal(insideRing(square, { x: 15, z: 15 }), true);
  assert.equal(insideRing(square, { x: 25, z: 15 }), false);
  assert.equal(insideRing(square, { x: 5, z: 15 }), false);
  assert.equal(insideRing(square, { x: 15, z: 25 }), false);
  assert.equal(insideRing(square, { x: 15, z: 5 }), false);
  // An L: the square with its top-right quarter cut away. A point in the notch is OUT even though
  // it is inside the bounding box — a box test would say in.
  const ell: GPoint[] = [
    { x: 10, z: 10 },
    { x: 20, z: 10 },
    { x: 20, z: 15 },
    { x: 15, z: 15 },
    { x: 15, z: 20 },
    { x: 10, z: 20 },
  ];
  assert.equal(insideRing(ell, { x: 18, z: 18 }), false, 'in the notch');
  assert.equal(insideRing(ell, { x: 12, z: 18 }), true);
  assert.equal(insideRing(ell, { x: 18, z: 12 }), true);
  assert.equal(insideRing([], { x: 0, z: 0 }), false);
});

// ⚠⚠ THE THREE FIXTURES BELOW ARE NOT EXTRA COVERAGE — each one is the ONLY input that separates
// the ray cast from a plausible variant of itself. They were found by brute force over 400,000
// random rings and probes, because reasoning about a ray cast's parity is exactly the reasoning
// that produces a convincing wrong answer: five of the seven variants tried agree with the real
// thing on every convex ring probed away from its boundary.
test('the crossing test is HALF-OPEN in z: a vertex on the ray counts for the edge below it', () => {
  // A triangle with a vertex at z = 2 — the probe's own z — and a spur crossing that line. The
  // whole convention lives here: `>` on both ends says INSIDE, either `>=` says outside.
  const spur: GPoint[] = [{ x: 10, z: 2 }, { x: 0, z: 8 }, { x: 3, z: 0 }];
  assert.equal(straddles({ x: 10, z: 2 }, { x: 3, z: 0 }, 2), false, 'a vertex ON the ray is not above it');
  assert.equal(straddles({ x: 0, z: 8 }, { x: 10, z: 2 }, 2), true, 'the edge above it does cross');
  assert.equal(insideRing(spur, { x: 3, z: 2 }), true);
  // Away from the vertex line the convention cannot be seen at all — which is why the fixture
  // above has to sit exactly on it.
  assert.equal(insideRing(spur, { x: 3, z: 3 }), true);
  assert.equal(insideRing(spur, { x: 9, z: 6 }), false);
});

test('the crossing X is the edge’s own line: (Δx · (z − a.z)) / Δz, offset from a', () => {
  // A slanted triangle and a probe to the WEST of it: out. Read with `(z − a.z)` multiplied by Δz
  // instead of divided, the crossing lands far to the left of the probe and the ring reports IN.
  const slant: GPoint[] = [{ x: 7, z: 5 }, { x: 2, z: 10 }, { x: 0, z: -2 }];
  assert.equal(insideRing(slant, { x: -4, z: 0 }), false, 'a point west of the ring is outside');
  assert.equal(crossingX({ x: 0, z: -2 }, { x: 7, z: 5 }, 0), 2, 'two units along a 45° edge');
  assert.equal(crossingX({ x: 7, z: 5 }, { x: 2, z: 10 }, 5), 7, 'at the edge’s own end, the end');
  // And the offset is `a.x`, not zero: the same edge shifted east crosses further east.
  assert.equal(crossingX({ x: 100, z: -2 }, { x: 107, z: 5 }, 0), 102);
});

test('insideRing pins the boundary convention: a probe exactly on a vertex is INSIDE', () => {
  // ⚠ THIS IS THE ONLY SHAPE THAT SEPARATES `<` FROM `<=` on the crossing comparison, and the
  // answer is a CONVENTION rather than a truth: a probe on the ring's own boundary has to fall one
  // way, and it falls this way. `crossingIsRight` carries the matching Stryker note.
  const hex: GPoint[] = [
    { x: 0, z: -13 },
    { x: -5, z: -8 },
    { x: -12, z: -7 },
    { x: -10, z: -13 },
    { x: -9, z: -15 },
    { x: -7, z: -15 },
  ];
  assert.equal(insideRing(hex, { x: -10, z: -13 }), true, 'a probe ON a vertex');
  assert.equal(crossingIsRight(1, 2), true);
  assert.equal(crossingIsRight(2, 2), false, 'a crossing exactly AT the probe is not to its right');
  assert.equal(crossingIsRight(3, 2), false);
});

test('cellAt is the FIRST containing cell, and null off every cell', () => {
  const cells = parcel('a', 'healthy', 0, 2);
  assert.equal(cellAt(cells, { x: ORIGIN_X + 5, z: ORIGIN_Z + 5 })?.cellId, 'a-0-0');
  assert.equal(cellAt(cells, { x: ORIGIN_X + CELL_W + 5, z: ORIGIN_Z + 5 })?.cellId, 'a-0-1');
  assert.equal(cellAt(cells, { x: ORIGIN_X - 5, z: ORIGIN_Z + 5 }), null);
  assert.equal(cellAt(cells, { x: ORIGIN_X + 5, z: ORIGIN_Z + CELL_D + 5 }), null);
  assert.equal(cellAt([], { x: 0, z: 0 }), null);
  // Two cells over one point: the earlier one answers.
  const twice = [...cells, { ...cells[0]!, cellId: 'again' }];
  assert.equal(cellAt(twice, { x: ORIGIN_X + 5, z: ORIGIN_Z + 5 })?.cellId, 'a-0-0');
});

// ---------------------------------------------------------------------------
// where dressing may not stand
// ---------------------------------------------------------------------------

test('clear of the beach at the band’s width exactly, not inside it', () => {
  assert.equal(beachClear(DRESSING_BEACH), true, 'the shore field caps at the width — the cap IS clear');
  assert.equal(beachClear(DRESSING_BEACH - 1e-9), false);
  assert.equal(beachClear(0), false);
  assert.equal(beachClear(20), true);
});

test('clear of the path is the recipe’s wear < 0.30 through the wear layer’s own smoothstep', () => {
  assert.equal(pathClear(0), false, 'on the centreline the wear is 1');
  assert.equal(pathClear(WEAR_FALLOFF), true, 'at the falloff the wear is 0');
  assert.equal(pathClear(100), true);
  // THE BOUNDARY, derived from the same function rather than typed: the distance at which wearOf
  // crosses the ceiling, found by bisection on wearOf itself.
  let lo = 0;
  let hi = WEAR_FALLOFF;
  for (const _ of Array.from({ length: 60 })) {
    void _;
    const mid = (lo + hi) / 2;
    if (wearOf(mid) < DRESSING_WEAR_CEILING) hi = mid;
    else lo = mid;
  }
  assert.equal(pathClear(hi + 1e-9), true);
  assert.equal(pathClear(lo - 1e-9), false);
  // And the header's number: about 1.91 TUNED units from the centreline on the shipped falloff —
  // × LAND_SCALE (`land-per-capability.ts`) on the ground, the falloff being 3.0 × LAND_SCALE. The
  // tolerance is stated in units, so it scales with the number it bounds.
  assert.ok(
    Math.abs(hi - 1.908 * LAND_SCALE) < 0.005 * LAND_SCALE,
    `the path keeps dressing ${hi.toFixed(3)} units away`,
  );
});

/** One rectangular island as `cell-ground` descriptors — one big cell, so its rim is its outline. */
function rectIsland(islandId: string, x0: number, z0: number, w: number, d: number): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    transform: { x: x0 + w / 2, y: 0, z: z0 + d / 2 },
    group: 'cell-ground',
    material: 'healthy',
    island: islandId,
    parcel: `${islandId}-cap`,
    points: [
      { x: x0, y: 0, z: z0 },
      { x: x0 + w, y: 0, z: z0 },
      { x: x0 + w, y: 0, z: z0 + d },
      { x: x0, y: 0, z: z0 + d },
    ],
  };
}

/**
 * TUNED-island units → ground units. The synthetic islands below were drawn in the units every
 * band constant was judged in; the shipped beach, wear falloff, coast outset and dock reach are
 * all × LAND_SCALE (`land-per-capability.ts`), so the FIXTURE is scaled by the same factor — the
 * island, its paths and every probe — and each claim below is the same claim on an island of the
 * shipped scale. (Scaling only the probes would leave the coast clip's corner cuts, which the
 * 4-vertex rectangle's Chaikin rounding carves INSIDE the rim, at a different fraction of it.)
 */
const g = (tuned: number): number => tuned * LAND_SCALE;

test('dressingExclusion reads the beach off the island’s rim and the path off its polylines', () => {
  const rim = rectIsland('r', 0, 0, g(200), g(100));
  const bare = dressingExclusion([rim], []);
  assert.equal(bare.clear(g(100), g(50)), true, 'the middle of a 200 x 100 island');
  assert.equal(bare.clear(g(5), g(50)), false, '5 units from the west rim');
  assert.equal(bare.clear(g(100), g(8)), false, '8 units from the north rim');
  assert.equal(bare.clear(g(100), g(9)), true, '9 units from it — the band’s own width');
  // A path straight across the middle: on it, no; the recipe's distance off it, yes.
  const pathed = dressingExclusion([rim], [[{ x: g(20), z: g(50) }, { x: g(180), z: g(50) }]]);
  assert.equal(pathed.clear(g(100), g(50)), false, 'on the centreline');
  assert.equal(pathed.clear(g(100), g(51.5)), false, '1.5 off it — still worn past 0.30');
  assert.equal(pathed.clear(g(100), g(52.5)), true, '2.5 off it — clear');
  assert.equal(pathed.clear(g(100), g(20)), true);
  // ⚠ BOTH halves bind: a point clear of the path but on the beach is still refused.
  assert.equal(pathed.clear(g(100), g(5)), false);
});

test('islandExclusion clips the island’s own ground to the shipped coast and docks the strips on it', () => {
  // A 200 x 100 island named `a` (tuned units, × LAND_SCALE through `g` like the test above — the
  // coast clip, dock reach, path jitter and wear falloff are all scaled, so the fixture is too),
  // and a trail strip arriving from the west whose landward end sits
  // on the island's UNCLIPPED west rim — within dock reach of the clipped coast, which lies a
  // beach's width further out.
  const ground = rectIsland('a', 0, 0, g(200), g(100));
  const strip: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: g(-20), y: 0, z: g(50) },
    group: 'trail-strip',
    points: [
      { x: g(-40), y: 0, z: g(50) },
      { x: g(-20), y: 0, z: g(50) },
      { x: 0, y: 0, z: g(50) },
    ],
    width: 3,
    usage: 1,
    hidden: false,
    edges: [],
    segment: 'a/west',
  };
  const skipped: Descriptor3D = { kind: 'skipped', sceneKind: 'parcel-blade' };
  const ex = islandExclusion([ground, strip, skipped], 'a');
  // The one-dock path runs dock -> waypoint -> the rim's centroid, so the island's middle is ON it.
  assert.equal(ex.clear(g(100), g(50)), false, 'the centroid is on the worn path');
  // Far from the path and the beach: clear. The path's control point is jittered off the chord,
  // so probe a corner of the interior rather than a point on the chord.
  assert.equal(ex.clear(g(150), g(25)), true);
  // On the unclipped rim: inside the beach band by construction (the coast is outset from it).
  assert.equal(ex.clear(g(200), g(25)), false, 'the rim sits inside the band');
  // ⚠ NON-VACUITY, the other way: the SAME island with no strip has no path, so its centroid is
  // clear — which is what shows the refusal above came from the dock, not from the beach.
  assert.equal(islandExclusion([ground, skipped], 'a').clear(g(100), g(50)), true);
  // And an island the stream holds no ground for has no coast and no path: everything is clear.
  assert.equal(islandExclusion([ground, strip], 'nowhere').clear(g(100), g(50)), true);

  // ⚠⚠ THE ISLAND IS WHAT THIS FILTER DECIDES, and a SECOND island in the stream is the only thing
  // that shows it. A neighbour's parcels handed to `clipToCoast` would give island `a` a second
  // coast to keep clear of — so a point deep inside `a` that is near `b`'s rim would stop being
  // clear, and `a`'s own picture would be wrong for a reason nothing on `a` could explain.
  const neighbour = rectIsland('b', g(400), 0, g(120), g(100));
  const twoIslands = islandExclusion([ground, neighbour, strip], 'a');
  for (const at of [
    { x: g(150), z: g(25) },
    { x: g(195), z: g(50) },
    { x: g(100), z: g(50) },
    { x: g(40), z: g(80) },
  ]) {
    assert.equal(
      twoIslands.clear(at.x, at.z),
      ex.clear(at.x, at.z),
      `the neighbour island moved a's exclusion at ${at.x},${at.z}`,
    );
  }
  // ⚠ NON-VACUITY, and it is what makes the loop above mean something: five units inside `b`'s
  // west rim is inside `b`'s beach band and 200 units from anything `a` owns. Asked about `b` the
  // exclusion refuses it; asked about `a` — the same stream, the same point — it is clear. So the
  // filter reads its argument rather than answering about whatever ground it was handed first.
  assert.equal(islandExclusion([ground, neighbour, strip], 'b').clear(g(405), g(50)), false, 'inside b’s band');
  assert.equal(twoIslands.clear(g(405), g(50)), true, 'b’s band is not a’s business');
});
