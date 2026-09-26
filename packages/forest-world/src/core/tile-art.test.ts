// tile-art.test.ts — THE TILE IS DERIVED, AND EVERY LENGTH RE-BASES THROUGH IT (ADR-0528).
//
// What a test can hold about a drawing whose look is the owner's: that the lattice radius is the
// arithmetic the decision states and nothing else; that the tuned tile is typed as history and
// `tileUnits` re-bases exactly; that the lattice functions honour an explicit radius; that the
// substrate built on the tuned tile is the tuned mesh (homogeneous in the radius); that the coast's
// per-vertex outset is the formula it claims, in the outset it is handed; and that `TileArt` folds
// the tile and the art rungs into the numbers the builders read. Every line here was re-based or
// introduced by ADR-0528, and the mutation rung asked for each operator to be held.

import assert from 'node:assert/strict';
import test from 'node:test';

import { LAND_CAMERA_ELEVATION_DEG, PLAN_VIEW_ELEVATION_DEG, groundFlattening, uprightForeshortening } from './camera.js';
import { COAST_OUTSET, COAST_OUTSET_ON_TILE, jitteredOutset, smoothCoast, type BoundarySeg } from './coast.js';
import {
  HEX_AREA,
  HEX_R,
  HEX_TILES_PER_CAPABILITY,
  HEX_UNIT_AREA,
  HEX_W,
  LAND_AREA_PER_CAPABILITY,
  PRE_ADR0528_TILE,
  TILE_DEPTH_WORLD,
  TILE_QUOTA_RULE,
  TILE_SCALE,
  hexCenter,
  pixelToHex,
  tileUnits,
} from './hex.js';
import { hash, rand01 } from './rng.js';
import { SHIPPED_TILE_ART, tileArt } from './scene.js';
import {
  FLORA_ART_RUNG,
  PLATE_ART_RUNG,
  TRAIL_ART_RUNG,
  TREE_ART_RUNG,
  TREE_SCALE,
  crownRadius,
  crownRadiusWorld,
  storyTreeReach,
  tileQuota,
} from './sizing.js';
import { buildRelaxedCells, type DrawTile } from './substrate.js';

const close = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

// ---------------------------------------------------------------- hex.ts

test('ADR-0528 D1: the hex is sized so HEX_TILES_PER_CAPABILITY hexes cover exactly the land ratio — and nothing is authored', () => {
  assert.equal(LAND_AREA_PER_CAPABILITY, 318);
  assert.equal(HEX_TILES_PER_CAPABILITY, 1);
  close(HEX_UNIT_AREA, (3 * Math.sqrt(3)) / 2);
  // the derivation, restated: radius from area, then area from radius, closing the loop exactly
  close(HEX_R, Math.sqrt(318 / 1 / ((3 * Math.sqrt(3)) / 2)));
  close(HEX_AREA * HEX_TILES_PER_CAPABILITY, LAND_AREA_PER_CAPABILITY);
  close(HEX_AREA, HEX_UNIT_AREA * HEX_R * HEX_R);
  close(HEX_W, Math.sqrt(3) * HEX_R);
  assert.ok(HEX_R > 11 && HEX_R < 11.1, `${HEX_R}`);
  assert.equal(TILE_QUOTA_RULE, 'max(1, capabilities) × 1 hexes');
});

test('the tuned tile is typed as history — radius 27 and the retired quota, in words a reader checks against git', () => {
  assert.deepEqual(PRE_ADR0528_TILE, { hexR: 27, quota: 'max(3, capabilities + 2) hexes' });
  assert.ok(Object.isFrozen(PRE_ADR0528_TILE));
  close(TILE_SCALE, HEX_R / 27);
  close(tileUnits(27), HEX_R);
  close(tileUnits(0), 0);
  close(tileUnits(7), 7 * TILE_SCALE);
  close(TILE_DEPTH_WORLD, 8 * TILE_SCALE);
});

test('hexCenter / pixelToHex honour an explicit radius — the tuned lattice is the radius-27 lattice exactly, and the default is the derived one', () => {
  const tuned = { elevationDeg: PLAN_VIEW_ELEVATION_DEG, hexR: 27 };
  // the table `buildWorld.groundSpace.test.ts` was hand-verified against, at radius 27
  const c11 = hexCenter({ q: 1, r: 1 }, tuned);
  close(c11.x, 70.15, 0.01);
  close(c11.y, 40.5, 1e-9);
  const c12 = hexCenter({ q: 1, r: 2 }, tuned);
  close(c12.x, 93.53, 0.01);
  close(c12.y, 81, 1e-9);
  // the derived lattice is the same lattice scaled by TILE_SCALE
  const d11 = hexCenter({ q: 1, r: 1 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
  close(d11.x, c11.x * TILE_SCALE);
  close(d11.y, c11.y * TILE_SCALE);
  // the camera flattens the depth axis only, on either radius
  close(hexCenter({ q: 0, r: 2 }, { hexR: 27 }).y, 1.5 * 27 * 2 * groundFlattening(LAND_CAMERA_ELEVATION_DEG));
  close(hexCenter({ q: 0, r: 2 }).y, 1.5 * HEX_R * 2 * groundFlattening(LAND_CAMERA_ELEVATION_DEG));
  // the inverse reads the same radius: a round trip on the tuned lattice lands on the tile it left
  for (const h of [{ q: 3, r: -2 }, { q: -4, r: 5 }, { q: 0, r: 0 }]) {
    assert.deepEqual(pixelToHex(hexCenter(h, tuned), tuned), h);
    assert.deepEqual(pixelToHex(hexCenter(h)), h);
  }
  // and NOT the other: a tuned-lattice point read at the derived radius is a different tile
  assert.notDeepEqual(pixelToHex(hexCenter({ q: 3, r: -2 }, tuned)), { q: 3, r: -2 });
});

// ---------------------------------------------------------------- sizing.ts

test('tileQuota is one tile per capability with a floor of one — the `+ 2` is gone', () => {
  assert.equal(tileQuota(0), 1 * HEX_TILES_PER_CAPABILITY);
  assert.equal(tileQuota(1), 1 * HEX_TILES_PER_CAPABILITY);
  assert.equal(tileQuota(7), 7 * HEX_TILES_PER_CAPABILITY);
  assert.equal(tileQuota(26), 26 * HEX_TILES_PER_CAPABILITY);
  assert.equal(tileQuota(-3), 1 * HEX_TILES_PER_CAPABILITY);
});

test('the art rungs are 1 on every family, and the tree scale, the world crown and the tree reach carry TILE_SCALE × the rung', () => {
  assert.equal(TREE_ART_RUNG, 1);
  assert.equal(PLATE_ART_RUNG, 1);
  assert.equal(FLORA_ART_RUNG, 1);
  assert.equal(TRAIL_ART_RUNG, 1);
  close(TREE_SCALE, TILE_SCALE * TREE_ART_RUNG);
  close(crownRadiusWorld(3), crownRadius(3) * TREE_SCALE);
  close(crownRadiusWorld(3, 0.5), crownRadius(3) * 0.5);
  close(crownRadiusWorld(30), 32 * TREE_SCALE);
  close(storyTreeReach(4), (2.72 * crownRadius(4) + 18) * TREE_SCALE * uprightForeshortening(LAND_CAMERA_ELEVATION_DEG));
  close(storyTreeReach(4, 60), (2.72 * crownRadius(4) + 18) * TREE_SCALE * uprightForeshortening(60));
});

// ---------------------------------------------------------------- coast.ts

test('the coast outset stays authored on the tuned tile (the 3D reads it there) and re-bases for the 2D drawing; jitteredOutset is its formula in the outset it is handed', () => {
  assert.equal(COAST_OUTSET, 7);
  close(COAST_OUTSET_ON_TILE, 7 * TILE_SCALE);
  const id = 'coast-formula';
  const n = 12;
  for (const i of [0, 3, 7, 11]) {
    const theta = (i / n) * Math.PI * 2;
    const phase = rand01(hash(`${id}:coast:phase`)) * Math.PI * 2;
    const wave = Math.sin(theta * 3 + phase);
    const wobble = (rand01(hash(`${id}:coast:${i}`)) - 0.5) * 0.6;
    const expected = (outset: number): number => outset * (1 + 0.5 * (0.7 * wave + wobble));
    close(jitteredOutset(id, i, n), expected(COAST_OUTSET));
    close(jitteredOutset(id, i, n, COAST_OUTSET_ON_TILE), expected(COAST_OUTSET_ON_TILE));
    close(jitteredOutset(id, i, n, 10), expected(10));
    // linear in the outset — the wave and wobble only modulate it
    close(jitteredOutset(id, i, n, 20), 2 * jitteredOutset(id, i, n, 10));
  }
  // the wave and the wobble both bite: over a ring the outset is not constant, and it is never negative
  const ring = Array.from({ length: n }, (_, i) => jitteredOutset(id, i, n));
  assert.ok(Math.max(...ring) - Math.min(...ring) > 0.5, `${ring.join(', ')}`);
  assert.ok(ring.every((v) => v > 0));
});

test('smoothCoast pushes the loop out by the outset it is handed — a wider outset is a wider coast, and the default is the tuned one', () => {
  const square: BoundarySeg[] = [
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x1: 100, y1: 0, x2: 100, y2: 100 },
    { x1: 100, y1: 100, x2: 0, y2: 100 },
    { x1: 0, y1: 100, x2: 0, y2: 0 },
  ];
  const extent = (loops: Array<Array<{ x: number; y: number }>>): number => {
    const xs = loops.flat().map((p) => p.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  const tuned = extent(smoothCoast(square, 'sq').loops);
  const explicit = extent(smoothCoast(square, 'sq', COAST_OUTSET).loops);
  const onTile = extent(smoothCoast(square, 'sq', COAST_OUTSET_ON_TILE).loops);
  const wide = extent(smoothCoast(square, 'sq', 20).loops);
  close(tuned, explicit);
  assert.ok(tuned > 100 && onTile > 100 && wide > tuned && tuned > onTile, `${onTile} < ${tuned} < ${wide}`);
  // the loop is a real ring of finite points on every outset (an undefined per-vertex outset would NaN it)
  for (const loops of [smoothCoast(square, 'sq').loops, smoothCoast(square, 'sq', 20).loops]) {
    assert.ok(loops.length === 1 && loops[0]!.length > 8);
    assert.ok(loops[0]!.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

// ---------------------------------------------------------------- substrate.ts

test('a substrate built on the tuned tile IS the tuned mesh: the lattice spans 27/HEX_R of the derived build, the decomposition is the same, and the mesh is pinned — so the r3f fixture drawn at 27 is byte-for-byte what it was', () => {
  const tiles: DrawTile[] = [
    { h: { q: 0, r: 0 }, owner: 0 },
    { h: { q: 1, r: 0 }, owner: 0 },
    { h: { q: 0, r: 1 }, owner: 0 },
    { h: { q: -1, r: 1 }, owner: 0 },
  ];
  const spanOf = (cells: ReadonlyArray<{ poly: ReadonlyArray<{ x: number; y: number }> }>): number => {
    const xs = cells.flatMap((c) => c.poly.map((p) => p.x));
    return Math.max(...xs) - Math.min(...xs);
  };
  const digest = (cells: ReadonlyArray<{ owner: number; variant: number; wheat: boolean; poly: ReadonlyArray<{ x: number; y: number }> }>): number =>
    hash(cells.map((c) => `${c.owner}:${c.variant}:${c.wheat ? 1 : 0}:${c.poly.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')}`).join('|'));
  // ⚠ The interiors are NOT a scaled copy of each other — the relaxed mesh interns vertices by their
  // rounded position and seeds its jitter off that identity, so a lattice at another radius jitters
  // differently. What IS homogeneous is the lattice: the extent scales exactly. And the tuned build
  // is pinned by digest, which is what "the fixture is what it was" means as a number (re-record
  // with a reason, as `substrate-camera.test.ts` says of its own digest).
  const pinned = { mesh: 1171615638, 'relaxed-quad': 803192388, 'relaxed-hex': 728292467 } as const;
  for (const mode of ['mesh', 'relaxed-quad', 'relaxed-hex'] as const) {
    const derived = buildRelaxedCells(tiles, [new Set<string>()], mode, {}, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
    const tuned = buildRelaxedCells(tiles, [new Set<string>()], mode, { hexR: 27 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
    assert.equal(tuned.length, derived.length, `${mode}: the same decomposition`);
    assert.ok(tuned.length > 0);
    close(spanOf(tuned) / spanOf(derived), 27 / HEX_R, 1e-6);
    assert.equal(digest(tuned), pinned[mode], `${mode}: the tuned mesh moved — name what moved and why, then re-record`);
    assert.notEqual(digest(derived), pinned[mode], `${mode}: the derived build is not the tuned one`);
  }
});

// ---------------------------------------------------------------- scene.ts — the TileArt bundle

test('tileArt folds the tile and the rungs into the numbers the builders read; the shipped art is the derived tile at rung 1', () => {
  const shipped = tileArt();
  close(shipped.hexR, HEX_R);
  close(shipped.scale, TILE_SCALE);
  close(shipped.units(15), 15 * TILE_SCALE);
  close(shipped.tree, TILE_SCALE * TREE_ART_RUNG);
  close(shipped.plate, TILE_SCALE * PLATE_ART_RUNG);
  close(shipped.flora, TILE_SCALE * FLORA_ART_RUNG);
  close(shipped.trailStroke, TILE_SCALE * TRAIL_ART_RUNG);
  close(shipped.markerSpacing, 15 * TILE_SCALE);
  close(shipped.markerTreeWell, 36 * TILE_SCALE);
  close(shipped.hoverOrbitR, 9 * TILE_SCALE);
  assert.deepEqual(Object.keys(SHIPPED_TILE_ART).sort(), Object.keys(shipped).sort());
  close(SHIPPED_TILE_ART.tree, shipped.tree);
  // the tuned tile: every factor is exactly 1 × its rung, and a length authored there re-bases to itself
  const tuned = tileArt(27);
  close(tuned.scale, 1);
  close(tuned.units(36), 36);
  close(tuned.markerTreeWell, 36);
  close(tuned.tree, TREE_ART_RUNG);
  // the rungs multiply their own family and no other
  const dialled = tileArt(HEX_R, { tree: 0.8, plate: 1.25, flora: 1.5, trail: 2.44 });
  close(dialled.tree, TILE_SCALE * TREE_ART_RUNG * 0.8);
  close(dialled.plate, TILE_SCALE * PLATE_ART_RUNG * 1.25);
  close(dialled.flora, TILE_SCALE * FLORA_ART_RUNG * 1.5);
  close(dialled.trailStroke, TILE_SCALE * TRAIL_ART_RUNG * 2.44);
  close(dialled.markerSpacing, shipped.markerSpacing);
  close(tileArt(HEX_R, { tree: 0.8 }).plate, shipped.plate);
});
