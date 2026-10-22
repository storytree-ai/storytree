import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Vector3 } from 'three';
import type { ForestScene, Island, Plumbing } from '../scene.js';
import { buildPlanetPathways, growthPlan, laneRoutes, planetPathwayDrawing, roadSegmentWindows, trailFillWidth } from '../geometry.js';
import { RIBBON_GROUND_SCALE } from '../trail-ribbon-width.js';
import { drawnAtOnce, routedDrawing, type RoadRouter } from './road-routing.js';
import { answerRouting } from './road-worker.js';
import { plumbingKey, plumbingLabels, roadLook } from './plumbing.js';
import { PlumbingChips } from './PlumbingLabels.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const at = (angle: number) => ({ x: R * Math.sin(angle), y: 0, z: R * Math.cos(angle) });
const spots = new Map([['a', at(-0.3)], ['b', at(0.3)], ['c', at(0.9)]]);
const islands = [island('a', ['a1']), island('b', ['b1']), island('c', ['c1'])];
const call = (from: string, to: string, kind: Plumbing['kind'], files = [`${from}/${kind}.ts`]): Plumbing => ({ from, to, kind, files });
const WIDTH = (links: number) => trailFillWidth(links) * RIBBON_GROUND_SCALE;

test('4.29 a plumbing call is drawn as a road between the two islands it joins, one per kind, dock to dock', () => {
  const scene: ForestScene = { islands, links: [], plumbing: [call('a', 'b', 'build step'), call('a', 'c', 'cleanup'), call('b', 'c', 'forwarder')] };
  const plan = buildPlanetPathways(scene, spots, R);
  assert.deepEqual((plan.plumbing ?? []).map(p => [p.from, p.to, p.kind]), [['a', 'b', 'build step'], ['a', 'c', 'cleanup'], ['b', 'c', 'forwarder']]);
  assert.deepEqual((plan.plumbing ?? []).map(p => p.files), [['a/build step.ts'], ['a/cleanup.ts'], ['b/forwarder.ts']], 'each carries the files behind it');
  assert.equal(plan.edges.length, 0, 'no capability link is drawn');
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  for (const road of plan.plumbing ?? []) {
    const chain = road.segments.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    const near = (story: string, p: Vector3) => plan.docks.some(d => d.story === story && d.point.distanceTo(p) < 1e-6);
    assert.ok(near(road.from, chain[0]!), `${road.kind} starts on a dock of ${road.from}`);
    assert.ok(near(road.to, chain.at(-1)!), `${road.kind} ends on a dock of ${road.to}`);
  }
  for (const segment of plan.segments) assert.ok((segment.plumbing ?? []).length > 0, `${segment.id} is a plumbing road`);
  // A call naming a story with no island, or an island to itself, is left out; the other roads are still drawn.
  const odd: ForestScene = { ...scene, plumbing: [call('a', 'zzz', 'cleanup'), call('a', 'a', 'forwarder'), call('a', 'b', 'build step')] };
  assert.deepEqual((planetPathwayDrawing(odd, spots, R).plan.plumbing ?? []).map(p => [p.from, p.to, p.kind]), [['a', 'b', 'build step']]);
});

test('4.30 a plumbing road is not a dependency: it joins no capability link, widens no road and lights no lane, and kinds between one pair collide on no key', () => {
  const links = [{ from: 'b1', to: 'a' }];
  const scene: ForestScene = { islands, links, plumbing: [call('b', 'a', 'build step'), call('b', 'a', 'cleanup'), call('a', 'b', 'forwarder'), call('a', 'c', 'cleanup')] };
  const plan = buildPlanetPathways(scene, spots, R);
  assert.deepEqual(plan.edges.map(e => `${e.from}->${e.to}`), ['b1->a'], 'only the mapped island\'s road is a capability edge');
  assert.deepEqual((plan.plumbing ?? []).map(plumbingKey), ['b->a#build step', 'b->a#cleanup', 'a->b#forwarder', 'a->c#cleanup'], 'a key per pair and kind');
  assert.equal(new Set((plan.plumbing ?? []).map(plumbingKey)).size, 4);
  for (const segment of plan.segments) {
    assert.ok(segment.links.every(link => link === 'b1->a'), `${segment.id} counts only the capability link`);
    assert.ok(Math.abs(segment.width - WIDTH(segment.links.length)) < 1e-9, `${segment.id} is as wide as its capability links make it`);
  }
  const only = plan.segments.filter(s => s.links.length === 0);
  assert.ok(only.length > 0 && only.every(s => s.width < WIDTH(1)), 'a road only plumbing uses is narrower than a one-link road');
  assert.deepEqual(laneRoutes(plan, [{ from: 'b', to: 'a', dir: 'up' }, { from: 'a', to: 'c', dir: 'down' }]), [], 'a selection lights no plumbing road');
  assert.ok(plan.docks.every(d => d.links.every(link => !link.includes('#'))), 'no dock claims a plumbing call as a link');
});

test('4.31 each plumbing road is labelled at its middle with its kind\'s words only, one chip per kind between a pair, the files as its title', () => {
  const scene: ForestScene = { islands, links: [], plumbing: [call('a', 'b', 'cleanup', ['x/clean.ts']), call('a', 'b', 'build step', ['x/build.ts', 'x/also.ts']), call('a', 'c', 'forwarder')] };
  const plan = buildPlanetPathways(scene, spots, R);
  const labels = plumbingLabels(plan);
  assert.deepEqual(labels.map(l => [l.from, l.to, l.chips.map(c => c.kind)]), [['a', 'b', ['build step', 'cleanup']], ['a', 'c', ['forwarder']]]);
  const segments = new Map(plan.segments.map(s => [s.id, s]));
  for (const label of labels) {
    const road = plan.plumbing!.find(p => p.from === label.from && p.to === label.to)!;
    const chain = road.segments.flatMap(ref => { const p = segments.get(ref.id)!.points; return ref.reversed ? [...p].reverse() : p; });
    const walk = [0];
    for (let i = 1; i < chain.length; i++) walk.push(walk[i - 1]! + chain[i]!.distanceTo(chain[i - 1]!));
    const middle = walk.at(-1)! / 2, point = label.point!;
    const nearest = chain.reduce((best, p, i) => p.distanceTo(point) < best.d ? { d: p.distanceTo(point), i } : best, { d: Infinity, i: 0 });
    assert.ok(nearest.d <= 1, `${label.from}->${label.to}'s label sits on its road`);
    assert.ok(Math.abs(walk[nearest.i]! - middle) <= 1.5, `${label.from}->${label.to}'s label sits at its middle`);
  }
  const html = renderToStaticMarkup(createElement(PlumbingChips, { chips: labels[0]!.chips }));
  const text = html.replace(/<[^>]*>/g, '|').split('|').filter(Boolean);
  assert.deepEqual(text, ['build step', 'cleanup'], 'the chips read the kind and nothing else');
  assert.match(html, /title="x\/build\.ts, x\/also\.ts"/);
  assert.doesNotMatch(html, /smell|bad|warn|wrong|problem/i);
});

test('4.32 a plumbing road reads as a different kind of road from a dependency: its own ink alone, or a thin thread down a dependency\'s road', () => {
  const scene: ForestScene = { islands, links: [{ from: 'b1', to: 'a1' }], plumbing: [call('b', 'a', 'build step'), call('a', 'c', 'cleanup')] };
  const plan = buildPlanetPathways(scene, spots, R);
  const plain = roadLook({ id: 'x', points: [], width: 3, links: ['b1->a1'] });
  const alone = plan.segments.filter(s => s.links.length === 0), shared = plan.segments.filter(s => s.links.length > 0 && (s.plumbing ?? []).length > 0);
  assert.ok(alone.length > 0 && shared.length > 0, 'the plan has both a plumbing-only road and a shared one');
  assert.equal(plain.thread, undefined);
  for (const segment of alone) {
    const look = roadLook(segment);
    assert.notEqual(look.road, plain.road, 'its own ink');
    assert.notEqual(look.halo, plain.halo);
    assert.equal(look.thread, undefined);
  }
  for (const segment of shared) {
    const look = roadLook(segment), ink = roadLook(alone[0]!).road;
    assert.equal(look.road, plain.road, 'a dependency\'s road keeps its colour');
    assert.equal(look.thread, ink, 'with a thread in the plumbing ink');
    assert.ok(look.threadWidth! > 0 && look.threadWidth! < segment.width, 'narrower than the road');
  }
});

test('4.33 in a recorded growth a plumbing road draws on once both its islands stand, and moves no island\'s rise', () => {
  const before: ForestScene = { islands: [island('a', ['a1']), island('b', ['b1'])], links: [] };
  const after = (plumbing: Plumbing[]): ForestScene => ({ islands: [island('a', ['a1']), island('b', ['b1']), island('c', ['c1'])], links: [], plumbing });
  const stages = (plumbing: Plumbing[]) => [{ id: 'one', scene: before }, { id: 'two', scene: after(plumbing) }];
  const calls = [call('a', 'b', 'build step'), call('c', 'a', 'cleanup')];
  const plan = growthPlan(stages(calls)), bare = growthPlan(stages([]));
  assert.deepEqual([...plan.roads.keys()].sort(), calls.map(plumbingKey).sort());
  assert.deepEqual([...plan.islands], [...bare.islands], 'an island rises as it would with no plumbing');
  const end = (w: { start: number; seconds: number }) => w.start + w.seconds;
  assert.ok(plan.roads.get(plumbingKey(calls[0]!))!.start >= plan.stages[1]!.start, 'a road between standing islands waits for its stage');
  assert.ok(plan.roads.get(plumbingKey(calls[1]!))!.start >= end(plan.islands.get('c')!), 'a road to a rising island waits for it');
  assert.ok(plan.seconds >= end(plan.roads.get(plumbingKey(calls[1]!))!), 'the growth lasts until it is drawn');
  const pathways = buildPlanetPathways(after(calls), spots, R);
  const windows = roadSegmentWindows(pathways, plan.roads);
  for (const segment of pathways.segments) assert.ok(windows.has(segment.id), `${segment.id} draws on in its window`);
  const orphan = growthPlan([{ id: 'x', scene: after([call('a', 'zzz', 'cleanup')]) }]);
  assert.equal(orphan.roads.size, 0, 'a call to a story that is not recorded is not scheduled');
});

test('4.34 a layout whose roads are only plumbing is routed and kept like any other: asked of the router, drawn at once when nothing moved, kept on show while a moved layout is routed', async () => {
  const scene: ForestScene = { islands, links: [], plumbing: [call('a', 'b', 'build step')] };
  const asked: Parameters<RoadRouter>[0][] = [];
  const router: RoadRouter = async routing => { asked.push(routing); const reply = answerRouting(routing); if ('error' in reply) throw new Error(reply.error); return reply.network; };
  const first = drawnAtOnce(scene, spots, R);
  assert.equal(first.drawing.plan.segments.length, 0, 'the islands first');
  assert.ok(first.routing, 'the plumbing road waits on a routing');
  const drawn = (await routedDrawing(scene, spots, R, first.routing!, router, new AbortController().signal))!;
  assert.deepEqual(asked[0]!.edges.map(e => [e.from, e.to]), [['a', 'b']], 'the router is asked for the road');
  assert.equal(drawn.plan.plumbing?.length, 1);
  const again = drawnAtOnce(scene, spots, R);
  assert.equal(again.routing, undefined, 'kept: nothing to route');
  assert.equal(again.drawing.plan.plumbing?.length, 1, 'and drawn at once');
  const more: ForestScene = { ...scene, plumbing: [...scene.plumbing!, call('a', 'c', 'cleanup')] };
  const added = drawnAtOnce(more, spots, R, { spots, radius: R, drawing: drawn });
  assert.ok(added.routing, 'a new plumbing call waits on a routing');
  assert.equal(added.drawing.plan.plumbing?.length, 1, 'the road already drawn stays on show meanwhile');
});
