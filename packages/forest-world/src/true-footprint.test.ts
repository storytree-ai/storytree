import assert from 'node:assert/strict';
import test from 'node:test';

import { islandCentres, nearestCentre, scaleAboutIslands } from './true-footprint.js';
import type { Descriptor3D, InstanceDescriptor } from './descriptors.js';

function stretchAboutIslands<T extends Descriptor3D>(descriptors: readonly T[], factor: number): T[] {
  return scaleAboutIslands(descriptors, () => ({ x: 1, z: factor }));
}

function square(id: string, cx: number, cz: number, side = 20): InstanceDescriptor {
  const h = side / 2;
  return {
    kind: 'cell-ground',
    transform: { x: cx, y: 0, z: cz },
    group: 'cell-ground',
    material: 'healthy',
    island: id,
    parcel: `${id}/p`,
    points: [
      { x: cx - h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz + h },
      { x: cx - h, y: 0, z: cz + h },
    ],
  };
}

interface Extent {
  w: number;
  d: number;
}

function depthOf(ds: readonly InstanceDescriptor[]): Extent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of ds) {
    for (const p of c.points ?? []) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { w: maxX - minX, d: maxZ - minZ };
}

test('islandCentres is the mean of each island’s ring vertices; nearestCentre picks by distance', () => {
  const ds = [square('a', 0, 0), square('b', 100, 50)];
  const c = islandCentres(ds);
  assert.equal(c.size, 2);
  assert.deepEqual(c.get('a'), { x: 0, z: 0 });
  assert.deepEqual(c.get('b'), { x: 100, z: 50 });
  assert.deepEqual(nearestCentre(c, 10, 5), { x: 0, z: 0 });
  assert.deepEqual(nearestCentre(c, 80, 40), { x: 100, z: 50 });
  assert.equal(nearestCentre(new Map(), 0, 0), null);
  const { island: _dropped, ...anon } = square('x', 5, 5);
  void _dropped;
  assert.equal(islandCentres([anon]).size, 0);
});

test('⚠⚠ every ground z is stretched about ITS island’s centre, x and y untouched, the points too — and the centre does not move', () => {
  const s = 2.5;
  const ds = [square('a', 0, 0), square('b', 100, 50, 10)];
  const out = stretchAboutIslands(ds, s);
  assert.equal(out.length, 2);
  for (const [i, d] of out.entries()) {
    const b = ds[i]!;
    const cz = islandCentres(ds).get(b.island!)!.z;
    assert.equal(d.transform.x, b.transform.x);
    assert.equal(d.transform.y, b.transform.y);
    assert.ok(Math.abs(d.transform.z - cz - (b.transform.z - cz) * s) < 1e-9);
    for (const [j, p] of (d.points ?? []).entries()) {
      const q = b.points![j]!;
      assert.equal(p.x, q.x);
      assert.ok(Math.abs(p.z - cz - (q.z - cz) * s) < 1e-9);
    }
  }
  const after = islandCentres(out);
  assert.deepEqual(after.get('a'), { x: 0, z: 0 });
  assert.ok(Math.abs(after.get('b')!.z - 50) < 1e-9);
  assert.ok(Math.abs(depthOf([out[0]!]).d - 20 * s) < 1e-9);
  assert.ok(Math.abs(depthOf([out[1]!]).d - 10 * s) < 1e-9);
  assert.equal(ds[0]!.points![0]!.z, -10);
  const before = depthOf(ds).d;
  const now = depthOf(out).d;
  assert.ok(now > before && now < before * s, `${before} → ${now}`);
});

test('⚠ islandCentres reads only cells with vertices; nearestCentre keeps the first of two equidistant centres', () => {
  const { points: _ring, ...ringless } = square('r', 5, 5);
  void _ring;
  assert.equal(islandCentres([ringless]).size, 0);
  assert.equal(islandCentres([{ ...ringless, points: [] }]).size, 0);
  const c = islandCentres([square('a', -10, 0), square('b', 10, 0)]);
  assert.deepEqual(nearestCentre(c, 0, 0), { x: -10, z: 0 });
});

test('⚠ a descriptor that NAMES its island stretches about it even when another island is nearer; an unknown island id falls back to the nearest', () => {
  const point = (island: string | undefined): InstanceDescriptor => {
    const { points: _ring, island: _own, ...cell } = square('x', 95, 34, 2);
    void _ring; void _own;
    return island === undefined ? cell : { ...cell, island };
  };
  const ds: InstanceDescriptor[] = [
    square('a', 0, 0),
    square('b', 100, 30),
    point('a'),
    point('ghost'),
    point(undefined),
  ];
  const out = stretchAboutIslands(ds, 3);
  assert.ok(Math.abs(out[2]!.transform.z - 34 * 3) < 1e-9, 'the cell stretched about a (its own, z 0), not b (the nearest, z 30)');
  assert.ok(Math.abs(out[3]!.transform.z - (30 + 4 * 3)) < 1e-9, 'a cell naming an island the stream lacks fell back to the nearest island — b');
  assert.ok(Math.abs(out[4]!.transform.z - (30 + 4 * 3)) < 1e-9, 'a cell naming no island follows the nearest island — b');
  const big = square('big', 0, 0, 100);
  const tiny = square('tiny', 60, 0, 4);
  const [bigOut] = stretchAboutIslands([big, tiny], 3);
  assert.deepEqual(bigOut!.points!.map((p) => p.z), [-150, -150, 150, 150]);
});

test('a stream with no islands, or a stretch of 1, comes back unchanged; a bad factor refuses', () => {
  const { island: _none, ...anon } = square('none', 1, 2);
  void _none;
  assert.deepEqual(stretchAboutIslands([anon], 3), [anon]);
  const ds: Descriptor3D[] = [square('a', 0, 0)];
  assert.deepEqual(stretchAboutIslands(ds, 1), ds);
  assert.throws(() => stretchAboutIslands(ds, 0), /positive finite/);
  assert.throws(() => stretchAboutIslands(ds, Number.NaN), /positive finite/);
  assert.throws(() => stretchAboutIslands(ds, -2), /positive finite/);
});

test('⚠ the stretch is exactly invertible: stretching by s then by 1/s is the identity to the bit of a centre', () => {
  const ds = [square('a', 3, -7), square('b', 120, 40, 14)];
  const back = stretchAboutIslands(stretchAboutIslands(ds, 2.9238), 1 / 2.9238);
  for (const [i, d] of back.entries()) {
    for (const [j, p] of (d.points ?? []).entries()) {
      assert.ok(Math.abs(p.z - ds[i]!.points![j]!.z) < 1e-9);
    }
  }
});

test('⚠ scaleAboutIslands REFUSES a scale that is not a positive finite pair, naming the island and the pair; zero is refused, not only negatives', () => {
  const isle = square('a', 0, 0);
  for (const bad of [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: -1, z: 1 },
    { x: 1, z: -0.5 },
    { x: Number.NaN, z: 1 },
    { x: 1, z: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => scaleAboutIslands([isle], () => bad),
      (e: unknown) => e instanceof Error && e.message === `true-footprint: island "a" was given a scale of (${bad.x}, ${bad.z}); both must be positive finite numbers`,
      `(${bad.x}, ${bad.z}) was accepted`,
    );
  }
  const [out] = scaleAboutIslands([square('a', 10, 20)], () => ({ x: 2, z: 0.5 })) as [InstanceDescriptor];
  const e = depthOf([out]);
  assert.ok(Math.abs(e.w - 40) < 1e-9 && Math.abs(e.d - 10) < 1e-9, `${e.w} × ${e.d}`);
  assert.deepEqual(out.transform, { x: 10, y: 0, z: 20 });
  assert.deepEqual(scaleAboutIslands([], () => ({ x: 2, z: 2 })), []);
});

