import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { routeTrails, type TrailNetwork } from '../core/routing.js';
import { planetPathwayDrawing, type CrossRouting } from './pathways.js';
import { drawnAtOnce, routedDrawing, routeInWorker, type RoadRouter, type RoadWorker } from './road-routing.js';
import { answerRouting } from './road-worker.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2' }] };
/** The two islands `apart` radians apart: each angle is its own layout. */
const layout = (apart: number) => new Map([['a', { x: R * Math.sin(apart / 2), y: 0, z: R * Math.cos(apart / 2) }], ['b', { x: -R * Math.sin(apart / 2), y: 0, z: R * Math.cos(apart / 2) }]]);
const roads = (drawing: { plan: { segments: unknown[]; edges: unknown[]; docks: unknown[] } }) => JSON.stringify([drawing.plan.segments, drawing.plan.edges, drawing.plan.docks]);

/** A router that answers only when told to, as a worker does, counting what it is asked. */
function heldRouter() {
  const asked: { routing: CrossRouting; signal: AbortSignal; answer: () => void }[] = [];
  const router: RoadRouter = (routing, signal) => new Promise<TrailNetwork>((resolve, reject) => {
    asked.push({ routing, signal, answer: () => { const reply = answerRouting(routing); 'network' in reply ? resolve(reply.network) : reject(new Error(reply.error)); } });
  });
  return { router, asked };
}

test('6.21 a layout draws every island before its roads are routed, then the same roads routing on the page draws', async () => {
  const spots = layout(0.61);
  const now = drawnAtOnce(scene, spots, R);
  assert.ok(now.routing, 'the roads wait on a routing');
  assert.deepEqual([...now.drawing.plan.plates.keys()], ['a', 'b'], 'both islands are on show at once');
  assert.equal(now.drawing.plan.segments.length, 0, 'no road is drawn before the routing answers');
  const { router, asked } = heldRouter();
  const drawing = routedDrawing(scene, spots, R, now.routing, router, new AbortController().signal);
  asked[0]!.answer();
  const routed = (await drawing)!;
  assert.ok(routed.plan.segments.length > 0);
  assert.equal(routed.plan.plates.get('a'), now.drawing.plan.plates.get('a'), 'the islands drawn at once are kept, not drawn again');
  // The page routing the same layout afresh, once another layout has been routed since.
  planetPathwayDrawing(scene, layout(0.67), R);
  assert.equal(roads(planetPathwayDrawing(scene, spots, R)), roads(routed), 'the roads are the ones routing on the page draws');
});

test('6.21 a layout is routed once: drawn again with nothing moved, its roads are drawn at once', async () => {
  const spots = layout(0.63);
  const { router, asked } = heldRouter();
  const first = drawnAtOnce(scene, spots, R);
  const drawing = routedDrawing(scene, spots, R, first.routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const routed = (await drawing)!;
  // An island's health changes; no island moves.
  const healthier: ForestScene = { ...scene, islands: [{ ...scene.islands[0]!, trees: scene.islands[0]!.trees.map(tree => ({ ...tree, status: 'unhealthy' as const })) }, scene.islands[1]!] };
  const again = drawnAtOnce(healthier, spots, R);
  assert.equal(again.routing, undefined, 'nothing waits on a routing');
  assert.equal(roads(again.drawing), roads(routed), 'its roads are drawn at once');
  assert.equal(asked.length, 1, 'the router was asked once');
});

test('6.21 a routing overtaken by a new layout draws nothing, and its worker is stopped', async () => {
  const spots = layout(0.65);
  const pending = drawnAtOnce(scene, spots, R).routing!;
  const { router, asked } = heldRouter();
  const overtaken = new AbortController();
  const drawing = routedDrawing(scene, spots, R, pending, router, overtaken.signal);
  overtaken.abort();
  asked[0]!.answer();
  assert.equal(await drawing, undefined, 'the overtaken routing draws nothing');
  assert.notEqual(drawnAtOnce(scene, spots, R).routing, undefined, 'and its routes are not kept as the layout\'s');

  let stopped = 0;
  const worker: RoadWorker = { onmessage: null, onerror: null, postMessage: () => {}, terminate: () => { stopped++; } };
  const inWorker = routeInWorker(() => worker), signal = new AbortController();
  const routing = inWorker(pending.routing, signal.signal);
  signal.abort();
  await assert.rejects(routing);
  assert.equal(stopped, 1, 'the worker routing it is stopped');
});

test('6.21 a road worker routes the roads off the page; a page whose worker cannot load still gets its roads', async () => {
  const spots = layout(0.69);
  const pending = drawnAtOnce(scene, spots, R).routing!;
  let posted: CrossRouting | undefined;
  const answering: RoadWorker = {
    onmessage: null, onerror: null, terminate: () => {},
    postMessage(routing) { posted = routing; queueMicrotask(() => answering.onmessage!({ data: answerRouting(structuredClone(routing)) })); },
  };
  const page: RoadRouter = () => assert.fail('the page routes nothing while its worker answers');
  const network = await routeInWorker(() => answering, page)(pending.routing, new AbortController().signal);
  assert.deepEqual(posted, pending.routing, 'the worker is posted the routing');
  const { islands, edges, seed, tuning } = pending.routing;
  const onThePage = routeTrails(islands, edges, seed, tuning);
  assert.ok(onThePage.segments.length > 0);
  assert.deepEqual(network, onThePage, 'and answers the roads routing on the page would');

  const missing: RoadWorker = { onmessage: null, onerror: null, terminate: () => {}, postMessage() { queueMicrotask(() => missing.onerror!({})); } };
  let routedOnThePage = 0;
  const fallback: RoadRouter = async routing => { routedOnThePage++; return (answerRouting(routing) as { network: TrailNetwork }).network; };
  assert.deepEqual(await routeInWorker(() => missing, fallback)(pending.routing, new AbortController().signal), onThePage);
  await routeInWorker(() => { throw new Error('no workers here'); }, fallback)(pending.routing, new AbortController().signal);
  assert.equal(routedOnThePage, 2, 'a worker that fails to load, or to start, leaves the routing to the page');
});

test('6.21 a routing that fails leaves the islands on show with the notice that roads could not be drawn', async () => {
  const spots = layout(0.71);
  const pending = drawnAtOnce(scene, spots, R).routing!;
  const failing: RoadRouter = async () => { throw new Error('the router gave up'); };
  const drawing = (await routedDrawing(scene, spots, R, pending, failing, new AbortController().signal))!;
  assert.deepEqual([...drawing.plan.plates.keys()], ['a', 'b']);
  assert.equal(drawing.plan.segments.length, 0);
  assert.match(drawing.issue ?? '', /the router gave up/);
});
