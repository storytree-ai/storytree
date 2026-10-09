import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, planetPathwayDrawing, plateTransform, PLATE_CLEARANCE } from '../geometry.js';
import { onIslandSurface } from './island-surface.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const links = [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }];
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('6.4 every recorded capability link between islands is one unbroken road from dock to dock; a link within an island has none', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  assert.deepEqual(plan.edges.map(e => `${e.from}->${e.to}`), ['b1->a1'], 'a2->a1 and b2->b1 stay on their islands');
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  const [edge] = plan.edges;
  const points = edge!.segments.flatMap(ref => ref.reversed ? [...segments.get(ref.id)!.points].reverse() : segments.get(ref.id)!.points);
  for (let i = 1; i < points.length; i++) assert.ok(points[i - 1]!.distanceTo(points[i]!) < 1.5, `b1->a1 breaks at point ${i}`);
  const dock = (story: string) => plan.docks.find(d => d.story === story && d.links.includes('b1->a1'))!.point;
  assert.ok(points[0]!.distanceTo(dock('b')) < 1e-6, 'it starts at b\'s dock');
  assert.ok(points.at(-1)!.distanceTo(dock('a')) < 1e-6, 'it ends at a\'s dock');
});

test('6.12 a road between islands follows the globe\'s surface, however far round the globe its islands sit', () => {
  // A large island 132° from the chart's pole, where the chart stretches it most, linked to one near the pole;
  // and a neighbour a few units of sea from that one, whose short road is all approach to its two ends.
  const far: Island = { ...island('far', []), trees: Array.from({ length: 30 }, (_, i) => ({ capability: `far${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: i % 6, z: Math.floor(i / 6), scale: 1, turn: 0 })) };
  const at = (angle: number) => ({ x: R * Math.sin(angle), y: 0, z: R * Math.cos(angle) });
  const spots = new Map([['a', at(0.3)], ['near', at(0.42)], ['far', at(-2.3)]]);
  const plan = buildPlanetPathways({ islands: [island('a', ['a1']), island('near', ['near1']), far],
    links: [{ from: 'far1', to: 'a1' }, { from: 'near1', to: 'a1' }] }, spots, R);
  const roads = plan.segments;
  assert.ok(roads.some(road => road.points.at(-1)!.distanceTo(road.points[0]!) < 16), 'a short road between neighbours');
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!, ab = b.clone().sub(a);
    assert.ok(ab.length() <= 1.5, `${road.id} jumps ${ab.length().toFixed(1)} units at point ${i} of ${road.points.length}`);
    // The ribbon is drawn straight between its points: the nearest it comes to the globe's middle stays outside the glass.
    const t = Math.max(0, Math.min(1, -a.dot(ab) / ab.lengthSq()));
    assert.ok(a.clone().addScaledVector(ab, t).length() >= R, `${road.id} cuts through the glass at point ${i}`);
    // Nor does it lift off the glass, which would show it past the globe's edge (the owner, 2026-10-06: "the payways
    // look to flow off the globe when they hit the edge rather then end"): no higher than the islands' land.
    assert.ok(b.length() <= R + PLATE_CLEARANCE + 0.01, `${road.id} lifts ${(b.length() - R).toFixed(2)} units off the glass at point ${i}`);
  }
  // Each road ends on its island's coast as the globe draws it, bent onto the sphere.
  assert.ok(plan.docks.length > 0);
  for (const dock of plan.docks) {
    const { position, quaternion } = plateTransform(spots.get(dock.story)!, R);
    const drawn = onIslandSurface(R)(dock.local).applyQuaternion(quaternion).add(new Vector3(...position));
    assert.ok(dock.point.distanceTo(drawn) < 1e-6, `the road's end on ${dock.story} is ${dock.point.distanceTo(drawn).toFixed(2)} units off its drawn coast`);
  }
});

test('6.14 a road to an island far round the globe is routed all the way to its coast, not filled in along the surface', () => {
  // A large island 132° from +z, linked to one near +z: about the islands' own middle, neither is far round the chart.
  const far: Island = { ...island('far', []), trees: Array.from({ length: 30 }, (_, i) => ({ capability: `far${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: i % 6, z: Math.floor(i / 6), scale: 1, turn: 0 })) };
  const at = (angle: number) => ({ x: R * Math.sin(angle), y: 0, z: R * Math.cos(angle) });
  const plan = buildPlanetPathways({ islands: [island('a', ['a1']), far], links: [{ from: 'far1', to: 'a1' }] },
    new Map([['a', at(0.3)], ['far', at(-2.3)]]), R);
  const roads = plan.segments;
  assert.ok(roads.length > 0);
  for (const road of roads) assert.ok(road.unrouted! <= 1, `${road.id} runs ${road.unrouted!.toFixed(1)} units the router never planned`);
});

test('6.14 a road to an island whose coast is not round is routed to that coast, from any side', () => {
  // An L-shaped island: its coast dips far inside the disc round its farthest point, most of all in the L's corner.
  const trees = [...Array.from({ length: 10 }, (_, i) => [i, 0]), ...Array.from({ length: 9 }, (_, i) => [0, i + 1])];
  const ell: Island = { ...island('ell', []), trees: trees.map(([x, z], i) => ({ capability: `ell${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: x!, z: z!, scale: 1, turn: 0 })) };
  for (let side = 0; side < 8; side++) {
    const angle = side * Math.PI / 4;
    const plan = buildPlanetPathways({ islands: [island('a', ['a1']), ell], links: [{ from: 'ell0', to: 'a1' }] },
      new Map([['ell', { x: 0, y: 0, z: R }], ['a', { x: R * Math.sin(0.3) * Math.cos(angle), y: R * Math.sin(0.3) * Math.sin(angle), z: R * Math.cos(0.3) }]]), R);
    for (const road of plan.segments) {
      assert.ok(road.unrouted! <= 1, `from side ${side}, ${road.id} runs ${road.unrouted!.toFixed(1)} units the router never planned`);
    }
  }
});

test('6.13 a link naming a capability on no island is left out on its own: every other road is drawn, and the notice names it', () => {
  // A capability still depending on one that was retired (ADR-0920 left "5 · The canvas" depending on a retired one).
  const stray = { from: 'b2', to: 'retired' };
  const drawing = planetPathwayDrawing({ ...scene, links: [...links, stray] }, spots, R);
  assert.deepEqual(drawing.plan.edges.map(e => `${e.from}->${e.to}`), ['b1->a1'], 'the link between the islands keeps its road');
  assert.ok(drawing.plan.segments.length > 0, 'the road between the islands is drawn');
  assert.match(drawing.issue ?? '', /b2.*retired/, 'the notice names the link left out');
});
