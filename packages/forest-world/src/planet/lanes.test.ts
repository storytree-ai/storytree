import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, LANE_COLOUR } from '../geometry.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('6.8 a lit link\'s lane is one unbroken strip along its trail, from the capability built on to the one building on it, narrower than its road', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }]);
  assert.deepEqual(lanes.map(l => [l.from, l.to, l.colour]), [['b1', 'a1', LANE_COLOUR.down], ['b2', 'a2', LANE_COLOUR.up]]);
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  for (const lane of lanes) {
    const edge = plan.edges.find(e => e.from === lane.from && e.to === lane.to)!;
    const road = edge.segments.map(ref => segments.get(ref.id)!);
    const trail = edge.segments.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    // The trail itself is unbroken (6.4); the lane is that trail, walked back from the capability built on.
    const back = trail.reverse().filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-9);
    assert.equal(lane.points.length, back.length);
    lane.points.forEach((p, i) => assert.ok(p.distanceTo(back[i]!) < 1e-9, `on its trail at point ${i}`));
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
    for (const segment of road) assert.ok(lane.width < segment.width, `narrower than road ${segment.id}`);
  }
  assert.deepEqual(laneRoutes(plan, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no trail lights nothing');
});

test('6.9 a lane draws on at constant speed in 0.28 to 1.2 seconds, and whole at once under reduced motion', () => {
  assert.equal(laneDrawSeconds(0), 0.28);
  assert.equal(laneDrawSeconds(100_000), 1.2);
  const a = laneDrawSeconds(200), b = laneDrawSeconds(300), c = laneDrawSeconds(400);
  assert.ok(a > 0.28 && c < 1.2, 'mid-length lanes sit between the bounds');
  assert.ok(Math.abs((b - a) - (c - b)) < 1e-9, 'equal extra length takes equal extra time');
  assert.equal(laneProgress(0, 0.5, false), 0);
  assert.equal(laneProgress(0.5, 0.5, false), 1);
  assert.equal(laneProgress(9, 0.5, false), 1);
  assert.ok(laneProgress(0.25, 0.5, false) > 0.5, 'it eases out');
  assert.equal(laneProgress(0, 0.5, true), 1);
});
