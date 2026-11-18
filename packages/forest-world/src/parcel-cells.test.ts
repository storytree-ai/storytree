import assert from 'node:assert/strict';
import test from 'node:test';

import { cellsByIsland, cellsByParcel, parcelCellsFrom } from './parcel-cells.js';
import type { LayoutCell } from './parcel-cells.js';
import type { Descriptor3D, InstanceDescriptor } from './descriptors.js';

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
  const bare = cell();
  delete bare.material;
  assert.equal(parcelCellsFrom([bare])[0]?.status, 'unknown');
});

test('a cell with no parcel is KEPT, and carries an honest absence', () => {
  const [got] = parcelCellsFrom([cell()]);
  assert.ok(got);
  assert.equal(got.parcel, undefined);
  assert.equal(got.points.length, 4);
});

test('a ring bounding no area is stepped over, and so is a missing one', () => {
  const two = cell({ points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] });
  const none = cell();
  delete none.points;
  assert.deepEqual(parcelCellsFrom([two, none]), []);
  const tri = cell({
    points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 8 }],
  });
  assert.equal(parcelCellsFrom([tri]).length, 1);
});

test('the order of the cells is the descriptor stream’s own', () => {
  const ids = ['cap-2', 'cap-0', 'cap-1'];
  assert.deepEqual(
    parcelCellsFrom(ids.map((parcel) => cell({ parcel }))).map((c) => c.parcel),
    ids,
  );
});

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
  const grouped = cellsByParcel([cellOf(undefined), cellOf('cap-0'), cellOf(undefined)]);
  assert.deepEqual([...grouped.keys()], ['cap-0']);
  assert.equal(grouped.size, 1);
});

test('an empty input groups to nothing, not to one empty group', () => {
  assert.equal(cellsByParcel([]).size, 0);
  assert.equal(cellsByIsland([]).size, 0);
});

test('a cell carries the STORY whose island it sits on, alongside the capability whose parcel it is', () => {
  const [got] = parcelCellsFrom([cell({ parcel: 'cap-0', island: 'atlas' })]);
  assert.ok(got);
  assert.equal(got.parcel, 'cap-0');
  assert.equal(got.island, 'atlas');
});

test('a cell the substrate could not attribute carries an honest absence, and is still KEPT', () => {
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
  const grouped = cellsByIsland([cellOf('cap-0'), cellOf('cap-1', 'healthy', 'atlas'), cellOf(undefined)]);
  assert.deepEqual([...grouped.keys()], ['atlas']);
  assert.equal(grouped.size, 1);
});

test('the island grouping and the parcel grouping partition the SAME cells differently', () => {
  const cells = [
    cellOf('cap-a', 'healthy', 'atlas'),
    cellOf('cap-b', 'healthy', 'atlas'),
    cellOf('cap-c', 'healthy', 'beacon'),
  ];
  assert.equal(cellsByIsland(cells).size, 2);
  assert.equal(cellsByParcel(cells).size, 3);
});
