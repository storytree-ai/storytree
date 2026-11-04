import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, SEA_LANE } from '../geometry.js';
import { advanceLaneClock, laneHead, laneHeads, LANE_SPEED, roadsUnderLanes, seaLaneWidth, type LaneRoute, type LitLink } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('4.8 a lit link\'s lane is one unbroken line at sea between islands, from the dock of the island built on to the dock of the island building on it, one pale sea-blue in and out alike', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }, { from: 'a2', to: 'a1', dir: 'up' }]);
  assert.deepEqual(lanes.map(l => [l.from, l.to, l.colour]), [['b1', 'a1', SEA_LANE], ['b2', 'a2', SEA_LANE]],
    'a link within one island lights nothing, and both ways are one tone');
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  const dock = (story: string, link: string) => plan.docks.find(d => d.story === story && d.links.includes(link))!.point;
  for (const lane of lanes) {
    const edge = plan.edges.find(e => e.from === lane.from && e.to === lane.to)!;
    // The chain is its roads between islands: nothing inland on either island.
    const cross = edge.segments;
    assert.ok(cross.length > 0);
    const trail = cross.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    const back = trail.reverse().filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-9);
    assert.equal(lane.points.length, back.length);
    lane.points.forEach((p, i) => assert.ok(p.distanceTo(back[i]!) < 1e-9, `down the middle of its road at point ${i}`));
    const link = `${lane.from}->${lane.to}`;
    assert.ok(lane.points[0]!.distanceTo(dock('a', link)) < 1e-9, 'starts on the dock of the island built on');
    assert.ok(lane.points.at(-1)!.distanceTo(dock('b', link)) < 1e-9, 'ends on the dock of the island building on it');
    assert.equal(lane.widths.length, lane.points.length);
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
  }
  const [alone] = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  assert.ok(alone!.widths.every(w => w === seaLaneWidth(1)), 'a lane alone is the narrowest line');
  assert.deepEqual(laneRoutes(plan, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no trail lights nothing');
});

test('4.8 the roads the lit lanes run along are not drawn under them; every other road stays', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const under = roadsUnderLanes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  const carries = plan.segments.filter(s => s.links.includes('b1->a1')).map(s => s.id);
  assert.ok(carries.length > 0 && carries.every(id => under.has(id)), 'its road gives way to the lane');
  assert.ok(plan.segments.filter(s => !s.links.includes('b1->a1')).every(s => !under.has(s.id)), 'no other road is hidden');
  assert.equal(roadsUnderLanes(plan, []).size, 0);
});

test('4.8 a type-only link stays marked on its road and its lane', () => {
  const typed: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2', typeOnly: true }, { from: 'b2', to: 'a1', typeOnly: true }] };
  const plan = buildPlanetPathways(typed, spots, R);
  assert.deepEqual(plan.edges.map(e => [e.from, e.to, e.typeOnly === true]), [['b1', 'a1', false], ['b2', 'a2', true], ['b2', 'a1', true]]);
  for (const segment of plan.segments) {
    assert.equal(segment.typeOnlyLinks ?? 0, segment.links.filter(link => link !== 'b1->a1').length, `${segment.id} counts its type-only links`);
  }
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'up' }, { from: 'b2', to: 'a2', dir: 'up' }]);
  assert.deepEqual(lanes.map(lane => lane.typeOnly === true), [false, true]);
});

test('4.8 lanes sharing a stretch, in and out alike, are one line down the middle of its road, a step wider by how many share it', () => {
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
  const [down, up] = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'a2', to: 'b2', dir: 'up' }]);
  for (const lane of [down!, up!]) lane.points.forEach((p, i) => {
    if (Math.abs(p.x) < 9.99) {
      assert.equal(p.y, 0, 'on the shared trunk both run down its middle');
      assert.equal(lane.widths[i], seaLaneWidth(2), 'a step wider where two share it');
    } else if (Math.abs(p.x) > 10.01) assert.equal(lane.widths[i], seaLaneWidth(1), 'the narrowest line where it runs alone');
  });
  assert.ok(seaLaneWidth(1) < seaLaneWidth(2) && seaLaneWidth(7) === seaLaneWidth(2) && seaLaneWidth(8) > seaLaneWidth(7)
    && seaLaneWidth(32) > seaLaneWidth(31) && seaLaneWidth(100) === seaLaneWidth(32), 'one, two to seven, eight to thirty-one, thirty-two or more');
  const eight = fork(Array.from({ length: 8 }, (_, i) => ({ from: `e${i}`, arm: 'east' as const, dir: i % 2 ? 'up' as const : 'down' as const })));
  assert.equal(eight[0]!.widths[0], seaLaneWidth(8), 'eight on the trunk, in and out alike, count as eight');
});

test('4.9 lit lanes start together and their fronts keep one steady pace, so the selection settles in its longest lane\'s time; whole at once under reduced motion', () => {
  assert.ok(Math.abs(laneDrawSeconds(600) - 2 * laneDrawSeconds(300)) < 1e-9, 'a lane twice as long takes twice as long');
  assert.equal(laneProgress(0, laneDrawSeconds(100), false), 0, 'nothing drawn when the selection is made');
  for (const t of [0.1, 0.25, 0.5]) {
    const short = laneProgress(t, laneDrawSeconds(300), false) * 300, long = laneProgress(t, laneDrawSeconds(900), false) * 900;
    assert.ok(Math.abs(short - long) < 1e-9, `at ${t} s both fronts are the same distance out`);
    assert.ok(Math.abs(short - t * LANE_SPEED) < 1e-9, 'at the steady pace');
  }
  assert.equal(laneProgress(laneDrawSeconds(100), laneDrawSeconds(100), false), 1);
  assert.equal(laneProgress(99, laneDrawSeconds(100), false), 1);
  assert.equal(laneProgress(0, laneDrawSeconds(100), true), 1);
  assert.equal(laneProgress(0, laneDrawSeconds(0), false), 1, 'a lane with no length is whole');
});

/** One island's dock at (-20, 0) sends lanes up a trunk to a fork at (0, 0), where an arm runs on to each of two islands. */
function fork(links: { from: string; arm: 'east' | 'west'; dir: LitLink['dir'] }[]): LaneRoute[] {
  const point = (x: number, y: number) => new Vector3(x, y, R);
  const line = (id: string, from: [number, number], to: [number, number], with_: string[]) => ({
    id, width: 2, links: with_, points: Array.from({ length: 21 }, (_, i) => point(from[0], from[1]).lerp(point(to[0], to[1]), i / 20)),
  });
  const on = (arm: 'east' | 'west') => links.filter(link => link.arm === arm).map(link => `${link.from}->a1`);
  const plan: PlanetPathways = {
    plates: new Map(), docks: [],
    segments: [line('trunk', [-20, 0], [0, 0], links.map(link => `${link.from}->a1`)),
      line('east', [0, 0], [10, 10], on('east')), line('west', [0, 0], [10, -10], on('west'))],
    // A chain runs from the building capability back to the one built on; the lane walks it the other way.
    edges: links.map(link => ({ from: link.from, to: 'a1', segments: [{ id: link.arm, reversed: true }, { id: 'trunk', reversed: true }] })),
  };
  return laneRoutes(plan, links.map(link => ({ from: link.from, to: 'a1', dir: link.dir })));
}
const headsAt = (lanes: readonly LaneRoute[], distance: number) => {
  const heads = laneHeads(lanes);
  return lanes.filter((lane, i) => laneHead(distance / LANE_SPEED, lane.length, heads[i]!, false) > 0).length;
};

test('4.9 one head per shared stretch: links over one road show one head on it and one each where their routes part, however many links ride it', () => {
  const two = fork([{ from: 'e1', arm: 'east', dir: 'down' }, { from: 'w1', arm: 'west', dir: 'down' }]);
  assert.equal(two[0]!.length, two[1]!.length);
  for (const distance of [1, 10, 19]) assert.equal(headsAt(two, distance), 1, `one head on the shared trunk ${distance} units out`);
  for (const distance of [24, 30, 34]) assert.equal(headsAt(two, distance), 2, `two heads once their routes part, ${distance} units out`);
  const twenty = fork([...Array.from({ length: 19 }, (_, i) => ({ from: `e${i}`, arm: 'east' as const, dir: 'down' as const })),
    { from: 'w1', arm: 'west', dir: 'down' }]);
  assert.equal(twenty.length, 20);
  for (const distance of [1, 10, 19]) assert.equal(headsAt(twenty, distance), 1, `a twentieth link adds no head on the trunk, ${distance} units out`);
  for (const distance of [24, 30, 34]) assert.equal(headsAt(twenty, distance), 2, `nor on an arm others share, ${distance} units out`);
  const settle = (lanes: readonly LaneRoute[]) => Math.max(...lanes.map(lane => laneDrawSeconds(lane.length)));
  assert.equal(settle(twenty), settle(two), 'nor any time to settle');
  assert.deepEqual(laneHeads([...twenty].reverse()).reverse(), laneHeads(twenty), 'who leads does not depend on the order the links come in');
  const both = fork([{ from: 'e1', arm: 'east', dir: 'down' }, { from: 'w1', arm: 'west', dir: 'up' }]);
  assert.equal(headsAt(both, 10), 1, 'a lane in and a lane out sharing a road share one head, being one line');
  assert.equal(laneHead(0, two[0]!.length, laneHeads(two)[0]!, false), 0, 'no head before it sets out');
  assert.equal(headsAt(two, 10) + laneHeads(two).reduce((n, heads, i) => n + laneHead(10 / LANE_SPEED, two[i]!.length, heads, true), 0), 1,
    'never a head under reduced motion');
});

test('4.9 a lane\'s head fades once the lane is whole, and grows in over a short distance where it turns off alone rather than popping on', () => {
  const [alone] = fork([{ from: 'e1', arm: 'east', dir: 'down' }]), heads = laneHeads([alone!])[0]!, whole = laneDrawSeconds(alone!.length);
  assert.equal(laneHead(whole, alone!.length, heads, false), 1);
  assert.ok(laneHead(whole + 0.2, alone!.length, heads, false) > 0 && laneHead(whole + 0.2, alone!.length, heads, false) < 1, 'fading once whole');
  assert.equal(laneHead(whole + 0.5, alone!.length, heads, false), 0);
  const two = fork([{ from: 'e1', arm: 'east', dir: 'down' }, { from: 'w1', arm: 'west', dir: 'down' }]), led = laneHeads(two);
  const follower = led.findIndex(ranges => ranges[0]![0] > 0);
  const at = (distance: number) => laneHead(distance / LANE_SPEED, two[follower]!.length, led[follower]!, false);
  assert.ok(at(20.2) > 0 && at(20.2) < at(30), 'a follower\'s head grows in where it turns off alone');
  assert.equal(at(30), 1);
});

test('4.9 slow rendered frames leave visible intermediate lane growth, while normal frame steps keep their real time', () => {
  let elapsed = 0;
  for (let i = 0; i < 4; i++) {
    const next = advanceLaneClock(elapsed, 0.016);
    assert.ok(Math.abs((next - elapsed) - 0.016) < 1e-9, 'normal frames retain their actual elapsed time');
    elapsed = next;
  }
  assert.equal(advanceLaneClock(0, 0.6), 0.08, 'a slow frame cannot complete a short route at once');
  assert.ok(laneProgress(advanceLaneClock(0, 1.5), laneDrawSeconds(100), false) < 0.3, 'the first slow frame leaves most of the route still to grow');
  assert.equal(advanceLaneClock(0.1, -1), 0.1, 'a negative frame delta cannot wind growth backwards');
});
