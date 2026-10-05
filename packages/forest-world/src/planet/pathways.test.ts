import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways } from '../geometry.js';

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
