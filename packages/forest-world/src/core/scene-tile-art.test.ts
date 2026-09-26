/**
 * ADR-0528 — the tile is an INPUT of the drawing, and every length the drawing authored on the
 * radius-27 tile now rides `TileArt`. These tests pin the EXACT geometry each builder emits from the
 * bundle (rest spots, orbits, the plate transform, the hit rect, the flora pivot, the drift bed) so
 * that a length that stopped scaling — or scaled off the wrong field — is a failing byte, not a
 * look nobody measured. They are the mutation rung's witnesses for the lines this branch changed:
 * `check:mutation-diff` mutates every operator on those lines, and a test that only checks a shape
 * or a count lets `+` → `-` through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hash, rand01 } from './rng.js';
import { TILE_SCALE } from './hex.js';
import { crownRadius } from './sizing.js';
import type { Pt } from './hex.js';
import type { RelaxedCell } from './substrate.js';
import {
  buildScene,
  driftSpot,
  fittedHeroScale,
  tileArt,
  SHIPPED_TILE_ART,
  type SceneG,
  type SceneGardenHero,
  type SceneGardenInput,
  type SceneInput,
  type SceneNode,
  type SceneTerritoryInput,
} from './scene.js';
import { shippedInput, shippedTerritory } from './testing/scene-fixture.js';

// ---------------------------------------------------------------- helpers

const f = (n: number): string => n.toFixed(1);
const ART = SHIPPED_TILE_ART;
const TUNED = tileArt(27);

function children(n: SceneNode): SceneNode[] {
  return n.el === 'g' ? n.children : [];
}
function allByKind(n: SceneNode, kind: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (m: SceneNode): void => {
    if (m.kind === kind) out.push(m);
    for (const c of children(m)) walk(c);
  };
  walk(n);
  return out;
}
/** The parent of the first node of `kind` — for builders whose outer wrapper carries the geometry. */
function parentOfKind(n: SceneNode, kind: string): SceneNode | null {
  let hit: SceneNode | null = null;
  const walk = (m: SceneNode): void => {
    for (const c of children(m)) {
      if (c.kind === kind && !hit) hit = m;
      walk(c);
    }
  };
  walk(n);
  return hit;
}
function firstByKind(n: SceneNode, kind: string): SceneNode {
  const hit = allByKind(n, kind)[0];
  assert.ok(hit, `expected a "${kind}" node`);
  return hit;
}
const translateOf = (n: SceneNode): Pt => {
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(n.transform ?? '');
  assert.ok(m, `a translate on ${n.kind ?? n.el}: ${n.transform ?? '(none)'}`);
  return { x: Number(m[1]), y: Number(m[2]) };
};
const scaleOf = (n: SceneNode): string => {
  const m = /scale\((-?[\d.]+)\)/.exec(n.transform ?? '');
  assert.ok(m, `a scale on ${n.kind ?? n.el}: ${n.transform ?? '(none)'}`);
  return m[1]!;
};

/** A 20-unit square mesh over `box` — flat land with no holes, so containment never bites. */
function isleCells(box: { xMin: number; xMax: number; yMin: number; yMax: number }): RelaxedCell[] {
  const cells: RelaxedCell[] = [];
  for (let x = box.xMin; x < box.xMax; x += 20) {
    for (let y = box.yMin; y < box.yMax; y += 20) {
      cells.push({
        owner: 0,
        poly: [
          { x, y },
          { x: x + 20, y },
          { x: x + 20, y: y + 20 },
          { x, y: y + 20 },
        ],
        variant: 0,
        wheat: false,
      });
    }
  }
  return cells;
}
const FULL_LAND = isleCells({ xMin: 40, xMax: 160, yMin: 140, yMax: 260 });
const cellAt = (cx: number, cy: number): RelaxedCell => ({
  owner: 0,
  poly: [{ x: cx - 2, y: cy - 2 }, { x: cx + 2, y: cy - 2 }, { x: cx, y: cy + 4 }],
  variant: 0,
  wheat: false,
});

/** The fixture territory: centroid (100,200), tree spot (100,190), radius 60, plate row y=260, w=120 h=33. */
const T = shippedTerritory();
const ORBIT_R = T.screenRadius * 0.72 + ART.units(22);
const TREE_DX = T.treeSpot.x - T.centroid.x;
const TREE_DY = T.treeSpot.y - T.centroid.y;

/** mulberry32 — a deterministic stand-in for the surface's own stream. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the wisp families

test('a HOVER wisp rests at the tile-scaled spot beside the tree — every term of the rest spot is the authored offset × TILE_SCALE', () => {
  const scene = buildScene(shippedInput({ territories: [shippedTerritory({ claims: [{ key: 's1', grade: 'exploring', title: 't', colourState: 'authoring' }] })] }));
  const k = hash('s1');
  const hx = TREE_DX + (rand01(k + 1) - 0.5) * ART.units(18);
  const hy = TREE_DY - (ORBIT_R + ART.units(12)) + (rand01(k + 2) - 0.5) * ART.units(10);
  const outer = parentOfKind(scene, 'hover-wisp');
  assert.ok(outer);
  assert.equal(outer.transform, `translate(${f(hx)} ${f(hy)})`);
  const arm = children(firstByKind(scene, 'hover-wisp'))[0]!;
  assert.equal(arm.transform, `translate(${f(ART.hoverOrbitR)} 0) scale(${f(ART.scale)})`);
  // the same spot on the TUNED tile is the pre-ADR-0528 drawing: offsets in whole authored units.
  const tuned = buildScene(shippedInput({ tile: { hexR: 27 }, territories: [shippedTerritory({ claims: [{ key: 's1', grade: 'exploring', title: 't', colourState: 'authoring' }] })] }));
  const orbit27 = T.screenRadius * 0.72 + 22;
  assert.equal(parentOfKind(tuned, 'hover-wisp')!.transform, `translate(${f(TREE_DX + (rand01(k + 1) - 0.5) * 18)} ${f(TREE_DY - (orbit27 + 12) + (rand01(k + 2) - 0.5) * 10)})`);
});

test('QUEUE wisps line up outside the orbit at tile-scaled steps: orbitR + 14u + index × 16u', () => {
  const claims = [
    { key: 'a', grade: 'waiting' as const, title: 'a', colourState: 'authoring' as const },
    { key: 'b', grade: 'waiting' as const, title: 'b', colourState: 'authoring' as const },
    { key: 'c', grade: 'waiting' as const, title: 'c', colourState: 'authoring' as const },
  ];
  const scene = buildScene(shippedInput({ territories: [shippedTerritory({ claims })] }));
  const queue = allByKind(scene, 'queue-wisp').map((w) => children(w)[0]!.transform);
  assert.deepEqual(
    queue,
    [0, 1, 2].map((i) => `translate(${f(ORBIT_R + ART.units(14) + i * ART.units(16))} 0) scale(${f(ART.scale)})`),
  );
});

test('a DEPARTING wisp rests where the hover family rests and drifts UP by ageRatio × 24u', () => {
  for (const ageRatio of [0, 0.5, 1]) {
    const scene = buildScene(shippedInput({ territories: [shippedTerritory({ departures: [{ key: 's9', title: 't', ageRatio }] })] }));
    const k = hash('s9');
    const x = TREE_DX + (rand01(k + 1) - 0.5) * ART.units(18);
    const y = TREE_DY - (ORBIT_R + ART.units(12)) - ageRatio * ART.units(24);
    assert.equal(children(firstByKind(scene, 'departing-wisp'))[0]!.transform, `translate(${f(x)} ${f(y)}) scale(${f(ART.scale)})`);
  }
});

test('a BUILD wisp orbits at 0.72·R + 10u', () => {
  const scene = buildScene(shippedInput({ territories: [shippedTerritory({ wisps: [{ runId: 'r1', title: 'building' }] })] }));
  const inner = children(firstByKind(scene, 'wisp'))[0]!;
  assert.equal(inner.transform, `translate(${f(T.screenRadius * 0.72 + ART.units(10))} 0) scale(${f(ART.scale)})`);
});

// ---------------------------------------------------------------- plate + hit

test('the nameplate scales about its own centre: translate(cx − w·plate/2, labelY) scale(plate) — and is the authored plate on the tuned tile', () => {
  const p = T.plate;
  const shipped = buildScene(shippedInput());
  const plate = parentOfKind(shipped, 'plate-bg');
  assert.ok(plate);
  assert.equal(plate.transform, `translate(${f(T.centroid.x - (p.w * ART.plate) / 2)} ${f(T.labelY)}) scale(${f(ART.plate)})`);
  const tuned = parentOfKind(buildScene(shippedInput({ tile: { hexR: 27 } })), 'plate-bg');
  assert.equal(tuned!.transform, `translate(${f(T.centroid.x - p.w / 2)} ${f(T.labelY)}) scale(1.0)`);
  assert.notEqual(ART.plate, 1, 'the shipped plate is scaled, so the two transforms differ');
});

test('the delegation HIT rect spans the scaled tree top to the scaled plate bottom, with a tile-scaled corner radius', () => {
  const scene = buildScene(shippedInput());
  const hit = firstByKind(scene, 'hit');
  assert.equal(hit.el, 'rect');
  if (hit.el !== 'rect') return;
  const top = T.treeSpot.y - (2.7 * crownRadius(T.caps) + 16) * ART.tree;
  assert.deepEqual(
    { x: hit.x, y: hit.y, width: hit.width, height: hit.height, rx: hit.rx },
    { x: T.centroid.x - T.screenRadius, y: top, width: T.screenRadius * 2, height: T.labelY + T.plate.h * ART.plate - top, rx: ART.units(14) },
  );
});

// ---------------------------------------------------------------- the parcel flora

type Parcels = NonNullable<SceneTerritoryInput['parcels']>;
const oneParcel = (status: SceneTerritoryInput['status'], testCount: number, theme: 'meadow' | 'woodland' | 'heath'): Parcels => [
  { capId: 'capA', status, testCount, theme, seed: { x: 100, y: 200 } },
];
function floraScene(parcels: Parcels, over: Partial<SceneInput> = {}): SceneG {
  return buildScene(
    shippedInput({
      relaxedCells: FULL_LAND,
      vegetation: {},
      territories: [shippedTerritory({ id: 'library', status: 'proposed', parcels, decor: [], plants: [] })],
      ...over,
    }),
  );
}
const floraItems = (scene: SceneG): SceneNode[] => allByKind(scene, 'parcel-flora');

test('every parcel-flora item scales about its OWN pivot: translate(p) scale(flora) translate(−p) — and scale(1.0) on the tuned tile', () => {
  const scene = floraScene(oneParcel('healthy', 6, 'meadow'));
  const items = floraItems(scene);
  assert.ok(items.length > 3);
  for (const it of items) {
    const m = /^translate\((-?[\d.]+) (-?[\d.]+)\) scale\((-?[\d.]+)\) translate\((-?[\d.]+) (-?[\d.]+)\)$/.exec(it.transform ?? '');
    assert.ok(m, `pivot transform: ${it.transform ?? '(none)'}`);
    assert.equal(m[3], f(ART.flora));
    assert.equal(m[4], f(-Number(m[1])));
    assert.equal(m[5], f(-Number(m[2])));
  }
  const tuned = floraItems(floraScene(oneParcel('healthy', 6, 'meadow'), { tile: { hexR: 27 } }));
  assert.equal(tuned.length, items.length);
  for (const it of tuned) assert.match(it.transform ?? '', / scale\(1\.0\) /);
});

test('the density budget lands as ITEMS, one per push — meadow, woodland and heath, every status-specific tier included', () => {
  // meadow (the formulas are the surface's own): grass round(2 + 1.9·t), shrubs round(t / 2.6) where
  // eligible (×0.7 unhealthy), sprouts max(1, round(0.45·t)) proposed, wilts max(1, round(0.4·t)) unhealthy;
  // ×0.85 grass on proposed. No wildflowers under the unified vocabulary.
  const t = 6;
  const grass = Math.round(2 + t * 1.9);
  const expectMeadow = {
    healthy: grass + Math.round(t / 2.6),
    proposed: Math.round(grass * 0.85) + Math.max(1, Math.round(t * 0.45)),
    unhealthy: grass + Math.round(Math.round(t / 2.6) * 0.7) + Math.max(1, Math.round(t * 0.4)),
  } as const;
  for (const [status, n] of Object.entries(expectMeadow) as Array<[keyof typeof expectMeadow, number]>) {
    assert.equal(floraItems(floraScene(oneParcel(status, t, 'meadow'))).length, n, `meadow ${status}`);
  }
  // woodland: ferns min(cells, 2 + round(0.85·t)), shrubs max(1, round(0.45·t)), saplings floor(t/4).
  const w = 8;
  assert.equal(
    floraItems(floraScene(oneParcel('healthy', w, 'woodland'))).length,
    Math.min(FULL_LAND.length, 2 + Math.round(w * 0.85)) + Math.max(1, Math.round(w * 0.45)) + Math.floor(w / 4),
    'woodland healthy',
  );
  // heath: mounds min(cells, 4 + round(1.3·t)), shrubs round(0.75·t); racemes retired under the vocabulary.
  assert.equal(
    floraItems(floraScene(oneParcel('healthy', w, 'heath'))).length,
    Math.min(FULL_LAND.length, 4 + Math.round(w * 1.3)) + Math.round(w * 0.75),
    'heath healthy',
  );
});

test('heath items carry the status opacity ONLY when it is below 1 (mapped 0.72; healthy none)', () => {
  const mapped = floraItems(floraScene(oneParcel('mapped', 5, 'heath')));
  assert.ok(mapped.length > 0);
  for (const it of mapped) assert.equal(it.opacity, 0.72);
  const healthy = floraItems(floraScene(oneParcel('healthy', 5, 'heath')));
  assert.ok(healthy.length > 0);
  for (const it of healthy) assert.equal(it.opacity, undefined);
});

test('a drift bed has radius (7 + 0.55·tests) authored units on the tile, squashed 0.6 on y — the draws fill the ellipse and never leave it', () => {
  const big = [{ poly: [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: -900, y: 900 }], cx: 0, cy: 0 }];
  for (const tests of [0, 10]) {
    const spread = ART.units(7 + tests * 0.55);
    const next = driftSpot(big, tests, seeded(7 + tests));
    let maxR = 0;
    let maxY = 0;
    for (let i = 0; i < 4000; i++) {
      const p = next();
      maxR = Math.max(maxR, Math.hypot(p.x, p.y / 0.6));
      maxY = Math.max(maxY, Math.abs(p.y));
    }
    assert.ok(maxR <= spread + 1e-9, `tests=${tests}: never past the bed radius (${maxR} vs ${spread})`);
    assert.ok(maxR > spread * 0.97, `tests=${tests}: the draws reach the rim (${maxR} vs ${spread})`);
    assert.ok(maxY <= spread * 0.6 + 1e-9 && maxY > spread * 0.6 * 0.95, `tests=${tests}: y is the 0.6 squash (${maxY} vs ${spread * 0.6})`);
  }
  // a negative test count is clamped to zero, not folded into the radius.
  const neg = driftSpot(big, -20, seeded(3));
  let maxNeg = 0;
  for (let i = 0; i < 2000; i++) {
    const p = neg();
    maxNeg = Math.max(maxNeg, Math.hypot(p.x, p.y / 0.6));
  }
  assert.ok(maxNeg <= ART.units(7) + 1e-9 && maxNeg > ART.units(7) * 0.95);
});

// ---------------------------------------------------------------- the UAT-marker keep-outs

test('UAT markers honour the three tile-scaled keep-outs at plan view: above the plate band (14u), outside the tree well (36u), and 15u from each other', () => {
  // Plan view (90°): the ground gap IS the screen distance, so the keep-outs can be read off the
  // transforms directly. The plate row sits ON the centroid so the band actually bites, and the
  // island is flat land with no holes so no marker has to fall back to a cell centroid.
  const criteria = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, state: (['proven', 'pending', 'failing'] as const)[i % 3]! }));
  const t = shippedTerritory({ labelY: 200, uatCriteria: criteria, plants: [], decor: [] });
  const scene = buildScene(shippedInput({ territories: [t], relaxedCells: FULL_LAND, vegetation: {}, cameraElevationDeg: 90 }));
  const spots = ['tall-flower-proven', 'tall-flower-pending', 'tall-flower-failing'].flatMap((k) => allByKind(scene, k)).map(translateOf);
  assert.equal(spots.length, 16);
  for (const p of spots) {
    assert.ok(p.y < t.labelY - ART.units(14), `above the plate band: ${p.y} vs ${t.labelY - ART.units(14)}`);
    assert.ok(Math.hypot(p.x - t.treeSpot.x, p.y - t.treeSpot.y) > ART.markerTreeWell, `outside the tree well: ${JSON.stringify(p)}`);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const gap = Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y);
      assert.ok(gap > ART.markerSpacing, `markers ${i} and ${j} keep their spacing: ${gap}`);
    }
  }
  // the band is not vacuous: some marker sits within one plate height of it.
  assert.ok(spots.some((p) => p.y > t.labelY - ART.units(14) - 33), 'a marker sits near the band, so the band is what placed it');
});

// ---------------------------------------------------------------- the starvation repair

test('a starving parcel takes the cell NEAREST ITS SEED (squared planar distance about the seed), from a donor holding two or more', () => {
  // Both seeds sit on (20,10); the Voronoi ties toward capA, which gets all three cells. capB then
  // takes the nearest: A1 at 6 units. The fixture is built so each wrong distance picks a different
  // cell — dropping the y term or the seed offset, or turning the sum into a difference, all select
  // A2 or A3 instead.
  const a1 = cellAt(26, 10);
  const a2 = cellAt(25, 15);
  const a3 = cellAt(20, 3);
  const parcels: Parcels = [
    { capId: 'capA', status: 'healthy', testCount: 3, theme: 'meadow', seed: { x: 20, y: 10 } },
    { capId: 'capB', status: 'unhealthy', testCount: 3, theme: 'meadow', seed: { x: 20, y: 10 } },
  ];
  const scene = floraScene(parcels, { relaxedCells: [a3, a2, a1] });
  const ground = allByKind(scene, 'parcel');
  const capB = ground.find((p) => p.id === 'capB');
  const capA = ground.find((p) => p.id === 'capA');
  assert.ok(capA && capB);
  assert.equal(children(capA).length, 2);
  const taken = children(capB);
  assert.equal(taken.length, 1);
  // the cell's outline is a path; read its vertices back as numbers.
  const verts = (n: SceneNode): number[] => (n.el === 'path' ? (n.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : []);
  assert.deepEqual(verts(taken[0]!), a1.poly.flatMap((p) => [p.x, p.y]), 'the cell at (26,10)');

  // a donor holding EXACTLY two still donates (the floor is "keeps at least one").
  const two = floraScene(parcels, { relaxedCells: [a2, a1] });
  const g2 = allByKind(two, 'parcel');
  assert.deepEqual(g2.map((p) => children(p).length), [1, 1]);
});

// ---------------------------------------------------------------- the garden + hero tree

const gHero = (height: number): SceneGardenHero => ({
  nodes: [{ el: 'polygon', points: '0,0 5,0 0,-5', fill: '#cba', stroke: '#210', strokeWidth: 0.3 }],
  width: 10,
  height,
});
const mkGarden = (islandId: string): SceneGardenInput => ({
  islandId,
  heroes: { cottage: gHero(21.8), gazebo: gHero(15.4), 'autumn-tree': gHero(20.6), 'stepping-stone': gHero(6.3) },
});
const useById = (scene: SceneNode, defId: string): SceneNode => {
  const hit = allByKind(scene, 'baked-art').find((u) => (u as { defId?: string }).defId === defId);
  assert.ok(hit, `a baked-art use of ${defId}`);
  return hit;
};

test('fittedHeroScale fits the hero to the TILE-SCALED crown: on a roomy island the tuned-tile fit is 1/TILE_SCALE of the shipped one', () => {
  const roomy = shippedTerritory({ screenRadius: 400, groundRadius: 400 });
  const hero = gHero(21.8);
  const shipped = fittedHeroScale('cottage', hero, roomy);
  assert.equal(shipped, fittedHeroScale('cottage', hero, roomy, ART));
  assert.equal(shipped, (crownRadius(roomy.caps) * ART.tree * 1.7) / hero.height);
  assert.ok(Math.abs(fittedHeroScale('cottage', hero, roomy, TUNED) / shipped - 1 / TILE_SCALE) < 1e-9);
});

test('the garden heroes and the hero tree are fitted with the SCENE tile: built on the tuned tile they wear the tuned fit, not the shipped one', () => {
  const hero = gHero(20.6);
  const veg = { heroTrees: { healthy: hero } };
  const shippedTree = useById(buildScene(shippedInput({ vegetation: veg })), 'veg-hero-autumn-tree-healthy');
  const tunedTree = useById(buildScene(shippedInput({ vegetation: veg, tile: { hexR: 27 } })), 'veg-hero-autumn-tree-healthy');
  assert.equal(scaleOf(shippedTree), f(fittedHeroScale('autumn-tree', hero, T, ART)));
  assert.equal(scaleOf(tunedTree), f(fittedHeroScale('autumn-tree', hero, T, TUNED)));
  assert.notEqual(scaleOf(shippedTree), scaleOf(tunedTree));

  const garden = mkGarden('library');
  const shippedCottage = useById(buildScene(shippedInput({ garden, relaxedCells: FULL_LAND })), 'garden-hero-cottage');
  const tunedCottage = useById(buildScene(shippedInput({ garden, relaxedCells: FULL_LAND, tile: { hexR: 27 } })), 'garden-hero-cottage');
  assert.equal(scaleOf(shippedCottage), f(fittedHeroScale('cottage', gHero(21.8), T, ART)));
  assert.equal(scaleOf(tunedCottage), f(fittedHeroScale('cottage', gHero(21.8), T, TUNED)));
  assert.notEqual(scaleOf(shippedCottage), scaleOf(tunedCottage));
});

test('the garden lays BOTH stone paths — the front-door walk and the lighter step trail to the gazebo — each tagged', () => {
  // (the fixture's default land is one five-unit triangle, which collapses every hero onto it — draw on real land)
  const scene = buildScene(shippedInput({ garden: mkGarden('library'), relaxedCells: FULL_LAND, territories: [shippedTerritory({ plants: [], decor: [] })] }));
  const ids = allByKind(scene, 'baked-art').map((u) => u.id ?? '');
  assert.ok(ids.some((id) => id.startsWith('garden-walk-')), 'the walk');
  assert.ok(ids.some((id) => id.startsWith('garden-step-')), 'the step trail');
});

test('a free garden hero clears the plate band by 18 tile units (plan view, no land to fall back on)', () => {
  // The plate row sits ON the centroid so the band bites on half the island; without land the
  // sampler has no centroid fallback, so a hero placed by a sample that ignored the band is visible.
  const t = shippedTerritory({ labelY: 200, plants: [], decor: [] });
  const scene = buildScene(shippedInput({ territories: [t], relaxedCells: null, garden: mkGarden('library'), cameraElevationDeg: 90 }));
  for (const id of ['garden-hero-cottage', 'garden-hero-gazebo']) {
    const p = translateOf(useById(scene, id));
    assert.ok(p.y < t.labelY - ART.units(18), `${id} clears the band: ${p.y} vs ${t.labelY - ART.units(18)}`);
  }
});
