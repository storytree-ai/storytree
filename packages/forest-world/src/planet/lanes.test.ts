import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, LANE_COLOUR } from '../geometry.js';
import { advanceLaneClock, entranceShown, laneEntrances } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('6.8 a lit link\'s lane is one unbroken strip between islands, from the dock of the island built on to the dock of the island building on it, narrower than its road', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }, { from: 'a2', to: 'a1', dir: 'up' }]);
  assert.deepEqual(lanes.map(l => [l.from, l.to, l.colour]), [['b1', 'a1', LANE_COLOUR.down], ['b2', 'a2', LANE_COLOUR.up]],
    'a link within one island lights nothing');
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  const dock = (story: string, link: string) => plan.docks.find(d => d.story === story && d.links.includes(link))!.point;
  for (const lane of lanes) {
    const edge = plan.edges.find(e => e.from === lane.from && e.to === lane.to)!;
    // Only the chain's roads between islands: nothing inland on either island.
    const cross = edge.segments.filter(ref => segments.get(ref.id)!.island === undefined);
    assert.ok(cross.length > 0 && cross.length < edge.segments.length);
    const road = cross.map(ref => segments.get(ref.id)!);
    const trail = cross.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    const back = trail.reverse().filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-9);
    assert.equal(lane.points.length, back.length);
    const link = `${lane.from}->${lane.to}`;
    assert.ok(lane.points[0]!.distanceTo(dock('a', link)) < 1e-9, 'starts on the dock of the island built on');
    assert.ok(lane.points.at(-1)!.distanceTo(dock('b', link)) < 1e-9, 'ends on the dock of the island building on it');
    lane.points.forEach((p, i) => {
      const margin = Math.min(...road.filter(segment => segment.points.some(q => q.distanceTo(back[i]!) < 1e-9)).map(segment => segment.width / 2));
      assert.ok(p.distanceTo(back[i]!) + lane.width / 2 < margin, `inside its road at point ${i}`);
    });
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
    for (const segment of road) assert.ok(lane.width < segment.width, `narrower than road ${segment.id}`);
  }
  assert.deepEqual(laneRoutes(plan, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no trail lights nothing');
});

test('6.8 a lane marks each dock it uses in its colour, both colours side by side where an up and a down lane share one, shown once its front leaves or reaches it', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }]);
  const marks = laneEntrances(lanes);
  // Both links cross between the same two docks, so each dock carries one mark per colour.
  assert.equal(marks.length, 4);
  for (const story of ['a', 'b']) {
    const dock = plan.docks.find(d => d.story === story)!.point;
    const here = marks.filter(mark => mark.point.distanceTo(dock) < mark.radius * 2);
    assert.deepEqual(here.map(mark => mark.colour).sort(), [LANE_COLOUR.up, LANE_COLOUR.down].sort());
    const [one, two] = here;
    assert.ok(one!.point.distanceTo(two!.point) >= one!.radius + two!.radius - 1e-9, 'the two colours do not cover each other');
    for (const mark of here) {
      assert.ok(Math.abs(mark.point.length() - dock.length()) < 1e-9, 'lying on the coast at the dock\'s height');
      assert.ok(mark.radius > lanes[0]!.width && mark.radius < lanes[0]!.width * 2, 'a small pip, wider than its lane');
      assert.deepEqual(mark.lanes, [{ from: mark.dir === 'down' ? 'b1' : 'b2', to: mark.dir === 'down' ? 'a1' : 'a2', at: story === 'a' ? 'start' : 'end' }]);
    }
  }
  const alone = laneEntrances(lanes.slice(0, 1));
  assert.equal(alone.length, 2);
  assert.ok(alone.every(mark => plan.docks.some(d => d.point.distanceTo(mark.point) < 1e-9)), 'a lone colour sits on the dock itself');
  assert.equal(entranceShown('start', 0), false, 'not before its front leaves');
  assert.equal(entranceShown('start', 0.01), true);
  assert.equal(entranceShown('end', 0.99), false, 'not before its front arrives');
  assert.equal(entranceShown('end', 1), true);
});

test('6.8 opposite colours stay distinct on a shared trunk even when their links travel it in opposite directions, and join their exact endpoints continuously', () => {
  const point = (x: number, y: number) => new Vector3(x, y, R);
  const line = (id: string, from: [number, number], to: [number, number], links: string[]) => ({
    id, width: 2, links, points: Array.from({ length: 21 }, (_, i) => point(from[0], from[1]).lerp(point(to[0], to[1]), i / 20)),
  });
  const plan: PlanetPathways = {
    plates: new Map(), docks: [],
    segments: [line('left-a', [-20, -10], [-10, 0], ['b1->a1']), line('right-a', [10, 0], [20, -10], ['b1->a1']),
      line('left-b', [-20, 10], [-10, 0], ['a2->b2']), line('right-b', [10, 0], [20, 10], ['a2->b2']),
      line('trunk', [-10, 0], [10, 0], ['b1->a1', 'a2->b2'])],
    edges: [
      { from: 'b1', to: 'a1', segments: [{ id: 'right-a', reversed: true }, { id: 'trunk', reversed: true }, { id: 'left-a', reversed: true }] },
      { from: 'a2', to: 'b2', segments: [{ id: 'left-b', reversed: false }, { id: 'trunk', reversed: false }, { id: 'right-b', reversed: false }] },
    ],
  };
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'a2', to: 'b2', dir: 'up' }]);
  assert.deepEqual(lanes.map(lane => [lane.from, lane.to, lane.colour]), [['b1', 'a1', LANE_COLOUR.down], ['a2', 'b2', LANE_COLOUR.up]]);
  const [down, up] = lanes;
  assert.deepEqual(down!.points[0], point(-20, -10));
  assert.deepEqual(down!.points.at(-1), point(20, -10));
  assert.deepEqual(up!.points[0], point(20, 10));
  assert.deepEqual(up!.points.at(-1), point(-20, 10));
  const middle = lanes.map(lane => lane.points.reduce((best, p) => Math.abs(p.x) < Math.abs(best.x) ? p : best));
  assert.ok(middle[0]!.distanceTo(middle[1]!) > (down!.width + up!.width) / 2, 'both inks have their own visible strip');
  for (const lane of lanes) {
    assert.ok(lane.points.every(p => Number.isFinite(p.length())));
    assert.ok(lane.points.slice(1).every((p, i) => p.distanceTo(lane.points[i]!) < 1.5), 'the lane never jumps at a trunk junction');
    for (const p of lane.points.filter(p => Math.abs(p.x) < 9)) {
      assert.ok(Math.hypot(p.y, p.z - R) + lane.width / 2 < 1, 'both strips retain a road rim');
    }
  }
  const alone = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }])[0]!;
  assert.ok(alone.points.every(p => Math.abs(p.x) >= 10 || p.y === 0), 'a single colour uses the centre of its road');
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
  assert.equal(laneProgress(0.25, 0.5, false), 0.5, 'half the time reveals half the physical route');
  assert.equal(laneProgress(0.125, 0.5, false), 0.25, 'equal time steps reveal equal distances');
  assert.equal(laneProgress(0, 0.5, true), 1);
});

test('6.9 slow rendered frames leave visible intermediate lane growth, while normal frame steps keep constant speed', () => {
  let elapsed = 0;
  for (let i = 0; i < 4; i++) {
    const next = advanceLaneClock(elapsed, 0.016);
    assert.ok(Math.abs((next - elapsed) - 0.016) < 1e-9, 'normal frames retain their actual elapsed time');
    elapsed = next;
  }
  assert.equal(advanceLaneClock(0, 0.6), 0.08, 'a slow frame cannot complete a short route at once');
  assert.ok(laneProgress(advanceLaneClock(0, 1.5), laneDrawSeconds(10), false) < 0.3, 'the first slow frame leaves most of the route still to grow');
  assert.equal(advanceLaneClock(0.1, -1), 0.1, 'a negative frame delta cannot wind growth backwards');
});
