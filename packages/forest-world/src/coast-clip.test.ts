// coast-clip.test.ts — the claims the SHIPPED map's coastline rests on.
//
// ⚠⚠ THE TEST THIS FILE EXISTS FOR IS {@link the area conservation one}. The first working version
// of `coastArcs` matched the rim to the curve with a nearest-point SEARCH, which is the obvious
// answer and is wrong: on the shipped fixture it lands 2 of 52 rim vertices one segment BEHIND
// their predecessor, so the arc between them runs 207 segments the long way instead of 1 and two
// boundary parcels swallow the whole coastline. The island still had the right BOUNDS and the right
// parcel COUNT and its picture would have been recognisably an island — the summed parcel area was
// 3.0x its true value and nothing else said so. So the area assertion below is the one that would
// have caught it, and the fixed correspondence is asserted directly beside it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_SCALE } from './land-per-capability.js';
import {
  COAST_MODES,
  COAST_OUTSET,
  COAST_SCALE_LADDER,
  GROUND_COAST_OUTSET,
  SHIPPED_COAST,
  isSimpleRing,
  applyDisplacement,
  clipToCoast,
  coastArcs,
  coastCurve,
  coastDisplacement,
  edgeKey,
  nearestOnSegment,
  rimLoops,
  vertexKey,
  type CoastMode,
  type CoastPoint,
} from './coast-clip.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** A 2x2 block of unit-ish square parcels: four rings sharing one centre vertex, so the block has
 *  8 boundary edges, 4 interior ones and exactly one rim loop. Small enough to reason about by
 *  hand, and it is NOT convex-per-parcel by accident — every parcel is a square, which is what
 *  makes the shared-vertex claim checkable without a mesh generator. */
const BLOCK: CoastPoint[][] = [
  [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }],
  [{ x: 10, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 10, z: 10 }],
  [{ x: 0, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 20 }, { x: 0, z: 20 }],
  [{ x: 10, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 20 }, { x: 10, z: 20 }],
];

/** The block as `cell-ground` descriptors on one island. `null` means the mapper could not name
 *  one — spelled `null` rather than `undefined` because passing `undefined` to a parameter with a
 *  default takes the DEFAULT, which is how the unhomed test below first passed a homed island and
 *  reported the module broken. */
function blockCells(island: string | null = 'story-a'): InstanceDescriptor[] {
  return BLOCK.map((ring, i) => {
    const d: InstanceDescriptor = {
      kind: 'cell-ground',
      transform: { x: 0, y: 0, z: 0 },
      group: 'cell-ground',
      points: ring.map((p) => ({ x: p.x, y: 0, z: p.z })),
      parcel: `cap-${i}`,
      material: 'healthy',
    };
    if (island !== null) d.island = island;
    return d;
  });
}

/** Twice the signed shoelace area of a ring — SIGNED, so a ring that folds back on itself does not
 *  get to hide behind an absolute value. */
function signedArea2(ring: readonly CoastPoint[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    s += p.x * q.z - q.x * p.z;
  }
  return s;
}

/** The summed |area| of every parcel in a descriptor set — the island's own area while the parcels
 *  tile it, and a number that BLOWS UP the moment a ring self-crosses. */
function summedArea(cells: readonly InstanceDescriptor[]): number {
  return cells.reduce(
    (a, c) => a + Math.abs(signedArea2((c.points ?? []).map((p) => ({ x: p.x, z: p.z })))) / 2,
    0,
  );
}

function ringsOf(cells: readonly InstanceDescriptor[]): CoastPoint[][] {
  return cells.map((c) => (c.points ?? []).map((p) => ({ x: p.x, z: p.z })));
}

// ---------------------------------------------------------------------------
// The rim
// ---------------------------------------------------------------------------

test('rimLoops finds the one closed loop of edges used by a single parcel', () => {
  const loops = rimLoops(BLOCK);
  assert.equal(loops.length, 1);
  assert.equal(loops[0]!.length, 8);
  // Every rim vertex is on the block's outside; the shared centre (10, 10) is on no boundary edge.
  const keys = new Set(loops[0]!.map(vertexKey));
  assert.equal(keys.has(vertexKey({ x: 10, z: 10 })), false);
  assert.equal(keys.size, 8);
});

test('rimLoops walks the loop in order — consecutive vertices are 10 apart, never diagonal', () => {
  const loop = rimLoops(BLOCK)[0]!;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    assert.equal(Math.hypot(b.x - a.x, b.z - a.z), 10, `step ${i} is not one block edge`);
  }
});

test('rimLoops ignores a ring that bounds no area', () => {
  const withSliver = [...BLOCK, [{ x: 50, z: 50 }, { x: 51, z: 50 }]];
  assert.deepEqual(rimLoops(withSliver), rimLoops(BLOCK));
});

test('an interior seam is one edge however its two parcels traverse it', () => {
  const a = { x: 10, z: 0 };
  const b = { x: 10, z: 10 };
  assert.equal(edgeKey(a, b), edgeKey(b, a));
});

// ---------------------------------------------------------------------------
// The curve, and the correspondence that is NOT a search
// ---------------------------------------------------------------------------

test('coastCurve outsets 1:1 and Chaikin-doubles twice', () => {
  const rim = rimLoops(BLOCK)[0]!;
  const curve = coastCurve(rim, 'story-a');
  assert.equal(curve.outset.length, rim.length);
  assert.equal(curve.smooth.length, rim.length * 4);
});

test('the outset pushes every rim vertex OUTWARD, by about the authored beach', () => {
  const rim = rimLoops(BLOCK)[0]!;
  const curve = coastCurve(rim, 'story-a');
  const centre = { x: 10, z: 10 };
  for (let i = 0; i < rim.length; i += 1) {
    const before = Math.hypot(rim[i]!.x - centre.x, rim[i]!.z - centre.z);
    const after = Math.hypot(curve.outset[i]!.x - centre.x, curve.outset[i]!.z - centre.z);
    assert.ok(after > before, `vertex ${i} did not move outward`);
  }
  // `jitteredOutset` modulates COAST_OUTSET by ±(0.7 wave + wobble) * 0.5, so the widest it can
  // ever reach is COAST_OUTSET * 1.5 — the cap the 2D map's own comment relies on to keep a coast
  // inside the inter-island gap — and the narrowest is COAST_OUTSET * 0.5.
  // × LAND_SCALE (`land-per-capability.ts`): the GROUND outsets by the 2D outset scaled, so the
  // whole envelope is [0.5, 1.5] × GROUND_COAST_OUTSET. BOTH bounds bind: an UNSCALED outset
  // (max ≈ 10.2 on this rim) breaks the upper one, a twice-scaled outset breaks the lower one.
  const widths = curve.outset.map((p, i) =>
    Math.hypot(p.x - rim[i]!.x, p.z - rim[i]!.z),
  );
  assert.equal(GROUND_COAST_OUTSET, COAST_OUTSET * LAND_SCALE);
  for (const w of widths) {
    assert.ok(w > 0 && w <= GROUND_COAST_OUTSET * 1.5, `beach ${w} out of range`);
    assert.ok(w >= GROUND_COAST_OUTSET * 0.5, `beach ${w} under the jitter's floor`);
  }
  // And the jitter really modulates about the ground outset — some vertex wider, some narrower.
  assert.ok(Math.max(...widths) > GROUND_COAST_OUTSET, 'no vertex reached past the nominal beach');
  assert.ok(Math.min(...widths) < GROUND_COAST_OUTSET, 'no vertex fell short of the nominal beach');
});

test('coastArcs partitions the curve EXACTLY once — no point used twice, none left out', () => {
  const rim = rimLoops(BLOCK)[0]!;
  const curve = coastCurve(rim, 'story-a');
  const { landings, arcs } = coastArcs(curve);
  assert.equal(landings.length, rim.length);
  assert.equal(arcs.length, rim.length);
  const used = arcs.flat();
  assert.equal(used.length, curve.smooth.length);
  assert.equal(new Set(used.map(vertexKey)).size, new Set(curve.smooth.map(vertexKey)).size);
});

test('each arc is the curve run FORWARD from its own landing — never the long way round', () => {
  const rim = rimLoops(BLOCK)[0]!;
  const curve = coastCurve(rim, 'story-a');
  const index = new Map(curve.smooth.map((p, i) => [vertexKey(p), i]));
  const { arcs } = coastArcs(curve);
  const n = curve.smooth.length;
  for (let i = 0; i < arcs.length; i += 1) {
    const ids = arcs[i]!.map((p) => index.get(vertexKey(p))!);
    for (let k = 1; k < ids.length; k += 1) {
      assert.equal((ids[k]! - ids[k - 1]! + n) % n, 1, `arc ${i} skips curve points`);
    }
  }
});

test('coastArcs REFUSES a curve that is not the outset loop doubled twice', () => {
  const rim = rimLoops(BLOCK)[0]!;
  const curve = coastCurve(rim, 'story-a');
  // The WHOLE message, not its opening: a reader who hits this has to be told what the curve
  // actually was, and half a message is a mutant no partial match can catch.
  assert.throws(
    () => coastArcs({ outset: curve.outset, smooth: curve.smooth.slice(0, -1) }),
    /coastArcs: expected 32 curve points for 8 outset points at 2 Chaikin passes, got 31/,
  );
});

test('nearestOnSegment returns a point ON the segment, both ends included', () => {
  const a = { x: 0, z: 0 };
  const b = { x: 10, z: 0 };
  assert.deepEqual(nearestOnSegment({ x: 4, z: 7 }, a, b), { x: 4, z: 0 });
  assert.deepEqual(nearestOnSegment({ x: -9, z: 1 }, a, b), { x: 0, z: 0 });
  assert.deepEqual(nearestOnSegment({ x: 99, z: 1 }, a, b), { x: 10, z: 0 });
  assert.deepEqual(nearestOnSegment({ x: 3, z: 3 }, a, a), { x: 0, z: 0 });
});

// ---------------------------------------------------------------------------
// The displacement, and what it does to a parcel
// ---------------------------------------------------------------------------

test('the interior vertex never moves, under any mode', () => {
  for (const mode of COAST_MODES) {
    const d = coastDisplacement(BLOCK, 'story-a', mode);
    assert.equal(d.moved.has(vertexKey({ x: 10, z: 10 })), false, mode);
  }
});

test('a shared rim vertex moves ONCE, so the two parcels holding it stay watertight', () => {
  for (const mode of COAST_MODES.filter((m) => m !== 'none')) {
    const clipped = clipToCoast(blockCells(), mode);
    const rings = ringsOf(clipped);
    // (10, 0) is the rim vertex the two top parcels share.
    const holders = rings.filter((r, i) =>
      (BLOCK[i] ?? []).some((p) => vertexKey(p) === vertexKey({ x: 10, z: 0 })),
    );
    assert.equal(holders.length, 2, mode);
    const seen = new Set<string>();
    for (const ring of holders) {
      // The moved vertex is whichever of this ring's points is NOT one of the original interior
      // ones; find it by asking the displacement directly.
      const d = coastDisplacement(BLOCK, 'story-a', mode);
      const target = d.moved.get(vertexKey({ x: 10, z: 0 }))!;
      assert.ok(
        ring.some((p) => vertexKey(p) === vertexKey(target)),
        `${mode}: a holder of the shared rim vertex does not carry its moved position`,
      );
      seen.add(vertexKey(target));
    }
    assert.equal(seen.size, 1, `${mode}: the shared vertex moved to two different places`);
  }
});

test('`none` is the identity — the SAME OBJECTS, not equal copies', () => {
  // ⚠ IDENTITY RATHER THAN `deepEqual`, and the difference is what the assertion is for. Without
  // the early return, `none` would run the whole path, find nothing to move, and rebuild every
  // descriptor through `{ ...d, points }` — producing objects that are deeply EQUAL and freshly
  // allocated. The control has to be the map itself, not a copy of it.
  const cells = blockCells();
  const out = clipToCoast(cells, 'none');
  assert.deepEqual(out, cells);
  out.forEach((d, i) => assert.equal(d, cells[i], `descriptor ${i} was rebuilt`));
});

test('only `subdivide` adds ring vertices, and it adds the whole curve exactly once', () => {
  const rimLength = rimLoops(BLOCK)[0]!.length;
  const before = ringsOf(blockCells()).reduce((a, r) => a + r.length, 0);
  const counts = new Map<CoastMode, number>();
  for (const mode of COAST_MODES) {
    counts.set(
      mode,
      ringsOf(clipToCoast(blockCells(), mode)).reduce((a, r) => a + r.length, 0),
    );
  }
  assert.equal(counts.get('none'), before);
  assert.equal(counts.get('outset'), before);
  assert.equal(counts.get('project'), before);
  // Two Chaikin passes → 4 curve points per rim vertex, every one of them inserted once.
  assert.equal(counts.get('subdivide'), before + rimLength * 4);
});

test('THE PARCELS STILL TILE THE ISLAND — summed parcel area IS the area the rim encloses', () => {
  // ⚠⚠ THE REGRESSION, AND IT IS AN EQUALITY RATHER THAN A BOUND. A nearest-point search matched
  // two rim vertices out of order and two boundary parcels each swallowed the whole coastline;
  // bounds, parcel count, ring count and winding all still looked right and the island's summed
  // parcel area went to 3.0x. No ratio threshold is the right instrument for that — the invariant
  // is that parcels tile their island with no gap and no overlap, so their summed area IS the area
  // enclosed by the rim they collectively bound. A folded ring breaks it in one direction and a
  // gap breaks it in the other, and neither needs a magic number to notice.
  for (const mode of COAST_MODES) {
    const clipped = clipToCoast(blockCells(), mode);
    const loops = rimLoops(ringsOf(clipped));
    assert.equal(loops.length, 1, `${mode}: the clipped island is not one landmass`);
    const enclosed = Math.abs(signedArea2(loops[0]!)) / 2;
    const tiled = summedArea(clipped);
    assert.ok(
      Math.abs(tiled - enclosed) < enclosed * 1e-9,
      `${mode}: parcels sum to ${tiled} inside a rim enclosing ${enclosed} — a ring folded or a gap opened`,
    );
    assert.ok(enclosed > 0, `${mode}: the island bounds nothing`);
  }
});

test('the beach GROWS the island, and only the modes that draw one', () => {
  const plain = summedArea(blockCells());
  assert.equal(summedArea(clipToCoast(blockCells(), 'none')), plain);
  for (const mode of COAST_MODES.filter((m) => m !== 'none')) {
    assert.ok(summedArea(clipToCoast(blockCells(), mode)) > plain, `${mode}: the island did not grow`);
  }
});

test('every parcel keeps the winding it arrived with', () => {
  for (const mode of COAST_MODES) {
    const clipped = ringsOf(clipToCoast(blockCells(), mode));
    for (let i = 0; i < clipped.length; i += 1) {
      assert.equal(
        Math.sign(signedArea2(clipped[i]!)),
        Math.sign(signedArea2(BLOCK[i]!)),
        `${mode}: parcel ${i} flipped`,
      );
    }
  }
});

test('the clip carries every parcel identity through untouched', () => {
  for (const mode of COAST_MODES) {
    const clipped = clipToCoast(blockCells(), mode);
    assert.equal(clipped.length, 4);
    clipped.forEach((c, i) => {
      assert.equal(c.parcel, `cap-${i}`, mode);
      assert.equal(c.island, 'story-a', mode);
      assert.equal(c.material, 'healthy', mode);
      assert.equal(c.kind, 'cell-ground', mode);
    });
  }
});

test('a descriptor that is not ground passes through in place', () => {
  const bloom: InstanceDescriptor = {
    kind: 'uat-bloom',
    transform: { x: 3, y: 0, z: 4 },
    group: 'uat-bloom',
  };
  const mixed = [...blockCells(), bloom];
  const out = clipToCoast(mixed, 'subdivide');
  assert.equal(out.length, 5);
  assert.deepEqual(out[4], bloom);
});

test('a parcel the mapper could not attribute to an island is LEFT ALONE', () => {
  // No island id means no story seed, so there is no coast to draw — and pooling unhomed parcels
  // would compute a rim across the sea between two unrelated ones.
  const cells = blockCells(null);
  const out = clipToCoast(cells, 'subdivide');
  assert.deepEqual(out, cells);
});

test('two islands get two coasts, and neither reaches into the other', () => {
  const a = blockCells('story-a');
  const b = blockCells('story-b').map((c) => ({
    ...c,
    points: (c.points ?? []).map((p) => ({ x: p.x + 200, y: p.y, z: p.z })),
  }));
  const out = clipToCoast([...a, ...b], 'outset');
  const xs = out.flatMap((c) => (c.points ?? []).map((p) => p.x));
  const near = xs.filter((x) => x < 100);
  const far = xs.filter((x) => x >= 100);
  assert.equal(near.length, far.length);
  assert.ok(Math.max(...near) < Math.min(...far), 'the two islands overlap after clipping');
  // Different story ids seed different waves, so the two coasts are not translations of each other.
  const shifted = far.map((x) => x - 200);
  assert.notDeepEqual(near, shifted);
});

test('applyDisplacement reads an inserted arc BACKWARDS for a ring that traverses the edge the other way', () => {
  const forward: CoastPoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ];
  const backward: CoastPoint[] = [
    { x: 10, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: 10 },
  ];
  const inserted = new Map([
    [
      edgeKey({ x: 0, z: 0 }, { x: 10, z: 0 }),
      { from: vertexKey({ x: 0, z: 0 }), points: [{ x: 3, z: -1 }, { x: 7, z: -1 }] },
    ],
  ]);
  const d = { moved: new Map<string, CoastPoint>(), inserted };
  assert.deepEqual(applyDisplacement(forward, d).slice(1, 3), [
    { x: 3, z: -1 },
    { x: 7, z: -1 },
  ]);
  assert.deepEqual(applyDisplacement(backward, d).slice(1, 3), [
    { x: 7, z: -1 },
    { x: 3, z: -1 },
  ]);
});

test('the coast is DETERMINISTIC and story-seeded', () => {
  const once = clipToCoast(blockCells(), 'subdivide');
  const twice = clipToCoast(blockCells(), 'subdivide');
  assert.deepEqual(once, twice);
  const other = clipToCoast(blockCells('story-b'), 'subdivide');
  assert.notDeepEqual(
    once.map((c) => c.points),
    other.map((c) => c.points),
  );
});

// ---------------------------------------------------------------------------
// What belongs to no coast — one predicate, three ways to fail it
// ---------------------------------------------------------------------------

/** A descriptor that carries an island AND a ring but is NOT ground. If the clip read `island` and
 *  `points` without asking about `kind`, this would join the island's rim and be rewritten — and
 *  the picture would be an ordinary island with a signed criterion's bloom moved onto the
 *  shoreline. (It was the `story-tree` family until that was retired, ADR-0508; a bloom carries
 *  the same island id and plays the same part here.) */
const BLOOM_ON_THE_ISLAND: InstanceDescriptor = {
  kind: 'uat-bloom',
  transform: { x: 5, y: 0, z: 5 },
  group: 'uat-bloom',
  island: 'story-a',
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 0, z: 0 },
    { x: 40, y: 0, z: 40 },
  ],
};

/** Ground, on the island, with no ring at all. It bounds nothing, so it contributes no shore edge
 *  and has nothing to rewrite. */
const GROUND_WITHOUT_A_RING: InstanceDescriptor = {
  kind: 'cell-ground',
  transform: { x: 0, y: 0, z: 0 },
  group: 'cell-ground',
  island: 'story-a',
  material: 'healthy',
};

test('a NON-GROUND descriptor is left alone even when it carries an island and a ring', () => {
  const out = clipToCoast([...blockCells(), BLOOM_ON_THE_ISLAND], 'subdivide');
  assert.equal(out[4], BLOOM_ON_THE_ISLAND, 'the bloom was rewritten');
  // And it did not reach the rim either: the island's coast is what it is without the tree.
  const alone = clipToCoast(blockCells(), 'subdivide');
  assert.deepEqual(out.slice(0, 4), alone);
});

test('GROUND WITH NO RING is left alone, and contributes no shore', () => {
  const out = clipToCoast([...blockCells(), GROUND_WITHOUT_A_RING], 'subdivide');
  assert.equal(out[4], GROUND_WITHOUT_A_RING);
  assert.deepEqual(out.slice(0, 4), clipToCoast(blockCells(), 'subdivide'));
});

test('an UNHOMED ground parcel never joins a named island\'s rim', () => {
  const unhomed = blockCells(null).map((d) => ({
    ...d,
    points: (d.points ?? []).map((p) => ({ ...p, x: p.x + 500 })),
  }));
  const out = clipToCoast([...blockCells(), ...unhomed], 'subdivide');
  out.slice(4).forEach((d, i) => assert.equal(d, unhomed[i], `unhomed parcel ${i} was rewritten`));
  assert.deepEqual(out.slice(0, 4), clipToCoast(blockCells(), 'subdivide'));
});

// ---------------------------------------------------------------------------
// The rim's own guard, and the fold cap's own loop
// ---------------------------------------------------------------------------

test('a DEGENERATE rim loop is skipped, and the island still gets its coast', () => {
  // A one-point ring forges a ONE-VERTEX rim loop (see the test below). Handed to the coast
  // machinery that loop outsets to itself and Chaikin-rounds to itself, so the curve comes back the
  // same length as the rim and `coastArcs` REFUSES it. The guard is what stops a stray descriptor
  // from taking the whole island's coast down with it.
  // ⚠ THE FIXTURE IS A RING WITH A REPEATED VERTEX, not a one-point ring, and the difference is
  // what makes this test reach the guard at all. `rimLoops` refuses a ring of fewer than three
  // points on its own, so a one-point sliver never gets as far as a rim loop. A THREE-point ring
  // whose first two vertices coincide does: its self-edge is used once, so it chains into a
  // one-vertex "loop", and that loop outsets and Chaikin-rounds to itself — leaving a curve the
  // same length as the rim, which `coastArcs` refuses. One malformed parcel would take the whole
  // island's coast down with it.
  const withSpur: CoastPoint[][] = [
    ...BLOCK,
    [
      { x: 50, z: 50 },
      { x: 50, z: 50 },
      { x: 60, z: 50 },
    ],
  ];
  assert.equal(rimLoops(withSpur).some((l) => l.length < 3), true, 'the fixture forges no short loop');
  assert.doesNotThrow(() => coastDisplacement(withSpur, 'story-a', 'outset'));
  assert.deepEqual(
    [...coastDisplacement(withSpur, 'story-a', 'outset').moved.entries()].sort(),
    [...coastDisplacement(BLOCK, 'story-a', 'outset').moved.entries()].sort(),
  );
});

test('a ring of ONE point contributes no shore — it would otherwise forge a rim loop', () => {
  // A single-point ring emits the self-edge (p, p), which is used ONCE and therefore looks exactly
  // like a boundary edge. Chained, it becomes a one-vertex "loop" the coast machinery would then be
  // asked to outset. The guard is what stops that, and this is the fixture that reaches it.
  const loops = rimLoops([...BLOCK, [{ x: 50, z: 50 }]]);
  assert.deepEqual(loops, rimLoops(BLOCK));
});

test('a THREE-point parcel is a real parcel — its edges are shore', () => {
  // The guard is `< 3`, not `<= 3`: a triangle bounds area and its outer edges are coastline.
  const triangle: CoastPoint[] = [
    { x: 20, z: 0 },
    { x: 30, z: 10 },
    { x: 20, z: 10 },
  ];
  const loops = rimLoops([...BLOCK, triangle]);
  assert.equal(loops.length, 1);
  assert.ok(
    loops[0]!.some((p) => vertexKey(p) === vertexKey({ x: 30, z: 10 })),
    "the triangle's own corner is not on the rim",
  );
});

test('a THREE-vertex island still gets a coast', () => {
  // `coastDisplacement` skips a rim loop of fewer than three vertices; a triangle is exactly three,
  // and the boundary of a triangle IS an island's shore.
  const triangle: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    island: 'story-tri',
    material: 'healthy',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 60, y: 0, z: 0 },
      { x: 0, y: 0, z: 60 },
    ],
  };
  const out = clipToCoast([triangle], 'outset');
  assert.notDeepEqual(out[0]!.points, triangle.points, 'the triangle island got no coast');
  assert.equal(out[0]!.points!.length, 3);
});

test('the cap leaves a HONEST coast alone, and every scale it reports is a rung', () => {
  // ⚠ THE BLOCK DOES NOT FOLD, AND THAT IS THE ASSERTION RATHER THAN A LIMITATION OF THE FIXTURE.
  // Its parcels are 10 units across against a beach of at most 10.5 in TUNED units (× LAND_SCALE
  // on the ground: at most ~3.96, against the same 10 — a convex coast folds at NO beach), and a convex island offset
  // along its own vertex bisectors stays simple however wide the beach is — a fold needs a rim that
  // TURNS sharply beside a parcel too shallow to absorb the turn. So the cap must bind NOWHERE
  // here: a cap that fired on an honest coast would be spending beach nothing asked it to spend.
  // The island that does fold is the one the studio ships, and `harness/shipped-coast-scene.test.ts`
  // is where that is asserted — it is the fixture with the real geometry.
  for (const mode of COAST_MODES.filter((m) => m !== 'none')) {
    const d = coastDisplacement(BLOCK, 'story-a', mode);
    assert.equal(d.scales.size, 8, `${mode}: every rim vertex should report a scale`);
    for (const s of d.scales.values()) {
      assert.equal(s, 1, `${mode}: the cap bound at ${s} on a coast that does not fold`);
      assert.ok(COAST_SCALE_LADDER.includes(s), `${mode}: scale ${s} is not a rung of the ladder`);
    }
    for (const ring of BLOCK) {
      assert.equal(isSimpleRing(applyDisplacement(ring, d)), true, `${mode}: a ring folds`);
    }
  }
  assert.equal(coastDisplacement(BLOCK, 'story-a', 'none').scales.size, 0, 'the control caps nothing');
});

/**
 * AN ISLAND WHOSE COAST GENUINELY FOLDS — seven 24 x 4 parcels in a cross.
 *
 * ⚠⚠ IT IS SEARCHED FOR RATHER THAN GUESSED, and the first three fixtures tried did not fold. A
 * convex island offset along its own vertex bisectors stays simple however wide the beach is; a
 * fold needs a rim that TURNS sharply beside a parcel too SHALLOW to absorb the turn. Long thin
 * parcels arranged in a cross give both — the arms are 4 units deep against a beach reaching 10.5,
 * and the rim turns twice at every armpit.
 *
 * × LAND_SCALE (`land-per-capability.ts`): those are TUNED-island units. The ground's beach is the
 * 2D outset × LAND_SCALE, so the fixture is scaled with it — the same cross against the same
 * beach, in ground units — and the fold it was searched for is the same fold.
 */
const FOLDING: CoastPoint[][] = [
  [1, 0],
  [1, 1],
  [1, 2],
  [0, 1],
  [2, 1],
  [1, 3],
  [1, 4],
].map(([cx, cy]) => [
  { x: cx! * 24 * LAND_SCALE, z: cy! * 4 * LAND_SCALE },
  { x: (cx! + 1) * 24 * LAND_SCALE, z: cy! * 4 * LAND_SCALE },
  { x: (cx! + 1) * 24 * LAND_SCALE, z: (cy! + 1) * 4 * LAND_SCALE },
  { x: cx! * 24 * LAND_SCALE, z: (cy! + 1) * 4 * LAND_SCALE },
]);

test('⚠⚠ THE FOLD CAP RUNS — it binds, it binds ONLY where it must, and nothing folds after', () => {
  for (const mode of COAST_MODES.filter((m) => m !== 'none')) {
    const d = coastDisplacement(FOLDING, 'story-c', mode);
    const scales = [...d.scales.values()];
    assert.equal(scales.length, 16, `${mode}: every rim vertex should report a scale`);
    const bound = scales.filter((x) => x < 1);
    assert.ok(bound.length > 0, `${mode}: the cap never bound on a fixture built to fold`);
    assert.ok(
      bound.length < scales.length,
      `${mode}: the cap demoted EVERY rim vertex — it is not selecting, it is just giving up`,
    );
    for (const x of scales) {
      assert.ok(COAST_SCALE_LADDER.includes(x), `${mode}: scale ${x} is not a rung of the ladder`);
    }
    for (const ring of FOLDING) {
      assert.equal(isSimpleRing(applyDisplacement(ring, d)), true, `${mode}: a ring still folds`);
    }
  }
});

test('the fold cap is the ONLY reason a vertex keeps less than its whole beach', () => {
  // Uncapped, this island folds. So the capped result must differ from the uncapped targets at
  // exactly the bound vertices and nowhere else — which is what says the ladder is being walked
  // rather than applied wholesale.
  const d = coastDisplacement(FOLDING, 'story-c', 'outset');
  const rim = rimLoops(FOLDING)[0]!;
  const curve = coastCurve(rim, 'story-c');
  let atFull = 0;
  rim.forEach((v, i) => {
    const moved = d.moved.get(vertexKey(v))!;
    const target = curve.outset[i]!;
    const same = vertexKey(moved) === vertexKey(target);
    assert.equal(same, d.scales.get(vertexKey(v)) === 1, 'a scale disagrees with where the vertex went');
    if (same) atFull += 1;
  });
  assert.ok(atFull > 0, 'no vertex kept its whole beach');
});

test('isSimpleRing counts CROSSINGS, never touches', () => {
  // A ring whose vertex lies exactly ON a non-adjacent edge bounds the same ground it did and
  // triangulates to zero-area triangles rather than to overlapping ones. Widening the test from
  // strict to inclusive would cap coasts that are perfectly honest.
  const touching: CoastPoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 5, z: 0 },
    { x: 0, z: 10 },
  ];
  assert.equal(isSimpleRing(touching), true, 'a touch was read as a crossing');
  // ⚠ AND THE SAME RING REVERSED. Reversing a ring flips the SIGN of every side test, so the zero
  // that proves the touch moves from one half of the straddle test to the other. One winding alone
  // leaves the other half's comparison untested.
  assert.equal(isSimpleRing([...touching].reverse()), true, 'a touch read as a crossing, reversed');
  const crossing: CoastPoint[] = [
    { x: 0, z: 0 },
    { x: 10, z: 10 },
    { x: 10, z: 0 },
    { x: 0, z: 10 },
  ];
  assert.equal(isSimpleRing(crossing), false, 'a bowtie was read as simple');
  assert.equal(isSimpleRing([...crossing].reverse()), false, 'a bowtie read as simple, reversed');
  // ⚠ A BOWTIE WHOSE ONLY CROSSING INVOLVES THE **LAST** EDGE. The same four points rotated, so the
  // crossing pair is (1, 3) rather than (0, 2). A comparison loop that walks the wrong window of
  // pairs still finds a crossing in the middle of a ring and silently never looks at the last edge
  // — this is the ring that separates the two.
  const crossingAtTheEnd: CoastPoint[] = [
    { x: 10, z: 10 },
    { x: 10, z: 0 },
    { x: 0, z: 10 },
    { x: 0, z: 0 },
  ];
  assert.equal(isSimpleRing(crossingAtTheEnd), false, 'a crossing on the last edge was missed');
  assert.equal(isSimpleRing(BLOCK[0]!), true);
});

test('THE SHIPPED MAP WEARS `subdivide`', () => {
  // An art decision, pinned the way this package pins its other art constants: not because the
  // choice is provably right, but because CHANGING WHAT THE MAP LOOKS LIKE has to be a deliberate
  // act rather than something that falls out of an edit elsewhere.
  assert.equal(SHIPPED_COAST, 'subdivide');
  assert.ok(COAST_MODES.includes(SHIPPED_COAST));
  assert.notEqual(SHIPPED_COAST, 'none', 'the shipped map would draw no coast at all');
});
