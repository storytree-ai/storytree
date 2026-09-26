// wear-atlas.test.ts — the distance-to-path field, packed over the occlusion atlas's own tiles.

import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoastPoint } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { WEAR_FALLOFF } from './land-wear.js';
import { buildAtlasOcclusion, type AtlasField } from './shadow-atlas.js';
import { decodeShore, encodeShore } from './shore-atlas.js';
import { islandPaths } from './island-path.js';
import { wearField } from './trail-wear.js';
import { WEAR_FIELD_WIDTH, buildAtlasWear } from './wear-atlas.js';
import type { InstanceDescriptor } from './world-to-3d.js';

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

function strip(from: CoastPoint, to: CoastPoint): InstanceDescriptor {
  return {
    kind: 'trail-strip',
    group: 'trail-strip',
    transform: { x: (from.x + to.x) / 2, y: 0, z: (from.z + to.z) / 2 },
    points: [{ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z }],
    width: 3,
    usage: 1,
    hidden: false,
    edges: [],
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
/** A crossing of isle-a from its west dock to its east dock; isle-b gets nothing. */
const A_PATHS = lazy(() => islandPaths(TWO, [strip({ x: -40, z: 20 }, { x: -2, z: 20 }), strip({ x: 80, z: 20 }, { x: 42, z: 20 })]));

/** Ragged sizes, so the shelf packer leaves padding the fill can be tested on. */
const RAGGED: InstanceDescriptor[] = [island('isle-a', 0, 0, 40), island('isle-b', 400, 0, 17), island('isle-c', 800, 0, 63)];
const RAGGED_OCC = lazy(() => buildAtlasOcclusion({ cells: RAGGED, relief: 2.2, casters: [] }));

const texelsOf = (atlas: AtlasField, id: string): number[] => {
  const tile = atlas.tiles.find((t) => t.island === id)!;
  const vals: number[] = [];
  for (let j = 0; j < tile.h; j += 1) {
    for (let i = 0; i < tile.w; i += 1) vals.push(atlas.data[(tile.y + j) * atlas.w + (tile.x + i)]!);
  }
  return vals;
};

test('the field width IS the wear falloff — the cap and the shader`s falloff are one number', () => {
  assert.equal(WEAR_FIELD_WIDTH, WEAR_FALLOFF);
  // The authored 3.0, times LAND_SCALE (`land-per-capability.ts`): the same fraction of the island.
  assert.equal(WEAR_FIELD_WIDTH, 3.0 * LAND_SCALE);
});

test('the wear atlas rides the OCCLUSION atlas`s tiles — structurally, not by agreement', () => {
  const wear = buildAtlasWear(A_PATHS(), OCC());
  assert.equal(wear.w, OCC().w);
  assert.equal(wear.h, OCC().h);
  assert.equal(wear.gres, OCC().gres);
  assert.equal(wear.tiles, OCC().tiles, 'the tiles must be the occlusion atlas`s own, not a copy');
  assert.equal(wear.data.length, OCC().data.length);
  assert.equal(wear.unassigned, 0);
});

test('⚠ AN UNWRITTEN TEXEL READS AS NO WEAR, NOT AS THE PATH', () => {
  // Zero encodes distance ZERO — the centreline — so a zero-filled atlas would deliver pure dirt
  // on every gap between tiles. The padding is DERIVED, not guessed at (the shore's first version
  // of this test sampled a texel that turned out to be inside a tile).
  const paths = islandPaths(RAGGED, [strip({ x: -40, z: 20 }, { x: -2, z: 20 }), strip({ x: 80, z: 20 }, { x: 42, z: 20 })]);
  const wear = buildAtlasWear(paths, RAGGED_OCC());
  const covered = new Uint8Array(wear.data.length);
  for (const tile of wear.tiles) {
    for (let j = 0; j < tile.h; j += 1) {
      for (let i = 0; i < tile.w; i += 1) covered[(tile.y + j) * wear.w + (tile.x + i)] = 1;
    }
  }
  const padding: number[] = [];
  for (let n = 0; n < wear.data.length; n += 1) if (covered[n] === 0) padding.push(n);
  assert.ok(padding.length > 0, 'this layout has no padding — the fill cannot be tested on it');
  for (const n of padding) assert.equal(wear.data[n], 255, `padding texel ${n} is not far-from-path`);
  assert.ok(wear.data.some((v) => v === 0), 'no texel is on the centreline — the field is empty');
});

test('⚠ each texel samples its OWN corner — the grid mapping is pinned against the reader', () => {
  const wear = buildAtlasWear(A_PATHS(), OCC());
  const reader = wearField(A_PATHS().get('isle-a')!, WEAR_FIELD_WIDTH);
  const tile = wear.tiles.find((t) => t.island === 'isle-a')!;
  const distinct = new Set<number>();
  for (let j = 0; j < tile.h; j += 1) {
    for (let i = 0; i < tile.w; i += 1) {
      const texel = wear.data[(tile.y + j) * wear.w + (tile.x + i)]!;
      const expected = encodeShore(
        reader.sample(tile.bounds.minX + i / wear.gres, tile.bounds.minZ + j / wear.gres).distance,
        WEAR_FIELD_WIDTH,
      );
      assert.equal(texel, expected, `texel (${i}, ${j}) does not sample its own corner`);
      distinct.add(texel);
    }
  }
  assert.ok(distinct.size > 8, `the tile holds only ${distinct.size} distinct values — no band`);
  assert.ok(distinct.has(0) && distinct.has(255), 'the sweep must span centreline to capped far field');
});

test('⚠⚠ AN ISLAND WITH NO PATH STAYS AT 255 — no whole-map fallback, ever', () => {
  // isle-b is absent from the path map entirely: its tile is untouched.
  const wear = buildAtlasWear(A_PATHS(), OCC());
  assert.equal(A_PATHS().has('isle-a'), true);
  // ⚠ THE FIXTURE PROVES THE CLAIM IS NOT VACUOUS: isle-b IS in the map (with no paths) and its
  // tile is still all 255, AND a variant that drops it from the map entirely is the same.
  assert.deepEqual(A_PATHS().get('isle-b'), []);
  assert.ok(texelsOf(wear, 'isle-b').every((v) => v === 255), 'isle-b wore a path it never had');
  assert.ok(texelsOf(wear, 'isle-a').includes(0), 'isle-a lost its own path');
  const onlyA = new Map([['isle-a', A_PATHS().get('isle-a')!]]);
  const dropped = buildAtlasWear(onlyA, OCC());
  assert.ok(texelsOf(dropped, 'isle-b').every((v) => v === 255), 'an island absent from the map wore a path');
  assert.deepEqual(texelsOf(dropped, 'isle-a'), texelsOf(wear, 'isle-a'));
  // And an EMPTY map draws nothing anywhere, without throwing.
  const none = buildAtlasWear(new Map(), OCC());
  assert.ok(none.data.every((v) => v === 255));
});

test('the field reads ZERO on the path and rises to the cap away from it', () => {
  const wear = buildAtlasWear(A_PATHS(), OCC());
  const tile = wear.tiles.find((t) => t.island === 'isle-a')!;
  const at = (i: number, j: number): number => decodeShore(wear.data[(tile.y + j) * wear.w + (tile.x + i)]!, WEAR_FIELD_WIDTH);
  // The path runs east-west through z = 20 (bowing off it a little). The island's north edge is
  // z = 0, which is 20 units from the path — well past the 3-unit cap.
  const northRow = Math.round((0 - tile.bounds.minZ + 2) * wear.gres);
  const north = at(Math.floor(tile.w / 2), northRow);
  assert.equal(north, WEAR_FIELD_WIDTH, 'the island`s north edge must be capped at the field width');
  // Down the middle column, the field is a BAND: somewhere strictly between 0 and the cap.
  const col = Array.from({ length: tile.h }, (_, j) => at(Math.floor(tile.w / 2), j));
  assert.ok(col.some((d) => d > 0 && d < WEAR_FIELD_WIDTH), 'the field is a step, not a band');
  assert.ok(col.some((d) => d < 0.4), 'the column never crosses the path');
});

test('the width parameter reaches BOTH the field`s cap and the encoding', () => {
  const width = 5.5;
  const wear = buildAtlasWear(A_PATHS(), OCC(), width);
  const reader = wearField(A_PATHS().get('isle-a')!, width);
  const tile = wear.tiles.find((t) => t.island === 'isle-a')!;
  let compared = 0;
  for (let j = 0; j < tile.h; j += 3) {
    for (let i = 0; i < tile.w; i += 3) {
      const texel = wear.data[(tile.y + j) * wear.w + (tile.x + i)]!;
      const expected = encodeShore(reader.sample(tile.bounds.minX + i / wear.gres, tile.bounds.minZ + j / wear.gres).distance, width);
      assert.equal(texel, expected);
      compared += 1;
    }
  }
  assert.ok(compared > 100);
  // A wider field wears MORE texels below 255 than the default — the width really widened it.
  const below = (a: { data: Uint8Array }): number => a.data.filter((v) => v < 255).length;
  assert.ok(below(wear) > below(buildAtlasWear(A_PATHS(), OCC())), 'a wider cap did not widen the band');
});
