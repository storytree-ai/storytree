// parcel-cells.test.ts — the route from the shipped descriptor stream into the placement basis.
//
// ⚠ THE `y`-MEANS-`z` CONVERSION HAPPENS HERE AND NOWHERE ELSE, which is what makes it worth
// pinning: a prop placed in a basis rotated ninety degrees from the land it stands on produces a
// picture that looks merely odd rather than wrong.

import assert from 'node:assert/strict';
import test from 'node:test';

import { cellsByIsland, cellsByParcel, parcelCellsFrom } from './parcel-cells.js';
import type { LayoutCell } from './parcel-cells.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

/** A `cell-ground` descriptor with a real ring — the shape `worldTo3D` emits. */
function cell(over: Partial<InstanceDescriptor> = {}): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    material: 'healthy',
    points: [
      { x: 100, y: 0, z: -40 },
      { x: 134, y: 0, z: -40 },
      { x: 134, y: 0, z: -14 },
      { x: 100, y: 0, z: -14 },
    ],
    ...over,
  };
}

test('a cell-ground ring becomes an {x, z} outline — the SECOND coordinate is z, not y', () => {
  // ⚠ THE TRAP. The descriptor's ring is `{x, y, z}` with `y` pinned to the ground plane; the
  // placement basis is `{x, z}`. Taking `y` would collapse every outline onto a line at z = 0 and
  // put every prop on one edge of the island. The fixture's y is deliberately 0 and its z is not,
  // so the two readings cannot be confused.
  const [got] = parcelCellsFrom([cell({ parcel: 'cap-0' })]);
  assert.ok(got);
  assert.deepEqual(got.points, [
    { x: 100, z: -40 },
    { x: 134, z: -40 },
    { x: 134, z: -14 },
    { x: 100, z: -14 },
  ]);
});

test('the parcel and the status carry through', () => {
  const [got] = parcelCellsFrom([cell({ parcel: 'cap-7', material: 'unhealthy' })]);
  assert.equal(got?.parcel, 'cap-7');
  assert.equal(got?.status, 'unhealthy');
});

test('a cell with no material reads as unknown, never as undefined', () => {
  // `unknown` is the one state that means "no data". Anything else would have a prop asserting a
  // proof state read off a cell that declared none.
  const bare = cell();
  delete bare.material;
  assert.equal(parcelCellsFrom([bare])[0]?.status, 'unknown');
});

test('a cell with no parcel is KEPT, and carries an honest absence', () => {
  // ⚠ Dropping it would shrink the ground a whole-story prop may stand on, and on a substrate with
  // no parcel groups at all it would shrink the island to nothing — a map reporting none of the
  // work, drawn with no error anywhere.
  const [got] = parcelCellsFrom([cell()]);
  assert.ok(got);
  assert.equal(got.parcel, undefined);
  assert.equal(got.points.length, 4);
});

test('only cell-ground descriptors are read — every other family is stepped over', () => {
  const others: Descriptor3D[] = [
    { kind: 'skipped', sceneKind: 'cell' },
    { kind: 'uat-bloom', transform: { x: 1, y: 0, z: 2 }, group: 'uat-bloom', material: 'healthy' },
    { kind: 'cave-arch', transform: { x: 3, y: 0, z: 4 }, group: 'cave-arch', material: 'healthy' },
  ];
  assert.deepEqual(parcelCellsFrom(others), []);
  assert.equal(parcelCellsFrom([...others, cell({ parcel: 'cap-0' })]).length, 1);

  // ⚠ AND ONE OF THEM CARRIES A PERFECTLY GOOD RING. Every descriptor above is refused by the
  // family check OR by the ring check, so a reader that had lost the family check entirely would
  // still answer `[]` here and look correct. This one is refused ONLY by its `kind` — a reader
  // that read parcels off ANY family with a ring, rather than off `cell-ground` specifically,
  // would put a capability's tree on geometry that is not a parcel at all. (The classic
  // substrate's `hex-ground` this arm used to name is retired — `retire-the-old-land-path` — so
  // `cave-arch` stands in as the still-live non-parcel family carrying a shaped ring.)
  const shaped: Descriptor3D = {
    ...cell({ parcel: 'cap-0' }),
    kind: 'cave-arch',
  };
  assert.deepEqual(parcelCellsFrom([shaped]), []);
});

test('a ring bounding no area is stepped over, and so is a missing one', () => {
  // A bilinear sample of two points is a point on a line, and of none is a throw. `worldTo3D`
  // already refuses to emit either, but this takes descriptors from any caller.
  const two = cell({ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] });
  const none = cell();
  delete none.points;
  assert.deepEqual(parcelCellsFrom([two, none]), []);
  // NON-VACUITY: three vertices DO bound an area and must survive the same guard.
  const tri = cell({
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 8 }],
  });
  assert.equal(parcelCellsFrom([tri]).length, 1);
});

test('the order of the cells is the descriptor stream’s own', () => {
  // The placement walks capabilities in first-seen order and seeds off the index, so a reordering
  // here would move every prop on every island with nothing saying so.
  const ids = ['cap-2', 'cap-0', 'cap-1'];
  assert.deepEqual(
    parcelCellsFrom(ids.map((parcel) => cell({ parcel }))).map((c) => c.parcel),
    ids,
  );
});

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

const cellOf = (
  parcel: string | undefined,
  status = 'healthy',
  island: string | undefined = undefined,
): LayoutCell => ({
  points: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }],
  parcel,
  island,
  status,
  cellId: undefined,
});

test('cells group by their parcel, in first-seen order, with every cell kept', () => {
  const grouped = cellsByParcel([
    cellOf('cap-1'),
    cellOf('cap-0'),
    cellOf('cap-1'),
    cellOf('cap-1'),
  ]);
  assert.deepEqual([...grouped.keys()], ['cap-1', 'cap-0']);
  assert.equal(grouped.get('cap-1')?.length, 3);
  assert.equal(grouped.get('cap-0')?.length, 1);
});

test('a cell with no parcel joins no group — not a group of unnamed ones', () => {
  // ⚠ A `undefined` key would be a capability the scene never declared, and one object would be
  // stood on it asserting a state nothing holds.
  const grouped = cellsByParcel([cellOf(undefined), cellOf('cap-0'), cellOf(undefined)]);
  assert.deepEqual([...grouped.keys()], ['cap-0']);
  assert.equal(grouped.size, 1);
});

test('an empty input groups to nothing, not to one empty group', () => {
  assert.equal(cellsByParcel([]).size, 0);
  assert.equal(cellsByIsland([]).size, 0);
});

// ---------------------------------------------------------------------------
// the ISLAND identity — a different question from the parcel, and both are carried
// ---------------------------------------------------------------------------

test('a cell carries the STORY whose island it sits on, alongside the capability whose parcel it is', () => {
  // ⚠ TWO IDS, TWO QUESTIONS. A capability's tree stands on its own parcel; a story's signed UAT
  // criterion belongs to the whole island. Carrying only one of them is what pinned the shipped
  // bloom count at zero.
  const [got] = parcelCellsFrom([cell({ parcel: 'cap-0', island: 'atlas' })]);
  assert.ok(got);
  assert.equal(got.parcel, 'cap-0');
  assert.equal(got.island, 'atlas');
});

test('a cell the substrate could not attribute carries an honest absence, and is still KEPT', () => {
  // The classic extruded-hex substrate has no island group at all. Dropping such a cell would
  // shrink the ground a prop may stand on; inventing an id for it would attribute work to a story
  // that does not exist.
  const cells = parcelCellsFrom([cell({ parcel: 'cap-0' }), cell({ island: 'atlas' })]);
  assert.equal(cells.length, 2, 'both cells kept');
  assert.equal(cells[0]!.island, undefined);
  assert.equal(cells[1]!.parcel, undefined);
});

test('cells group by their island, in first-seen order, with every attributed cell kept', () => {
  const grouped = cellsByIsland([
    cellOf('cap-1', 'healthy', 'beacon'),
    cellOf('cap-0', 'healthy', 'atlas'),
    cellOf('cap-2', 'healthy', 'beacon'),
  ]);
  assert.deepEqual([...grouped.keys()], ['beacon', 'atlas']);
  assert.equal(grouped.get('beacon')?.length, 2);
  assert.equal(grouped.get('atlas')?.length, 1);
});

test('⚠ an unattributed cell joins no island group — the fail-CLOSED direction', () => {
  // Unlike the parcel case this one is deliberate about WHICH way it fails: a caller groups by
  // island precisely so a per-story claim lands on the right story's ground, so ground nobody can
  // attribute is exactly the ground no such claim may be drawn on. An island bucket that swept up
  // the orphans would let one story's signatures stand anywhere on the map.
  const grouped = cellsByIsland([cellOf('cap-0'), cellOf('cap-1', 'healthy', 'atlas'), cellOf(undefined)]);
  assert.deepEqual([...grouped.keys()], ['atlas']);
  assert.equal(grouped.size, 1);
});

test('the island grouping and the parcel grouping partition the SAME cells differently', () => {
  // ⚠⚠ NON-VACUITY for the whole distinction: one island holding two capabilities must produce
  // ONE island group and TWO parcel groups. A reader that had quietly collapsed the two ids would
  // produce the same count twice and every other assertion here would still pass.
  const cells = [
    cellOf('cap-a', 'healthy', 'atlas'),
    cellOf('cap-b', 'healthy', 'atlas'),
    cellOf('cap-c', 'healthy', 'beacon'),
  ];
  assert.equal(cellsByIsland(cells).size, 2);
  assert.equal(cellsByParcel(cells).size, 3);
});
