import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, islandCoastReach, planetPathwayDrawing, plateTransform, PLATE_CLEARANCE } from '../geometry.js';
import { onIslandSurface } from './island-surface.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const links = [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }];
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('6.4 every recorded capability link on the globe is one unbroken trail, within an island or across the glass', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  assert.deepEqual(plan.edges.map(e => `${e.from}->${e.to}`).sort(), links.map(l => `${l.from}->${l.to}`).sort());
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  for (const edge of plan.edges) {
    assert.ok(edge.segments.length > 0, `${edge.from}->${edge.to} has a trail`);
    let end;
    for (const ref of edge.segments) {
      const segment = segments.get(ref.id)!;
      const points = ref.reversed ? [...segment.points].reverse() : segment.points;
      if (end) assert.ok(end.distanceTo(points[0]!) < 0.05, `${edge.from}->${edge.to} breaks at ${ref.id}`);
      end = points.at(-1)!;
    }
  }
  const crossing = plan.edges.find(e => e.from === 'b1')!;
  assert.ok(crossing.segments.some(ref => segments.get(ref.id)!.island === undefined), 'the link between islands crosses the glass');
});

test('6.12 a road between islands follows the globe\'s surface, however far round the globe its islands sit', () => {
  // A large island 132° from the chart's pole, where the chart stretches it most, linked to one near the pole;
  // and a neighbour a few units of sea from that one, whose short road is all approach to its two ends.
  const far: Island = { ...island('far', []), trees: Array.from({ length: 30 }, (_, i) => ({ capability: `far${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: i % 6, z: Math.floor(i / 6), scale: 1, turn: 0 })) };
  const at = (angle: number) => ({ x: R * Math.sin(angle), y: 0, z: R * Math.cos(angle) });
  const spots = new Map([['a', at(0.3)], ['near', at(0.42)], ['far', at(-2.3)]]);
  const plan = buildPlanetPathways({ islands: [island('a', ['a1']), island('near', ['near1']), far],
    links: [{ from: 'far1', to: 'a1' }, { from: 'near1', to: 'a1' }] }, spots, R);
  const roads = plan.segments.filter(segment => segment.island === undefined);
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

test('6.13 a link naming a capability on no island is left out on its own: every other road is drawn, and the notice names it', () => {
  // A capability still depending on one that was retired (ADR-0920 left "5 · The canvas" depending on a retired one).
  const stray = { from: 'b2', to: 'retired' };
  const drawing = planetPathwayDrawing({ ...scene, links: [...links, stray] }, spots, R);
  assert.deepEqual(drawing.plan.edges.map(e => `${e.from}->${e.to}`).sort(), links.map(l => `${l.from}->${l.to}`).sort(), 'every other link keeps its road');
  assert.ok(drawing.plan.segments.some(segment => segment.island === undefined), 'the road between the islands is drawn');
  assert.match(drawing.issue ?? '', /b2.*retired/, 'the notice names the link left out');
});

test('6.14 a road to islands far round the globe is routed up to their coast, not filled in along the surface', () => {
  // Three islands 126° to 143° from the globe's +z, where a chart about +z stretched them 2.5 to 3.3 times sideways:
  // the router's disc for each reached far past its coast and every road stopped short of it.
  const islands = ['a', 'b', 'c'].map(story => ({ ...island(story, []), trees: Array.from({ length: 8 }, (_, i) => ({
    capability: `${story}${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: i % 4, z: Math.floor(i / 4), scale: 1, turn: 0 })) }));
  const at = (angle: number, turn = 0) => ({ x: R * Math.sin(angle) * Math.cos(turn), y: R * Math.sin(angle) * Math.sin(turn), z: R * Math.cos(angle) });
  const spots = new Map([['a', at(2.2)], ['b', at(2.5)], ['c', at(2.35, 0.4)]]);
  const plan = buildPlanetPathways({ islands, links: [{ from: 'a1', to: 'b1' }, { from: 'c1', to: 'a2' }, { from: 'b2', to: 'c2' }] }, spots, R);
  // The router still sees each island as the disc its farthest coast reaches, so a road may stop where a coast dips
  // inside that disc; it stops no farther out than that, and a little.
  const dip = new Map(plan.docks.map(dock => [dock.point, islandCoastReach(islands.find(i => i.story === dock.story)!) - Math.hypot(dock.local.x, dock.local.z)]));
  for (const road of plan.segments.filter(segment => segment.island === undefined)) {
    const ends = [...dip].filter(([point]) => point.equals(road.points[0]!) || point.equals(road.points.at(-1)!)).map(([, d]) => d);
    assert.ok(road.filled! <= Math.max(0, ...ends) + 3, `${road.id} is filled in along the surface for ${road.filled!.toFixed(1)} units`);
  }
});
