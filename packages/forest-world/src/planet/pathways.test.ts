import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways } from '../geometry.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, radius: 1, key: story,
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
  // A large island 132° from the chart's pole, where the chart stretches it most, linked to one near the pole.
  const far: Island = { ...island('far', []), trees: Array.from({ length: 30 }, (_, i) => ({ capability: `far${i}`, form: 'green' as const, status: 'healthy' as const, contracts: 1, x: i % 6, z: Math.floor(i / 6), scale: 1, turn: 0 })) };
  const plan = buildPlanetPathways({ islands: [island('a', ['a1']), far], links: [{ from: 'far1', to: 'a1' }] },
    new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['far', { x: -R * Math.sin(2.3), y: 0, z: R * Math.cos(2.3) }]]), R);
  const roads = plan.segments.filter(segment => segment.island === undefined);
  assert.ok(roads.length > 0);
  for (const road of roads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]!, b = road.points[i]!, ab = b.clone().sub(a);
    assert.ok(ab.length() <= 1.5, `${road.id} jumps ${ab.length().toFixed(1)} units at point ${i} of ${road.points.length}`);
    // The ribbon is drawn straight between its points: the nearest it comes to the globe's middle stays outside the glass.
    const t = Math.max(0, Math.min(1, -a.dot(ab) / ab.lengthSq()));
    assert.ok(a.clone().addScaledVector(ab, t).length() >= R, `${road.id} cuts through the glass at point ${i}`);
  }
});
