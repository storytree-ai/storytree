// stepped-skirt.test.ts — the claims the shipped island's CLIFF rests on.
//
// ⚠⚠ THE TEST THIS FILE EXISTS FOR IS {@link the transcription one}. Every constant in
// `stepped-skirt.ts` is read off the approved render's own build script, and the whole value of the
// component is that the cliff is THAT cliff rather than a plausible re-authoring of it. A profile
// that drifted would still produce a stepped edge, still render, still pass a shape test, and be a
// different cliff wearing the approved one's name — which is exactly the failure this arc has
// already paid for once (`START ORDER` on the arc: a note priced against a repository that had
// moved under it). So the insets are asserted against a SECOND, independent arithmetic rather than
// against a copy of the first.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_GROUND_DEPTH,
  cellGroundGeometry,
  cellGroundTriangles,
  normalisedRing,
  signedRingArea2,
  type CellGroundGeometryInput,
  type LinearRgb,
  type P2,
  type P3,
} from './cell-ground-geometry.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SHADE_LEVELS, lambertOfNormal, parseHex } from './shade-ladder.js';
import {
  SKIRT_INSET_IN,
  SKIRT_INSET_OUT,
  SKIRT_INSET_PERIOD,
  SKIRT_INSET_SEED,
  SKIRT_JITTER_BASE,
  SKIRT_JITTER_SPAN,
  SKIRT_ROCK,
  SKIRT_ROCK_LIT,
  SKIRT_ROCK_SHADED,
  SKIRT_ROCK_SHADED_SUNK,
  SKIRT_ROWS,
  NO_SKIRT,
  ZERO_NORMAL,
  flatSkirt,
  insetPoint,
  isRimEdge,
  ledgeBelowLadderFloor,
  ledgeNormal,
  oneRock,
  shadeBelowHalfDepth,
  shadeBelowLadderFloor,
  shadeNever,
  type SkirtShadeRule,
  outwardNormal,
  rimEdgeCount,
  rimEdgeKeys,
  skirtExtraTriangles,
  skirtInset,
  skirtLedges,
} from './stepped-skirt.js';
import type { InstanceDescriptor } from './world-to-3d.js';

const square = (x0: number, z0: number): P2[] => [
  { x: x0, z: z0 },
  { x: x0 + 1, z: z0 },
  { x: x0 + 1, z: z0 + 1 },
  { x: x0, z: z0 + 1 },
];

const cell = (points: readonly P2[]): InstanceDescriptor => ({
  kind: 'cell-ground',
  group: 'cell-ground',
  material: 'healthy',
  transform: { x: 0, y: 0, z: 0 },
  points: points.map((p) => ({ x: p.x, y: 0, z: p.z })),
});

/** A parcel whose ring bounds no area — the shape the census must ignore rather than count. */
const ringless = (points: readonly P2[]): InstanceDescriptor => {
  const d = cell(points);
  return { ...d, points: points.map((p) => ({ x: p.x, y: 0, z: p.z })) };
};

test('the approved treatment cuts the edge into SIX ledges', () => {
  assert.equal(SKIRT_ROWS, 6);
  assert.equal(skirtLedges().length, 6);
});

test('THE TRANSCRIPTION: every inset matches `build_land.py`, computed a second way', () => {
  // ⚠ THE SECOND ROUTE IS THE POINT. `7919 % 13 === 2`, so for any row the source's
  // `(row * 7919) % 13` is `(row * 2) % 13` — a different expression of the same number, written
  // out here rather than importing the one under test. A test that re-spelled the implementation
  // would pass for a profile that had drifted, which is the whole failure being guarded.
  assert.equal(SKIRT_INSET_SEED % SKIRT_INSET_PERIOD, 2);
  for (let row = 1; row <= SKIRT_ROWS; row += 1) {
    const side = row % 2 === 1 ? SKIRT_INSET_IN : SKIRT_INSET_OUT;
    const expected =
      side * (SKIRT_JITTER_BASE + (SKIRT_JITTER_SPAN * ((row * 2) % SKIRT_INSET_PERIOD)) / SKIRT_INSET_PERIOD);
    assert.equal(skirtInset(row), expected, `row ${row}`);
  }
});

test('the ledges ALTERNATE: odd rows cut in, even rows stand proud', () => {
  for (let row = 1; row <= SKIRT_ROWS; row += 1) {
    const inset = skirtInset(row);
    if (row % 2 === 1) assert.ok(inset > 0, `row ${row} should cut inward, got ${inset}`);
    else assert.ok(inset < 0, `row ${row} should stand proud, got ${inset}`);
  }
});

test('the BASE COURSE stands proud of the parcel outline — a plinth, not a taper', () => {
  const ledges = skirtLedges();
  const base = ledges[ledges.length - 1]!;
  assert.ok(base.inset < 0, `the last ledge insets ${base.inset}, so the island tapers`);
  // and the deepest undercut is above it, which is what reads as a bedding plane
  const deepest = Math.max(...ledges.map((l) => l.inset));
  assert.ok(deepest > Math.abs(base.inset), 'no ledge cuts back further than the base stands out');
});

test('row 0 is the parcel ring itself, not a ledge, so it takes no inset', () => {
  assert.equal(skirtInset(0), 0);
  assert.equal(skirtInset(-1), 0);
});

test('ONE ledge is the shipped wall EXACTLY — same code path, no inset, full drop', () => {
  assert.deepEqual(skirtLedges(1), [{ row: 1, inset: 0, drop: 1, step: 0, fall: 1 }]);
  assert.deepEqual(skirtLedges(0), []);
});

test('the ledges descend to exactly the prism depth and never past it', () => {
  const ledges = skirtLedges();
  assert.equal(ledges[ledges.length - 1]!.drop, 1);
  for (let i = 1; i < ledges.length; i += 1) {
    assert.ok(ledges[i]!.drop > ledges[i - 1]!.drop, `drop is not monotone at ledge ${i}`);
  }
  for (const l of ledges) assert.ok(l.drop > 0 && l.drop <= 1, `drop ${l.drop} leaves the prism`);
});

test('the outward normal is UNIT, PERPENDICULAR, and points away from a normalised ring', () => {
  const ring = normalisedRing(square(0, 0));
  assert.ok(signedRingArea2(ring) < 0, 'the fixture is not in the module orientation');
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const n = outwardNormal(a, b);
    assert.ok(Math.abs(Math.hypot(n.x, n.z) - 1) < 1e-12, 'not a unit vector');
    assert.ok(Math.abs(n.x * (b.x - a.x) + n.z * (b.z - a.z)) < 1e-12, 'not perpendicular');
    // OUTWARD: stepping off the edge midpoint along the normal must leave the unit square.
    const mx = (a.x + b.x) / 2 + n.x * 0.25;
    const mz = (a.z + b.z) / 2 + n.z * 0.25;
    assert.ok(mx < 0 || mx > 1 || mz < 0 || mz > 1, `normal at edge ${i} points inward`);
  }
});

test('⚠ THE NORMAL IS NORMALISED — asserted on an edge whose length is NOT 1', () => {
  // ⚠⚠ THE UNIT SQUARE ABOVE CANNOT SEE THIS. On an edge of length 1, dividing by the length and
  // MULTIPLYING by it give the same vector, so `-dz / len` -> `-dz * len` survived every assertion
  // in this file until `check:mutation-diff` named it. A 3-4-5 edge separates them by a factor of 25.
  const n = outwardNormal({ x: 0, z: 0 }, { x: 3, z: 4 });
  assert.ok(Math.abs(Math.hypot(n.x, n.z) - 1) < 1e-12, `length ${Math.hypot(n.x, n.z)}`);
  assert.ok(Math.abs(n.x - -0.8) < 1e-12, `x was ${n.x}`);
  assert.ok(Math.abs(n.z - 0.6) < 1e-12, `z was ${n.z}`);
  // and the inset it drives is therefore in GROUND UNITS rather than in units-times-edge-length
  const cut = insetPoint({ x: 0, z: 0 }, n, 5);
  assert.ok(Math.abs(Math.hypot(cut.x, cut.z) - 5) < 1e-12, 'a 5-unit inset did not move 5 units');
});

test('a degenerate edge has no direction, and the zero vector is the honest answer', () => {
  assert.deepEqual(outwardNormal({ x: 3, z: 4 }, { x: 3, z: 4 }), { x: 0, z: 0 });
  // ⚠ AND `ZERO_NORMAL` IS THAT SAME VECTOR, ASSERTED HERE RATHER THAN INFERRED. It is what an
  // UNCUT edge is inset along, so both of its components being exactly 0 is what makes
  // `insetPoint(p, ZERO_NORMAL, 0)` return `p` TO THE BIT — which is the whole basis of the
  // "a one-ledge skirt and no skirt emit the same bytes" claim below. Emptying the literal was
  // caught only by a test file this branch never touched, so the discrimination is stated here.
  assert.deepEqual(ZERO_NORMAL, { x: 0, z: 0 });
  assert.equal(ZERO_NORMAL.x, 0);
  assert.equal(ZERO_NORMAL.z, 0);
  const p: P2 = { x: 7.25, z: -3.5 };
  assert.deepEqual(insetPoint(p, ZERO_NORMAL, 4), p, 'an inset along the zero normal moved a point');
});

test('a POSITIVE inset cuts INWARD — the sign `build_land.py` subtracts with', () => {
  const ring = normalisedRing(square(0, 0));
  const a = ring[0]!;
  const b = ring[1]!;
  const n = outwardNormal(a, b);
  const cut = insetPoint(a, n, 0.25);
  // the cut point is a quarter unit back along the normal, i.e. toward the square's inside
  assert.ok(Math.abs(cut.x - (a.x - 0.25 * n.x)) < 1e-12);
  assert.ok(Math.abs(cut.z - (a.z - 0.25 * n.z)) < 1e-12);
  const inside = (p: P2) => p.x >= 0 && p.x <= 1 && p.z >= 0 && p.z <= 1;
  assert.ok(inside(cut), 'a positive inset left the parcel');
  assert.ok(!inside(insetPoint(a, n, -0.25)), 'a negative inset did not stand proud');
});

test('THE RIM CENSUS: a shared seam is not rim, and every outer edge is', () => {
  const cells = [cell(square(0, 0)), cell(square(1, 0))];
  const rim = rimEdgeKeys(cells);
  // two unit squares side by side: 7 distinct edges, 1 shared, 6 on the rim
  assert.equal(rim.size, 6);
  assert.equal(isRimEdge(rim, { x: 1, z: 0 }, { x: 1, z: 1 }), false, 'the shared seam is not rim');
  assert.equal(isRimEdge(rim, { x: 1, z: 1 }, { x: 1, z: 0 }), false, 'nor is it, reversed');
  assert.equal(isRimEdge(rim, { x: 0, z: 0 }, { x: 1, z: 0 }), true);
  assert.equal(isRimEdge(rim, { x: 2, z: 0 }, { x: 2, z: 1 }), true);
});

test('the rim census ignores rings that bound no area', () => {
  const degenerate = ringless([{ x: 0, z: 0 }]);
  const none: InstanceDescriptor = {
    kind: 'cell-ground',
    group: 'cell-ground',
    material: 'healthy',
    transform: { x: 0, y: 0, z: 0 },
  };
  assert.equal(rimEdgeKeys([degenerate, none]).size, 0);
  assert.equal(rimEdgeKeys([cell(square(0, 0)), degenerate, none]).size, 4);
});

test('a lone parcel is ALL rim — nothing is buried when there is no neighbour', () => {
  assert.equal(rimEdgeKeys([cell(square(0, 0))]).size, 4);
});

test('⚠ A TRIANGLE IS A PARCEL — the smallest ring that bounds area, and the `< 3` boundary', () => {
  // ⚠⚠ THE SQUARE FIXTURES ABOVE CANNOT SEE THIS. Every ring in this file had four vertices, so
  // `ring.length < 3` -> `ring.length <= 3` changed nothing anywhere and survived — named by
  // `check:mutation-diff`. Under that mutant a triangular parcel silently bounds no area: it
  // contributes no rim edges, gets no cliff, and the buffer is sized for a parcel that then draws.
  const tri: readonly P2[] = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 0, z: 3 },
  ];
  assert.equal(rimEdgeKeys([cell(tri)]).size, 3, 'a triangular parcel contributed no rim');
  assert.equal(rimEdgeCount(tri, () => true), 3, 'a triangular ring counted no edges');
  // and TWO vertices really do bound nothing, on both routes
  assert.equal(rimEdgeCount([{ x: 0, z: 0 }, { x: 1, z: 0 }], () => true), 0);
});

test('the skirt`s cost is arithmetic at every boundary, and refuses to go NEGATIVE', () => {
  // The guard these replaced was an equivalent-mutant farm: at `rimEdges === 0` and `rows === 1`
  // the product is already 0, so every mutation of the branch survived. What a branch CAN decide is
  // the negative case, and that is what is asserted now.
  assert.equal(skirtExtraTriangles(52, SKIRT_ROWS), 520);
  assert.equal(skirtExtraTriangles(0, SKIRT_ROWS), 0);
  assert.equal(skirtExtraTriangles(52, 1), 0);
  assert.equal(skirtExtraTriangles(52, 0), 0, 'zero rows must not owe negative triangles');
  assert.equal(skirtExtraTriangles(-4, SKIRT_ROWS), 0, 'a negative rim must not owe negative triangles');
  assert.equal(skirtExtraTriangles(52, -3), 0, 'negative rows must not owe negative triangles');
});

test('skirtLedges emits nothing for a non-positive row count, with no guard to do it', () => {
  assert.deepEqual(skirtLedges(0), []);
  assert.deepEqual(skirtLedges(-5), []);
});

test('the skirt costs the RIM only, as a delta over the wall already drawn', () => {
  // 52 rim edges at six rows: the arc's own ~624-triangle sizing for this component.
  assert.equal(skirtExtraTriangles(52, SKIRT_ROWS), 520);
  assert.equal(52 * SKIRT_ROWS * 2, 624, 'the rim skirt itself is 624 triangles');
  assert.equal(skirtExtraTriangles(52, 1), 0, 'one row is the wall, so it adds nothing');
  assert.equal(skirtExtraTriangles(0, SKIRT_ROWS), 0);
  assert.equal(skirtExtraTriangles(-1, SKIRT_ROWS), 0);
});

test('the ROCK is the approved render`s own median skirt colour, and it is off the status axis', () => {
  assert.equal(SKIRT_ROCK, '#4d4d4f');
  const r = Number.parseInt(SKIRT_ROCK.slice(1, 3), 16);
  const g = Number.parseInt(SKIRT_ROCK.slice(3, 5), 16);
  const b = Number.parseInt(SKIRT_ROCK.slice(5, 7), 16);
  assert.deepEqual([r, g, b], [77, 77, 79], 'the measured median is rgb(77, 77, 79)');
  // NEUTRAL: the status families all sit on the green/ochre/brown axis, so the rock's defence
  // against being read as one of them is that it has almost no hue at all.
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 4, 'the rock has acquired a hue');
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// THE BUILDER'S HALF: what the ledges do once `cellGroundGeometry` writes them.

const ROCK: LinearRgb = { r: 0.25, g: 0.25, b: 0.26 };
const SOIL: LinearRgb = { r: 0.5, g: 0.7, b: 0.3 };
const ROCK_ROW = 9;
const SOIL_ROW = 0;

/** Two parcels side by side, with the relief field left flat so the only thing moving is the
 *  skirt. `index` is supplied so the status buffer is written and the rock's ROW is checkable. */
function build(skirt?: CellGroundGeometryInput['skirt']) {
  const cells = [cell(square(0, 0)), cell(square(1, 0))];
  const input: CellGroundGeometryInput = {
    cells,
    resolve: () => SOIL,
    index: () => SOIL_ROW,
  };
  if (skirt !== undefined) input.skirt = skirt;
  return cellGroundGeometry(input);
}

const rimOf = (): ((a: P2, b: P2) => boolean) => {
  const rim = rimEdgeKeys([cell(square(0, 0)), cell(square(1, 0))]);
  return (a, b) => isRimEdge(rim, a, b);
};

test('⚠ A ONE-LEDGE SKIRT AND NO SKIRT AT ALL EMIT THE SAME BYTES', () => {
  // The control arm on the comparison page is the shipped map itself, not a reconstruction of it,
  // and this is what makes that true. `flatSkirt` runs the LEDGE loop; `undefined` runs it with the
  // module's own `FLAT_WALL`. Both must land on the very floats every pre-skirt figure was taken on.
  const none = build();
  const flat = build(flatSkirt({ ...oneRock({ row: ROCK_ROW, colour: ROCK }), isRim: rimOf() }));
  assert.equal(flat.triangles, none.triangles);
  assert.deepEqual([...flat.positions], [...none.positions], 'a flat skirt moved a vertex');
  assert.deepEqual([...flat.normals], [...none.normals], 'a flat skirt turned a face');
  assert.deepEqual([...flat.colors], [...none.colors], 'a flat skirt delivered a rock pixel');
  assert.deepEqual([...flat.statuses], [...none.statuses], 'a flat skirt moved a ramp row');
});

test('the buffer is SIZED for exactly what is written — no overrun, no zeroed tail', () => {
  const stepped = build({
    rows: SKIRT_ROWS,
    ...oneRock({ row: ROCK_ROW, colour: ROCK }),
    soilLedges: 0,
    isRim: rimOf(),
  });
  // ⚠ `cellGroundTriangles` IS THE WHOLE UNDIVIDED PRISM — top face AND its four wall quads —
  // which is why the skirt's cost is stated as a DELTA. Adding the walls again here is exactly the
  // double-count `skirtExtraTriangles` exists to make impossible in the builder.
  const prisms = 2 * cellGroundTriangles(4);
  assert.equal(prisms, 20);
  assert.equal(stepped.triangles, prisms + skirtExtraTriangles(6, SKIRT_ROWS));
  assert.equal(stepped.positions.length, stepped.triangles * 9);
  // ⚠ THE TAIL IS THE POINT. A buffer sized for more than was written ends in zeroed vertices,
  // which draw as a triangle collapsed at the origin — invisible in a screenshot of an island that
  // does not contain the origin, and exactly the kind of defect a shape assertion sails past.
  const last = stepped.positions.slice(-9);
  assert.ok([...last].some((v) => v !== 0), 'the buffer ends in a zeroed vertex');
});

test('the ledges are CONTINUOUS — each hangs from the one above, so the cliff has no crack', () => {
  const ledges = skirtLedges();
  const outward = { x: 1, z: 0 };
  const a: P2 = { x: 0, z: 0 };
  let prev = a;
  for (const ledge of ledges) {
    const here = insetPoint(a, outward, ledge.inset);
    // every ledge is measured from the RING, never from its predecessor: an accumulating inset
    // would walk the base ~1.2 units inboard instead of leaving it 0.16 proud (both on the tuned
    // island; the insets are `× LAND_SCALE`, `land-per-capability.ts`, so both scale with it).
    assert.ok(Math.abs(here.x - (a.x - ledge.inset)) < 1e-12);
    prev = here;
  }
  // The floor scales with the insets it bounds — the same fraction of the base course as before.
  assert.ok(Math.abs(prev.x) > 0.15 * LAND_SCALE, 'the base course did not end up proud of the ring');
});

test('the ROCK reaches the RIM and nothing else — a buried seam keeps its status colour', () => {
  const stepped = build({
    rows: SKIRT_ROWS,
    ...oneRock({ row: ROCK_ROW, colour: ROCK }),
    soilLedges: 0,
    isRim: rimOf(),
  });
  const rows = [...stepped.statuses];
  const rockVerts = rows.filter((r) => r === ROCK_ROW).length;
  // 6 rim edges x 6 ledges x 2 triangles x 3 vertices
  assert.equal(rockVerts, 6 * SKIRT_ROWS * 2 * 3);
  // and the shared seam kept its own row: the two buried walls are 2 quads = 4 triangles.
  const soilVerts = rows.filter((r) => r === SOIL_ROW).length;
  assert.equal(soilVerts + rockVerts, rows.length, 'a vertex wears neither row');
});

test('`soilLedges` is the owner`s option B: the top ledge keeps the health tint', () => {
  const b = build({
    rows: SKIRT_ROWS,
    ...oneRock({ row: ROCK_ROW, colour: ROCK }),
    soilLedges: 1,
    isRim: rimOf(),
  });
  const rockVerts = [...b.statuses].filter((r) => r === ROCK_ROW).length;
  assert.equal(rockVerts, 6 * (SKIRT_ROWS - 1) * 2 * 3, 'the top ledge is not soil');
  const a = build({
    rows: SKIRT_ROWS,
    ...oneRock({ row: ROCK_ROW, colour: ROCK }),
    soilLedges: 0,
    isRim: rimOf(),
  });
  assert.ok(
    [...a.statuses].filter((r) => r === ROCK_ROW).length > rockVerts,
    'option A delivers no more rock than option B',
  );
});

test('⚠ EVERY LEDGE HANGS BELOW THE GROUND, at exactly the fraction of depth it declares', () => {
  // ⚠⚠ THE OLD VERSION OF THIS TEST ONLY CHECKED THE LOWEST POINT, and the mutation rung showed
  // that was not this branch's own discrimination: `top.y - depth * drop` -> `top.y + depth * drop`
  // was killed only by a test file this branch never touched. A cliff built UPWARD would stand as a
  // wall above the land rather than falling to the sea, so the whole ladder is pinned, not its foot.
  const stepped = build({
    rows: SKIRT_ROWS,
    ...oneRock({ row: ROCK_ROW, colour: ROCK }),
    soilLedges: 0,
    isRim: rimOf(),
  });
  const ys = new Set<number>();
  for (let i = 1; i < stepped.positions.length; i += 3) ys.add(stepped.positions[i]!);
  const above = [...ys].filter((y) => y > 0);
  assert.deepEqual(above, [], `the cliff rose ABOVE the ground plane at y=${above.join(', ')}`);
  // `Math.fround` on each expectation because the positions are a Float32Array and the depth is
  // `3 * LAND_SCALE` (`land-per-capability.ts`), so `depth * drop` is no longer float32-exact. The
  // 1e-12 bound is unchanged: it is the same double the builder stored, read back exactly.
  for (const ledge of skirtLedges()) {
    const expected = Math.fround(-CELL_GROUND_DEPTH * ledge.drop);
    assert.ok(
      [...ys].some((y) => Math.abs(y - expected) < 1e-12),
      `no vertex sits at ledge ${ledge.row}'s height ${expected}`,
    );
  }
  assert.equal(Math.min(...ys), Math.fround(-CELL_GROUND_DEPTH), 'the cliff does not bottom out at the depth');
});

test('NO_SKIRT marks NO edge as rim, which is why its colour can never be delivered', () => {
  // ⚠ THE UNREACHABILITY IS ASSERTED, NOT ASSUMED. `cellGroundGeometry` substitutes `NO_SKIRT` when
  // the caller supplies none, and the wall loop reads `skirt.colour` behind `rim && …`. If `isRim`
  // ever answered true here, every uncut island edge would be painted the placeholder BLACK — a
  // failure that looks like a lighting bug rather than like a missing input.
  assert.equal(NO_SKIRT.isRim({ x: 0, z: 0 }, { x: 1, z: 0 }), false);
  assert.equal(NO_SKIRT.isRim({ x: -9, z: 4 }, { x: 2, z: -7 }), false);
  assert.equal(NO_SKIRT.rows, 1, 'more than one ledge would move the no-skirt buffer');
  assert.equal(NO_SKIRT.soilLedges, 1, 'a zero here would make the single ledge rock');
  assert.deepEqual(skirtLedges(NO_SKIRT.rows), [{ row: 1, inset: 0, drop: 1, step: 0, fall: 1 }]);
  // and the cost it implies is nothing, on both factors
  assert.equal(skirtExtraTriangles(rimEdgeCount(square(0, 0), NO_SKIRT.isRim), NO_SKIRT.rows), 0);

  // ⚠⚠ AND ITS COLOUR IS A REAL VALUE, DRIVEN HERE RATHER THAN LEFT AS AN UNOBSERVABLE
  // PLACEHOLDER. Emptying it changed nothing anywhere and SURVIVED the mutation rung — the
  // signature of a value no fixture reaches. Handing the builder the same skirt with `isRim`
  // answering TRUE makes it reachable, which both kills the mutant and states what the placeholder
  // would look like if `NO_SKIRT` ever leaked: an island edged in black.
  const leaked = build({ ...NO_SKIRT, soilLedges: 0, isRim: () => true });
  let sawBlack = false;
  for (let i = 0; i < leaked.colors.length; i += 3) {
    if (leaked.colors[i] === 0 && leaked.colors[i + 1] === 0 && leaked.colors[i + 2] === 0) {
      sawBlack = true;
      break;
    }
  }
  assert.ok(sawBlack, 'NO_SKIRT’s rocks are not the black the module says they are');
});

test('the FLAT skirt changes nothing — one ledge, no rock, no inset', () => {
  const flat = flatSkirt({
    ...oneRock({ row: 3, colour: { r: 0, g: 0, b: 0 } }),
    isRim: () => true,
  });
  assert.equal(flat.rows, 1);
  assert.equal(flat.soilLedges, 1, 'the one ledge keeps the parcel tint, so no rock is delivered');
  assert.deepEqual(skirtLedges(flat.rows), [{ row: 1, inset: 0, drop: 1, step: 0, fall: 1 }]);
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// THE SECOND TOKEN: why one rock cannot span the cliff, and which faces the second one carries.

test('⚠⚠ ONE TOKEN CANNOT SPAN THE APPROVED SKIRT, AND THE PAIR CAN — the arithmetic, stated', () => {
  // ⚠⚠ THIS IS THE INCREMENT'S WHOLE PREMISE AS AN ASSERTION RATHER THAN AS PROSE. The approved
  // skirt spans luma 20.7 (p2) to 117.6 (p90) — a 5.7x range, because a path tracer lights it.
  // A single token stepped down THIS ladder spans `SHADE_LEVELS`'s own ratio and nothing more,
  // whatever colour the token is, so no re-pick closes the gap. If the ladder is ever refined the
  // premise moves, and this fails rather than the claim quietly becoming false in a comment.
  const APPROVED_SPAN = 117.6 / 20.7;
  const ladderSpan = SHADE_LEVELS[SHADE_LEVELS.length - 1]! / SHADE_LEVELS[0]!;
  assert.ok(ladderSpan < 1.3, `the ladder spans ${ladderSpan.toFixed(3)}x`);
  assert.ok(
    ladderSpan < APPROVED_SPAN,
    'one token now reaches the approved skirt s range — the second token s premise is gone',
  );

  // and the pair reaches further than any one token can: a token ratio times the ladder's own is
  // the achievable span. ⚠ IT NO LONGER REACHES THE APPROVED 5.7x, AND THAT IS THE SEA'S
  // ARITHMETIC RATHER THAN A TIMID PICK: the pair that did reach 4.5x (`SKIRT_ROCK_SHADED_SUNK`)
  // did so by starting BELOW the water — a range that begins at the render's transparent p2 has
  // no floor on this map, and the pixels it spent there merged into the sea (PR #1792). Against
  // `#101418` the range starts 20 above the water, so the reachable span is bounded by the sea,
  // and `harness/skirt-rock-separation.test.ts` holds the pair to THAT bound (it needs the scene
  // background, which lives in the harness). Here the premise that survives is the ordering.
  const lum = (hex: string): number => {
    const c = parseHex(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const pairSpan = (lum(SKIRT_ROCK_LIT) * SHADE_LEVELS[SHADE_LEVELS.length - 1]!) /
    (lum(SKIRT_ROCK_SHADED) * SHADE_LEVELS[0]!);
  assert.ok(
    pairSpan > ladderSpan,
    `the pair spans only ${pairSpan.toFixed(2)}x, no more than the single token's ${ladderSpan.toFixed(2)}x`,
  );
  const sunkSpan = (lum(SKIRT_ROCK_LIT) * SHADE_LEVELS[SHADE_LEVELS.length - 1]!) /
    (lum(SKIRT_ROCK_SHADED_SUNK) * SHADE_LEVELS[0]!);
  assert.ok(sunkSpan > 4, `the withdrawn pair spanned ${sunkSpan.toFixed(2)}x — the premise this comment records has moved`);
  assert.ok(
    pairSpan < sunkSpan,
    'the re-picked pair spans MORE than the sunk one — a shaded rock lighter than the sea cannot outrange one below it',
  );
});

test('the ledges alternate UNDERCUT and PROUD — each step is the run from the one above', () => {
  // The zigzag IS the bedding-plane read: `SKIRT_INSET_IN` cuts odd rows back and
  // `SKIRT_INSET_OUT` stands even rows proud, so every ledge crosses the whole gap rather than
  // taking half of it. `step` is that crossing, and it is what decides which rock a ledge wears.
  const ledges = skirtLedges();
  const signs = ledges.map((l) => Math.sign(l.step));
  assert.deepEqual(signs, [1, -1, 1, -1, 1, -1], 'the profile stopped alternating');
  // each ledge's step is measured from its PREDECESSOR, and the insets from the ring — so the
  // steps must sum back to the last ledge's own inset, or the two views have drifted apart.
  const summed = ledges.reduce((acc, l) => acc + l.step, 0);
  assert.ok(Math.abs(summed - ledges[ledges.length - 1]!.inset) < 1e-12);
  // every ledge falls the same fraction, and the falls reach the whole prism exactly once
  assert.deepEqual([...new Set(ledges.map((l) => l.fall))], [1 / SKIRT_ROWS]);
  assert.ok(Math.abs(ledges.reduce((a, l) => a + l.fall, 0) - 1) < 1e-12);
});

test('⚠ ledgeNormal: a ledge that steps INWARD as it falls points DOWN, and one that steps OUT points UP', () => {
  const out: P2 = { x: 1, z: 0 };
  // an undercut: half a unit down, half a unit inward -> 45 degrees, facing down and outward
  const under = ledgeNormal(out, 0.5, 0.5);
  assert.ok(Math.abs(under.x - Math.SQRT1_2) < 1e-12, `x was ${under.x}`);
  assert.ok(Math.abs(under.y + Math.SQRT1_2) < 1e-12, `y was ${under.y}`);
  assert.equal(under.z, 0);
  // the mirror: standing proud, so the same face turned up
  const proud = ledgeNormal(out, -0.5, 0.5);
  assert.ok(Math.abs(proud.y - Math.SQRT1_2) < 1e-12, `y was ${proud.y}`);
  // it is a UNIT normal, which the lighting term depends on and no caller re-normalises
  for (const n of [under, proud, ledgeNormal({ x: 0.6, z: -0.8 }, 0.3, 0.9)]) {
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-12, 'ledgeNormal is not unit length');
  }
  // ⚠ THE FLAT WALL IS THE ZERO-STEP CASE AND IT IS VERTICAL — the outward normal itself. This is
  // what makes a one-ledge skirt the wall the map always drew, in the normal as well as in the
  // position, so the shipped control arm stays byte-identical.
  // ⚠ COMPARED WITH `===` RATHER THAN `deepEqual`, because a zero step divides to NEGATIVE zero
  // and `deepStrictEqual` separates -0 from 0 while every consumer of this value does not:
  // `lambertOfNormal` multiplies it and both signs of zero sum identically. Asserting the
  // distinction would be pinning a fact about the spelling rather than about the direction.
  const vertical = ledgeNormal(out, 0, 1);
  assert.ok(vertical.x === 1 && vertical.y === 0 && vertical.z === 0, `${JSON.stringify(vertical)}`);
  // ⚠ AND A FACE OF NO EXTENT HAS NO DIRECTION: the honest answer is the edge's own outward
  // normal rather than a NaN propagated into a lighting term by a division by zero.
  assert.deepEqual(ledgeNormal(out, 0, 0), { x: 1, y: 0, z: 0 });
  assert.deepEqual(ledgeNormal(ZERO_NORMAL, 0, 0), { x: 0, y: 0, z: 0 });
  assert.ok(Number.isFinite(lambertOfNormal(ledgeNormal(out, 0, 0))), 'a zero face lit to NaN');
});

test('⚠⚠ THE MEASUREMENT THAT CHOSE THE RULE: the ladder saturates on more than half the cliff', () => {
  // ⚠⚠ RE-DERIVED HERE RATHER THAN QUOTED FROM THE EVIDENCE PAGE, because it is the reason the
  // second token is selected by SATURATION rather than by row parity or by "the shaded side".
  // Swept over 36 rim azimuths: every DOWN-facing ledge falls below the ladder's floor at EVERY
  // azimuth — the quantiser delivers them all at one lightness however much darker their true
  // lighting is — and the UP-facing ones fall below it on the half of the island facing away from
  // the light. A rule keyed on row parity would reach the first group and miss the second.
  const AZIMUTHS = 36;
  const saturated = skirtLedges().map((ledge) => {
    let n = 0;
    for (const k of Array.from({ length: AZIMUTHS }, (_, i) => i)) {
      const t = (k / AZIMUTHS) * Math.PI * 2;
      const outward: P2 = { x: Math.cos(t), z: Math.sin(t) };
      if (ledgeBelowLadderFloor(ledgeNormal(outward, ledge.step, CELL_GROUND_DEPTH * ledge.fall))) {
        n += 1;
      }
    }
    return n;
  });
  // the three undercut ledges: saturated everywhere, with no azimuth the ladder can express
  assert.deepEqual([saturated[0], saturated[2], saturated[4]], [AZIMUTHS, AZIMUTHS, AZIMUTHS]);
  // the three proud ones: saturated on the away-from-light half, and NOT on the lit half — which
  // is the group row parity cannot reach, and the reason the rule reads the lighting term.
  for (const i of [1, 3, 5]) {
    assert.ok(saturated[i]! > 0, `proud ledge ${i + 1} is never saturated`);
    assert.ok(saturated[i]! < AZIMUTHS, `proud ledge ${i + 1} is saturated at every azimuth`);
  }
  const total = saturated.reduce((a, b) => a + b, 0);
  assert.ok(
    total > (AZIMUTHS * SKIRT_ROWS) / 2,
    `only ${total} of ${AZIMUTHS * SKIRT_ROWS} ledge-azimuths saturate; a second token would be ` +
      'reaching a minority of the cliff',
  );
});

test('⚠ the ladder FLOOR is the boundary, and a face sitting exactly on it keeps the lit rock', () => {
  // ⚠ THE TIE IS DECIDED WITH AN INJECTED FLOOR, for the reason the module states: over the
  // authored `SHADE_LEVELS[0]` no reachable face lands on an exact tie, so the `<` rule is
  // unobservable there. The floor is taken from `lambertOfNormal` itself rather than typed out, so
  // the tie is exact by construction rather than to within a rounding.
  const up: P3 = { x: 0, y: 1, z: 0 };
  const exactly = lambertOfNormal(up);
  assert.equal(ledgeBelowLadderFloor(up, exactly), false, 'a face ON the floor read as below it');
  assert.equal(ledgeBelowLadderFloor(up, exactly + 1e-9), true);
  assert.equal(ledgeBelowLadderFloor(up, exactly - 1e-9), false);
  // and the authored default is the ladder's darkest rung, not its first BIN: a face at 0.81 is
  // representable (it quantises to rung 0 by rounding) and must keep the lit rock.
  assert.ok(SHADE_LEVELS[0]! < 0.8125, 'the ladder floor and the first bin edge have converged');
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// AND WHAT THE BUILDER DOES WITH IT.

/** The rows a two-token cliff selects, over the same two-parcel fixture. */
const SHADED_ROW = 11;
const pair = (isShaded: SkirtShadeRule = shadeBelowLadderFloor) => ({
  rows: SKIRT_ROWS,
  lit: { row: ROCK_ROW, colour: ROCK },
  shaded: { row: SHADED_ROW, colour: { r: 0.09, g: 0.1, b: 0.12 } },
  isShaded,
  soilLedges: 0,
  isRim: rimOf(),
});

test('⚠⚠ A ONE-TOKEN CLIFF IS BYTE-IDENTICAL TO THE PAIR HANDED THE SAME ROCK TWICE', () => {
  // ⚠⚠ THIS IS WHAT MAKES THE COMPARISON PAGE'S `rock` ARM THE SHIPPED MAP RATHER THAN A
  // RECONSTRUCTION OF IT. The selection runs on every ledge of both, and the degenerate pair's two
  // answers are the same rock — so a cliff that wants one colour goes down the very same code path
  // and lands on the very same floats. If this ever fails, the control arm has stopped being a
  // control and every number measured against it is a comparison of two different changes.
  const one = build({ rows: SKIRT_ROWS, ...oneRock({ row: ROCK_ROW, colour: ROCK }), soilLedges: 0, isRim: rimOf() });
  const spelled = build({
    rows: SKIRT_ROWS,
    lit: { row: ROCK_ROW, colour: ROCK },
    shaded: { row: ROCK_ROW, colour: ROCK },
    isShaded: shadeNever,
    soilLedges: 0,
    isRim: rimOf(),
  });
  assert.deepEqual([...one.colors], [...spelled.colors]);
  assert.deepEqual([...one.statuses], [...spelled.statuses]);
  assert.deepEqual([...one.positions], [...spelled.positions]);
});

test('⚠ A TWO-TOKEN CLIFF DELIVERS BOTH ROCKS, and which one is the pure predicate’s own answer', () => {
  // ⚠⚠ THIS IS THE SEAM BETWEEN THE PREDICATE AND THE BUILDER, CHECKED RATHER THAN ASSUMED. The
  // expected count is computed HERE from `ledgeNormal` + `ledgeBelowLadderFloor` over the fixture's
  // own rim edges, and compared against what the builder actually wrote. A builder that sized off
  // one rule and painted off another — the exact failure `rimEdgeCount` exists to prevent for the
  // buffer — would pass a "both rows appear" assertion and fail this one.
  const two = build(pair());
  const rows = [...two.statuses];
  const litVerts = rows.filter((r) => r === ROCK_ROW).length;
  const shadedVerts = rows.filter((r) => r === SHADED_ROW).length;
  assert.ok(litVerts > 0, 'the cliff delivered no LIT rock at all');
  assert.ok(shadedVerts > 0, 'the cliff delivered no SHADED rock at all');

  const isRim = rimOf();
  const ledges = skirtLedges();
  let expectedShaded = 0;
  for (const c of [square(0, 0), square(1, 0)]) {
    for (const [i, a] of c.entries()) {
      const b = c[(i + 1) % c.length]!;
      if (!isRim(a, b)) continue;
      const outward = outwardNormal(a, b);
      for (const ledge of ledges) {
        const n = ledgeNormal(outward, ledge.step, CELL_GROUND_DEPTH * ledge.fall);
        if (ledgeBelowLadderFloor(n)) expectedShaded += 1;
      }
    }
  }
  // each ledge quad is 2 triangles x 3 vertices
  assert.equal(shadedVerts, expectedShaded * 6, 'the builder and the predicate disagree');
  assert.equal(litVerts + shadedVerts, 6 * SKIRT_ROWS * 2 * 3, 'a rim ledge wears neither rock');
});

test('⚠ A BURIED SEAM TAKES NEITHER ROCK — the rim guard, asked of the SHADED half too', () => {
  // ⚠⚠ `rim &&` GUARDS THE SELECTION, NOT ONLY THE ROCK. A buried seam takes the one-rung flat
  // wall, whose step is 0 and whose normal is therefore the horizontal outward one — a lambert
  // well under the floor, so it would be SHADED at every azimuth. Without the guard every interior
  // wall in the island would be painted the dark rock: invisible from outside, and still wrong,
  // because the colour buffer is what the comparison arms are built from.
  const two = build(pair());
  const rows = [...two.statuses];
  const soilVerts = rows.filter((r) => r === SOIL_ROW).length;
  // the shared seam is 2 quads = 4 triangles = 12 vertices of wall, plus both top faces
  assert.ok(soilVerts > 0, 'the buried seam lost its status colour');
  assert.equal(
    soilVerts + rows.filter((r) => r === ROCK_ROW || r === SHADED_ROW).length,
    rows.length,
    'a vertex wears no row at all',
  );
  // and asking for no skirt still delivers no rock of either kind
  const none = build();
  assert.deepEqual([...new Set([...none.statuses])], [SOIL_ROW]);
});

test('NO_SKIRT’s SHADED rock is as unreachable as its lit one, and is the same black', () => {
  // The lit half of the pair is driven by the test above; this drives the OTHER half, because
  // `NO_SKIRT` now carries two colours and a mutant emptying only the shaded one would otherwise
  // survive. Making it reachable states what a leak would look like: an island edged in black.
  assert.deepEqual(NO_SKIRT.shaded.colour, { r: 0, g: 0, b: 0 });
  assert.deepEqual(NO_SKIRT.lit.colour, NO_SKIRT.shaded.colour);
  assert.equal(NO_SKIRT.lit.row, NO_SKIRT.shaded.row);
});

test('oneRock is the degenerate pair, and it is the same object on both sides', () => {
  const rock = { row: 4, colour: { r: 0.1, g: 0.2, b: 0.3 } };
  const p = oneRock(rock);
  assert.equal(p.lit, rock);
  assert.equal(p.shaded, rock);
});

test('⚠⚠ THE TWO RULES SELECT DIFFERENT COURSES, AND THE DEPTH RULE IS THE ONE ON THE VISIBLE ONES', () => {
  // ⚠⚠ THE FINDING THAT CHOSE THE SHIPPED RULE, AS AN ASSERTION. `shadeBelowLadderFloor` is the
  // obvious rule and it puts the shaded rock on the UNDERCUT courses — 1, 3 and 5 — which on this
  // map's fixed 2.5D camera are back-facing and contribute essentially no projected area (measured
  // on the shipped fixture: 15.4, 0.0 and 0.0 units against the proud courses' 200.7, 267.0 and
  // 333.3). `shadeBelowHalfDepth` splits by depth instead, so it reaches courses 4 and 6, which are
  // two of the three the camera can actually see.
  const ledges = skirtLedges();
  const out: P2 = { x: 0, z: 1 };
  const lit = ledges.filter((l) => shadeBelowLadderFloor(l, out, CELL_GROUND_DEPTH)).map((l) => l.row);
  const deep = ledges.filter((l) => shadeBelowHalfDepth(l, out, CELL_GROUND_DEPTH)).map((l) => l.row);
  // every UNDERCUT course saturates at every azimuth, so the lighting rule always contains them
  for (const row of [1, 3, 5]) assert.ok(lit.includes(row), `course ${row} is not saturated`);
  // the depth rule is the cliff's own lower half, and it contains two PROUD courses
  assert.deepEqual(deep, [4, 5, 6]);
  for (const row of [4, 6]) {
    assert.ok(ledges[row - 1]!.step < 0, `course ${row} is not a proud course any more`);
  }
  // and they are genuinely different rules, so the comparison page has two arms rather than one
  assert.notDeepEqual(lit, deep);
  // ⚠ THE DEPTH RULE READS THE LEDGE ALONE. It must not consult the edge it is cut into, or the
  // cliff's banding would change around the island and stop reading as strata.
  for (const t of [0, 1, 2, 3]) {
    const az = (t / 4) * Math.PI * 2;
    const o: P2 = { x: Math.cos(az), z: Math.sin(az) };
    assert.deepEqual(
      ledges.filter((l) => shadeBelowHalfDepth(l, o, CELL_GROUND_DEPTH)).map((l) => l.row),
      deep,
      'the depth rule moved with the azimuth',
    );
  }
  // shadeNever is the one-token cliff and selects nothing, at any azimuth or depth
  assert.deepEqual(ledges.filter((l) => shadeNever(l, out, CELL_GROUND_DEPTH)), []);
  // ⚠ AND IT RETURNS `false`, NOT MERELY SOMETHING FALSY — asserted strictly because
  // `check:mutation-diff` replaced its body with `() => undefined` and the filter above could not
  // tell. A `SkirtShadeRule` is declared to return a boolean and the mutant compiles only because
  // the rung does not typecheck; strict equality is what makes the contract observable.
  for (const l of ledges) assert.equal(shadeNever(l, out, CELL_GROUND_DEPTH), false);
});

test('the DEPTH rule puts the shaded rock on the cliff’s lower half in the BUFFER too', () => {
  const two = build(pair(shadeBelowHalfDepth));
  const rows = [...two.statuses];
  const shadedVerts = rows.filter((r) => r === SHADED_ROW).length;
  // 6 rim edges x 3 shaded courses x 2 triangles x 3 vertices
  assert.equal(shadedVerts, 6 * 3 * 2 * 3);
  assert.equal(rows.filter((r) => r === ROCK_ROW).length, 6 * 3 * 2 * 3);
  // and the shaded vertices are the DEEP ones: none of them sits above half depth
  const deepest = -CELL_GROUND_DEPTH * 0.5;
  for (let t = 0; t < two.triangles; t += 1) {
    if (rows[t * 3] !== SHADED_ROW) continue;
    for (const v of [0, 1, 2]) {
      assert.ok(
        two.positions[t * 9 + v * 3 + 1]! <= deepest + 1e-9,
        'a shaded ledge reaches above the cliff’s half depth',
      );
    }
  }
});
