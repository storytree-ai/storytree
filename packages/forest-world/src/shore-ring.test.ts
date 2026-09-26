// shore-ring.test.ts — the inset ring, held to the properties a DIVIDED parcel has to keep.
//
// ⚠⚠ THE FIXTURES ARE ANCHORED AWAY FROM THE ORIGIN ON PURPOSE. The mutation rung on the shore
// fall found a thorough-looking test that could not fail: a box anchored at (0, 0), where
// `Math.hypot` squares its arguments and a sign flip on one term vanished entirely. Every ring
// here sits at a positive offset in both axes, so a swapped or negated coordinate moves the answer.
//
// ⚠ THE SHORE FIELD IS SUPPLIED BY THE TEST, never taken from the real map. `shoreRingSplit` takes
// a `ShoreFieldReader`, so the whole module is drivable with a distance field the test can reason
// about — a straight coastline along one edge — and the properties below are then about the
// DIVISION rather than about one island's coast wave.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalisedRing,
  signedRingArea2,
  triangulateRing,
  type P2,
} from './cell-ground-geometry.js';
import { COAST_OUTSET, GROUND_COAST_OUTSET, isSimpleRing, nearestOnSegment, vertexKey } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SHORE_ARM_WIDTH, type ShoreArm, type ShoreFieldReader } from './shore-fall.js';
import {
  RING_ARMS,
  SHORE_ARM_INSETS,
  SHORE_RING_BISECTIONS,
  SHORE_RING_COAST_EPS,
  SHORE_RING_PROBE_MARGIN,
  armHasRing,
  coastRun,
  crossingOnEdge,
  insetDirection,
  inwardNormal,
  shoreRingField,
  shoreRingPlan,
  shoreRingSplit,
} from './shore-ring.js';
import type { InstanceDescriptor } from './world-to-3d.js';

// ---------------------------------------------------------------------------
// A shore a test can reason about
// ---------------------------------------------------------------------------

/** The x-axis line `z = COAST_Z`, standing in for a coastline. Ground with z ABOVE it is land, and
 *  a point's shore distance is how far above the line it stands. Anchored well away from the
 *  origin so a dropped or negated term cannot cancel itself out. */
const COAST_Z = 40;

/** A straight coast as a {@link ShoreFieldReader}: distance is the gap to `z = COAST_Z`, capped
 *  like the real field caps, and the gradient points inland (+z). */
function straightShore(width: number): ShoreFieldReader {
  return {
    width,
    loops: 1,
    sample(_x, z) {
      const d = Math.min(Math.abs(z - COAST_Z), width);
      return { distance: d, gx: 0, gz: z >= COAST_Z ? 1 : -1 };
    },
  };
}

/** A rectangular parcel with its seaward edge ON the coast: four corners, two of them at distance
 *  zero. `depth` is how far inland it reaches. Wound so `normalisedRing` has work to check. */
function coastalBox(x0: number, x1: number, depth: number): P2[] {
  return [
    { x: x0, z: COAST_Z },
    { x: x1, z: COAST_Z },
    { x: x1, z: COAST_Z + depth },
    { x: x0, z: COAST_Z + depth },
  ];
}

/** The same box moved wholly inland — no vertex on the coast at all. */
function inlandBox(x0: number, x1: number, near: number, far: number): P2[] {
  return [
    { x: x0, z: COAST_Z + near },
    { x: x1, z: COAST_Z + near },
    { x: x1, z: COAST_Z + far },
    { x: x0, z: COAST_Z + far },
  ];
}

const area2 = (ring: readonly P2[]): number => Math.abs(signedRingArea2(ring));

/**
 * The distance to an OPEN POLYLINE — a coast the test draws rather than describes.
 *
 * ⚠ IT IS WHAT MAKES THE CAP TESTABLE AT ALL. The ladder fires where the coast turns tighter than
 * the ring, and no coast expressible as a formula over `z` turns at all: a straight shore's inward
 * normals are parallel and never converge. Handed a polyline, the test can put a headland of a
 * chosen radius in front of a chosen ring and read the demotion off it.
 */
function polylineShore(coast: readonly P2[], width: number): ShoreFieldReader {
  return {
    width,
    loops: 1,
    sample(x, z) {
      let best = width;
      for (let i = 0; i + 1 < coast.length; i += 1) {
        const q = nearestOnSegment({ x, z }, coast[i]!, coast[i + 1]!);
        const d = Math.hypot(x - q.x, z - q.z);
        if (d < best) best = d;
      }
      return { distance: best, gx: 0, gz: 1 };
    },
  };
}

/** A parcel behind a HEADLAND of radius `R`: seven coast vertices on a half-circle bulging out to
 *  sea, then two corners well inland. The tighter the headland, the harder its inward offset is to
 *  place — which is the whole subject of the ladder. */
function headland(R: number) {
  const cx = 30;
  const cz = 50;
  const coast: P2[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const a = Math.PI * (1 - i / 6);
    coast.push({ x: cx + R * Math.cos(a), z: cz - R * Math.sin(a) });
  }
  return {
    ring: [...coast, { x: cx + R + 12, z: cz + 12 }, { x: cx - R - 12, z: cz + 12 }],
    field: polylineShore(coast, 20),
  };
}

// ---------------------------------------------------------------------------
// The arm table
// ---------------------------------------------------------------------------

test('the ring arms are exactly the arms with insets, and the width arms have none', () => {
  // DERIVED rather than listed, which is the property: an arm that gained a ring and was left out
  // of `RING_ARMS` would be drawn on the page and compared against the wrong denominator.
  assert.deepEqual([...RING_ARMS], ['ring', 'ring-pair']);
  for (const arm of ['none', 'authored', 'beach', 'shelf'] as ShoreArm[]) {
    assert.equal(armHasRing(arm), false, `${arm} is on the width axis and must draw no ring`);
    assert.deepEqual([...SHORE_ARM_INSETS[arm]], []);
  }
  for (const arm of RING_ARMS) assert.equal(armHasRing(arm), true);
});

test('⚠ EVERY INSET IS DERIVED FROM THE BEACH, so a wider beach moves its rings with it', () => {
  // The failure this forecloses is silent and total: a hand-written 3.5 left behind by a change to
  // `COAST_OUTSET` would put the ring OUTSIDE the band, where the falloff is already 1 and the
  // extra vertices buy nothing at all while still costing their triangles.
  // The beach the GROUND draws is `GROUND_COAST_OUTSET` = COAST_OUTSET × LAND_SCALE
  // (`land-per-capability.ts`), so the insets derive from THAT — held both as the import and as
  // the scaled literal, so neither a dropped LAND_SCALE nor a re-typed 7 can pass.
  assert.deepEqual([...SHORE_ARM_INSETS.ring], [GROUND_COAST_OUTSET / 2]);
  assert.deepEqual([...SHORE_ARM_INSETS['ring-pair']], [GROUND_COAST_OUTSET / 3, (GROUND_COAST_OUTSET * 2) / 3]);
  assert.equal(GROUND_COAST_OUTSET, COAST_OUTSET * LAND_SCALE);
  for (const arm of RING_ARMS) {
    for (const inset of SHORE_ARM_INSETS[arm]) {
      assert.ok(inset > 0, `${arm} has a ring at or seaward of the waterline`);
      assert.ok(inset < SHORE_ARM_WIDTH[arm], `${arm} has a ring outside its own band`);
    }
  }
});

test('the ring arms’ insets are strictly ascending, which the division relies on', () => {
  // `shoreRingSplit` sorts, so this is not a precondition — but a table authored out of order is a
  // table somebody has stopped reading, and the bands are built seaward-first.
  for (const arm of RING_ARMS) {
    const insets = [...SHORE_ARM_INSETS[arm]];
    assert.deepEqual(insets, [...insets].sort((a, b) => a - b));
  }
});

// ---------------------------------------------------------------------------
// The chain's geometry
// ---------------------------------------------------------------------------

test('the inward normal is the ring convention’s, and it is a UNIT vector', () => {
  // `cell-ground-geometry.ts` settles it: for the negative winding, A→B faces `(-dz, 0, dx)`
  // OUTWARD. A sign error here points every chain into the sea, which draws as an island with a
  // moat and would be caught — but only after a browser run.
  const n = inwardNormal({ x: 10, z: 20 }, { x: 14, z: 20 });
  assert.deepEqual(n, { x: 0, z: -1 });
  const diagonal = inwardNormal({ x: 10, z: 20 }, { x: 13, z: 24 });
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-12);
  // Reversing the edge reverses the normal — the property that makes "inward" a fact about the
  // ring's winding rather than about the order two points happened to be written in.
  const back = inwardNormal({ x: 14, z: 20 }, { x: 10, z: 20 });
  assert.deepEqual(back, { x: 0, z: 1 });
});

test('a zero-length edge has no inward direction, and says so with a zero vector', () => {
  // Reachable on a degenerate ring, and an ordinary answer rather than a guard: the caller SUMS
  // normals, so a zero contributes nothing and the other edge decides.
  assert.deepEqual(inwardNormal({ x: 7, z: 9 }, { x: 7, z: 9 }), { x: 0, z: 0 });
});

test('the inset direction bisects, and is a unit vector at a corner', () => {
  // A right-angle corner: one edge running +x, the next running +z. Inward for the first is -z and
  // for the second is +x, so the bisector is the diagonal between them.
  const dir = insetDirection({ x: 10, z: 20 }, { x: 14, z: 20 }, { x: 14, z: 24 });
  assert.ok(Math.abs(Math.hypot(dir.x, dir.z) - 1) < 1e-12);
  assert.ok(Math.abs(dir.x - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(dir.z + Math.SQRT1_2) < 1e-12);
  // Straight through: both edges agree, so the bisector IS the shared normal.
  const straight = insetDirection({ x: 10, z: 20 }, { x: 14, z: 20 }, { x: 18, z: 20 });
  assert.deepEqual(straight, { x: 0, z: -1 });
});

test('a 180-degree spur falls back to the INCOMING edge’s own inward normal', () => {
  // The two normals cancel exactly, so the sum has no direction. Reachable on a ring that doubles
  // back — which the ladder's own bottom rungs can produce — and the incoming edge is the honest
  // answer rather than an arbitrary one.
  const dir = insetDirection({ x: 10, z: 20 }, { x: 14, z: 20 }, { x: 10, z: 20 });
  assert.deepEqual(dir, { x: 0, z: -1 });
});

// ---------------------------------------------------------------------------
// The crossing — the half that must agree with a neighbour
// ---------------------------------------------------------------------------

test('a crossing lands where the shore distance IS the inset', () => {
  const field = straightShore(20);
  const p = crossingOnEdge(field, { x: 30, z: COAST_Z }, { x: 30, z: COAST_Z + 12 }, 3.5);
  assert.ok(Math.abs(p.z - (COAST_Z + 3.5)) < 1e-6, `landed at ${p.z}`);
  assert.equal(p.x, 30, 'a crossing stays ON its edge');
});

test('⚠⚠ A CROSSING IS A PROPERTY OF THE EDGE, not of the direction it is walked', () => {
  // THE PROPERTY THE WHOLE MODULE RESTS ON. Two parcels share this edge and traverse it opposite
  // ways; if each bisected in its own direction the two would land a few ulps apart, which is two
  // heights, which is a crack running the length of the shore. Asserted BIT-IDENTICAL rather than
  // within a tolerance, because a tolerance is exactly the weaker claim that would not have caught
  // it.
  const field = straightShore(20);
  // ⚠ THE COORDINATES ARE DELIBERATELY AWKWARD. On a tidy edge the bisection converges to the same
  // double from either end and the assertion below passes however the direction is chosen — a test
  // that cannot fail. On this one the two directions differ in the last bit, so the symmetry is a
  // real claim about the ordering rather than about the arithmetic being forgiving.
  const a = { x: 23.1, z: COAST_Z };
  const b = { x: 41.7, z: COAST_Z + 9.3 };
  const forward = crossingOnEdge(field, a, b, 3.5);
  const backward = crossingOnEdge(field, b, a, 3.5);
  assert.equal(forward.x, backward.x);
  assert.equal(forward.z, backward.z);
  // The tidy edge is kept beside it, so a later reader can see WHY the awkward one is there.
  const tidy = crossingOnEdge(field, { x: 31, z: COAST_Z }, { x: 37, z: COAST_Z + 11 }, 3.5);
  assert.equal(tidy.z, crossingOnEdge(field, { x: 37, z: COAST_Z + 11 }, { x: 31, z: COAST_Z }, 3.5).z);
});

test('⚠⚠ THE BISECTION READS WHICH END IS INSIDE — it does not assume the first one is', () => {
  // The canonical ordering is by NAME and says nothing about which end is nearer the water, so on
  // roughly half the map's edges the canonical `from` is the INLAND end. An assumption here would
  // be right on the other half and would return the wrong endpoint on this one.
  const field = straightShore(20);
  // Keys "30.0,52.0" and "35.0,40.0": the LOWER key is the inland vertex, so `from` is outside.
  const inland = { x: 30, z: COAST_Z + 12 };
  const shore = { x: 35, z: COAST_Z };
  const p = crossingOnEdge(field, shore, inland, 3.5);
  assert.ok(Math.abs(field.sample(p.x, p.z).distance - 3.5) < 1e-6, `landed at ${p.z}`);
  // And an edge whose `from` sits EXACTLY on the ring is outside it, not inside: with `<=` the
  // bisection would bracket the wrong way and come back at that very endpoint instead of the far
  // one, which is a whole edge's length away rather than a rounding.
  const atTheRing = crossingOnEdge(
    field,
    { x: 30, z: COAST_Z + 3.5 },
    { x: 30, z: COAST_Z + 12 },
    3.5,
  );
  assert.ok(Math.abs(atTheRing.z - (COAST_Z + 12)) < 1e-6, `landed at ${atTheRing.z}`);
});

test('a crossing works whichever end of the edge is inside the band', () => {
  // The canonical ordering is by NAME and says nothing about which end is nearer the water, so the
  // bisection has to read that off the field. An assumption here would fire on exactly half the
  // edges of the map.
  const field = straightShore(20);
  const inward = crossingOnEdge(field, { x: 30, z: COAST_Z }, { x: 30, z: COAST_Z + 12 }, 3.5);
  const outward = crossingOnEdge(field, { x: 30, z: COAST_Z + 12 }, { x: 30, z: COAST_Z }, 3.5);
  assert.ok(Math.abs(inward.z - (COAST_Z + 3.5)) < 1e-6);
  assert.equal(inward.z, outward.z);
});

test('the bisection is halvings, and enough of them to beat the descriptors’ own precision', () => {
  // The descriptors carry one decimal (`vertexKey` rounds to it and says why), so a crossing has
  // to be far better resolved than that or two parcels could round to different keys. Twenty-four
  // halvings is 6e-8 of an edge.
  assert.equal(SHORE_RING_BISECTIONS.length, 24);
  assert.ok(2 ** -SHORE_RING_BISECTIONS.length < 1e-6);
});

// ---------------------------------------------------------------------------
// The coast run
// ---------------------------------------------------------------------------

test('a contiguous run is found, wrapping the ring’s end', () => {
  // The wrap is the case an index-based scan gets wrong, and it is the COMMON one: a parcel's coast
  // vertices are as likely to straddle index 0 as not.
  assert.deepEqual(coastRun([0, 0, 9, 9, 0]), { start: 4, length: 3 });
  assert.deepEqual(coastRun([9, 0, 0, 0, 9]), { start: 1, length: 3 });
  assert.deepEqual(coastRun([9, 9, 0, 9]), { start: 2, length: 1 });
});

test('a run of ONE vertex is a run — a parcel may touch the coast at a single corner', () => {
  // Seven of the shipped island's fifty-three coastal parcels are this shape. Refusing them would
  // leave a hole in the band at every one, and they divide perfectly well: the chain is just its
  // two side-edge crossings with nothing between.
  assert.deepEqual(coastRun([9, 9, 0, 9, 9]), { start: 2, length: 1 });
});

test('no run at all: an interior parcel, an all-coast parcel, and a two-run parcel', () => {
  assert.equal(coastRun([9, 9, 9, 9]), null, 'nothing on the coast');
  assert.equal(coastRun([0, 0, 0, 0]), null, 'no inland side to keep');
  assert.equal(coastRun([0, 9, 0, 9]), null, 'two runs need a band each');
});

test('⚠ A CROSSING NEEDS THE INSET STRICTLY ABOVE THE NEAR END TOO — not only below the far one', () => {
  // The sibling of the `k < hi` bound, and the one a fixture reaches less often: an inland vertex
  // sitting EXACTLY on the ring. With `k >= lo` the edge leading away from it would be given a
  // second crossing at the vertex itself, and the band would close on a zero-length side.
  const field = straightShore(20);
  const onTheRing: P2[] = [
    { x: 20, z: COAST_Z },
    { x: 36, z: COAST_Z },
    { x: 36, z: COAST_Z + 3.5 },
    { x: 36, z: COAST_Z + 12 },
    { x: 20, z: COAST_Z + 12 },
  ];
  const split = shoreRingSplit(onTheRing, field, [3.5]);
  // Three inland edges, and only two of them straddle the ring: (36, 40) up to (36, 43.5) does not,
  // because 3.5 is its far END rather than between its ends, and (36, 43.5) up to (36, 52) does not
  // either, because 3.5 is its NEAR end. Only the closing edge back to the coast crosses.
  assert.equal(split.wall.length, onTheRing.length + 1);
});

test('the coast test is a floating-point epsilon, not a tolerance on the art', () => {
  // A rim vertex lies ON the coast by construction, so its measured distance is rounding residue.
  // The next-nearest vertex on the shipped island is 8.66 units out — six orders of magnitude away.
  assert.ok(SHORE_RING_COAST_EPS < 1e-5);
  assert.deepEqual(coastRun([SHORE_RING_COAST_EPS / 2, 9, 9]), { start: 0, length: 1 });
  assert.equal(coastRun([SHORE_RING_COAST_EPS * 10, 9, 9]), null, 'that is not on the coast');
  // ⚠ THE BOUND ITSELF IS INCLUSIVE, and it is the one input that separates `<=` from `<`. A rim
  // vertex lands here only by arithmetic coincidence, but the reading has to be settled somewhere
  // and "within the epsilon" is the side that keeps a genuine rim vertex on the coast.
  assert.deepEqual(coastRun([SHORE_RING_COAST_EPS, 9, 9]), { start: 0, length: 1 });
});

// ---------------------------------------------------------------------------
// The division
// ---------------------------------------------------------------------------

test('a coastal parcel is divided into a band and a core, and the band is the seaward one', () => {
  const field = straightShore(20);
  const ring = coastalBox(20, 36, 12);
  const split = shoreRingSplit(ring, field, [3.5]);
  assert.equal(split.divided, true);
  assert.equal(split.scale, 1, 'a straight coast needs no cap');
  assert.equal(split.faces.length, 2, 'one ring divides a parcel in two');
  // ⚠⚠ EXACT LENGTHS, because the BUFFER IS SIZED FROM THEM. `groundFaceTriangles` counts
  // `length - 2` per face, so a face carrying one vertex more than the division needs — a chain
  // point appended twice, a side crossing walked into the core as well as into the band — sizes
  // the buffer for a mesh the writer then does not produce, and the extra triangle draws as a
  // zero-area sliver nobody sees. The band is the two coast corners with the two chain points; the
  // core is the two chain points with the two inland corners.
  assert.deepEqual(split.faces.map((f) => f.length), [4, 4]);
  assert.equal(split.wall.length, 6, 'four corners plus one crossing on each inland edge');
  // The band's vertices are all within the inset; the core's are all at or beyond it.
  const band = split.faces[0]!;
  const core = split.faces[1]!;
  for (const p of band) assert.ok(p.z <= COAST_Z + 3.5 + 1e-6, `band vertex at ${p.z}`);
  for (const p of core) assert.ok(p.z >= COAST_Z + 3.5 - 1e-6, `core vertex at ${p.z}`);
});

test('⚠⚠ THE FACES TILE THE PARCEL EXACTLY — no ground lost, none drawn twice', () => {
  // THE CHECK THAT MAKES THIS SAFE ON GROUND WHOSE COLOUR REPORTS A CAPABILITY'S STATUS. Ground
  // covered twice is one capability's status painted over another's (ADR-0392 D5 / ADR-0398 D7);
  // ground lost is a hole in the island. Both show up as area, exactly.
  const field = straightShore(20);
  for (const insets of [[3.5], [7 / 3, 14 / 3], [1, 2, 3]]) {
    const ring = coastalBox(20, 36, 12);
    const split = shoreRingSplit(ring, field, insets);
    assert.equal(split.divided, true, `${insets.length} rings should divide this parcel`);
    assert.equal(split.faces.length, insets.length + 1);
    const tiled = split.faces.reduce((sum, f) => sum + area2(f), 0);
    assert.ok(
      Math.abs(tiled - area2(split.wall)) < 1e-9 * area2(split.wall),
      `${insets.length} rings tiled ${tiled} of ${area2(split.wall)}`,
    );
  }
});

test('the WALL carries every inserted point, so the skirt hangs from the face’s own outline', () => {
  // ⚠ THE HALF A CALLER FORGETS. A top face that bends through a point on an edge, over a wall
  // that spans that edge straight, is a hairline crack down the shore.
  const field = straightShore(20);
  const split = shoreRingSplit(coastalBox(20, 36, 12), field, [3.5]);
  assert.equal(split.wall.length, 6, 'four corners plus a crossing on each inland edge');
  const onWall = new Set(split.wall.map(vertexKey));
  // Both side-edge crossings — the points a NEIGHBOUR also inserts — are on the wall.
  for (const p of split.faces[0]!) {
    if (Math.abs(p.z - (COAST_Z + 3.5)) > 1e-6) continue;
    assert.ok(onWall.has(vertexKey(p)), `a shared crossing at ${p.x} is missing from the wall`);
  }
  assert.ok(isSimpleRing(split.wall), 'the wall ring crosses itself');
});

test('the wall ring bounds the SAME ground as the parcel it came from', () => {
  // The inserted points are ON the parcel's own edges, so the outline cannot move — which is what
  // makes `groundArea` a check on the division rather than a number that drifts with it.
  const field = straightShore(20);
  const ring = coastalBox(20, 36, 12);
  const split = shoreRingSplit(ring, field, [3.5]);
  assert.ok(Math.abs(area2(split.wall) - area2(ring)) < 1e-9 * area2(ring));
});

test('every face triangulates upward, and to the count the buffer is sized for', () => {
  // `cellGroundGeometry` allocates from `groundFaceTriangles`, so a face that triangulated to more
  // pieces than its length predicts would overrun the buffer it was sized for.
  const field = straightShore(20);
  const split = shoreRingSplit(coastalBox(20, 36, 12), field, [7 / 3, 14 / 3]);
  for (const face of split.faces) {
    const tris = triangulateRing(face);
    assert.equal(tris.length, face.length - 2, 'a simple polygon has length-2 triangles');
    for (const [a, b, c] of tris) {
      // Negative shoelace is the upward-facing winding — the module's one convention.
      assert.ok(signedRingArea2([a, b, c]) <= 0, 'a face triangulated downward');
    }
  }
});

test('an INTERIOR parcel is left exactly alone — no crossing, no division, no cost', () => {
  const field = straightShore(20);
  const ring = inlandBox(20, 36, 9, 21);
  const split = shoreRingSplit(ring, field, [3.5]);
  assert.equal(split.divided, false);
  assert.equal(split.scale, 0, 'an undivided parcel kept no band');
  assert.deepEqual([...split.wall], [...normalisedRing(ring)]);
  assert.equal(split.faces.length, 1);
});

test('an arm with NO insets returns the ring verbatim, which is the pre-ring mesh', () => {
  // The before/after on this arc has to be the same function called twice. `[]` is what a width arm
  // passes, and it must produce the buffer the map had before this module existed.
  const field = straightShore(20);
  const ring = coastalBox(20, 36, 12);
  const split = shoreRingSplit(ring, field, []);
  assert.equal(split.divided, false);
  assert.deepEqual([...split.wall], [...normalisedRing(ring)]);
  assert.deepEqual(split.faces.map((f) => [...f]), [[...normalisedRing(ring)]]);
});

test('a ring that bounds no area is refused rather than divided — and is left UNTOUCHED', () => {
  const field = straightShore(20);
  const two: P2[] = [{ x: 20, z: COAST_Z }, { x: 36, z: COAST_Z }];
  const split = shoreRingSplit(two, field, [3.5]);
  assert.equal(split.divided, false);
  assert.equal(split.faces.length, 1);
  // ⚠ AND IT IS NOT COASTAL, which is a separate claim from not being divided. `coastal` is the
  // DENOMINATOR the coverage ratio is read against, and a ring that bounds no ground is not a piece
  // of shore the ring failed on — counting it as one would quietly deflate every coverage figure
  // this module reports, in the direction that reads as a worse result.
  assert.equal(split.coastal, false);
  assert.equal(shoreRingSplit(two, field, []).coastal, false, 'an arm with no ring did not look');
  // ⚠ AND THE REFUSAL COMES BEFORE THE CROSSINGS, which is what this second ring is for. A
  // two-vertex ring straddling the band would gain a crossing if the refusal were removed, and the
  // wall would come back one vertex longer than the ring it was handed — a parcel that bounds no
  // area, wearing geometry.
  const straddling: P2[] = [{ x: 20, z: COAST_Z }, { x: 20, z: COAST_Z + 12 }];
  const crossed = shoreRingSplit(straddling, field, [3.5]);
  assert.equal(crossed.divided, false);
  assert.equal(crossed.wall.length, 2, 'a ring bounding no area was given a crossing');
  assert.deepEqual(crossed.faces.map((f) => f.length), [2]);
});

test('⚠ A PARCEL SHALLOWER THAN ITS RING FALLS BACK, and still inserts nothing it cannot', () => {
  // Real on the forest: one coastal parcel's nearest interior vertex is 0.004 units from its own
  // shore. There is no edge for the crossing to sit on, so the band cannot be closed — and the
  // refusal is EDGE-LOCAL, so the neighbour across that edge refuses identically.
  const field = straightShore(20);
  const shallow = coastalBox(20, 36, 1.5);
  const split = shoreRingSplit(shallow, field, [3.5]);
  assert.equal(split.divided, false);
  assert.equal(split.wall.length, 4, 'no crossing exists to insert');
});

test('a run of ONE divides into a triangle band and a core', () => {
  // The seven single-corner parcels of the shipped island. The chain is its two side crossings with
  // nothing between, so the band is the smallest polygon there is.
  const field = straightShore(20);
  // A pentagon touching the coast at exactly one vertex.
  const ring: P2[] = [
    { x: 28, z: COAST_Z },
    { x: 36, z: COAST_Z + 7 },
    { x: 33, z: COAST_Z + 15 },
    { x: 23, z: COAST_Z + 15 },
    { x: 20, z: COAST_Z + 7 },
  ];
  const split = shoreRingSplit(ring, field, [3.5]);
  assert.equal(split.divided, true);
  assert.equal(split.faces[0]!.length, 3, 'a single-corner band is a triangle');
  const tiled = split.faces.reduce((sum, f) => sum + area2(f), 0);
  assert.ok(Math.abs(tiled - area2(split.wall)) < 1e-9 * area2(split.wall));
});

test('⚠⚠ THE LADDER DEMOTES A CHAIN THE COAST CANNOT CARRY, and never the SHARED crossings', () => {
  // An inward offset self-intersects as soon as it exceeds the curve's radius of curvature. Here
  // the coast is a sharp inward notch, so the full-depth chain folds and the ladder shortens it.
  //
  // ⚠ THE SIDE CROSSINGS STAY PUT, which is the half that must not move: they sit on SHARED edges
  // and a neighbour that knows nothing of this parcel's corners computes them independently.
  const field: ShoreFieldReader = {
    width: 20,
    loops: 1,
    // A V-shaped coast: distance is the gap to the nearer of two lines meeting at x = 30.
    sample(x, z) {
      const d = Math.min(Math.abs(z - (COAST_Z + Math.abs(x - 30) * 8)), 20);
      return { distance: d, gx: 0, gz: 1 };
    },
  };
  const ring: P2[] = [
    { x: 22, z: COAST_Z + 64 },
    { x: 30, z: COAST_Z },
    { x: 38, z: COAST_Z + 64 },
    { x: 38, z: COAST_Z + 80 },
    { x: 22, z: COAST_Z + 80 },
  ];
  const split = shoreRingSplit(ring, field, [3.5]);
  if (split.divided) {
    const tiled = split.faces.reduce((sum, f) => sum + area2(f), 0);
    assert.ok(Math.abs(tiled - area2(split.wall)) < 1e-9 * area2(split.wall));
    for (const face of split.faces) assert.ok(isSimpleRing(face), 'a demoted face still folds');
  }
  // Whatever the ladder decided, the wall — and therefore every shared crossing — is untouched.
  assert.ok(isSimpleRing(split.wall));
});

test('a divided parcel’s scale is on the coast clip’s ladder, and never zero', () => {
  // ⚠ ZERO IS DROPPED DELIBERATELY. It puts every chain point back on the coast vertex it came
  // from — a band of zero depth, which delivers no shape and still costs its triangles. The
  // undivided ring is the same picture for less.
  const field = straightShore(20);
  const split = shoreRingSplit(coastalBox(20, 36, 12), field, [3.5]);
  assert.ok(split.scale > 0 && split.scale <= 1);
});

// ---------------------------------------------------------------------------
// The map-wide plan
// ---------------------------------------------------------------------------

/** A descriptor carrying one ring — the shape `cellGroundGeometry` and the plan both read. */
function cell(points: readonly P2[]): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    island: 'story-a',
    material: 'healthy',
    points: points.map((p) => ({ x: p.x, y: 0, z: p.z })),
  };
}

// ---------------------------------------------------------------------------
// A whole island, so the census has something to be a census OF
// ---------------------------------------------------------------------------

/** Where the toy island's south-west corner sits. ⚠ Away from the origin, and away from its own
 *  parcel size, so a dropped term or a swapped axis moves every answer. */
const ISLAND_X0 = 100;
const ISLAND_Z0 = 200;
/** One parcel's side, in ground units. Comfortably wider than any ring the tests place inside it. */
const PARCEL = 20;

/**
 * A 3 x 3 grid of square parcels — a closed island whose rim is its own outline, so `shoreField`
 * measures to something real and the census is about a shore rather than about four loose boxes.
 *
 * Eight parcels meet the coast (four corners with a three-vertex run, four edges with a two-vertex
 * run) and the middle one is interior, its nearest rim a whole parcel away.
 */
function islandCells(lobe = 0): InstanceDescriptor[] {
  const out: InstanceDescriptor[] = [];
  const h = PARCEL / 2;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const x = ISLAND_X0 + i * PARCEL;
      const z = ISLAND_Z0 + j * PARCEL;
      /** The south side of this parcel: its midpoint, or — for the middle-south parcel when the
       *  caller asks for one — a LOBE of the given radius bulging out to sea in its place. A lobe
       *  tighter than the ring is a coast the chain cannot follow at full depth, which is the only
       *  thing on a square island that makes the ladder demote anything. */
      const south =
        lobe > 0 && i === 1 && j === 0
          ? [
              { x: x + h - lobe, z },
              ...Array.from({ length: 5 }, (_unused, k) => {
                const a = Math.PI * (1 - (k + 1) / 6);
                return { x: x + h + lobe * Math.cos(a), z: z - lobe * Math.sin(a) };
              }),
              { x: x + h + lobe, z },
            ]
          : [{ x: x + h, z }];
      // ⚠ EIGHT VERTICES, NOT FOUR — a midpoint on every side. Two things need it. Neighbours must
      // agree edge for edge or `rimLoops` would read the seam as boundary, so the midpoints are on
      // BOTH sides of every shared edge; and a four-vertex parcel's coast run has no interior
      // vertex at all, which would leave the bisector's own arithmetic unexercised.
      out.push(
        cell([
          { x, z },
          ...south,
          { x: x + PARCEL, z },
          { x: x + PARCEL, z: z + h },
          { x: x + PARCEL, z: z + PARCEL },
          { x: x + h, z: z + PARCEL },
          { x, z: z + PARCEL },
          { x, z: z + h },
        ]),
      );
    }
  }
  return out;
}

test('⚠⚠ THE CENSUS COUNTS A WHOLE ISLAND, and every column is a number a reader can check', () => {
  const cells = islandCells();
  const plan = shoreRingPlan(cells, [3.5]);
  const c = plan.census;
  // Eight of the nine parcels meet the rim; the middle one's nearest coast is a whole parcel away.
  assert.equal(c.coastal, 8);
  assert.equal(c.divided + c.undivided, 9);
  assert.equal(c.divided, 8, 'a square coast turns nowhere tighter than 3.5 units');
  assert.equal(c.undivided, 1, 'the interior parcel is left alone');
  assert.equal(c.capped, 0, 'nothing on a square island needs demoting');
  assert.equal(c.leastScale, 1);
  // Every coastal parcel's two side edges gain one crossing each: 8 parcels x 2 = 16 insertions.
  assert.equal(c.inserted, 16);
  // ⚠⚠ THE CHAIN'S ACHIEVED DISTANCES ARE THE BISECTOR'S OWN REPORT, AND ON THIS ISLAND THEY ARE
  // ALL THE SAME NUMBER — which is the mitre this module deliberately does not do, arriving as a
  // measurement. Every chain point that is not on the wall ring sits at a right-angled CORNER of
  // the island (the four corner parcels' own corners; an edge parcel's run is two vertices, so its
  // whole chain is its two side-edge crossings and those ARE on the wall). A right-angle bisector
  // lands the point short by the cosine of the half turn: 3.5 / sqrt(2) = 2.4749, not 3.5.
  // ⚠⚠ THE TWO ENDS OF THIS RANGE ARE TWO DIFFERENT GEOMETRIES, and reading them apart is what
  // makes the pair worth reporting at all. A chain point on a STRAIGHT stretch of run lands at the
  // full inset. A chain point at a right-angled CORNER lands short by the cosine of the half turn —
  // 3.5 / sqrt(2) = 2.4749 — because the offset is a plain bisector and not a MITRE. The shortfall
  // is a deliberate trade (a mitre spikes without bound at a sharp corner, which is how a parcel
  // folds), and it is reported rather than hidden precisely so a reader can see its size.
  assert.ok(Math.abs(c.nearestChain - 3.5 / Math.SQRT2) < 1e-9, `nearest ${c.nearestChain}`);
  assert.ok(Math.abs(c.farthestChain - 3.5) < 1e-9, `farthest ${c.farthestChain}`);
  assert.ok(c.nearestChain < c.farthestChain, 'a corner and a straight run cannot land alike');
});

/** A SECOND island, far away, whose parcels are plain squares — four corners and no midpoints.
 *  Every vertex of a coast run here is a right-angled CORNER, so every chain point it produces is
 *  the mitred 3.5/sqrt(2) and none reaches the full inset. */
function plainIslandCells(): InstanceDescriptor[] {
  const out: InstanceDescriptor[] = [];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const x = ISLAND_X0 + 400 + i * PARCEL;
      const z = ISLAND_Z0 + 400 + j * PARCEL;
      out.push(
        cell([
          { x, z },
          { x: x + PARCEL, z },
          { x: x + PARCEL, z: z + PARCEL },
          { x, z: z + PARCEL },
        ]),
      );
    }
  }
  return out;
}

test('⚠⚠ THE FARTHEST CHAIN POINT IS THE MAXIMUM, not the last one the sweep happened to see', () => {
  // ⚠ THE ORDER IS THE FIXTURE. Over one island the deepest chain point is also very nearly the
  // last one measured, so a "maximum" that simply kept assigning would report the right number and
  // the mutation rung duly found it unkillable. Here a SECOND island follows the first, and every
  // chain point on it is a mitred corner — shallower than the first island's straight stretches.
  // A running maximum still reports the first island's 3.5; a last-write reports 2.4749.
  const both = shoreRingPlan([...islandCells(), ...plainIslandCells()], [3.5]).census;
  assert.equal(both.coastal, 16, 'two islands of eight coastal parcels each');
  assert.ok(Math.abs(both.farthestChain - 3.5) < 1e-9, `farthest ${both.farthestChain}`);
  assert.ok(Math.abs(both.nearestChain - 3.5 / Math.SQRT2) < 1e-9, `nearest ${both.nearestChain}`);
  // And the second island ALONE reaches only the mitred distance, which is what makes the pair
  // above a real ordering rather than two numbers that happen to agree.
  const plain = shoreRingPlan(plainIslandCells(), [3.5]).census;
  assert.ok(Math.abs(plain.farthestChain - 3.5 / Math.SQRT2) < 1e-9, `plain ${plain.farthestChain}`);
  assert.equal(plain.farthestChain, plain.nearestChain, 'a square island has only corners');
});

test('the census is EMPTY where the arm has no ring — an absence, not a zeroed island', () => {
  const c = shoreRingPlan(islandCells(), []).census;
  assert.deepEqual(c, {
    coastal: 0,
    divided: 0,
    undivided: 9,
    inserted: 0,
    nearestChain: 0,
    farthestChain: 0,
    capped: 0,
    leastScale: 1,
  });
});

test('⚠⚠ THE LADDER DEMOTES BY EXACTLY AS MUCH AS THE HEADLAND DEMANDS, and reports it', () => {
  // THE CAP, ASSERTED AS A LADDER RATHER THAN AS A BOOLEAN. An inward offset self-intersects as
  // soon as it exceeds the curve's radius of curvature, so a headland's radius is a dial on how
  // much of its ring the shore can keep — and the demotion is monotone in it. A cap nobody can see
  // is indistinguishable from a shore that never needed one (`coastCapping`'s own argument).
  for (const [R, expected] of [
    [0.4, 0.1],
    [0.9, 0.2],
    [1.5, 0.4],
    [2, 0.5],
    [3, 0.8],
    [5, 1],
    [9, 1],
  ] as const) {
    const { ring, field } = headland(R);
    const split = shoreRingSplit(ring, field, [3.5]);
    assert.equal(split.divided, true, `a headland of radius ${R} kept no band at all`);
    assert.equal(split.scale, expected, `a headland of radius ${R} kept ${split.scale}`);
    // Whatever it kept, the guarantees bind: the faces tile the parcel and none of them folds.
    for (const f of split.faces) assert.ok(isSimpleRing(f), `radius ${R} folded a face`);
    const tiled = split.faces.reduce((sum, f) => sum + area2(f), 0);
    assert.ok(Math.abs(tiled - area2(split.wall)) < 1e-9 * area2(split.wall));
  }
});

test('⚠⚠ A HEADLAND TIGHTER THAN EVERY RUNG IS REFUSED, and reports keeping no band', () => {
  // The bottom of the ladder is dropped, so a parcel that only holds at zero depth is not divided:
  // that band delivers no shape and still costs its triangles, and the undivided outline is the
  // same picture for less. `scale === 0` is what distinguishes "kept none" from "kept the least".
  const { ring, field } = headland(0.2);
  const split = shoreRingSplit(ring, field, [3.5]);
  assert.equal(split.divided, false);
  assert.equal(split.scale, 0);
  assert.equal(split.faces.length, 1);
  assert.deepEqual([...split.faces[0]!], [...split.wall]);
  // ⚠ AND IT STILL INSERTS ITS SHARED CROSSINGS. They belong to the EDGE, and the neighbour across
  // each one inserts it whatever this parcel decided — a refusal that dropped them would crack the
  // seam it was trying to be careful about.
  assert.equal(split.wall.length, ring.length + 2);
  assert.equal(split.coastal, true, 'a refused coastal parcel is still coastal');
});

test('the ladder’s demotion is MONOTONE in the headland — a tighter coast never keeps more', () => {
  // A cap that were not monotone would mean the ladder is finding a rung by luck rather than by
  // the geometry, and the number it reports would not be about the coast.
  let previous = 0;
  for (const R of [0.4, 0.9, 1.5, 2, 3, 5, 9]) {
    const { ring, field } = headland(R);
    const scale = shoreRingSplit(ring, field, [3.5]).scale;
    assert.ok(scale >= previous, `radius ${R} kept ${scale} against a tighter coast's ${previous}`);
    previous = scale;
  }
});

test('⚠⚠ THE CENSUS TRACKS THE CAP OVER A WHOLE MAP, and reads the ladder off the coast', () => {
  // The per-parcel ladder is asserted on the headland above; this is the half that has to survive
  // the fold into a census — `capped` counts the parcels the ladder demoted and `leastScale` is the
  // worst of them. A cap nobody can see is indistinguishable from a shore that never needed one.
  //
  // ⚠ ONE PARCEL OF THE NINE WEARS THE LOBE, so the numbers below say which: exactly one parcel is
  // capped however tight the lobe gets, and the other seven keep their whole ring. A census that
  // reported the demotion against the wrong parcel, or spread it, would move that count.
  for (const [lobe, expected] of [
    [1, 0.2],
    [2, 0.5],
    [3, 0.8],
  ] as const) {
    const c = shoreRingPlan(islandCells(lobe), [3.5]).census;
    assert.equal(c.divided, 8, `a lobe of radius ${lobe} stopped a parcel dividing at all`);
    assert.equal(c.capped, 1, `a lobe of radius ${lobe} capped ${c.capped} parcels`);
    assert.equal(c.leastScale, expected, `a lobe of radius ${lobe} kept ${c.leastScale}`);
  }
  // A lobe WIDER than the ring needs no cap at all, which is what makes the numbers above about the
  // coast rather than about the island.
  const gentle = shoreRingPlan(islandCells(6), [3.5]).census;
  assert.equal(gentle.capped, 0);
  assert.equal(gentle.leastScale, 1);
});

test('a plan skips descriptors with no ring, and with too short a one', () => {
  // The geometry builder skips them too, so a census that counted them would report a denominator
  // the mesh does not have.
  const ringless: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    island: 'story-a',
    material: 'healthy',
  };
  const twoPoint = cell([
    { x: ISLAND_X0, z: ISLAND_Z0 },
    { x: ISLAND_X0 + PARCEL, z: ISLAND_Z0 },
  ]);
  // ⚠ A TRIANGLE IS A PARCEL AND MUST NOT BE SKIPPED. Three vertices is the smallest ring that
  // bounds ground, and a bound reading `<= 3` would drop every triangular parcel out of the mesh's
  // own census while the mesh went on drawing them.
  const triangle = cell([
    { x: ISLAND_X0 - 40, z: ISLAND_Z0 - 40 },
    { x: ISLAND_X0 - 20, z: ISLAND_Z0 - 40 },
    { x: ISLAND_X0 - 30, z: ISLAND_Z0 - 24 },
  ]);
  const plan = shoreRingPlan([...islandCells(), ringless, twoPoint, triangle], [3.5]);
  assert.equal(plan.census.divided + plan.census.undivided, 10, 'a parcel was miscounted');
  // And the resolver still answers about them, because `cellGroundGeometry` may ask.
  assert.deepEqual(plan.decompose(ringless), { wall: [], faces: [[]] });
  assert.equal(plan.decompose(twoPoint).wall.length, 2);
  assert.equal(plan.decompose(triangle).faces.length, 1, 'a lone triangle has no shore to band');
});

test('the whole island’s faces tile it — no ground lost, none drawn twice, over nine parcels', () => {
  const cells = islandCells();
  const plan = shoreRingPlan(cells, [3.5]);
  let faced = 0;
  let walled = 0;
  for (const c of cells) {
    const f = plan.decompose(c);
    walled += area2(f.wall);
    faced += f.faces.reduce((sum, one) => sum + area2(one), 0);
    assert.ok(isSimpleRing(f.wall));
    for (const one of f.faces) assert.ok(isSimpleRing(one));
  }
  assert.ok(Math.abs(faced - walled) < 1e-9 * walled, `${faced} against ${walled}`);
  // And the island still bounds the ground it did: nine parcels of PARCEL squared.
  assert.ok(Math.abs(walled / 2 - 9 * PARCEL * PARCEL) < 1e-9);
});

// ---------------------------------------------------------------------------
// The cases the first round of the mutation rung found unasserted
// ---------------------------------------------------------------------------

test('⚠ THE CHAIN SITS INSIDE THE BAND — between the water and the inset, not merely short of it', () => {
  // ⚠ THE FIRST DRAFT OF THIS ASSERTED ONLY THE UPPER BOUND, and that is a test that cannot fail:
  // a chain offset the WRONG WAY lands out at sea, where `z <= COAST_Z + inset` is still true. The
  // mutation rung reported six survivors on the offset's own arithmetic, all of them this shape.
  const field = straightShore(20);
  const split = shoreRingSplit(coastalBox(20, 36, 12), field, [3.5]);
  assert.equal(split.divided, true);
  for (const p of split.faces[0]!) {
    assert.ok(p.z >= COAST_Z - 1e-9, `a band vertex is out at sea, at ${p.z}`);
    assert.ok(p.z <= COAST_Z + 3.5 + 1e-6, `a band vertex is inland of the ring, at ${p.z}`);
  }
  // And the chain itself is AT the inset, not merely inside it. On a straight run there is no
  // corner for the bisector to fall short at, so the distance is exact.
  const chain = split.faces[0]!.filter((p) => p.z > COAST_Z + 1e-9);
  assert.ok(chain.length >= 2, 'the band has no chain at all');
  for (const p of chain) assert.ok(Math.abs(p.z - (COAST_Z + 3.5)) < 1e-6, `chain at ${p.z}`);
});

test('the insets are SORTED before use, so an arm may declare them in any order', () => {
  const field = straightShore(20);
  const ring = coastalBox(20, 36, 12);
  const forward = shoreRingSplit(ring, field, [7 / 3, 14 / 3]);
  const backward = shoreRingSplit(ring, field, [14 / 3, 7 / 3]);
  assert.equal(forward.faces.length, 3);
  assert.deepEqual(forward.faces.map((f) => f.length), [4, 4, 4]);
  assert.equal(forward.wall.length, 8, 'two crossings on each inland edge');
  assert.deepEqual(
    backward.faces.map((f) => f.map((p) => [p.x, p.z])),
    forward.faces.map((f) => f.map((p) => [p.x, p.z])),
    'the bands came out in a different order — the sort is load-bearing',
  );
});

test('a TRIANGULAR coastal parcel divides — three vertices is a parcel, not a degenerate one', () => {
  // The smallest ring that bounds area. A guard reading `n <= 3` would refuse it and the shore
  // would quietly skip every triangular parcel.
  const field = straightShore(20);
  const split = shoreRingSplit(
    [
      { x: 22, z: COAST_Z },
      { x: 38, z: COAST_Z },
      { x: 30, z: COAST_Z + 14 },
    ],
    field,
    [3.5],
  );
  assert.equal(split.divided, true);
  const tiled = split.faces.reduce((sum, f) => sum + area2(f), 0);
  assert.ok(Math.abs(tiled - area2(split.wall)) < 1e-9 * area2(split.wall));
});

test('⚠ A CROSSING NEEDS THE INSET STRICTLY BETWEEN THE ENDS — a parcel exactly one ring deep has none', () => {
  // The bounds matter: with `k <= hi` the inland vertex itself would be taken as the crossing, and
  // the band would be closed on a zero-width side edge.
  const field = straightShore(20);
  const exact = shoreRingSplit(coastalBox(20, 36, 3.5), field, [3.5]);
  assert.equal(exact.divided, false, 'a parcel exactly one ring deep has no room for the ring');
  assert.equal(exact.wall.length, 4, 'a crossing was inserted at the parcel’s own corner');
  // And a hair deeper it does divide, so the refusal above is about the bound and not about the
  // parcel being small.
  const deeper = shoreRingSplit(coastalBox(20, 36, 3.6), field, [3.5]);
  assert.equal(deeper.divided, true);
  assert.equal(deeper.wall.length, 6);
});

test('⚠ BOTH SIDE EDGES MUST CROSS, and a parcel that offers only one is refused', () => {
  // Real on the forest, where a coastal parcel's inland corners are not all the same distance out.
  // With `&&` in place of `||` this parcel would be divided along a band with one open side.
  const field = straightShore(20);
  const lopsided: P2[] = [
    { x: 20, z: COAST_Z },
    { x: 36, z: COAST_Z },
    { x: 36, z: COAST_Z + 12 },
    { x: 20, z: COAST_Z + 1.5 },
  ];
  const split = shoreRingSplit(lopsided, field, [3.5]);
  assert.equal(split.divided, false);
  assert.equal(split.faces.length, 1, 'a refused parcel keeps ONE face — its own outline');
  assert.deepEqual([...split.faces[0]!], [...split.wall], 'the face is the wall ring itself');
  // The sides that DO cross still get their points, because a crossing belongs to the EDGE and the
  // neighbour across it inserts the same one either way. Two of this parcel's three inland edges
  // cross the ring — the long one out and the short one back — so the wall gains two.
  assert.equal(split.wall.length, 6);
});

test('⚠⚠ ONE FOLDED FACE IS ENOUGH TO REFUSE A RUNG — the check is EVERY face, not any', () => {
  // ⚠ THE FIXTURE IS THE POINT. On a headland BOTH faces fold together, so a check reading "any
  // face is simple" agrees with the right one and the mutation rung reported it as unkillable. This
  // parcel folds ASYMMETRICALLY: its coast is straight, so the band stays simple at every rung,
  // while the chain pushes straight through the shallow notch in its inland edge and the CORE
  // crosses itself. A rung accepted on the band alone would draw the notch's ground twice — one
  // capability's status colour over another's (ADR-0392 D5 / ADR-0398 D7).
  const field = straightShore(20);
  const notched: P2[] = [
    { x: 20, z: COAST_Z },
    { x: 28, z: COAST_Z },
    { x: 36, z: COAST_Z },
    { x: 36, z: COAST_Z + 12 },
    { x: 28, z: COAST_Z + 1 },
    { x: 20, z: COAST_Z + 12 },
  ];
  const split = shoreRingSplit(notched, field, [3.5]);
  assert.equal(split.divided, true);
  // The chain only clears the notch at a fifth of its authored depth, and the ladder finds that.
  assert.equal(split.scale, 0.2, `the notch admitted a chain at ${split.scale}`);
  for (const f of split.faces) assert.ok(isSimpleRing(f), 'a folded face was accepted');
});

test('the CORE face carries the crossings on every inland edge, not only the chain', () => {
  // ⚠ THE INLAND WALK IS WHERE THE FACES STOP TILING IF IT IS WRONG. An inland edge can cross the
  // ring too — a parcel whose far side dips back toward the water — and a core that dropped that
  // crossing would leave a sliver between itself and the wall.
  const field = straightShore(20);
  const bent: P2[] = [
    { x: 20, z: COAST_Z },
    { x: 28, z: COAST_Z },
    { x: 36, z: COAST_Z },
    { x: 36, z: COAST_Z + 12 },
    { x: 28, z: COAST_Z + 1 },
    { x: 20, z: COAST_Z + 12 },
  ];
  const split = shoreRingSplit(bent, field, [3.5]);
  assert.equal(split.divided, true);
  // Four of this parcel's edges cross the ring — the two side edges and the two halves of the
  // bent inland edge — so the wall carries four inserted points in all.
  assert.equal(split.wall.length, 10);
  // ⚠⚠ THE CORE'S EXACT LENGTH IS THE ASSERTION, and an area check is NOT — which is the same trap
  // this module's own source fell into. The sub-faces share their vertices and traverse the chain
  // once in each direction, so their shoelace terms TELESCOPE: the areas sum to the parcel's
  // whether or not the core carries the crossings, and whether or not a face is folded inside out.
  // Counting the core's vertices is what actually notices. The band is the three coast vertices
  // with the three-point chain; the core is that chain, then the inland path — three original
  // vertices with the two crossings that fall between them.
  assert.deepEqual(split.faces.map((f) => f.length), [6, 8]);
});

test('⚠ THE CHAIN’S DEPTH IS THE ONLY THING THE LADDER TOUCHES — the shared crossings never move', () => {
  // ⚠⚠ THE HALF THAT MUST NOT BE SCALED. `qs` and `qe` sit on SHARED edges and their positions are
  // the property of those edges, agreed with a neighbour that knows nothing about this parcel's
  // corners. A ladder that scaled them would be exactly the disagreement the canonical bisection
  // exists to prevent, and the seam would crack — silently, and only on the capped parcels.
  const loose = headland(9);
  const tight = headland(0.9);
  const full = shoreRingSplit(loose.ring, loose.field, [3.5]);
  const capped = shoreRingSplit(tight.ring, tight.field, [3.5]);
  assert.equal(full.scale, 1);
  assert.ok(capped.scale < 1);
  // Both parcels' side-edge crossings are at the FULL inset from their own coast, cap or no cap.
  for (const [split, field] of [
    [full, loose.field],
    [capped, tight.field],
  ] as const) {
    const onWall = new Set(split.wall.map(vertexKey));
    const shared = split.faces[0]!.filter((p) => {
      if (!onWall.has(vertexKey(p))) return false;
      return field.sample(p.x, p.z).distance > 1e-6;
    });
    assert.equal(shared.length, 2, 'a band should meet its parcel on exactly two side edges');
    for (const p of shared) {
      assert.ok(
        Math.abs(field.sample(p.x, p.z).distance - 3.5) < 1e-6,
        `a shared crossing moved to ${field.sample(p.x, p.z).distance}`,
      );
    }
  }
});

test('the census counts what the division actually did, parcel by parcel', () => {
  const cells = [cell(coastalBox(20, 36, 12)), cell(inlandBox(40, 56, 9, 21))];
  // ⚠ THE FIELD THE PLAN BUILDS IS ITS OWN. These fixtures are not a closed island, so the real
  // `shoreField` would measure to their whole outline — which is why the plan is exercised through
  // its own field here and the DIVISION is exercised above against a shore a test can reason about.
  const plan = shoreRingPlan(cells, [3.5]);
  assert.equal(plan.census.divided + plan.census.undivided, cells.length);
  assert.equal(
    plan.census.inserted,
    cells.reduce((sum, c) => sum + plan.decompose(c).wall.length, 0) -
      cells.reduce((sum, c) => sum + c.points!.length, 0),
    'the census disagrees with the wall rings it produced',
  );
});

test('the resolver is stable — asked twice about one parcel it answers identically', () => {
  // `shorePlan` reads it once for the buffer and once for the counters. Two answers would mean the
  // report describes a different mesh from the one drawn.
  const cells = [cell(coastalBox(20, 36, 12))];
  const plan = shoreRingPlan(cells, [3.5]);
  const first = plan.decompose(cells[0]!);
  const second = plan.decompose(cells[0]!);
  assert.equal(first, second, 'the plan re-derived a division it had already made');
});

test('a parcel the plan never saw still gets a usable answer', () => {
  // The resolver's contract is total: `cellGroundGeometry` may be handed a descriptor list that
  // does not match the one the plan was built from, and the honest answer is the undivided ring
  // rather than a throw halfway through a buffer.
  const plan = shoreRingPlan([cell(coastalBox(20, 36, 12))], [3.5]);
  const stranger = cell(inlandBox(90, 106, 9, 21));
  const faces = plan.decompose(stranger);
  assert.equal(faces.faces.length, 1);
  assert.equal(faces.wall.length, 4);
  assert.deepEqual(faces.wall.map((p) => [p.x, p.z]), [
    [90, COAST_Z + 9],
    [106, COAST_Z + 9],
    [106, COAST_Z + 21],
    [90, COAST_Z + 21],
  ]);
  // And a stranger with NO ring at all gets the empty division rather than a throw, which is the
  // branch the `?? []` exists for: the resolver's contract is total.
  const ringlessStranger: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    island: 'story-b',
    material: 'healthy',
  };
  assert.deepEqual(plan.decompose(ringlessStranger), { wall: [], faces: [[]] });
});

test('the probe field reaches past the widest ring, so no ring sits at its own cap', () => {
  // The field caps its answer at the width it was built for, and every comparison in this module is
  // `distance < inset`. A cap AT the widest inset would make that comparison false at the very ring
  // it is asked about, and the outermost band would silently never close.
  const field = shoreRingField([cell(coastalBox(20, 36, 12))], [7 / 3, 14 / 3]);
  assert.equal(field.width, (14 / 3) * SHORE_RING_PROBE_MARGIN);
  assert.ok(field.width > 14 / 3);
});

test('⚠ THE COASTAL COUNT IS THE DENOMINATOR, and an arm with no rings reports an ABSENCE', () => {
  // "47 parcels divided" says nothing on its own: the shipped island has 164 parcels and 111 of
  // them are interior. The coverage ratio is what chose the shipped arm, so the denominator has to
  // be measured rather than carried in prose.
  const field = straightShore(20);
  assert.equal(shoreRingSplit(coastalBox(20, 36, 12), field, [3.5]).coastal, true);
  assert.equal(shoreRingSplit(inlandBox(40, 56, 9, 21), field, [3.5]).coastal, false);
  // A coastal parcel too shallow for its ring is still COASTAL — it is a parcel the ring failed on
  // rather than one it had no business reaching, and counting it as interior would flatter the
  // coverage by hiding exactly the failures the ratio exists to show.
  assert.equal(shoreRingSplit(coastalBox(20, 36, 1.5), field, [3.5]).coastal, true);
  // ⚠ AND AN ARM WITH NO RINGS ANSWERS `false`, which is an absence rather than a claim: the field
  // such an arm builds caps at zero, so every vertex reads as on the coast and the question cannot
  // be asked. Reporting `true` there would put a real-looking denominator under a zero numerator.
  assert.equal(shoreRingSplit(coastalBox(20, 36, 12), field, []).coastal, false);
});

test('a plan with no insets divides nothing and inserts nothing', () => {
  const cells = [cell(coastalBox(20, 36, 12))];
  const plan = shoreRingPlan(cells, []);
  assert.equal(plan.census.coastal, 0);
  assert.equal(plan.census.divided, 0);
  assert.equal(plan.census.inserted, 0);
  assert.equal(plan.census.capped, 0);
  assert.equal(plan.census.leastScale, 1);
  assert.equal(plan.census.nearestChain, 0);
  assert.equal(plan.census.farthestChain, 0);
  assert.equal(plan.decompose(cells[0]!).faces.length, 1);
});
