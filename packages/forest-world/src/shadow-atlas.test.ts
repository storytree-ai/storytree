// shadow-atlas.test.ts — the packed occlusion field, held to the one claim that makes it a
// remedy rather than a rearrangement: AN ISLAND IN A CROWD IS SHADED EXACTLY AS IT IS ALONE.
//
// ⚠ THE FIXTURES ARE MEMOISED AND SMALL, and that is a mutation-rung requirement rather than
// tidiness. `check:mutation-diff` runs the covering tests ONCE PER MUTANT against a per-mutant
// timeout, and scores a timeout as UNPROVEN with the same "no test named" line an attribution gap
// produces — so a witness that rebuilds a whole forest per assertion turns this module's mutants
// into a stable-looking set of phantom survivors. Every island here is a four-vertex square and
// every field is a few thousand samples.

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONTACT_SPREAD, SHADOW_CONTACT_BAND, buildGroundOcclusion } from './contact-shade.js';
import {
  OCCLUSION_PAD,
  SHADOW_GRES,
  SHADOW_PENUMBRA,
  SHADOW_TEXTURE_MAX,
  occlusionGres,
  type GroundBounds,
  type ShadowCaster,
} from './land-shadow.js';
import {
  ATLAS_REFIT_ATTEMPTS,
  ATLAS_SHRINK_MARGIN,
  SHADOW_ATLAS_MAX,
  UNHOMED_ISLAND,
  assignCasters,
  atlasBytes,
  atlasShrink,
  blitTile,
  byIslandId,
  casterWithin,
  atlasCoverage,
  atlasOccupancy,
  atlasOrigin,
  atlasOriginResolver,
  atlasScale,
  buildAtlasOcclusion,
  islandGroundBounds,
  packShadowAtlas,
  shelfPack,
  tileEdge,
  tileMargin,
  tileOf,
  type IslandBounds,
} from './shadow-atlas.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** One square parcel, `size` units on a side, with its south-west corner at (x, z). */
function square(island: string | undefined, x: number, z: number, size: number): InstanceDescriptor {
  const cell: InstanceDescriptor = {
    kind: 'cell-ground',
    group: 'cell-ground',
    transform: { x: x + size / 2, y: 0, z: z + size / 2 },
    points: [
      { x, y: 0, z },
      { x: x + size, y: 0, z },
      { x: x + size, y: 0, z: z + size },
      { x, y: 0, z: z + size },
    ],
  };
  if (island !== undefined) cell.island = island;
  return cell;
}

/** `n` islands of `size` units, laid out on a wide grid with `gap` units of sea between them —
 *  the shape the remedy is about: a little land, a lot of nothing. */
function scattered(n: number, size = 30, gap = 400): InstanceDescriptor[] {
  const cells: InstanceDescriptor[] = [];
  for (let i = 0; i < n; i += 1) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    cells.push(square(`isle-${String(i).padStart(2, '0')}`, col * gap, row * gap, size));
  }
  return cells;
}

/** A tree standing in the middle of island `i` of {@link scattered}'s layout. */
function treeOn(i: number, size = 30, gap = 400): ShadowCaster {
  const col = i % 6;
  const row = Math.floor(i / 6);
  return { x: col * gap + size / 2, z: row * gap + size / 2, radius: 4, height: 19 };
}

const SIX = scattered(6);
const SIX_BOUNDS = islandGroundBounds(SIX);

test('islands are grouped by their OWN id, not by proximity', () => {
  const bounds = islandGroundBounds([
    square('a', 0, 0, 10),
    square('b', 100, 0, 10),
    square('a', 40, 40, 10),
  ]);
  assert.equal(bounds.length, 2);
  const a = bounds.find((b) => b.island === 'a');
  assert.deepEqual(a?.bounds, { minX: 0, maxX: 50, minZ: 0, maxZ: 50 });
  assert.deepEqual(bounds.find((b) => b.island === 'b')?.bounds, {
    minX: 100,
    maxX: 110,
    minZ: 0,
    maxZ: 10,
  });
});

test('a cell with NO island id gets its own group, never a neighbour’s', () => {
  const bounds = islandGroundBounds([square('a', 0, 0, 10), square(undefined, 500, 500, 10)]);
  assert.equal(bounds.length, 2);
  const unhomed = bounds.find((b) => b.island === UNHOMED_ISLAND);
  assert.ok(unhomed, 'the unhomed cell must bound something of its own');
  assert.equal(unhomed.bounds.minX, 500);
  // The point of the separate key: folding it into `a` would have stretched `a`'s tile across
  // 500 units of sea, which is the very allocation this module exists to avoid.
  assert.equal(bounds.find((b) => b.island === 'a')?.bounds.maxX, 10);
});

test('the grouping is SORTED, so two runs over one map pack the same atlas', () => {
  const forward = islandGroundBounds([square('b', 0, 0, 10), square('a', 40, 0, 10)]);
  const backward = islandGroundBounds([square('a', 40, 0, 10), square('b', 0, 0, 10)]);
  assert.deepEqual(
    forward.map((b) => b.island),
    ['a', 'b'],
  );
  assert.deepEqual(forward, backward);
});

test('a cell with no ring bounds nothing at all', () => {
  const ringless: InstanceDescriptor = {
    kind: 'cell-ground',
    group: 'cell-ground',
    transform: { x: 5, y: 0, z: 5 },
    island: 'a',
  };
  assert.deepEqual(islandGroundBounds([ringless]), []);
});

test('tileEdge rounds UP and never returns a zero-sample tile', () => {
  assert.equal(tileEdge(10, 3), 30);
  assert.equal(tileEdge(10.1, 3), 31);
  assert.equal(tileEdge(0, 3), 1);
  assert.equal(tileEdge(0.1, 0.01), 1);
});

test('⚠ THE BILINEAR MARGIN IS ALREADY PAID FOR — a tile cannot bleed its neighbour', () => {
  // The whole safety argument for packing many fields into one texture, as a number. A bilinear
  // tap reaches ONE texel; the pad leaves this many between an island's own land and its border.
  assert.equal(tileMargin(SHADOW_GRES), OCCLUSION_PAD * SHADOW_GRES);
  assert.ok(tileMargin(SHADOW_GRES) > 1, 'the authored pad must exceed a bilinear tap');
  // And it is a real fence rather than a restatement of the constant: at a coarse enough
  // resolution the pad stops covering a texel, which is when this module would owe its own gutter.
  assert.ok(tileMargin(0.4) < 1);
});

test('shelf packing places every tile inside the atlas, and no two overlap', () => {
  const layout = shelfPack(SIX_BOUNDS, SHADOW_GRES, SHADOW_ATLAS_MAX);
  assert.ok(layout, 'six small islands must fit');
  assert.equal(layout.tiles.length, 6);
  for (const t of layout.tiles) {
    assert.ok(t.x >= 0 && t.x + t.w <= layout.w, `${t.island} runs off the atlas in x`);
    assert.ok(t.y >= 0 && t.y + t.h <= layout.h, `${t.island} runs off the atlas in y`);
  }
  for (const a of layout.tiles) {
    for (const b of layout.tiles) {
      if (a.island === b.island) continue;
      const apart =
        a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `${a.island} and ${b.island} overlap in the atlas`);
    }
  }
});

test('a tile wider than the whole atlas is REFUSED rather than shelved forever', () => {
  const huge: IslandBounds[] = [{ island: 'x', bounds: { minX: 0, maxX: 1000, minZ: 0, maxZ: 10 } }];
  assert.equal(shelfPack(huge, SHADOW_GRES, 64), null);
});

test('a set that overflows the atlas HEIGHT is refused too', () => {
  // Six 30-unit islands at 3 samples per unit are 102 texels each; a 128-wide atlas fits one per
  // shelf, so six shelves need 612 rows and a 128 cap cannot hold them.
  assert.equal(shelfPack(SIX_BOUNDS, SHADOW_GRES, 128), null);
});

test('tiles are shelved TALLEST FIRST — which is what makes the packing tight', () => {
  const mixed: IslandBounds[] = [
    { island: 'short', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 4 } },
    { island: 'tall', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 60 } },
    { island: 'middling', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 20 } },
  ];
  const layout = shelfPack(mixed, 1, SHADOW_ATLAS_MAX);
  assert.ok(layout);
  assert.deepEqual(
    layout.tiles.map((t) => t.island),
    ['tall', 'middling', 'short'],
  );
});

test('⚠⚠ THE HEADLINE: the packed atlas delivers the AUTHORED resolution where the rect clamp does not', () => {
  const forest = scattered(35);
  const bounds = islandGroundBounds(forest);
  const layout = packShadowAtlas(bounds);
  assert.equal(layout.gres, SHADOW_GRES, 'the atlas must not have had to go coarse');

  // The same islands, bounded as one rect, under the shipped cap.
  const rect = rectBoundsOf(bounds);
  const clamped = occlusionGres(rect, SHADOW_GRES, SHADOW_TEXTURE_MAX);
  assert.ok(clamped < SHADOW_GRES, 'the control must actually be clamped, or this proves nothing');
  // And the atlas is not merely equal-or-better — it is smaller as well, which is the half a
  // reader would not assume.
  const rectBytes =
    Math.ceil((rect.maxX - rect.minX + OCCLUSION_PAD * 2) * clamped) *
    Math.ceil((rect.maxZ - rect.minZ + OCCLUSION_PAD * 2) * clamped);
  assert.ok(
    atlasBytes(layout) < rectBytes,
    `the atlas (${atlasBytes(layout)} B) must cost less than the clamped rect (${rectBytes} B)`,
  );
});

/** The one rect that contains every island — the allocation the atlas replaces. */
function rectBoundsOf(islands: readonly IslandBounds[]): GroundBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const i of islands) {
    minX = Math.min(minX, i.bounds.minX);
    maxX = Math.max(maxX, i.bounds.maxX);
    minZ = Math.min(minZ, i.bounds.minZ);
    maxZ = Math.max(maxZ, i.bounds.maxZ);
  }
  return { minX, maxX, minZ, maxZ };
}

test('an atlas that cannot fit goes COARSER rather than refusing — the same failure the rect form has', () => {
  const layout = packShadowAtlas(SIX_BOUNDS, SHADOW_GRES, 128);
  assert.ok(layout.gres < SHADOW_GRES, 'it must have degraded');
  assert.ok(layout.w <= 128 && layout.h <= 128, 'and landed inside the cap it was given');
});

test('an atlas that cannot fit at ANY reachable resolution THROWS rather than drawing nothing', () => {
  // One island and a one-texel atlas: every refit is still too big, so the bounded loop gives up.
  assert.throws(
    () => packShadowAtlas(SIX_BOUNDS, SHADOW_GRES, 1),
    /do not fit .* in 8 attempts/,
  );
  assert.equal(ATLAS_REFIT_ATTEMPTS, 8, 'the message above quotes this bound');
});

test('occupancy reports the packing waste rather than leaving it to be inferred', () => {
  const layout = shelfPack(SIX_BOUNDS, SHADOW_GRES, SHADOW_ATLAS_MAX);
  assert.ok(layout);
  const occ = atlasOccupancy(layout);
  assert.ok(occ > 0 && occ <= 1, `occupancy out of range: ${occ}`);
  let used = 0;
  for (const t of layout.tiles) used += t.w * t.h;
  assert.equal(occ, used / atlasBytes(layout));
});

test('⚠⚠ THE UV DERIVATION LANDS ON THE TEXEL THE FIELD WROTE — origin plus scale, not a second copy', () => {
  const layout = packShadowAtlas(SIX_BOUNDS);
  const scale = atlasScale(layout);
  for (const island of SIX_BOUNDS) {
    const tile = tileOf(layout, island.island);
    assert.ok(tile, `${island.island} must have a tile`);
    const origin = atlasOrigin(layout, island.island);
    // A ground point in the island's middle, and where the packing says its sample sits.
    const gx = (island.bounds.minX + island.bounds.maxX) / 2;
    const gz = (island.bounds.minZ + island.bounds.maxZ) / 2;
    const texelX = (origin.u + gx * scale.u) * layout.w;
    const texelZ = (origin.v + gz * scale.v) * layout.h;
    assert.ok(
      Math.abs(texelX - (tile.x + (gx - tile.minX) * layout.gres)) < 1e-6,
      `${island.island}: u lands at ${texelX}, not in its own tile`,
    );
    assert.ok(
      Math.abs(texelZ - (tile.y + (gz - tile.minZ) * layout.gres)) < 1e-6,
      `${island.island}: v lands at ${texelZ}, not in its own tile`,
    );
    // And it is INSIDE the tile, which is the property a bleeding sample would violate.
    assert.ok(texelX >= tile.x && texelX <= tile.x + tile.w);
    assert.ok(texelZ >= tile.y && texelZ <= tile.y + tile.h);
  }
});

test('an island with no tile reads the atlas ORIGIN, never a NaN', () => {
  const layout = packShadowAtlas(SIX_BOUNDS);
  assert.deepEqual(atlasOrigin(layout, 'no-such-island'), { u: 0, v: 0 });
  assert.equal(tileOf(layout, 'no-such-island'), undefined);
});

test('the resolver reads an ABSENT island as the unhomed group, not as a miss', () => {
  const cells = [square('a', 0, 0, 10), square(undefined, 500, 500, 10)];
  const layout = packShadowAtlas(islandGroundBounds(cells));
  const resolve = atlasOriginResolver(layout);
  assert.deepEqual(resolve(undefined), atlasOrigin(layout, UNHOMED_ISLAND));
  assert.notDeepEqual(resolve(undefined), resolve('a'));
});

test('every caster is assigned to the island it stands on, and strays are REPORTED', () => {
  const stray: ShadowCaster = { x: -5000, z: -5000, radius: 4, height: 19 };
  const assignment = assignCasters(SIX_BOUNDS, [treeOn(0), treeOn(3), stray]);
  assert.equal(assignment.unassigned.length, 1);
  assert.deepEqual(assignment.unassigned[0], stray);
  assert.equal(assignment.byIsland.get('isle-00')?.length, 1);
  assert.equal(assignment.byIsland.get('isle-03')?.length, 1);
  assert.equal(assignment.byIsland.get('isle-01')?.length, 0);
});

test('a caster on the very RIM belongs to its island — the pad is part of the test', () => {
  const rim: ShadowCaster = { x: 30 + OCCLUSION_PAD, z: 15, radius: 4, height: 19 };
  const beyond: ShadowCaster = { x: 30 + OCCLUSION_PAD + 0.001, z: 15, radius: 4, height: 19 };
  const a = assignCasters(SIX_BOUNDS, [rim]);
  assert.equal(a.byIsland.get('isle-00')?.length, 1);
  assert.equal(assignCasters(SIX_BOUNDS, [beyond]).unassigned.length, 1);
});

test('⚠⚠ AN ISLAND IN A CROWD IS SHADED EXACTLY AS IT IS ALONE — byte for byte', () => {
  // THE CLAIM THE WHOLE REMEDY RESTS ON. Not "similar", not "at the same resolution": the tile
  // this island occupies in a six-island atlas is the field it gets when it is the only island
  // on the map, sample for sample. Anything weaker would leave "the crowd changes the shadow"
  // exactly as true as it was, only harder to see.
  const casters = [treeOn(0), treeOn(1), treeOn(2), treeOn(3), treeOn(4), treeOn(5)];
  const atlas = buildAtlasOcclusion({ cells: SIX, relief: 2.2, casters });
  assert.equal(atlas.unassigned, 0);
  assert.equal(atlas.gres, SHADOW_GRES);

  const alone = buildGroundOcclusion({
    bounds: SIX_BOUNDS[0]!.bounds,
    relief: 2.2,
    casters: [treeOn(0)],
  });
  const tile = atlas.tiles.find((t) => t.island === 'isle-00');
  assert.ok(tile);
  assert.equal(tile.w, alone.w, 'the tile and the lone field must be the same width');
  assert.equal(tile.h, alone.h);
  let differing = 0;
  for (let j = 0; j < alone.h; j += 1) {
    for (let i = 0; i < alone.w; i += 1) {
      const inAtlas = atlas.data[(tile.y + j) * atlas.w + tile.x + i]!;
      if (inAtlas !== alone.data[j * alone.w + i]!) differing += 1;
    }
  }
  assert.equal(differing, 0, `${differing} samples differ between the crowd and the lone island`);
  // NON-VACUITY: the lone field is not simply empty, so "identical" is a claim about a shadow.
  assert.ok(
    alone.data.some((v) => v > 0),
    'the lone island must actually carry a shadow, or the comparison above is two empty fields',
  );
});

test('only the island’s OWN casters reach its tile — a neighbour’s tree darkens nothing here', () => {
  const withNeighbour = buildAtlasOcclusion({
    cells: SIX,
    relief: 2.2,
    casters: [treeOn(0), treeOn(1)],
  });
  const alone = buildAtlasOcclusion({ cells: SIX, relief: 2.2, casters: [treeOn(0)] });
  const tile = withNeighbour.tiles.find((t) => t.island === 'isle-00')!;
  const aloneTile = alone.tiles.find((t) => t.island === 'isle-00')!;
  assert.deepEqual({ x: tile.x, y: tile.y }, { x: aloneTile.x, y: aloneTile.y });
  let differing = 0;
  for (let j = 0; j < tile.h; j += 1) {
    for (let i = 0; i < tile.w; i += 1) {
      const p = (tile.y + j) * withNeighbour.w + tile.x + i;
      if (withNeighbour.data[p] !== alone.data[p]) differing += 1;
    }
  }
  assert.equal(differing, 0);
  // And island 1 really did get its tree in the first build, so the isolation above is not the
  // trivial consequence of nothing being drawn anywhere.
  const other = withNeighbour.tiles.find((t) => t.island === 'isle-01')!;
  let lit = 0;
  for (let j = 0; j < other.h; j += 1) {
    for (let i = 0; i < other.w; i += 1) {
      if (withNeighbour.data[(other.y + j) * withNeighbour.w + other.x + i]! > 0) lit += 1;
    }
  }
  assert.ok(lit > 0, "island 1's own tree must have stamped island 1's tile");
});

test('a caster on no island is COUNTED rather than silently dropped', () => {
  const atlas = buildAtlasOcclusion({
    cells: SIX,
    relief: 2.2,
    casters: [treeOn(0), { x: -9000, z: 0, radius: 4, height: 19 }],
  });
  assert.equal(atlas.unassigned, 1);
});

test('atlas coverage measures the packed field, and is HIGHER than the rect form on the same shadows', () => {
  const casters = [treeOn(0), treeOn(1), treeOn(2), treeOn(3), treeOn(4), treeOn(5)];
  const atlas = buildAtlasOcclusion({ cells: SIX, relief: 2.2, casters });
  const packed = atlasCoverage(atlas);
  assert.ok(packed > 0 && packed < 1);
  // The point of the comment on `atlasCoverage`: the rect form's denominator is mostly sea, so
  // the SAME shadows read as a smaller fraction there. A reader comparing the two numbers
  // straight across would conclude the atlas drew MORE shadow, and it drew exactly the same.
  const rect = buildGroundOcclusion({ bounds: rectBoundsOf(SIX_BOUNDS), relief: 2.2, casters });
  let n = 0;
  for (const v of rect.data) if (v / 255 > 0.5) n += 1;
  assert.ok(packed > n / rect.data.length);
});

// ---------------------------------------------------------------------------------------------
// THE MUTATION RUNG'S OWN LIST — every claim below is here because `check:mutation-diff` named a
// mutant this file's first draft could not kill. They are not extra coverage; they are the
// boundaries, the tie-breaks and the defaults the arithmetic above actually turns on.

test('the unhomed key is the EMPTY string, and a real island can never collide with it', () => {
  // Asserted as a literal rather than symbolically: every test that spells `UNHOMED_ISLAND` is
  // satisfied by any value at all, so nothing above pins what the key IS.
  assert.equal(UNHOMED_ISLAND, '');
  const bounds = islandGroundBounds([square(undefined, 0, 0, 10)]);
  assert.equal(bounds[0]?.island, '');
});

test('a tile begins one PAD outside its island, on both axes', () => {
  const layout = packShadowAtlas(SIX_BOUNDS);
  for (const island of SIX_BOUNDS) {
    const tile = tileOf(layout, island.island);
    assert.ok(tile);
    // ⚠ THE SIGN OF THE PAD, PINNED. Flipped, the tile still packs, the UV round trip above still
    // agrees with itself, and every island's field simply sits four ground units off the land it
    // describes — a shadow displaced by a quarter of a parcel, which reads as a lighting quirk.
    assert.equal(tile.minX, island.bounds.minX - OCCLUSION_PAD);
    assert.equal(tile.minZ, island.bounds.minZ - OCCLUSION_PAD);
    // And the tile carries the island's own rect, unpadded — what the field is built over.
    assert.deepEqual(tile.bounds, island.bounds);
  }
});

test('byIslandId orders both ways and reports ties — all three branches', () => {
  assert.equal(byIslandId('a', 'b'), -1);
  assert.equal(byIslandId('b', 'a'), 1);
  assert.equal(byIslandId('a', 'a'), 0);
});

test('EQUAL-HEIGHT tiles are shelved in ISLAND-ID order, whichever order they arrive in', () => {
  // ⚠ THE TIE-BREAK IS THE WHOLE POINT AND IT IS INVISIBLE UNTIL THE HEIGHTS MATCH. Every island
  // in the crowd fixture is a copy of one island, so EVERY comparison falls through to this
  // branch: a comparator that returned a constant would pack in arrival order, and two runs over
  // the same map would commit two different atlases.
  const forward: IslandBounds[] = [
    { island: 'a', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 } },
    { island: 'b', bounds: { minX: 40, maxX: 50, minZ: 0, maxZ: 10 } },
    { island: 'c', bounds: { minX: 80, maxX: 90, minZ: 0, maxZ: 10 } },
  ];
  const order = (l: ReturnType<typeof shelfPack>): string[] => (l?.tiles ?? []).map((t) => t.island);
  assert.deepEqual(order(shelfPack(forward, 1)), ['a', 'b', 'c']);
  assert.deepEqual(order(shelfPack([...forward].reverse(), 1)), ['a', 'b', 'c']);
  const shuffled = [forward[1]!, forward[2]!, forward[0]!];
  assert.deepEqual(order(shelfPack(shuffled, 1)), ['a', 'b', 'c']);
});

test('a tile that EXACTLY fills the atlas fits — the cap is a ceiling, not a wall one short of it', () => {
  // 10 units + 2 pads of 2 = 14 units; at 1 sample per unit that is a 14-texel tile.
  const one: IslandBounds[] = [{ island: 'a', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 } }];
  assert.ok(shelfPack(one, 1, 14), 'a tile exactly as wide as the atlas must fit');
  assert.equal(shelfPack(one, 1, 13), null, 'and one texel wider must not');
});

test('two tiles that EXACTLY fill a shelf share it — the wrap is a ceiling too', () => {
  // Tiles 14 texels wide (10 units + two pads of 2, at 1 sample per unit) and 6 tall.
  const two: IslandBounds[] = [
    { island: 'a', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 2 } },
    { island: 'b', bounds: { minX: 40, maxX: 50, minZ: 0, maxZ: 2 } },
  ];
  const exact = shelfPack(two, 1, 28);
  assert.ok(exact);
  assert.equal(exact.h, 6, 'at exactly 28 wide both tiles share ONE shelf');
  assert.equal(exact.w, 28);
  const tight = shelfPack(two, 1, 27);
  assert.ok(tight);
  assert.equal(tight.h, 12, 'one texel narrower and the second tile wraps to a second shelf');
});

test('a set that EXACTLY fills the atlas HEIGHT fits, and one texel more does not', () => {
  // Tiles 14 wide by 10 tall, in a 20-texel atlas: one per shelf, two shelves, exactly 20 rows.
  const two: IslandBounds[] = [
    { island: 'a', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 6 } },
    { island: 'b', bounds: { minX: 40, maxX: 50, minZ: 0, maxZ: 6 } },
  ];
  const exact = shelfPack(two, 1, 20);
  assert.ok(exact, 'two 10-row shelves must fit a 20-row atlas exactly');
  assert.equal(exact.h, 20);
  assert.equal(shelfPack(two, 1, 19), null, 'and one row short must be refused');
});

test('atlasShrink on an EMPTY set returns the margin rather than dividing by nothing', () => {
  assert.equal(atlasShrink([], SHADOW_GRES), ATLAS_SHRINK_MARGIN);
  // And a real set shrinks by less than 1, or the refit loop would never converge.
  const shrink = atlasShrink(SIX_BOUNDS, SHADOW_GRES, 64);
  assert.ok(shrink > 0 && shrink < 1, `shrink out of range: ${shrink}`);
});

test('an empty atlas is ONE texel and fully occupied — which is why occupancy needs no guard', () => {
  const empty = shelfPack([], SHADOW_GRES);
  assert.ok(empty);
  assert.equal(atlasBytes(empty), 1);
  assert.equal(atlasOccupancy(empty), 0);
});

test('⚠ casterWithin: all FOUR bounds, each at the exact pad and one step past it', () => {
  // Four comparisons, four separate boundaries, and every one of them is a `<` a mutant can turn
  // into a `<=` or a pad sign it can flip. The predicate decides which island's tile a story
  // tree's pool is stamped into; a flipped comparison sends it to a neighbour's land.
  const bounds: GroundBounds = { minX: 0, maxX: 100, minZ: 0, maxZ: 50 };
  const at = (x: number, z: number): ShadowCaster => ({ x, z, radius: 4, height: 19 });
  assert.equal(casterWithin(bounds, at(-OCCLUSION_PAD, 25)), true, 'the west pad is inclusive');
  assert.equal(casterWithin(bounds, at(-OCCLUSION_PAD - 0.001, 25)), false, 'and one step out is not');
  assert.equal(casterWithin(bounds, at(100 + OCCLUSION_PAD, 25)), true, 'the east pad is inclusive');
  assert.equal(casterWithin(bounds, at(100 + OCCLUSION_PAD + 0.001, 25)), false);
  assert.equal(casterWithin(bounds, at(50, -OCCLUSION_PAD)), true, 'the north pad is inclusive');
  assert.equal(casterWithin(bounds, at(50, -OCCLUSION_PAD - 0.001)), false);
  assert.equal(casterWithin(bounds, at(50, 50 + OCCLUSION_PAD)), true, 'the south pad is inclusive');
  assert.equal(casterWithin(bounds, at(50, 50 + OCCLUSION_PAD + 0.001)), false);
  // The pad is an ARGUMENT, and passing a different one really moves the boundary.
  assert.equal(casterWithin(bounds, at(-10, 25), 20), true);
  assert.equal(casterWithin(bounds, at(-10, 25), 5), false);
});

test('a caster inside TWO islands’ padded bounds is given to BOTH', () => {
  const overlapping: IslandBounds[] = [
    { island: 'a', bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 } },
    { island: 'b', bounds: { minX: 12, maxX: 22, minZ: 0, maxZ: 10 } },
  ];
  const between: ShadowCaster = { x: 11, z: 5, radius: 4, height: 19 };
  const assignment = assignCasters(overlapping, [between]);
  assert.equal(assignment.byIsland.get('a')?.length, 1);
  assert.equal(assignment.byIsland.get('b')?.length, 1);
  assert.equal(assignment.unassigned.length, 0, 'and it is not ALSO reported as homeless');
});

test('buildAtlasOcclusion honours an explicit gres and an explicit max', () => {
  // Both defaults are `??`, and a mutant that turns either into `&&` inverts them: the explicit
  // value is discarded and the authored one used, or vice versa. Only an explicitly-passed value
  // that DIFFERS from the default can see it.
  const coarse = buildAtlasOcclusion({ cells: SIX, relief: 2.2, casters: [treeOn(0)], gres: 1 });
  assert.equal(coarse.gres, 1, 'an explicit gres must be the one delivered');
  assert.notEqual(coarse.gres, SHADOW_GRES);
  const capped = buildAtlasOcclusion({ cells: SIX, relief: 2.2, casters: [treeOn(0)], max: 100 });
  assert.ok(capped.w <= 100 && capped.h <= 100, 'an explicit max must bound the atlas');
  assert.ok(capped.gres < SHADOW_GRES, 'and it must have cost resolution to get there');
});

test('⚠ blitTile REFUSES a field that is not its tile’s size', () => {
  // The defence that used to be a `Math.min`. Clamping absorbs the first disagreement between the
  // grid arithmetic and the packing arithmetic by dropping a row — one texel of one island's
  // shadow, invisible and unattributable. Throwing makes it the loudest thing in the run.
  const layout = packShadowAtlas(SIX_BOUNDS);
  const tile = layout.tiles[0]!;
  const wrong = {
    minX: tile.minX,
    minZ: tile.minZ,
    w: tile.w - 1,
    h: tile.h,
    gres: layout.gres,
    data: new Uint8Array((tile.w - 1) * tile.h),
  };
  assert.throws(
    () => blitTile(new Uint8Array(layout.w * layout.h), layout.w, tile, wrong),
    /the grid arithmetic and the packing arithmetic have parted/,
  );
  // NON-VACUITY: the right size does not throw, so the refusal is about the size and not about
  // the call.
  const right = { ...wrong, w: tile.w, data: new Uint8Array(tile.w * tile.h) };
  blitTile(new Uint8Array(layout.w * layout.h), layout.w, tile, right);
});

test('atlasCoverage counts what the MATERIAL thresholds, at the threshold it is given', () => {
  // A hand-built field rather than a rendered one, so the expected number is arithmetic rather
  // than a transcription: four samples, two of them past the material's 0.5.
  const field = {
    w: 2,
    h: 2,
    gres: 1,
    data: new Uint8Array([0, 128, 200, 255]),
    tiles: [],
    unassigned: 0,
  };
  // 128/255 = 0.502 and 200/255 = 0.784 and 255/255 = 1 are past 0.5; 0 is not.
  assert.equal(atlasCoverage(field), 0.75);
  // The threshold is a real argument: at 0.9 only the last sample survives.
  assert.equal(atlasCoverage(field, 0.9), 0.25);
  // And nothing can be past 1, which is what says the comparison is `>` on a 0..1 scalar rather
  // than on the raw byte.
  assert.equal(atlasCoverage(field, 1), 0);
});

test('a NEIGHBOUR’S tree never reaches this island’s tile — even when it is close enough to try', () => {
  // ⚠⚠ THE FILTER IS NOT AN OPTIMISATION AT CLOSE RANGE. Handing every island the whole map's
  // casters is harmless while islands are hundreds of units apart, because a stamp is bounded to
  // its own caster's box. Put two islands twenty units apart and a story tree's shadow — about
  // thirteen ground units long — reaches over the water into the NEIGHBOUR's field, and the
  // neighbour's tile acquires a shadow cast by a tree standing on somebody else's land.
  // Three ground units of water between them. The authored light throws a shadow along
  // (+0.789, -0.614) for 13.2 units from a 19-unit tree, and the contact pool alone is 5.6 units
  // across — so both terms reach `b`'s field, which begins one pad short of `b` at x = 31.
  const close: InstanceDescriptor[] = [square('a', 0, 0, 30), square('b', 33, 0, 30)];
  // On island `a`, near its eastern edge — and OUTSIDE `b`'s padded bounds (31 > 29), so it stays
  // `a`'s caster alone while its shadow leans across the water into `b`'s tile.
  const edger: ShadowCaster = { x: 29, z: 15, radius: 4, height: 19 };
  const atlas = buildAtlasOcclusion({ cells: close, relief: 2.2, casters: [edger] });
  assert.equal(atlas.unassigned, 0, "the tree must belong to `a`");
  assert.equal(assignCasters(islandGroundBounds(close), [edger]).byIsland.get('b')?.length, 0);

  const tile = atlas.tiles.find((t) => t.island === 'b');
  assert.ok(tile);
  let lit = 0;
  for (const j of Array.from({ length: tile.h }, (_, n) => n)) {
    for (const i of Array.from({ length: tile.w }, (_, n) => n)) {
      if (atlas.data[(tile.y + j) * atlas.w + tile.x + i]! > 0) lit += 1;
    }
  }
  assert.equal(lit, 0, `island b's tile carries ${lit} samples of its neighbour's shadow`);

  // NON-VACUITY: the same tree DOES darken its own island, and its shadow really does reach past
  // that island's own bounds — so the zero above is the filter working, not the tree missing.
  const own = atlas.tiles.find((t) => t.island === 'a')!;
  let ownLit = 0;
  for (const j of Array.from({ length: own.h }, (_, n) => n)) {
    for (const i of Array.from({ length: own.w }, (_, n) => n)) {
      if (atlas.data[(own.y + j) * atlas.w + own.x + i]! > 0) ownLit += 1;
    }
  }
  assert.ok(ownLit > 0, "the tree must darken its own island's tile");
  // ⚠ AND THE UNFILTERED CALL REALLY WOULD HAVE STAMPED `b` — asserted rather than assumed, or
  // the zero above is satisfied by two islands too far apart to have been a test at all.
  const spilled = buildGroundOcclusion({
    bounds: islandGroundBounds(close).find((i) => i.island === 'b')!.bounds,
    relief: 2.2,
    casters: [edger],
  });
  assert.ok(
    spilled.data.some((v) => v > 0),
    "island b's own field, handed the whole map's casters, would carry the neighbour's shadow",
  );
});

test('blitTile refuses a HEIGHT mismatch as well as a width one, and says which sizes', () => {
  const layout = packShadowAtlas(SIX_BOUNDS);
  const tile = layout.tiles[0]!;
  const shortField = {
    minX: tile.minX,
    minZ: tile.minZ,
    w: tile.w,
    h: tile.h - 1,
    gres: layout.gres,
    data: new Uint8Array(tile.w * (tile.h - 1)),
  };
  assert.throws(
    () => blitTile(new Uint8Array(layout.w * layout.h), layout.w, tile, shortField),
    // ⚠ THE MESSAGE'S FIRST HALF TOO, not only its verdict. A reader who hits this is holding two
    // pieces of arithmetic that have parted and needs the four numbers to see which way.
    new RegExp(`island "${tile.island}" built a ${tile.w}x${tile.h - 1} field for a ${tile.w}x${tile.h} tile`),
  );
});

test('the penumbra and the contact band reach every tile: an atlas built at another width, or at the full band, differs from the default one', () => {
  const cells = SIX;
  const casters = [treeOn(0), treeOn(1)];
  const base = buildAtlasOcclusion({ cells, relief: 0, casters });
  const wide = buildAtlasOcclusion({ cells, relief: 0, casters, penumbra: 2.4 });
  const full = buildAtlasOcclusion({ cells, relief: 0, casters, contactBand: 'full' });
  assert.notDeepEqual([...wide.data], [...base.data], 'the penumbra did not reach the tiles');
  assert.notDeepEqual([...full.data], [...base.data], 'the contact band did not reach the tiles');
  // The spread too: the derived pool (1) is wider than the shipped one, and no pool at all (0) is
  // narrower — every tile's builder is handed it.
  const derived = buildAtlasOcclusion({ cells, relief: 0, casters, contactSpread: 1 });
  const none = buildAtlasOcclusion({ cells, relief: 0, casters, contactSpread: 0 });
  assert.notDeepEqual([...derived.data], [...base.data], 'the spread did not reach the tiles');
  assert.ok(atlasCoverage(derived, 0.25) > atlasCoverage(base, 0.25), 'the derived pool is not wider than the shipped one');
  assert.ok(atlasCoverage(none, 0.25) < atlasCoverage(base, 0.25), 'no pool is not narrower than the shipped one');
  // And the default IS the authored triple: the same atlas as naming them.
  const named = buildAtlasOcclusion({ cells, relief: 0, casters, penumbra: SHADOW_PENUMBRA, contactBand: SHADOW_CONTACT_BAND, contactSpread: CONTACT_SPREAD });
  assert.deepEqual([...named.data], [...base.data]);
});
