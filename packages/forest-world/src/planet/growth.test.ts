import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { buildPlanetPathways, growthMoment, growthPlan, growthProgress, plateGrowth, roadSegmentWindows, segmentDrawRange, type GrowthWindow } from '../geometry.js';

const R = 218;
const island = (story: string, capabilities: string[], files: string[] = []): Island => ({
  story, title: story, x: 0, z: 0, radius: 1, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
  ...(files.length ? { land: { territories: [], files: files.map(path => ({ path, lines: 10 })) } } : {}),
});
const end = (w: GrowthWindow) => w.start + w.seconds;
// Recorded: a and b are planned with no links; later b builds on a, and c arrives building on b.
const stages: { id: string; scene: ForestScene }[] = [
  { id: 'stories', scene: { islands: [island('a', ['a1']), island('b', ['b1'])], links: [] } },
  { id: 'same', scene: { islands: [island('a', ['a1']), island('b', ['b1'])], links: [] } },
  { id: 'linked', scene: { islands: [island('a', ['a1', 'a2'], ['src/a.ts']), island('b', ['b1']), island('c', ['c1'])],
    links: [{ from: 'b1', to: 'a1' }, { from: 'c1', to: 'b1' }] } },
];

test('7.1 a growth replays only what the recording holds, in its stages\' order, and roads only leave risen islands', () => {
  const plan = growthPlan(stages);
  assert.deepEqual([...plan.islands.keys()].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...plan.roads.keys()].sort(), ['b1->a1', 'c1->b1']);
  assert.deepEqual([...plan.capabilities.keys()].sort(), ['a1', 'a2', 'b1', 'c1']);
  assert.deepEqual([...plan.files.keys()], ['a\nsrc/a.ts']);
  // A stage that adds nothing takes no time; the next stage starts after everything earlier has finished.
  assert.deepEqual(plan.stages.map(s => s.id), ['stories', 'linked']);
  const linked = plan.stages[1]!.start;
  for (const story of ['a', 'b']) assert.ok(end(plan.islands.get(story)!) <= linked, `${story} rose in its own stage`);
  for (const w of [...plan.roads.values(), plan.capabilities.get('a2')!, plan.files.get('a\nsrc/a.ts')!, plan.islands.get('c')!]) assert.ok(w.start >= linked);
  // Causal: a road leaves its built-on island once settled; the dependent rises when it arrives.
  const road = plan.roads.get('c1->b1')!;
  assert.ok(road.start >= end(plan.islands.get('b')!));
  assert.ok(Math.abs(plan.islands.get('c')!.start - end(road)) < 1e-9, 'c rises as its road arrives');
  // A link whose ends are not both recorded is never drawn.
  const orphan = growthPlan([{ id: 'x', scene: { islands: [island('a', ['a1'])], links: [{ from: 'z9', to: 'a1' }] } }]);
  assert.deepEqual([...orphan.roads.keys()], []);
});

test('7.1 within one saved reading, islands nothing reaches start spread over a beat, and the rest arrive along their roads', () => {
  const plan = growthPlan([stages[2]!]);
  const [a, b, c] = ['a', 'b', 'c'].map(s => plan.islands.get(s)!);
  assert.ok(b!.start >= end(plan.roads.get('b1->a1')!) - 1e-9 && c!.start >= end(plan.roads.get('c1->b1')!) - 1e-9);
  assert.ok(a!.start < b!.start && b!.start < c!.start);
  // Roads are still drawing while islands rise: one interleaved arrival, not islands then roads.
  assert.ok(plan.roads.get('c1->b1')!.start < c!.start);
  // Islands only on a cycle nothing reaches still rise, after the rest.
  const cycle = growthPlan([{ id: 'c', scene: { islands: [island('a', ['a1']), island('p', ['p1']), island('q', ['q1'])],
    links: [{ from: 'p1', to: 'q1' }, { from: 'q1', to: 'p1' }] } }]);
  assert.deepEqual([...cycle.islands.keys()].sort(), ['a', 'p', 'q']);
});

test('7.2 a whole globe grows from a point of light to its full form in the length asked for, keeping order and pacing', () => {
  const natural = growthPlan(stages, { fromPoint: true });
  const globe = natural.globe!;
  assert.equal(globe.start, 0);
  for (const w of natural.islands.values()) assert.ok(w.start >= end(globe), 'the globe has swelled before the first island rises');
  const fitted = growthPlan(stages, { fromPoint: true, seconds: 15 });
  assert.ok(Math.abs(fitted.seconds - 15) < 1e-9);
  const k = 15 / natural.seconds;
  for (const [story, w] of natural.islands) {
    const f = fitted.islands.get(story)!;
    assert.ok(Math.abs(f.start - w.start * k) < 1e-9 && Math.abs(f.seconds - w.seconds * k) < 1e-9, `${story} keeps its place in the pacing`);
  }
  for (const w of [...fitted.islands.values(), ...fitted.roads.values(), ...fitted.capabilities.values()]) assert.ok(end(w) <= 15 + 1e-9);
});

test('7.2 a road draws on at constant speed from its built-on end, split by length across the segments it crosses, a shared one drawn by its earliest road', () => {
  const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])],
    links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2' }] };
  const spots = new Map([['a', { x: R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }], ['b', { x: -R * Math.sin(0.3), y: 0, z: R * Math.cos(0.3) }]]);
  const pathways = buildPlanetPathways(scene, spots, R);
  const roads = new Map<string, GrowthWindow>([['b1->a1', { start: 1, seconds: 1 }], ['b2->a2', { start: 3, seconds: 1 }]]);
  const windows = roadSegmentWindows(pathways, roads);
  const segments = new Map(pathways.segments.map(s => [s.id, s]));
  const length = (id: string) => segments.get(id)!.points.slice(1).reduce((sum, p, i) => sum + p.distanceTo(segments.get(id)!.points[i]!), 0);
  const edge = pathways.edges.find(e => e.from === 'b1')!;
  // Walked from the capability built on: the chain reversed, only the segments drawn across the glass.
  const walk = [...edge.segments].reverse().filter(ref => segments.get(ref.id)!.island === undefined);
  assert.ok(walk.length > 0);
  const total = walk.reduce((sum, ref) => sum + length(ref.id), 0);
  let at = 1;
  for (const ref of walk) {
    const w = windows.get(ref.id)!;
    assert.ok(Math.abs(w.start - at) < 1e-9, `${ref.id} starts where the front reaches it`);
    assert.ok(Math.abs(w.seconds - length(ref.id) / total) < 1e-9, 'constant speed');
    assert.equal(w.fromEnd, !ref.reversed, 'drawn from the end the road enters');
    at += w.seconds;
  }
  const shared = pathways.segments.filter(s => s.island === undefined && s.links.includes('b1->a1') && s.links.includes('b2->a2'));
  assert.ok(shared.length > 0, 'the two roads share the glass between the islands');
  for (const s of shared) assert.ok(windows.get(s.id)!.start < 3, 'a shared segment keeps its earliest road');
});

test('7.3 an island rises from its middle without overshoot, its parts and files filling in behind it; reduced motion shows the end at once', () => {
  const w = { start: 2, seconds: 1 };
  let last = 0;
  for (let t = 0; t <= 4; t += 0.01) {
    const p = growthProgress(w, t, false);
    assert.ok(p >= last - 1e-12 && p <= 1, 'eases up, never past full');
    last = p;
  }
  assert.equal(growthProgress(w, 1.9, false), 0);
  assert.equal(growthProgress(w, 3, false), 1);
  assert.ok(growthProgress(w, 2.5, false) > 0.5, 'it eases out');
  assert.equal(growthProgress(w, 0, true), 1);
  assert.equal(growthProgress(undefined, 0, false), 1, 'what no growth schedules is shown whole');
  const plan = growthPlan([stages[2]!]);
  const a = plan.islands.get('a')!;
  for (const part of [plan.capabilities.get('a1')!, plan.capabilities.get('a2')!, plan.files.get('a\nsrc/a.ts')!]) {
    assert.ok(part.start > a.start && end(part) >= end(a), 'after its island, finishing with or after it');
  }
});

test('7.4 the globe given a growth hides what has not risen, draws roads on from their built-on end, and ends as the globe without one', () => {
  assert.deepEqual(plateGrowth(0), { visible: false, scale: 0, sink: 1 });
  const half = plateGrowth(0.5);
  assert.ok(half.visible && half.scale > 0 && half.scale < 1 && half.sink > 0 && half.sink < 1);
  assert.deepEqual(plateGrowth(1), { visible: true, scale: 1, sink: 0 });
  assert.deepEqual(segmentDrawRange(10, 0, false), { start: 0, count: 0 });
  assert.deepEqual(segmentDrawRange(10, 0.3, false), { start: 0, count: 18 });
  assert.deepEqual(segmentDrawRange(10, 0.3, true), { start: 42, count: 18 }, 'from the far end');
  assert.deepEqual(segmentDrawRange(10, 1, true), { start: 0, count: 60 });
  // At its end every island is whole and every road fully drawn.
  const plan = growthPlan(stages, { fromPoint: true, seconds: 12 });
  for (const w of [plan.globe!, ...plan.islands.values(), ...plan.roads.values()]) assert.equal(growthProgress(w, plan.seconds, false), 1);
});

test('7.5 a recorded date falls in the replay where it fell between the dated stages, so dates keep their order', () => {
  const dated = [
    { id: 'stories', at: '2026-10-01T10:00:00.000Z', scene: stages[0]!.scene },
    { id: 'same', at: '2026-10-01T11:00:00.000Z', scene: stages[1]!.scene },
    { id: 'linked', at: '2026-10-01T12:00:00.000Z', scene: stages[2]!.scene },
  ];
  const plan = growthPlan(dated, { fromPoint: true, seconds: 15, until: '2026-10-01T14:00:00.000Z' });
  const [stories, linked] = plan.stages;
  assert.deepEqual(plan.stages.map(s => s.at), [dated[0]!.at, dated[2]!.at], 'each stage keeps the date it was recorded');
  assert.ok(Math.abs(growthMoment(plan, dated[0]!.at) - stories!.start) < 1e-9);
  assert.ok(Math.abs(growthMoment(plan, dated[2]!.at) - linked!.start) < 1e-9);
  // Between two stages, in proportion; a stage that added nothing (11:00) moves nothing.
  assert.ok(Math.abs(growthMoment(plan, '2026-10-01T10:30:00.000Z') - (stories!.start + (linked!.start - stories!.start) / 4)) < 1e-9);
  // After the last stage, toward the recording's end, reached as the growth ends; outside the recording, held at its edges.
  assert.ok(Math.abs(growthMoment(plan, '2026-10-01T13:00:00.000Z') - (linked!.start + plan.seconds) / 2) < 1e-9);
  assert.equal(growthMoment(plan, '2026-10-01T14:00:00.000Z'), plan.seconds);
  assert.equal(growthMoment(plan, '2026-10-02T00:00:00.000Z'), plan.seconds);
  assert.equal(growthMoment(plan, '2026-09-30T00:00:00.000Z'), stories!.start);
  const dates = ['2026-10-01T09:00:00.000Z', '2026-10-01T10:10:00.000Z', '2026-10-01T11:59:00.000Z', '2026-10-01T12:01:00.000Z', '2026-10-01T15:00:00.000Z'];
  const moments = dates.map(d => growthMoment(plan, d));
  assert.ok(moments.every((m, i) => i === 0 || m >= moments[i - 1]!), 'a later date is never earlier in the replay');
  // A recording with no dates places every date at its first stage.
  assert.equal(growthMoment(growthPlan(stages), '2026-10-01T13:00:00.000Z'), 0);
});

test('7.6 a stage that holds a beat for what it carries beyond the plan takes that beat, even when it adds nothing', () => {
  const dated = [
    { id: 'stories', at: '2026-10-01T10:00:00.000Z', scene: stages[0]!.scene },
    { id: 'claimed', at: '2026-10-01T10:05:00.000Z', scene: stages[1]!.scene, hold: 1 },
    { id: 'quiet', at: '2026-10-01T10:06:00.000Z', scene: stages[1]!.scene },
    { id: 'linked', at: '2026-10-01T20:00:00.000Z', scene: stages[2]!.scene },
  ];
  const plan = growthPlan(dated);
  assert.deepEqual(plan.stages.map(s => s.id), ['stories', 'claimed', 'linked'], 'a held stage stays; one that adds and holds nothing does not');
  const [stories, claimed, linked] = plan.stages;
  assert.ok(claimed!.start >= Math.max(...[...plan.islands.values()].filter(w => w.start < claimed!.start).map(end)) - 1e-9, 'it waits for the stage before');
  assert.ok(linked!.start - claimed!.start >= 1, 'it holds its beat');
  assert.ok(Math.abs(growthMoment(plan, dated[1]!.at) - claimed!.start) < 1e-9, 'what it carries falls at its own start');
  assert.ok(stories!.start < claimed!.start);
  const unheld = growthPlan(dated.map(({ hold, ...stage }) => stage));
  assert.deepEqual(unheld.stages.map(s => s.id), ['stories', 'linked'], 'without its hold it takes no time');
  assert.ok(plan.seconds - unheld.seconds >= 1, 'the hold adds its beat');
});
