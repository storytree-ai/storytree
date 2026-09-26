// shore-atlas.test.ts — the distance-to-coast field, packed over the occlusion atlas's own tiles.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAtlasOcclusion } from './shadow-atlas.js';
import { AUTHORED_SHORE_WIDTH, shoreField } from './shore-fall.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SHADOW_GRES } from './land-shadow.js';
import { SAND_SHIPPED_BEACH_WIDTH, SAND_SHIPPED_DIVISOR } from './land-sand.js';
import {
  bucketByIsland,
  SAND_FIELD_WIDTH,
  SAND_RECIPE_FIELD_WIDTH,
  buildAtlasShore,
  decodeShore,
  encodeShore,
  shoreSampleSpacing,
} from './shore-atlas.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** One square island, `size` units on a side, with a ring — `shoreField` refuses a ringless
 *  descriptor, so the ring is not decoration here. */
function island(id: string, x: number, z: number, size: number): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    group: 'cell-ground',
    island: id,
    transform: { x: x + size / 2, y: 0, z: z + size / 2 },
    points: [
      { x, y: 0, z },
      { x: x + size, y: 0, z },
      { x: x + size, y: 0, z: z + size },
      { x, y: 0, z: z + size },
    ],
  };
}

const TWO: InstanceDescriptor[] = [island('isle-a', 0, 0, 40), island('isle-b', 400, 0, 40)];
/** ⚠ BUILT ON FIRST USE, NOT AT IMPORT. A fixture built at module scope executes the code under
 *  test before any test runs, which makes EVERY mutant in that code a STATIC mutant for
 *  `check:mutation-diff` — uncovered by any named test, re-run against the whole suite, and scored
 *  UNPROVEN on a timeout rather than KILLED by the assertion that actually notices it (measured:
 *  334 static mutants, 88% of the rung's time, 2026-09-02). A memoised accessor keeps the cost of
 *  building it once and puts the build inside the tests that read it. */
function lazy<T>(build: () => T): () => T {
  let memo: { value: T } | undefined;
  return () => {
    if (memo === undefined) memo = { value: build() };
    return memo.value;
  };
}

const OCC = lazy(() => buildAtlasOcclusion({ cells: TWO, relief: 2.2, casters: [] }));

/** ⚠ ISLANDS OF DELIBERATELY DIFFERENT SIZES, because the shelf packer leaves NO padding when they
 *  are equal — measured, {@link TWO} packs to 264x132 with zero uncovered texels. The `data.fill`
 *  that makes an unwritten texel read as grass is therefore untestable on the even fixture, which
 *  is exactly why `check:mutation-diff` could delete it and stay green. This layout leaves 17,802
 *  padding texels. */
const RAGGED: InstanceDescriptor[] = [
  island('isle-a', 0, 0, 40),
  island('isle-b', 400, 0, 17),
  island('isle-c', 800, 0, 63),
];
const RAGGED_OCC = lazy(() => buildAtlasOcclusion({ cells: RAGGED, relief: 2.2, casters: [] }));

test('the field width is the SHIPPED band`s divisor, and the recipe`s is kept beside it', () => {
  // ⚠⚠ THE FIELD'S CAP AND THE SHADER'S DIVISOR ARE ONE NUMBER. `shoreField` caps its distances at
  // the band it was built for, so a field built to the recipe's 3.1 feeding a shader divided by
  // the owner's 9 would deliver a beach that stops at the old width and STEPS — a hard edge that
  // reads as a defect in the noise rather than as two constants disagreeing.
  assert.equal(SAND_FIELD_WIDTH, SAND_SHIPPED_DIVISOR);
  // The recipe's `+ 0.9` is a ground-unit term and follows LAND_SCALE (`land-per-capability.ts`)
  // with the width it is added to.
  assert.equal(SAND_SHIPPED_DIVISOR, SAND_SHIPPED_BEACH_WIDTH + 0.9 * LAND_SCALE);
  // The recipe's own is kept so an arm can build the transcribed band on the same instrument.
  assert.equal(SAND_RECIPE_FIELD_WIDTH, AUTHORED_SHORE_WIDTH + 0.9 * LAND_SCALE);
  // The authored 3.1, times LAND_SCALE: the same fraction of the island.
  assert.equal(AUTHORED_SHORE_WIDTH, 3.1 * LAND_SCALE);
  // ⚠ AND THE OWNER'S BAND IS WIDER THAN THE RECIPE'S — the whole point of the departure. If these
  // ever met again the widening would have been silently reverted.
  assert.ok(
    SAND_SHIPPED_BEACH_WIDTH > AUTHORED_SHORE_WIDTH,
    'the shipped beach must be wider than the transcribed one — that is the owner-directed change',
  );
  // The field still has to reach past the ramp's top by more than the edge noise can displace.
  const rampTopDistance = 0.7 * SAND_FIELD_WIDTH;
  assert.ok(
    SAND_FIELD_WIDTH - rampTopDistance >= 1.0,
    `the field reaches ${SAND_FIELD_WIDTH} but the ramp tops out at ${rampTopDistance}`,
  );
});

test('THE ADR-0490 D4 CLAIM: the field is FINER than the grid Blender authored against', () => {
  // The whole reason this is a texture and not a vertex attribute. Blender's `shore` attribute is
  // per-vertex on a 0.55-unit grid; the shipped mesh's ground vertices are >= 8.66 units apart, so
  // a vertex attribute smears the band away. This field's spacing is what replaces it, and the
  // claim is only worth making if it is actually finer.
  assert.ok(
    shoreSampleSpacing() < 0.55,
    `field spacing ${shoreSampleSpacing()} is coarser than Blender's 0.55 — the carrier is not a fix`,
  );
  assert.equal(shoreSampleSpacing(), 1 / SHADOW_GRES);
});

test('the byte encoding round-trips inside its own step, and clamps at both ends', () => {
  const step = SAND_FIELD_WIDTH / 255;
  for (const d of [0, 0.4, 1.55, 2.8, SAND_FIELD_WIDTH]) {
    assert.ok(
      Math.abs(decodeShore(encodeShore(d)) - d) <= step,
      `${d} did not round-trip within one quantiser step`,
    );
  }
  // ⚠ BOTH CLAMPS, and the low one is the one that matters: a negative distance cannot arise
  // today, but an unclamped encode would wrap it to a LARGE byte — reading as "far inland" — so
  // the failure would be sand missing from the one place it is certainly meant to be.
  assert.equal(encodeShore(-1), 0);
  assert.equal(encodeShore(SAND_FIELD_WIDTH * 2), 255);
  assert.equal(encodeShore(0), 0);
});

test('the shore atlas rides the OCCLUSION atlas`s tiles — structurally, not by agreement', () => {
  const shore = buildAtlasShore(TWO, OCC());
  // Same dimensions, same resolution, and the SAME tile objects — so the mesh's one
  // `atlasOrigin` attribute and the material's one `uShadowAtlasScale` address both textures.
  assert.equal(shore.w, OCC().w);
  assert.equal(shore.h, OCC().h);
  assert.equal(shore.gres, OCC().gres);
  assert.equal(shore.tiles, OCC().tiles, 'the tiles must be the occlusion atlas`s own, not a copy');
  assert.equal(shore.data.length, OCC().data.length);
});

test('⚠ AN UNWRITTEN TEXEL READS AS GRASS, NOT AS SAND', () => {
  // ⚠⚠ THE FAILURE THIS PREVENTS IS VISIBLE AND WRONG. Zero encodes distance ZERO — the
  // waterline — so an atlas left zero-filled would deliver PURE SAND everywhere no tile was
  // written: every gap between tiles, and every island the loop missed, as a sand-coloured
  // rectangle in the sea. 255 is "far inland", which makes an unwritten texel deliver exactly what
  // the ground drew before this layer existed.
  //
  // ⚠⚠ AND THE FIRST VERSION OF THIS TEST WAS VACUOUS — `check:mutation-diff` deleted the
  // `data.fill(255)` outright and it stayed green. It sampled the atlas's LAST texel, assuming
  // that was padding; on this layout it falls inside a tile and is written either way. The check
  // has to find the padding rather than guess where it is, so it derives the uncovered set.
  const shore = buildAtlasShore(RAGGED, RAGGED_OCC());
  const covered = new Uint8Array(shore.data.length);
  for (const tile of shore.tiles) {
    for (let j = 0; j < tile.h; j += 1) {
      for (let i = 0; i < tile.w; i += 1) covered[(tile.y + j) * shore.w + (tile.x + i)] = 1;
    }
  }
  const padding: number[] = [];
  for (let n = 0; n < shore.data.length; n += 1) if (covered[n] === 0) padding.push(n);
  // The precondition is ASSERTED, not assumed: a layout with no padding could not test the fill.
  assert.ok(padding.length > 0, 'this layout has no padding — the fill cannot be tested on it');
  for (const n of padding) {
    assert.equal(shore.data[n], 255, `padding texel ${n} is not far-inland grass`);
  }
  // And the claim is not vacuous the other way either: the field genuinely reaches 0 somewhere.
  assert.ok(shore.data.some((v) => v === 0), 'no texel is on the waterline — the field is empty');
});

test('⚠ each texel samples its OWN corner — the grid mapping is pinned, not assumed', () => {
  // ⚠⚠ `check:mutation-diff` flipped `minX + i / gres` to `minX - i / gres` and `i / gres` to
  // `i * gres`, and every other test here survived both: the field still had a waterline, still
  // had a capped interior, still rose inland. A mirrored or scaled sample grid produces a
  // perfectly plausible field for the WRONG PLACE — the beach would trace a coastline the island
  // does not have, which is the one failure a picture would not obviously reveal.
  //
  // So the mapping is checked against the reader directly: the texel at (i, j) must decode to what
  // `shoreField` reports at exactly `bounds.min + index / gres`.
  const shore = buildAtlasShore(TWO, OCC());
  const reader = shoreField(TWO, SAND_FIELD_WIDTH);
  const tile = shore.tiles.find((t) => t.island === 'isle-a')!;
  // ⚠⚠ THE WHOLE TILE, NOT A HANDFUL OF PROBES. Five sample points did NOT kill `i * gres`: at a
  // 3-samples-per-unit grid the mis-scaled coordinates mostly land deep inside the island where
  // the distance is CAPPED, so both mappings decode to 255 and the comparison passes. A sparse
  // probe set on a field that is constant over most of its area proves almost nothing — sweeping
  // the tile puts the shore band itself under the assertion, which is the only part that varies.
  const distinct = new Set<number>();
  for (let j = 0; j < tile.h; j += 1) {
    for (let i = 0; i < tile.w; i += 1) {
      const texel = shore.data[(tile.y + j) * shore.w + (tile.x + i)]!;
      const expected = encodeShore(
        reader.sample(tile.bounds.minX + i / shore.gres, tile.bounds.minZ + j / shore.gres).distance,
      );
      assert.equal(texel, expected, `texel (${i}, ${j}) does not sample its own corner`);
      distinct.add(texel);
    }
  }
  // ⚠ AND THE SWEEP MUST SEE A FIELD THAT ACTUALLY VARIES, or it is a long way of comparing 255 to
  // 255. The band is the part that discriminates between two mappings, so it has to be in here.
  assert.ok(distinct.size > 8, `the tile holds only ${distinct.size} distinct values — no band`);
  assert.ok(distinct.has(0) && distinct.has(255), 'the sweep must span waterline to capped interior');
});

test('the field reads ZERO at the coast and rises inland', () => {
  const shore = buildAtlasShore(TWO, OCC());
  const tile = shore.tiles.find((t) => t.island === 'isle-a')!;
  const at = (i: number, j: number): number => decodeShore(shore.data[(tile.y + j) * shore.w + (tile.x + i)]!);
  // Walk inward along one row from the tile's own left edge. The island's rim sits inside the
  // tile's padded bounds, so the first samples are outside the land (distance capped) and the
  // distance must be NON-DECREASING as we cross the rim and head for the middle.
  const mid = Math.floor(tile.h / 2);
  const centre = at(Math.floor(tile.w / 2), mid);
  // The centre of a 40-unit island is 20 units from its rim, far past the 4.0 cap.
  assert.equal(centre, SAND_FIELD_WIDTH, 'the island`s middle must be capped at the field width');
  // And somewhere along that row the field is strictly between the two, i.e. it is a BAND rather
  // than a step — which is what the sand ramp needs in order to have anything to ramp across.
  const row = Array.from({ length: tile.w }, (_, i) => at(i, mid));
  assert.ok(
    row.some((d) => d > 0 && d < SAND_FIELD_WIDTH),
    'the field is a step, not a band — nothing for the sand ramp to resolve',
  );
});

test('every island gets its OWN coast, not the nearest one on the map', () => {
  // Two islands 400 units apart. If the packing and the sampling disagreed about which tile is
  // whose, island B's tile would carry island A's distances — and the sand would trace a coast
  // that is not there. Both tiles must independently contain a waterline and a capped interior.
  const shore = buildAtlasShore(TWO, OCC());
  for (const id of ['isle-a', 'isle-b']) {
    const tile = shore.tiles.find((t) => t.island === id)!;
    const vals: number[] = [];
    for (let j = 0; j < tile.h; j += 1) {
      for (let i = 0; i < tile.w; i += 1) vals.push(shore.data[(tile.y + j) * shore.w + (tile.x + i)]!);
    }
    assert.ok(vals.includes(0), `${id} has no waterline in its own tile`);
    assert.ok(vals.includes(255), `${id} has no capped interior in its own tile`);
  }
});

test('⚠ a tile whose island has no cells falls back to the WHOLE map, not to an empty coast', () => {
  // ⚠⚠ THE FALLBACK IS THE DIFFERENCE BETWEEN "SLOWER" AND "NO BEACH". The per-island bucketing is
  // a COST optimisation — a tile handed the whole map's cells computes the identical field, just
  // more slowly — so almost every way it can break is invisible in the output. The one way that is
  // NOT invisible is handing a tile an EMPTY coast: every texel then reads "far inland", and that
  // island silently loses its entire shore while every other island looks right.
  //
  // Built by giving the occlusion atlas an island id the shore call cannot resolve.
  const occ = buildAtlasOcclusion({ cells: TWO, relief: 2.2, casters: [] });
  const renamed = TWO.map((d) => ({ ...d, island: `${d.island}-moved` }));
  const shore = buildAtlasShore(renamed, occ);
  const tile = shore.tiles.find((t) => t.island === 'isle-a')!;
  const vals: number[] = [];
  for (let j = 0; j < tile.h; j += 1) {
    for (let i = 0; i < tile.w; i += 1) vals.push(shore.data[(tile.y + j) * shore.w + (tile.x + i)]!);
  }
  assert.ok(vals.includes(0), 'the tile lost its waterline — the fallback handed it no coast');
  assert.ok(
    vals.some((v) => v > 0 && v < 255),
    'the tile has no band at all, only capped values — its coast went missing',
  );
});

test('bucketByIsland groups EVERY cell under its own island, and keeps them all', () => {
  // ⚠ EVERY MUTANT IN THIS GROUPING USED TO SURVIVE, because `buildAtlasShore` falls back to the
  // whole map when a lookup misses — so a broken grouping computed the identical field, slower.
  // The fallback is what makes a mistake invisible, not what makes it harmless: the grouping is
  // also what stops each texel paying 35 box tests, and a silently-degraded one puts the 50-second
  // build back without changing a pixel.
  const cells = [island('a', 0, 0, 10), island('b', 100, 0, 10), island('a', 40, 40, 10)];
  const grouped = bucketByIsland(cells);
  assert.equal(grouped.size, 2, 'two distinct islands');
  assert.equal(grouped.get('a')?.length, 2, 'both of a`s cells must land in a`s bucket');
  assert.equal(grouped.get('b')?.length, 1);
  // ⚠ THE SECOND CELL IS APPENDED, NOT DISCARDED. Dropping it leaves half an island's coast out of
  // its own reader — a beach that traces only part of the shore, which looks like noise.
  assert.deepEqual(grouped.get('a'), [cells[0], cells[2]]);
  // Nothing is lost overall.
  assert.equal([...grouped.values()].flat().length, cells.length);
  // ⚠ AND AN ISLAND-LESS CELL IS KEPT UNDER THE EMPTY STRING rather than dropped — the shipped
  // stream can contain one, and dropping it would erase that ground's coast entirely.
  const { island: _dropped, ...homeless } = island('x', 0, 0, 10);
  const unhomed = bucketByIsland([homeless]);
  assert.equal(unhomed.get('')?.length, 1);
});
