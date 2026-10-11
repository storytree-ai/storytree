import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, laneDrawSeconds, laneProgress, laneRoutes, LANE_COLOUR } from '../geometry.js';
import { trailFillWidth } from '../core/routing.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import { advanceLaneClock, entranceShown, laneEntrances, laneHead, laneHeads, LANE_GLOW, LANE_SPEED, onIsland, type InlandWay, type LaneRoute, type LitLink } from './lanes.js';
import type { PlanetPathways } from './pathways.js';
import { dashedRoadMaterial, laneMaterial, ribbon, roadInk } from './PlanetTrailRibbons.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
  links: [{ from: 'a2', to: 'a1' }, { from: 'b1', to: 'a1' }, { from: 'b2', to: 'b1' }, { from: 'b2', to: 'a2' }] };
const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);

test('6.8 a lit link\'s lane is one unbroken strip between islands, from the dock of the island built on to the dock of the island building on it, filling its road with a glow beyond', () => {
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
      assert.ok(lane.widths[i]! >= 0.95 * margin, `at least half its road at point ${i}`);
    });
    assert.ok(Math.abs(lane.length - lane.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane.points[i]!), 0)) < 1e-6);
  }
  const [alone] = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'down' }]);
  const road = (p: Vector3) => Math.max(...plan.segments.filter(s => s.points.some(q => q.distanceTo(p) < 1e-9)).map(s => s.width));
  alone!.points.forEach((p, i) => assert.ok(Math.abs(alone!.widths[i]! - road(p)) < 1e-9, `a lone lane fills its road at point ${i}`));
  assert.ok(LANE_GLOW > 1.5, 'its glow reaches beyond the road\'s edge');
  assert.deepEqual(laneRoutes(plan, [{ from: 'x', to: 'y', dir: 'up' }]), [], 'a link with no trail lights nothing');
});

test('6.8 a lit lane runs on from each dock along its way inland to its capability\'s territory, a one-link road wide; with no way it ends at its dock', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  const link = { from: 'b1', to: 'a1', dir: 'down' } as const;
  // A way from the dock straight to the island's middle, in the island's own ground coordinates.
  const middle = (story: string) => onIsland([{ x: 0, z: 0 }], spots.get(story)!, R)[0]!;
  const inland: InlandWay = (dock, capability) => {
    assert.equal(capability, dock.story === 'a' ? 'a1' : 'b1', 'each end asks for the way to its own capability');
    return onIsland([dock.local, { x: dock.local.x / 2, z: dock.local.z / 2 }, { x: 0, z: 0 }], spots.get(dock.story)!, R);
  };
  const [road] = laneRoutes(plan, [link]), [lane] = laneRoutes(plan, [link], inland);
  assert.ok(lane!.points[0]!.distanceTo(middle('a')) < 1e-9, 'it starts in the territory on the island built on');
  assert.ok(lane!.points.at(-1)!.distanceTo(middle('b')) < 1e-9, 'and ends in the territory on the island building on it');
  const start = lane!.points.findIndex(p => p.distanceTo(road!.points[0]!) < 1e-9);
  assert.ok(start > 0, 'through the dock');
  road!.points.forEach((p, i) => assert.ok(p.distanceTo(lane!.points[start + i]!) < 1e-9, `along its road at point ${i}`));
  const inlandWidths = [...lane!.widths.slice(0, start), ...lane!.widths.slice(start + road!.points.length)];
  assert.ok(inlandWidths.length > 0 && inlandWidths.every(w => Math.abs(w - trailFillWidth(1) * RIBBON_GROUND_SCALE) < 1e-9), 'a one-link road wide inland');
  lane!.points.slice(1).forEach((p, i) => assert.ok(p.distanceTo(lane!.points[i]!) <= 1 + 1e-9, `unbroken at point ${i}`));
  assert.ok(Math.abs(lane!.length - lane!.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(lane!.points[i]!), 0)) < 1e-6);
  const marks = laneEntrances([lane!]);
  assert.deepEqual(marks.map(mark => [mark.point.distanceTo(lane!.points[0]!) < 1e-9, mark.point.distanceTo(lane!.points.at(-1)!) < 1e-9].indexOf(true)).sort(), [0, 1],
    'its marks sit at its two ends, in the territories');
  const [none] = laneRoutes(plan, [link], () => undefined);
  assert.equal(none!.points.length, road!.points.length, 'with no way inland it ends at its docks');
});

test('6.8 a way inland lies on its island where the globe draws it, from the dock, a unit at most between points', () => {
  const plan = buildPlanetPathways(scene, spots, R);
  for (const dock of plan.docks) {
    const way = onIsland([dock.local, { x: 0, z: 0 }], spots.get(dock.story)!, R);
    assert.ok(way[0]!.distanceTo(dock.point) < 1e-6, `it starts on the dock on ${dock.story}`);
    way.slice(1).forEach((p, i) => assert.ok(p.distanceTo(way[i]!) <= 1 + 1e-9));
    assert.ok(way.length > Math.hypot(dock.local.x, dock.local.z), 'filled in along the way');
  }
});

test('6.8 a type-only link\'s road and its lane are dashed; a road a link by value shares keeps a solid core as wide as its links by value', () => {
  const typed: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2', typeOnly: true }, { from: 'b2', to: 'a1', typeOnly: true }] };
  const plan = buildPlanetPathways(typed, spots, R);
  assert.deepEqual(plan.edges.map(e => [e.from, e.to, e.typeOnly === true]), [['b1', 'a1', false], ['b2', 'a2', true], ['b2', 'a1', true]]);
  for (const segment of plan.segments) {
    assert.equal(segment.typeOnlyLinks ?? 0, segment.links.filter(link => link !== 'b1->a1').length, `${segment.id} counts its type-only links`);
  }
  assert.deepEqual(roadInk({ links: ['x', 'y'] }), { dashed: false }, 'a road of links by value is solid');
  assert.deepEqual(roadInk({ links: ['x', 'y'], typeOnlyLinks: 2 }), { dashed: true }, 'a road of type-only links is dashed');
  assert.deepEqual(roadInk({ links: ['x', 'y', 'z'], typeOnlyLinks: 1 }), { dashed: true, core: trailFillWidth(2) * RIBBON_GROUND_SCALE },
    'a shared road is dashed, with a solid core as wide as its two links by value');
  const lanes = laneRoutes(plan, [{ from: 'b1', to: 'a1', dir: 'up' }, { from: 'b2', to: 'a2', dir: 'up' }]);
  assert.deepEqual(lanes.map(lane => lane.typeOnly === true), [false, true]);
  assert.equal(laneMaterial(LANE_COLOUR.up, false, 1, true).uniforms.uDashed!.value, 1, 'a type-only lane is dashed');
  assert.equal(laneMaterial(LANE_COLOUR.up, false, 1).uniforms.uDashed!.value, 0, 'a lane by value is not');
  assert.equal(dashedRoadMaterial('#c7bba1').uniforms.uDashed!.value, 1);
  // The dashes are measured along the road, so they keep their length wherever the road runs.
  const strip = ribbon(plan.segments[0]!), along = strip.getAttribute('along');
  const points = plan.segments[0]!.points;
  assert.ok(Math.abs(along.getX(along.count - 1) - points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(points[i]!), 0)) < 1e-3);
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
      assert.ok(mark.radius > 0.75 && mark.radius < 2, 'a small pip, about twice a one-link road across');
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

test('6.8 opposite colours share a trunk side by side, each just under half of it, even when their links travel it in opposite directions, and join their exact endpoints continuously', () => {
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

test('6.9 lit lanes start together and their fronts keep one steady pace, so the selection settles in its longest lane\'s time; whole at once under reduced motion', () => {
  assert.ok(LANE_SPEED > 0);
  assert.ok(Math.abs(laneDrawSeconds(300) - 300 / LANE_SPEED) < 1e-9, 'a lane\'s time is its length over the pace');
  assert.equal(laneProgress(0, laneDrawSeconds(100), false), 0, 'nothing drawn when the selection is made');
  for (const t of [0.1, 0.25, 0.5]) {
    const short = laneProgress(t, laneDrawSeconds(100), false) * 100, long = laneProgress(t, laneDrawSeconds(300), false) * 300;
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

test('6.9 one head per shared stretch of one colour: links over one road show one head on it and one each where their routes part, however many links ride it', () => {
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
  assert.deepEqual(laneHeads(twenty), laneHeads(twenty), 'who leads is the same every time');
  const both = fork([{ from: 'e1', arm: 'east', dir: 'down' }, { from: 'w1', arm: 'west', dir: 'up' }]);
  assert.equal(headsAt(both, 10), 2, 'an up and a down lane sharing a road each keep their own head');
  assert.equal(laneHead(0, two[0]!.length, laneHeads(two)[0]!, false), 0, 'no head before it sets out');
  assert.equal(headsAt(two, 10) + laneHeads(two).reduce((n, heads, i) => n + laneHead(10 / LANE_SPEED, two[i]!.length, heads, true), 0), 1,
    'never a head under reduced motion');
});

test('6.9 a lane\'s head fades once the lane is whole, and grows in over a short distance where it turns off alone rather than popping on', () => {
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

test('6.9 slow rendered frames leave visible intermediate lane growth, while normal frame steps keep their real time', () => {
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
