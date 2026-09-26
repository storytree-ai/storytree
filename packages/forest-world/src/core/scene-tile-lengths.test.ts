// scene-tile-lengths.test.ts — THE RE-BASED LENGTHS THAT ONLY A BUILT SCENE CAN SHOW (ADR-0528).
//
// `scene-tile-art.test.ts` holds the tile FOLD — the numbers `tileArt` hands the builders. This file
// holds four re-based lengths whose effect is only visible once a whole scene is composed, because
// each of them decides an ORDER or a REJECTION rather than an attribute a node carries:
//
//   · the meadow shrub's sort key — a tile-unit BEHIND its own spot, so it is a paint order;
//   · the heath's bell clusters — a tier the shipped studio never reaches (it sends `vegetation`,
//     which zeroes the count), so only the website's fold draws them and only it can hold them;
//   · the garden's crown-derived accent scale — the island crown taken ONTO the tile, not in the
//     tree's own drawing frame;
//   · the garden's plate keep-out and its owned-land clamp — both rejections, invisible in the
//     accepted result unless the fixture puts the bound where the sampler actually meets it.
//
// Each test names the bound and carries the guard that the fixture reaches it, because a keep-out
// nothing bumps into is a test that passes on any number.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groundRadiusToScreenHalfHeight, unprojectGround } from './camera.js';
import { TILE_SCALE, tileUnits } from './hex.js';
import { crownRadius } from './sizing.js';
import {
  buildScene,
  placeGardenHeroes,
  type GardenHeroId,
  type SceneG,
  type SceneGardenHero,
  type SceneGardenInput,
  type SceneNode,
  type SceneTerritoryInput,
} from './scene.js';
import { shippedInput, shippedTerritory } from './testing/scene-fixture.js';
import type { RelaxedCell } from './substrate.js';

type Parcels = NonNullable<SceneTerritoryInput['parcels']>;

function children(n: SceneNode): SceneNode[] {
  return n.el === 'g' ? n.children : [];
}
function allByKind(n: SceneNode, kind: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (x: SceneNode): void => {
    if (x.kind === kind) out.push(x);
    for (const c of children(x)) walk(c);
  };
  walk(n);
  return out;
}

/** One square land cell covering the island, so nothing is clipped by the substrate. */
const FULL_LAND: RelaxedCell[] = [
  { owner: 0, poly: [{ x: 40, y: 140 }, { x: 160, y: 140 }, { x: 160, y: 260 }, { x: 40, y: 260 }], variant: 0, wheat: false },
];

const oneParcel = (theme: 'meadow' | 'heath', testCount: number): Parcels => [
  { capId: 'capA', status: 'healthy', testCount, theme, seed: { x: 100, y: 200 } },
];

function floraScene(parcels: Parcels, over: Partial<Parameters<typeof shippedInput>[0]> = {}): SceneG {
  return buildScene(
    shippedInput({
      relaxedCells: FULL_LAND,
      territories: [shippedTerritory({ id: 'library', status: 'proposed', parcels, decor: [], plants: [] })],
      ...over,
    }),
  );
}

/** The y of a parcel-flora item's PIVOT — the spot it was planted on, which it scales about. */
function pivotY(item: SceneNode): number {
  const m = /^translate\(-?[\d.]+ (-?[\d.]+)\) scale\(/.exec(item.transform ?? '');
  assert.ok(m, `a parcel-flora item scales about its pivot: ${item.transform ?? '(none)'}`);
  return Number(m[1]);
}

/** Meadow's tiers are told apart by the marks they draw: a shrub is ellipses alone. */
const isShrub = (item: SceneNode): boolean =>
  children(item).length > 0 && children(item).every((c) => c.el === 'ellipse' && c.kind === 'parcel-shrub');

// ---------------------------------------------------------------- the meadow shrub's sort key

test('ADR-0528: a meadow shrub sorts ONE TILE UNIT behind its own spot — the re-based nudge is a paint order, and the sign of it is what the drawing shows', () => {
  const items = allByKind(floraScene(oneParcel('meadow', 12)), 'parcel-flora');
  const shrubs = items.filter(isShrub);
  assert.ok(shrubs.length >= 2, `the fixture must plant shrubs to hold their key: ${shrubs.length}`);

  // The island's drawables are painted back to front by their sort key, and a shrub's key is its
  // spot plus one tile unit. Read the emitted order back as keys under that rule: it must be
  // non-decreasing, which is the only thing a painter's order can assert.
  const keyed = (nudge: number): number[] => items.map((it) => pivotY(it) + (isShrub(it) ? nudge : 0));
  const nonDecreasing = (ks: number[]): boolean => ks.every((k, i) => i === 0 || k >= ks[i - 1]! - 1e-9);

  assert.ok(nonDecreasing(keyed(tileUnits(1))), 'the painted order IS the order of spot + one tile unit for a shrub');
  // THE GUARD, not decoration: if the fixture never stood a shrub within a tile unit of its
  // neighbours, the assertion above would hold for any nudge at all and would be proving nothing.
  assert.equal(nonDecreasing(keyed(-tileUnits(1))), false, 'the fixture separates the two signs — a shrub sits inside a neighbour’s unit');
  assert.equal(nonDecreasing(keyed(0)), false, 'the fixture separates the nudge from no nudge at all');
});

// ---------------------------------------------------------------- the heath's bell clusters

test('ADR-0528: the heath plants its bell clusters on the fold that reaches them — the studio sends `vegetation` and gets none, the website sends none and gets round((t − 1) × 0.3)', () => {
  // `unifiedVeg` (the studio's own vocabulary, ADR-0226/0231) zeroes this tier, so every studio-shaped
  // fixture draws no clusters and cannot hold them. The website's fold sends no vegetation at all.
  const t = 8;
  const mounds = (n: number): number => Math.min(FULL_LAND.length, 4 + Math.round(n * 1.3));
  const shrubs = (n: number): number => Math.round(n * 0.75);
  const clusters = (n: number): number => Math.round((n - 1) * 0.3);
  assert.ok(clusters(t) >= 1, 'the fixture must reach the cluster tier at all');

  const studio = allByKind(floraScene(oneParcel('heath', t), { vegetation: {} }), 'parcel-flora');
  const website = allByKind(floraScene(oneParcel('heath', t)), 'parcel-flora');
  assert.equal(studio.length, mounds(t) + shrubs(t), 'the unified vocabulary retires the clusters');
  assert.equal(website.length, mounds(t) + shrubs(t) + clusters(t), 'the website’s fold plants one item per cluster');

  // and each cluster is an ITEM in its own right — a bell drawn into a neighbour's group would keep
  // the count above honest while losing the cluster's own pivot, which is what it scales about.
  const extra = website.length - studio.length;
  assert.equal(extra, clusters(t));
  for (const it of website.slice(-extra)) assert.ok(children(it).length > 0, 'a planted cluster draws marks');
});

// ---------------------------------------------------------------- the garden

const gHero = (height: number): SceneGardenHero => ({
  nodes: [{ el: 'polygon', points: '0,0 5,0 0,-5', fill: '#cba', stroke: '#210', strokeWidth: 0.3 }],
  width: 10,
  height,
});
const mkGarden = (islandId: string): SceneGardenInput => ({
  islandId,
  heroes: { cottage: gHero(21.8), gazebo: gHero(15.4), 'autumn-tree': gHero(20.6), 'stepping-stone': gHero(6.3) },
});

/** The garden's lavender and grass accents: plain groups that scale about a placed point, carrying
 *  marks rather than a `baked-use` of a hero. They are the only nodes wearing the accent scale. */
function accentScales(s: SceneG): string[] {
  const out: string[] = [];
  const walk = (n: SceneNode): void => {
    const m = /^translate\(-?[\d.]+ -?[\d.]+\) scale\(([\d.]+)\)$/.exec(n.transform ?? '');
    if (m && n.el === 'g' && n.kind === undefined && n.id === undefined && children(n).length > 0) out.push(m[1]!);
    for (const c of children(n)) walk(c);
  };
  walk(s);
  return out;
}

test('ADR-0528: the garden accents wear the island crown TAKEN ONTO THE TILE — crownRadius(caps) × the tree rung ÷ 26, not the crown in the tree’s own frame', () => {
  const t = shippedTerritory({ id: 'library' });
  const s = floraScene(oneParcel('meadow', 3), { territories: [t], garden: mkGarden('library') });
  const expected = ((crownRadius(t.caps) * TILE_SCALE) / 26).toFixed(1);
  const scales = accentScales(s);
  assert.ok(scales.length >= 4, `the garden plants a lavender and three grass accents: ${scales.length}`);
  for (const sc of scales) assert.equal(sc, expected);
  // THE GUARD: the crown in its own frame is a different number, so this pins the re-basing and not
  // merely "some scale is on the node".
  assert.notEqual(expected, (crownRadius(t.caps) / 26).toFixed(1));
});

test('ADR-0528: the garden is handed THE ISLAND’S OWN CELLS — its accents and UAT markers are clamped onto owned land, never left where the sampler drew them', () => {
  // One small cell far from the centroid: everything the garden places must be pulled onto it, so a
  // garden handed no land at all is visible as an accent sitting where nothing was clamped.
  const cell: RelaxedCell = {
    owner: 0,
    poly: [{ x: 96, y: 196 }, { x: 104, y: 196 }, { x: 104, y: 204 }, { x: 96, y: 204 }],
    variant: 0,
    wheat: false,
  };
  const t = shippedTerritory({ id: 'library' });
  const s = buildScene(shippedInput({ relaxedCells: [cell], territories: [t], garden: mkGarden('library') }));
  const inCell = (p: { x: number; y: number }): boolean => p.x >= 95 && p.x <= 105 && p.y >= 195 && p.y <= 205;

  const placed: Array<{ x: number; y: number }> = [];
  const walk = (n: SceneNode): void => {
    const m = /^translate\((-?[\d.]+) (-?[\d.]+)\) scale\([\d.]+\)$/.exec(n.transform ?? '');
    if (m && n.el === 'g' && n.kind === undefined && n.id === undefined && children(n).length > 0) {
      placed.push({ x: Number(m[1]), y: Number(m[2]) });
    }
    for (const c of children(n)) walk(c);
  };
  walk(s);
  assert.ok(placed.length >= 4, `the garden places accents to clamp: ${placed.length}`);
  for (const p of placed) assert.ok(inCell(p), `an accent at (${p.x}, ${p.y}) sits off the island’s only owned cell`);
});

/** The elevation the band test's sampler is run at — deliberately NOT the declared camera, so a
 *  clearance that only holds at 20 degrees cannot pass. */
const ELEVATION = 12;

test('ADR-0528: a garden hero keeps the re-based NAMEPLATE BAND clear — 18 tile units above the plate, on a fixture where the band is where the sampler actually draws', () => {
  // The shipped island's plate sits far below the sampling disc, so the band is never reached and any
  // number would pass. Pull the plate up into the disc: now the bound is what decides a draw.
  const t = shippedTerritory({ id: 'library', labelY: 210, groundRadius: 60, screenRadius: 60 });
  // 18 tile units ON THE GROUND (ADR-0545). The clearance used to be read straight off the screen,
  // which made it 18 units only in plan view and ~53 ground units at the declared camera — the
  // over-enforcement this file's neighbours describe, and the reason a hero's spot moved with the
  // angle it was seen from. Projected here through the camera's own verb, at the same elevation the
  // sampler is run at, so the band means the same ground either way.
  const band = t.labelY - groundRadiusToScreenHalfHeight(tileUnits(18), ELEVATION);
  const ids: GardenHeroId[] = ['cottage', 'gazebo'];
  const halfW = new Map<GardenHeroId, number>([['cottage', 8], ['gazebo', 7]]);
  const spots = placeGardenHeroes(t, ids, halfW, null, ELEVATION);
  assert.equal(spots.size, ids.length, 'both heroes settled');
  for (const [id, p] of spots) {
    assert.ok(p.y < band, `${id} at y ${p.y} sits inside the nameplate band (clear above ${band})`);
    // The same statement in the space it is now made in: un-project the screen gap and it is a
    // clearance of at least 18 ground units, whatever camera the sampler was asked for.
    const groundGap = unprojectGround({ x: 0, y: t.labelY - p.y }, ELEVATION).y;
    assert.ok(
      groundGap > tileUnits(18),
      `${id} clears the plate by ${groundGap.toFixed(2)} ground units, under the 18 the band names`,
    );
  }
  // THE GUARD: the sampler's own disc reaches past the band on this island, so the bound rejected
  // draws rather than being slack — the mirrored band below the plate is inside the disc too.
  assert.ok(t.centroid.y + 0.62 * t.groundRadius > t.labelY + tileUnits(18), 'the fixture reaches past the band');
});
