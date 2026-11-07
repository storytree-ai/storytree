import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, SEA_LANE } from '../geometry.js';
import { advanceLaneClock, LANE_DOTS, LANE_MIN_PX, laneScale, SEA_LANE_ONE, laneDrawn, laneHead, laneHeads, laneShown, LANE_SPEED, restLanes, restShown, SEA_LANE_CAP, SEA_LANE_FILL, seaLaneWidth, type LaneRoute, type LitLink } from './lanes.js';
import type { PlanetLanes, PlanetPathways } from './pathways.js';
import { plateTransform } from './planet.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('4.8 a lit link\'s lane is one unbroken solid pale fill at sea between islands, routed on its own from the dock of the island built on to the dock of the island building on it, one pale tone in and out alike', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const lit: LitLink[] = [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'b2', to: 'a2', dir: 'up' }, { from: 'a2', to: 'a1', dir: 'up' }];
  const lanes = laneRoutes(plan.lanes, lit);
  assert.deepEqual(lanes.map(l => [l.from, l.to, l.colour]), [['b1', 'a1', SEA_LANE_FILL], ['b2', 'a2', SEA_LANE_FILL]],
    'a link within one island lights nothing, and both ways are one tone');
  const segments = new Map(plan.lanes.segments.map(s => [s.id, s]));
  const dock = (story: string, link: string) => plan.lanes.docks.find(d => d.story === story && d.links.includes(link))!.point;
  for (const lane of lanes) {
    const chain = plan.lanes.edges.find(e => e.from === lane.from && e.to === lane.to)!.segments;
    assert.ok(chain.length > 0);
    const route = chain.flatMap(ref => segments.get(ref.id)!.points);
    lane.points.forEach((p, i) => assert.ok(route.some(q => q.distanceTo(p) < 1e-9), `down the middle of its own route at point ${i}`));
    assert.ok(route.every(q => lane.points.some(p => p.distanceTo(q) < 1e-9)), 'the whole of its route');
    lane.points.slice(1).forEach((p, i) => assert.ok(p.distanceTo(lane.points[i]!) <= 1 + 1e-9, 'unbroken: no gap longer than a unit'));
    const link = `${lane.from}->${lane.to}`;
    assert.ok(lane.points[0]!.distanceTo(dock('a', link)) < 1e-9, 'starts on the dock of the island built on');
    assert.ok(lane.points.at(-1)!.distanceTo(dock('b', link)) < 1e-9, 'ends on the dock of the island building on it');
    assert.equal(lane.widths.length, lane.points.length);
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
  }
  const [alone] = laneRoutes(plan.lanes, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  assert.ok(alone!.widths.every(w => w === seaLaneWidth(1)), 'a lane alone is the narrowest line');
  assert.deepEqual(laneRoutes(plan.lanes, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no route lights nothing');
});

/** Where `p`, on the globe, lies against island `story`'s land: inside its coast, and how far from it. */
function againstLand(plan: PlanetPathways, story: string, spot: { x: number; y: number; z: number }, p: Vector3) {
  const transform = plateTransform(spot, R), local = p.clone().sub(new Vector3(...transform.position)).applyQuaternion(transform.quaternion.clone().invert());
  let into = false, off = Infinity;
  for (const ring of plan.plates.get(story)!.coast) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > local.z) !== (b.z > local.z) && local.x < (b.x - a.x) * (local.z - a.z) / (b.z - a.z) + a.x) into = !into;
    const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((local.x - a.x) * dx + (local.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    off = Math.min(off, Math.hypot(local.x - a.x - t * dx, local.z - a.z - t * dz));
  }
  return { into, off };
}

test('4.33 in a recorded growth a lane shows once both its islands have risen, never before', () => {
  const [lane] = laneRoutes(buildPlanetPathways(scene, spots, R).lanes, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  const rising = (progress: Record<string, number>) => (story: string) => progress[story] ?? 1;
  assert.equal(laneShown(lane!, rising({ a: 1, b: 0.4 })), false, 'hidden while its far island rises');
  assert.equal(laneShown(lane!, rising({ a: 0.2, b: 1 })), false, 'hidden while its near island rises');
  assert.equal(laneShown(lane!, rising({ a: 1, b: 1, c: 0 })), true, 'shown once both stand, whatever another island does');
  assert.equal(laneDrawn(lane!, rising({ a: 1, b: 0.4 }), 9, 1, false), 0, 'nothing of it is drawn while it waits, however long it was lit');
  assert.equal(laneDrawn(lane!, rising({ a: 1, b: 1 }), 9, 1, false), 1, 'and it is drawn as lit once both stand');
});

test('4.41 a lane never crosses another island\'s land: it is routed around an island lying between its two, clear of its coast', () => {
  const ring = (angle: number) => ({ x: R * Math.sin(angle), y: 0, z: R * Math.cos(angle) });
  const between = new Map([['a', ring(0.34)], ['c', ring(0)], ['b', ring(-0.34)]]);
  const three: ForestScene = { islands: [island('a', ['a1']), island('b', ['b1']), island('c', ['c1'])], links: [{ from: 'b1', to: 'a1' }] };
  const plan = buildPlanetPathways(three, between, R);
  const [lane] = laneRoutes(plan.lanes, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  assert.ok(lane && lane.points.length > 1);
  for (const p of lane.points) {
    const { into, off } = againstLand(plan, 'c', between.get('c')!, p);
    assert.ok(!into && off > 1, `never on c's land, nor within a unit of its coast (${off.toFixed(2)} off)`);
  }
});

test('4.42 lanes heading the same way share a channel: two islands\' lanes to a far one merge into one trunk, carried as one line', () => {
  const at = (angle: number, lean: number) => ({ x: R * Math.sin(angle) * Math.cos(lean), y: R * Math.sin(lean), z: R * Math.cos(angle) * Math.cos(lean) });
  const fan = new Map([['a', at(0.45, 0)], ['b', at(-0.3, 0.1)], ['c', at(-0.3, -0.1)]]);
  const three: ForestScene = { islands: [island('a', ['a1']), island('b', ['b1']), island('c', ['c1'])], links: [{ from: 'b1', to: 'a1' }, { from: 'c1', to: 'a1' }] };
  const plan = buildPlanetPathways(three, fan, R);
  const trunk = plan.lanes.segments.filter(s => s.links.includes('b1->a1') && s.links.includes('c1->a1'));
  const length = (points: readonly Vector3[]) => points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]!), 0);
  const lanes = laneRoutes(plan.lanes, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'c1', to: 'a1', dir: 'down' }]);
  const shared = trunk.reduce((sum, s) => sum + length(s.points), 0);
  assert.ok(shared > 0.3 * Math.min(...lanes.map(l => l.length)), `they share a trunk for a good part of the way (${shared.toFixed(0)} of ${lanes.map(l => l.length.toFixed(0))})`);
  const on = trunk[0]!.points[Math.floor(trunk[0]!.points.length / 2)]!;
  for (const lane of lanes) {
    const i = lane.points.findIndex(p => p.distanceTo(on) < 1e-9);
    assert.ok(i >= 0, 'both run down the trunk\'s one line');
    assert.equal(lane.widths[i], seaLaneWidth(2), 'a line as wide as the two it carries');
  }
});

test('4.8 a type-only link stays marked on its lane', () => {
  const typed: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2', typeOnly: true }, { from: 'b2', to: 'a1', typeOnly: true }] };
  const plan = buildPlanetPathways(typed, spots, R);
  for (const segment of plan.lanes.segments) {
    assert.equal(segment.typeOnlyLinks ?? 0, segment.links.filter(link => link !== 'b1->a1').length, `${segment.id} counts its type-only links`);
  }
  assert.deepEqual(plan.lanes.edges.map(e => [e.from, e.to, e.typeOnly === true]), [['b1', 'a1', false], ['b2', 'a2', true], ['b2', 'a1', true]]);
  const lanes = laneRoutes(plan.lanes, [{ from: 'b1', to: 'a1', dir: 'up' }, { from: 'b2', to: 'a2', dir: 'up' }]);
  assert.deepEqual(lanes.map(lane => lane.typeOnly === true), [false, true]);
});

test('4.8 lanes sharing a stretch, in and out alike, are one line down its middle, widening smoothly by how many share it up to a cap', () => {
  const point = (x: number, y: number) => new Vector3(x, y, R);
  const line = (id: string, from: [number, number], to: [number, number], links: string[]) => ({
    id, links, points: Array.from({ length: 21 }, (_, i) => point(from[0], from[1]).lerp(point(to[0], to[1]), i / 20)),
  });
  const plan: PlanetLanes = {
    docks: [],
    segments: [line('left-a', [-20, -10], [-10, 0], ['b1->a1']), line('right-a', [10, 0], [20, -10], ['b1->a1']),
      line('left-b', [-20, 10], [-10, 0], ['a2->b2']), line('right-b', [10, 0], [20, 10], ['a2->b2']),
      line('trunk', [-10, 0], [10, 0], ['b1->a1', 'a2->b2'])],
    edges: [
      { from: 'b1', to: 'a1', segments: [{ id: 'right-a', reversed: true }, { id: 'trunk', reversed: true }, { id: 'left-a', reversed: true }], islands: ['b', 'a'] },
      { from: 'a2', to: 'b2', segments: [{ id: 'left-b', reversed: false }, { id: 'trunk', reversed: false }, { id: 'right-b', reversed: false }], islands: ['a', 'b'] },
    ],
  };
  const [down, up] = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'a2', to: 'b2', dir: 'up' }]);
  for (const lane of [down!, up!]) lane.points.forEach((p, i) => {
    if (Math.abs(p.x) < 9.99) {
      assert.equal(p.y, 0, 'on the shared trunk both run down its middle');
      assert.equal(lane.widths[i], seaLaneWidth(2), 'wider where two share it');
    } else if (Math.abs(p.x) > 10.01) assert.equal(lane.widths[i], seaLaneWidth(1), 'the narrowest line where it runs alone');
  });
  const widths = Array.from({ length: 400 }, (_, i) => seaLaneWidth(i + 1));
  assert.equal(widths[0], 0.32, 'one lane is today\'s single width');
  assert.equal(Math.max(...widths), SEA_LANE_CAP, 'the busiest trunk reaches the cap');
  assert.ok(SEA_LANE_CAP <= 1.15 + 1e-9, 'a cap no wider than the old widest step');
  const full = widths.indexOf(SEA_LANE_CAP);
  assert.ok(full >= 31, `no step to the cap: below it every link more is wider (cap reached at ${full + 1})`);
  for (let i = 1; i < full; i++) {
    assert.ok(widths[i]! > widths[i - 1]!, `${i + 1} sharing is wider than ${i}`);
    if (i > 1) assert.ok(widths[i]! - widths[i - 1]! <= widths[i - 1]! - widths[i - 2]! + 1e-12, 'each link more adds no more than the last: a smooth curve');
  }
  assert.ok(widths.slice(full).every(w => w === SEA_LANE_CAP), 'and never past the cap');
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
    id, links: with_, points: Array.from({ length: 21 }, (_, i) => point(from[0], from[1]).lerp(point(to[0], to[1]), i / 20)),
  });
  const on = (arm: 'east' | 'west') => links.filter(link => link.arm === arm).map(link => `${link.from}->a1`);
  const plan: PlanetLanes = {
    docks: [],
    segments: [line('trunk', [-20, 0], [0, 0], links.map(link => `${link.from}->a1`)),
      line('east', [0, 0], [10, 10], on('east')), line('west', [0, 0], [10, -10], on('west'))],
    // A chain runs from the building capability back to the one built on; the lane walks it the other way.
    edges: links.map(link => ({ from: link.from, to: 'a1', segments: [{ id: link.arm, reversed: true }, { id: 'trunk', reversed: true }], islands: [link.from, 'a'] as const })),
  };
  return laneRoutes(plan, links.map(link => ({ from: link.from, to: 'a1', dir: link.dir })));
}
const headsAt = (lanes: readonly LaneRoute[], distance: number) => {
  const heads = laneHeads(lanes);
  return lanes.filter((lane, i) => laneHead(distance / LANE_SPEED, lane.length, heads[i]!, false) > 0).length;
};

test('4.9 one head per shared stretch: links over one stretch show one head on it and one each where their routes part, however many links ride it', () => {
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

/** Three islands' lanes (b's, c's and d's) to a: each comes down its own arm to a trunk the three share into a's dock. */
function trunkOfThree(): PlanetLanes {
  const point = (x: number, y: number) => new Vector3(x, y, R);
  const line = (id: string, from: [number, number], to: [number, number], links: string[]) => ({
    id, links, points: Array.from({ length: 41 }, (_, i) => point(from[0], from[1]).lerp(point(to[0], to[1]), i / 40)),
  });
  const arms = { b: [20, 10], c: [20, 0], d: [20, -10] } as const;
  return {
    docks: [],
    segments: [line('trunk', [-30, 0], [0, 0], ['b1->a1', 'c1->a1', 'd1->a1']),
      ...Object.entries(arms).map(([story, end]) => line(story, [0, 0], [...end], [`${story}1->a1`]))],
    edges: Object.keys(arms).map(story => ({ from: `${story}1`, to: 'a1', segments: [{ id: story, reversed: true }, { id: 'trunk', reversed: true }], islands: [story, 'a'] as const })),
  };
}

test('4.44 at rest every lane is drawn as a line of round chart dots in the lane blue, each stretch\'s dots about half its lane width and spaced about twice their size, down the middle of its merged route', () => {
  const plan = trunkOfThree(), stretches = restLanes(plan);
  assert.deepEqual(stretches.map(s => s.id).sort(), plan.segments.map(s => s.id).sort(), 'every stretch of every lane is dotted, each once however many lanes share it');
  for (const stretch of stretches) {
    const segment = plan.segments.find(s => s.id === stretch.id)!;
    assert.equal(stretch.size, seaLaneWidth(segment.links.length) * LANE_DOTS.size, `${stretch.id}'s dots are half its width`);
    assert.ok(LANE_DOTS.size === 0.5 && LANE_DOTS.pitch >= 1.8 && LANE_DOTS.pitch <= 2.2, 'about half the width, about twice their size apart');
    assert.ok(stretch.dots.length > 2, `${stretch.id} is a line of dots`);
    for (const dot of stretch.dots) assert.ok(segment.points.some(p => p.distanceTo(dot.at) < 0.6), 'each down the middle of its route');
    stretch.dots.slice(1).forEach((dot, i) => {
      const apart = dot.at.distanceTo(stretch.dots[i]!.at) / stretch.size;
      assert.ok(apart > LANE_DOTS.pitch * 0.8 && apart < LANE_DOTS.pitch * 1.25, `${stretch.id}'s dots ${apart.toFixed(2)} sizes apart`);
    });
  }
  const trunk = stretches.find(s => s.id === 'trunk')!, arm = stretches.find(s => s.id === 'b')!;
  assert.ok(trunk.size > arm.size, 'a trunk carrying more links reads as bigger dots');
  assert.ok(restShown(trunk, () => 1) && !restShown(arm, story => story === 'b' ? 0.5 : 1), 'in a growth a stretch shows once both islands of a lane on it have risen (4.33)');
  assert.ok(restShown(trunk, story => story === 'b' ? 0.5 : 1), 'the trunk shows while another of its lanes stands');
});

test('4.8 a selected story fills only its share of each stretch, as wide as its own lit lanes there and never wider than the stretch', () => {
  const plan = trunkOfThree(), rest = new Map(restLanes(plan).map(s => [s.id, s.size / LANE_DOTS.size]));
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }, { from: 'c1', to: 'a1', dir: 'down' }]);
  for (const lane of lanes) lane.points.forEach((p, i) => {
    if (p.x < -1e-9) {
      assert.equal(lane.widths[i], seaLaneWidth(2), 'on the trunk it carries two of three: two lanes\' width');
      assert.ok(lane.widths[i]! < rest.get('trunk')!, 'partly filled: narrower than the trunk');
    } else if (p.x > 1e-9) assert.equal(lane.widths[i], rest.get(lane.from[0]!), 'alone on its arm it fills the arm');
  });
});

test('4.44 zoomed out past the mock\'s one-lane width on screen, every lane size scales up together by a power of two, so lanes stay seen and the dots keep their places within a step', () => {
  assert.equal(laneScale(0.01), 1, 'zoomed in, lanes are their ground width');
  for (const worldPerPixel of [0.2, 0.5, 1, 1.7, 4]) {
    const scale = laneScale(worldPerPixel), px = SEA_LANE_ONE * scale / worldPerPixel;
    assert.equal(Math.log2(scale) % 1, 0, `a power of two at ${worldPerPixel}`);
    assert.ok(px >= LANE_MIN_PX / Math.SQRT2 - 1e-9 && px <= LANE_MIN_PX * Math.SQRT2 + 1e-9, `one lane ${px.toFixed(1)} px across at ${worldPerPixel} units a pixel`);
  }
  assert.equal(laneScale(1), laneScale(1.1), 'a little zoom keeps the step');
});
