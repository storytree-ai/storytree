// scene-parcel-repair.test.ts — NO CAPABILITY STARVES (ADR-0528), held at CELL IDENTITY.
//
// The tile is one hex per capability now, so two capabilities' seeds can land in the same hex and
// the plain Voronoi breaks every tie toward the lower index — one parcel gets every cell and its
// sibling gets none, which draws as a capability with no ground, no colour and (in 3D) no tree. The
// repair gives a starving parcel the cell nearest ITS seed, taken from whichever parcel holds two or
// more, in parcel order.
//
// WHY THIS FILE EXISTS SEPARATELY FROM THE COUNT TEST IN `scene.test.ts`. That test asserts how many
// cells each parcel ends with, and the repair's four remaining decisions are all invisible to a
// count: running the repair on a parcel that is NOT starving reorders a group without resizing it;
// robbing a one-cell group moves the starvation rather than curing it; taking the LAST cell examined
// instead of the nearest swaps which cell moves; and declining when nobody can spare one is a path a
// count never enters. Each test below names the cell that moved, not how many did.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScene, type SceneG, type SceneNode, type ScenePath, type SceneTerritoryInput } from './scene.js';
import { shippedInput, shippedTerritory } from './testing/scene-fixture.js';
import type { RelaxedCell } from './substrate.js';

type Parcels = NonNullable<SceneTerritoryInput['parcels']>;

/** A relaxed cell whose centroid is EXACTLY (cx, cy), and whose polygon is unique to it — so the
 *  emitted ground carries a path only this cell could have drawn, and a moved cell is nameable. */
const cellAt = (cx: number, cy: number): RelaxedCell => ({
  owner: 0,
  poly: [{ x: cx - 2, y: cy - 2 }, { x: cx + 2, y: cy - 2 }, { x: cx, y: cy + 4 }],
  variant: 0,
  wheat: false,
});

const parcelAt = (capId: string, x: number, y: number): Parcels[number] => ({
  capId,
  status: 'healthy',
  testCount: 3,
  theme: 'meadow',
  seed: { x, y },
});

function scene(parcels: Parcels, cells: RelaxedCell[]): SceneG {
  return buildScene(
    shippedInput({
      relaxedCells: cells,
      territories: [shippedTerritory({ id: 'library', status: 'proposed', parcels, decor: [], plants: [] })],
    }),
  );
}

function children(n: SceneNode): SceneNode[] {
  return n.el === 'g' ? n.children : [];
}

/** A ground cell is drawn as a path; its `d` is the only handle on WHICH cell it is. */
const isPath = (n: SceneNode): n is ScenePath => n.el === 'path';
function pathOf(n: SceneNode): string {
  assert.ok(isPath(n), `expected a drawn cell, got <${n.el}>`);
  return n.d;
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

/** Every parcel that owns ground, by capId, each mapped to the ORDERED list of its cells' path data.
 *  A parcel that starved owns no ground and is absent — which is the defect ADR-0528 cured. */
function parcelCells(s: SceneG): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of allByKind(s, 'parcel')) {
    out.set(p.id ?? '', children(p).map(pathOf));
  }
  return out;
}

// ---------------------------------------------------------------------------

// Seed B sits exactly on seed A, so the Voronoi gives A both of its cells and B none. C is far away
// and holds the ONLY cell near it. The repair must take from A (which can spare one) and must NOT
// take from C (which cannot), even though C's cell is nearer to B's seed than either of A's.
const SEEDS_ROBBING = [parcelAt('capA', 0, 0), parcelAt('capB', 50, 0), parcelAt('capC', 52, 0)];
// deliberately ordered nearest-to-B LAST within A's group, so "the nearest" and "the last examined"
// are different cells.
const CELLS_ROBBING = [cellAt(1, 1), cellAt(0, 0), cellAt(53, 0)];

test('ADR-0528: the repair takes from a parcel that can SPARE a cell — never from a one-cell parcel, even when that is the nearest cell of all', () => {
  const got = parcelCells(scene(SEEDS_ROBBING, CELLS_ROBBING));
  // the fixture is the one this test needs: A holds two, C holds one, B starves.
  assert.deepEqual([...got.keys()].sort(), ['capA', 'capB', 'capC'], 'every capability owns ground');
  assert.equal(got.get('capC')!.length, 1, 'the one-cell parcel keeps its only cell');
  assert.equal(got.get('capA')!.length, 1);
  assert.equal(got.get('capB')!.length, 1);
  // and the cell C keeps is its own — c(53,0), the cell NEAREST B's seed at (50,0). A repair that
  // ignored the spare-a-cell rule would have taken it and starved C in B's place.
  assert.deepEqual(got.get('capC'), [cellPath(53, 0)]);
});

test('ADR-0528: the starving parcel takes the cell NEAREST its seed, not the last one examined', () => {
  const got = parcelCells(scene(SEEDS_ROBBING, CELLS_ROBBING));
  // A holds c(1,1) and c(0,0) in that order. Of the two, c(1,1) is nearer to B's seed at (50,0)
  // (d = 2402 against 2500) and it is examined FIRST — so "nearest" and "last" name different cells.
  assert.deepEqual(got.get('capB'), [cellPath(1, 1)], 'B took the nearest spare cell');
  assert.deepEqual(got.get('capA'), [cellPath(0, 0)], 'A kept the other one');
});

test('ADR-0528: the repair runs ONLY for a parcel that starved — a parcel that already owns ground keeps its cells in the order the Voronoi gave them', () => {
  // Nobody starves here: three parcels, each with two cells of its own. The repair must be a no-op,
  // and "no-op" includes not REORDERING a group — which is the whole tell, since a repair that ran
  // on a non-starving parcel would splice its nearest cell out and push it back at the end.
  const parcels = [parcelAt('capA', 0, 0), parcelAt('capB', 100, 0), parcelAt('capC', 200, 0)];
  const cells = [cellAt(0, 0), cellAt(4, 4), cellAt(100, 0), cellAt(104, 4), cellAt(200, 0), cellAt(204, 4)];
  const got = parcelCells(scene(parcels, cells));
  assert.deepEqual(got.get('capA'), [cellPath(0, 0), cellPath(4, 4)]);
  assert.deepEqual(got.get('capB'), [cellPath(100, 0), cellPath(104, 4)]);
  assert.deepEqual(got.get('capC'), [cellPath(200, 0), cellPath(204, 4)]);
});

test('ADR-0528: when NO parcel can spare a cell the repair declines rather than throwing, and the parcels that do own ground are unharmed', () => {
  // Three parcels, two cells: A and C hold one each, B starves and nothing can be spared. This is
  // outside the mesh's own guarantee (at least as many cells as parcels) and the repair's job here
  // is to decline — the island draws two parcels, and B's capability simply has no ground to draw.
  const parcels = [parcelAt('capA', 0, 0), parcelAt('capB', 50, 0), parcelAt('capC', 100, 0)];
  const cells = [cellAt(0, 0), cellAt(100, 0)];
  const got = parcelCells(scene(parcels, cells));
  assert.deepEqual([...got.keys()].sort(), ['capA', 'capC'], 'the two that own ground draw; B does not');
  assert.deepEqual(got.get('capA'), [cellPath(0, 0)]);
  assert.deepEqual(got.get('capC'), [cellPath(100, 0)]);
});

/** The `d` a cell centred on (cx, cy) draws — the identity of a cell in the emitted ground. Derived
 *  from the same polygon `cellAt` authors, so it names a cell rather than pinning the path grammar. */
function cellPath(cx: number, cy: number): string {
  const p = cellAt(cx, cy).poly;
  return LAND_CELL_PATH(p);
}

/** Read the path grammar off the builder itself: build a one-cell, one-parcel island and take the
 *  cell's `d`. Pinning the grammar here would be a second copy of it; this asks the code. */
const LAND_CELL_PATH = (() => {
  const memo = new Map<string, string>();
  return (poly: ReadonlyArray<{ x: number; y: number }>): string => {
    const key = JSON.stringify(poly);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const one = scene([parcelAt('solo', poly[0]!.x, poly[0]!.y)], [{ owner: 0, poly: [...poly], variant: 0, wheat: false }]);
    const d = pathOf(children(allByKind(one, 'parcel')[0]!)[0]!);
    assert.ok(d.length > 0, 'a parcel cell draws a path');
    memo.set(key, d);
    return d;
  };
})();
