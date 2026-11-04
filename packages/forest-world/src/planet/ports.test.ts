import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, Vector3, type BufferAttribute } from 'three';
import { onIslandSurface } from './island-surface.js';
import { laneRoutes } from './lanes.js';
import { plateTransform } from './planet.js';
import type { PlanetPathways } from './pathways.js';
import { litIsland, PORT, portMarks, seaLanes } from './ports.js';
import type { ForestScene } from '../scene.js';

const R = 218;
const spot = new Vector3(0, 0, R);
type P = { x: number; z: number };

/** Island `a`, a round island of The library's land (or `k` times its size across), with roads out to sea from three docks:
 * two lanes and a third six units beside them on its east coast, one on its west. */
function plan(k = 1): PlanetPathways {
  const r = Math.sqrt(24105 / Math.PI) * k, transform = plateTransform(spot, R), at = new Vector3(...transform.position);
  const surface = onIslandSurface(R);
  const world = (p: P) => surface(p).applyQuaternion(transform.quaternion).add(at);
  const coast = Array.from({ length: 256 }, (_, i) => ({ x: r * Math.cos(i / 256 * 2 * Math.PI), z: r * Math.sin(i / 256 * 2 * Math.PI) }));
  const east = { x: r, z: 0 }, beside = { x: r * Math.cos(6 / r), z: r * Math.sin(6 / r) }, west = { x: -r, z: 0 };
  // Each road leaves its dock straight out to sea, then bends away.
  const road = (id: string, from: P, out: P, links: string[]) => {
    const pts: P[] = [];
    for (let t = 0; t <= 40; t++) pts.push({ x: from.x + out.x * t, z: from.z + out.z * t });
    for (let t = 1; t <= 20; t++) pts.push({ x: from.x + out.x * 40 + out.z * t, z: from.z + out.z * 40 - out.x * t });
    return { id, width: 1.5, links, points: pts.map(world) };
  };
  return {
    plates: new Map([['a', { descriptors: [], coast: [coast] }]]),
    segments: [road('e', east, { x: 1, z: 0 }, ['x1->a1', 'x2->a1']), road('b', beside, { x: 1, z: 0 }, ['x3->a2']), road('w', west, { x: -1, z: 0 }, ['a3->x4'])],
    edges: [
      { from: 'x1', to: 'a1', segments: [{ id: 'e', reversed: false }] },
      { from: 'x2', to: 'a1', segments: [{ id: 'e', reversed: false }] },
      { from: 'x3', to: 'a2', segments: [{ id: 'b', reversed: false }] },
      { from: 'a3', to: 'x4', segments: [{ id: 'w', reversed: true }] },
    ],
    docks: [
      { story: 'a', point: world(east), local: east, links: ['x1->a1', 'x2->a1'] },
      { story: 'a', point: world(beside), local: beside, links: ['x3->a2'] },
      { story: 'a', point: world(west), local: west, links: ['a3->x4'] },
    ],
  };
}
const lit = [{ from: 'x1', to: 'a1', dir: 'down' as const }, { from: 'x2', to: 'a1', dir: 'down' as const },
  { from: 'x3', to: 'a2', dir: 'down' as const }, { from: 'a3', to: 'x4', dir: 'up' as const }];
const toLocal = (w: Vector3) => {
  const transform = plateTransform(spot, R);
  return w.clone().sub(new Vector3(...transform.position)).applyQuaternion(transform.quaternion.clone().invert());
};
const inside = (p: P, ring: readonly P[]) => {
  let into = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) into = !into;
  }
  return into;
};

test('4.40 the ports go on the island the lanes are lit for: the one building on a lane going up, the one built on going down', () => {
  const tree = (capability: string) => ({ capability, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: 0, z: 0, scale: 1, turn: 0 });
  const scene: ForestScene = { islands: [{ story: 'a', title: 'a', x: 0, z: 0, key: 'a', trees: [tree('a1')] }, { story: 'b', title: 'b', x: 0, z: 0, key: 'b', trees: [tree('b1')] }] };
  assert.equal(litIsland(scene, [{ from: 'b1', to: 'a1', dir: 'down' }]), 'a');
  assert.equal(litIsland(scene, [{ from: 'b1', to: 'a1', dir: 'up' }]), 'b');
  assert.equal(litIsland(scene, [{ from: 'b', to: 'a1', dir: 'up' }]), 'b', 'a lane may end on an island as a whole (4.19)');
  assert.equal(litIsland(scene, []), undefined, 'nothing lit, no island');
});

test('4.40 the selected island has a port at each dock its lit lanes come ashore at, docks within a port\'s width sharing the busier one\'s, sized by the island against The library', () => {
  const { ports } = seaLanes(plan(), lit, { story: 'a', spot, radius: R });
  assert.deepEqual(ports.map(p => [p.dock.x > 0 ? 'east' : 'west', [...p.links].sort()]), [['east', ['x1->a1', 'x2->a1', 'x3->a2']], ['west', ['a3->x4']]],
    'the dock six units beside the busier one shares its port');
  const [busy, lone] = ports;
  assert.ok(Math.abs(busy!.size - 1) < 0.01, 'The library\'s size, at a port carrying more than one lane');
  assert.ok(Math.abs(lone!.size - PORT.small) < 0.01, 'a port carrying one lane is smaller');
  for (const port of ports) {
    assert.ok(Math.abs(port.out.x - Math.sign(port.dock.x)) < 0.01, 'it faces out to sea, the way its lanes come in');
    const off = Math.hypot(port.berth.x - port.dock.x, port.berth.z - port.dock.z);
    assert.ok(Math.abs(off - PORT.berth * busy!.size) < 1e-6, 'its berth stands just off the coast in front of it, by the island\'s size');
  }
  const half = seaLanes(plan(0.5), lit, { story: 'a', spot, radius: R }).ports;
  assert.ok(Math.abs(half[0]!.size - 0.5) < 0.01, 'an island half as wide as The library has ports half the size');
  assert.equal(half.length, 3, 'and a narrower port\'s width, so the dock beside it keeps its own');
  assert.deepEqual(seaLanes(plan(), lit, undefined).ports, [], 'no selection, no port');
  assert.deepEqual(seaLanes(plan(), [], { story: 'a', spot, radius: R }).ports, [], 'a dock no lit lane lands at has no port');
});

test('4.8 at the selected island each lit lane, in or out, ends on its port\'s berth just off the coast, never on the road ashore, and its far end stays at its dock', () => {
  const roads = plan(), coast = roads.plates.get('a')!.coast[0]!;
  const { lanes, ports } = seaLanes(roads, lit, { story: 'a', spot, radius: R });
  const before = laneRoutes(roads, lit);
  assert.equal(lanes.length, 4);
  lanes.forEach((lane, i) => {
    const key = `${lane.from}->${lane.to}`, port = ports.find(p => p.links.includes(key))!;
    const off = (w: Vector3) => { const p = toLocal(w); return Math.hypot(p.x - port.berth.x, p.z - port.berth.z); };
    const [own, far] = [lane.points[0]!, lane.points.at(-1)!].sort((a, b) => off(a) - off(b));
    assert.ok(off(own!) < 1e-6, `${key} ends on its port's berth`);
    for (const p of lane.points.map(toLocal)) assert.ok(!inside(p, coast), `${key} never comes ashore`);
    assert.ok([before[i]!.points[0]!, before[i]!.points.at(-1)!].some(p => p.distanceTo(far!) < 1e-9), `${key} keeps its far end`);
    assert.equal(lane.widths.length, lane.points.length);
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, j) => sum + p.distanceTo(lane.points[j]!), 0)) < 1e-6);
  });
  assert.deepEqual(seaLanes(roads, lit, undefined).lanes.map(l => l.points.length), before.map(l => l.points.length), 'no selection: the lanes run dock to dock');
});

test('4.40 a port is a low building where the road ends with a capped tower either side, twice as tall, all standing on the land with no jetty out to sea', () => {
  const { ports } = seaLanes(plan(), lit, { story: 'a', spot, radius: R });
  const marks = portMarks(ports, R);
  const top = (name: string) => {
    const mesh = marks.getObjectByName(name) as Mesh;
    assert.ok(mesh, `${name} is drawn`);
    const at = mesh.geometry.getAttribute('position') as BufferAttribute;
    let y = -Infinity;
    for (let i = 0; i < at.count; i++) y = Math.max(y, at.getY(i));
    return y;
  };
  ports.forEach((port, i) => {
    const ground = onIslandSurface(R)(port.dock).y;
    const house = top(`port-house:${i}`) - ground;
    for (const side of [-1, 1]) {
      const tower = top(`port-tower:${i}:${side}`) - ground;
      assert.ok(tower > house * 1.8, 'the towers stand about twice the building\'s height');
    }
    assert.ok(house > 0, 'the building stands up off the land');
  });
  marks.traverse(o => {
    if (!(o instanceof Mesh) || o.name.startsWith('port-shadow')) return;
    const i = Number(o.name.split(':')[1]), port = ports[i]!, at = o.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k < at.count; k++) {
      const seaward = (at.getX(k) - port.dock.x) * port.out.x + (at.getZ(k) - port.dock.z) * port.out.z;
      assert.ok(seaward <= 1e-6, `${o.name} stands on the land, nothing reaching out to sea`);
    }
  });
});
