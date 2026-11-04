import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, LANE_COLOUR } from '../geometry.js';
import { trailFillWidth } from '../core/routing.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import { advanceLaneClock, laneHead, laneHeads, LANE_GLOW, LANE_SPEED, THREAD_WIDTH, type LaneRoute, type LitLink } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('4.8 a lit link\'s lane is one unbroken strip between islands, from the dock of the island built on to the dock of the island building on it, a thread down the middle of its road with a glow beyond', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }, { from: 'a2', to: 'a1', dir: 'up' }]);
  assert.deepEqual(lanes.map(l => [l.from, l.to, l.colour]), [['b1', 'a1', LANE_COLOUR.down], ['b2', 'a2', LANE_COLOUR.up]],
    'a link within one island lights nothing');
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  const dock = (story: string, link: string) => plan.docks.find(d => d.story === story && d.links.includes(link))!.point;
  for (const lane of lanes) {
    const edge = plan.edges.find(e => e.from === lane.from && e.to === lane.to)!;
    // The chain is its roads between islands: nothing inland on either island.
    const cross = edge.segments;
    assert.ok(cross.length > 0);
    const road = cross.map(ref => segments.get(ref.id)!);
    const trail = cross.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    const back = trail.reverse().filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-9);
    assert.equal(lane.points.length, back.length);
    const link = `${lane.from}->${lane.to}`;
    assert.ok(lane.points[0]!.distanceTo(dock('a', link)) < 1e-9, 'starts on the dock of the island built on');
    assert.ok(lane.points.at(-1)!.distanceTo(dock('b', link)) < 1e-9, 'ends on the dock of the island building on it');
    assert.equal(lane.widths.length, lane.points.length);
    lane.points.forEach((p, i) => {
      const margin = Math.min(...road.filter(segment => segment.points.some(q => q.distanceTo(back[i]!) < 1e-9)).map(segment => segment.width / 2));
      assert.ok(p.distanceTo(back[i]!) + lane.widths[i]! / 2 <= margin + 1e-9, `inside its road at point ${i}`);
      assert.ok(lane.widths[i]! <= THREAD_WIDTH + 1e-9, `no wider than the thread at point ${i}`);
    });
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
  }
  const [alone] = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  const road = (p: Vector3) => Math.max(...plan.segments.filter(s => s.points.some(q => q.distanceTo(p) < 1e-9)).map(s => s.width));
  alone!.points.forEach((p, i) => assert.ok(Math.abs(alone!.widths[i]! - THREAD_WIDTH) < 1e-9 && alone!.widths[i]! < road(p), `a lone lane is the thread, its road showing either side, at point ${i}`));
  assert.ok(THREAD_WIDTH < trailFillWidth(1) * RIBBON_GROUND_SCALE, 'narrower than the narrowest road');
  assert.ok(LANE_GLOW > 1.5, 'its glow reaches beyond the thread\'s edge');
  assert.deepEqual(laneRoutes(plan, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no trail lights nothing');
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

test('4.8 opposite colours share a trunk side by side, each just under half of it, even when their links travel it in opposite directions, and join their exact endpoints continuously', () => {
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
      assert.ok(Math.hypot(p.y, p.z - R) + lane.width / 2 < 1, 'both strips lie within their road');
    }
    for (const p of lane.points.filter(p => Math.abs(p.x) < 6)) {
      assert.ok(Math.hypot(p.y, p.z - R) + lane.width / 2 > 0.95, 'side by side, the two strips fill their road');
    }
  }
  const alone = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }])[0]!;
  assert.ok(alone.points.every(p => Math.abs(p.x) >= 10 || p.y === 0), 'a single colour uses the centre of its road');
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

test('4.9 one head per shared stretch of one colour: links over one road show one head on it and one each where their routes part, however many links ride it', () => {
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
  assert.equal(headsAt(both, 10), 2, 'an up and a down lane sharing a road each keep their own head');
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
