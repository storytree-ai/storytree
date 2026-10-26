import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { routeTrails, type TrailNetwork } from '../core/routing.js';
import { planetPathwayDrawing, type CrossRouting } from './pathways.js';
import { drawnAtOnce, routedDrawing, routeInWorker, type RoadRouter, type RoadWorker } from './road-routing.js';
import { answerRouting } from './road-worker.js';
import { roadSegmentWindows } from './growth.js';
import { liveRoadProgress, liveRoadsGrowing, nextLiveRoads } from './live-roads.js';

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

test('4.21 a layout draws every island before its roads are routed, then the same roads routing on the page draws', async () => {
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

test('4.21 a layout is routed once: drawn again with nothing moved, its roads are drawn at once', async () => {
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

test('4.21 a routing overtaken by a new layout draws nothing, and its worker is stopped', async () => {
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

test('4.21 a road worker routes the roads off the page; a page whose worker cannot load still gets its roads, and the failure is written to the console', async t => {
  const logged = t.mock.method(console, 'error', () => {});
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
  assert.deepEqual(logged.mock.calls.map(call => call.arguments[0]), [
    'forest-world planet: the road worker failed to load; routing on the page', 'forest-world planet: the road worker could not start; routing on the page'], 'so app.log');
  assert.equal((logged.mock.calls[1]!.arguments[1] as Error).message, 'no workers here');
});

test('4.21 a routing that fails leaves the islands on show with the notice that roads could not be drawn, and writes it to the console', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const spots = layout(0.71);
  const pending = drawnAtOnce(scene, spots, R).routing!;
  const failing: RoadRouter = async () => { throw new Error('the router gave up'); };
  const drawing = (await routedDrawing(scene, spots, R, pending, failing, new AbortController().signal))!;
  assert.deepEqual([...drawing.plan.plates.keys()], ['a', 'b']);
  assert.equal(drawing.plan.segments.length, 0);
  assert.match(drawing.issue ?? '', /the router gave up/);
  assert.deepEqual(logged.mock.calls.map(call => [call.arguments[0], (call.arguments[1] as Error).message]),
    [['forest-world planet: the roads could not be drawn', 'the router gave up']], 'once, so app.log');
});

test('4.21 a dependency added with no island moved keeps every road on show while the new one is routed', async () => {
  const spots = layout(0.73);
  const one: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }] };
  const { router, asked } = heldRouter();
  const first = routedDrawing(one, spots, R, drawnAtOnce(one, spots, R).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  const added = drawnAtOnce(scene, layout(0.73), R, { spots, radius: R, drawing: drawn });
  assert.ok(added.routing, 'the added dependency waits on a routing');
  assert.equal(roads(added.drawing), roads(drawn), 'the roads already drawn stay on show meanwhile');
  const moved = drawnAtOnce(scene, layout(0.75), R, { spots, radius: R, drawing: drawn });
  assert.equal(moved.drawing.plan.segments.length, 0, 'roads drawn for islands that have since moved are not');
});

test('4.21 while a moved layout\'s roads are routed, a live globe forgets no road it drew, and draws on only the new one', async () => {
  const one: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }] };
  const { router, asked } = heldRouter();
  const before = drawnAtOnce(one, layout(0.77), R);
  const routedBefore = routedDrawing(one, layout(0.77), R, before.routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await routedBefore)!;
  const arrived = nextLiveRoads(new Map(), drawn.plan, 0);
  // A dependency is added and the globe is laid out again: its islands move, so nothing can be kept on show.
  const moved = drawnAtOnce(scene, layout(0.79), R, { spots: layout(0.77), radius: R, drawing: drawn });
  assert.equal(moved.drawing.plan.edges.length, 0);
  assert.equal(nextLiveRoads(arrived, moved.drawing.plan, 0, true).size, 0, 'a road still drawing when its roads were taken away draws on afresh');
  const waiting = nextLiveRoads(arrived, moved.drawing.plan, 5, true);
  assert.equal(waiting, arrived, 'the roads drawn are kept while the new ones are routed');
  const routing = routedDrawing(scene, layout(0.79), R, moved.routing!, router, new AbortController().signal);
  asked[1]!.answer();
  const after = nextLiveRoads(waiting, (await routing)!.plan, 5);
  assert.equal(after.get('b1->a1'), arrived.get('b1->a1'), 'the road drawn before keeps its arrival');
  assert.equal(after.get('b2->a2')?.start, 5, 'only the added road arrives now');
});

test('4.21 a road whose spans an earlier road already drew whole is kept while a moved layout is routed, so it is not drawn on again', async () => {
  // Two links between the same islands share one span: the later arrival is drawn whole by the earlier one's window
  // while its own time still runs. Forgetting it there regrew its spans from nothing once routed (3.35 on macOS CI, run 39945705905).
  const one: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }] };
  const { router, asked } = heldRouter();
  const routedOne = routedDrawing(one, layout(0.81), R, drawnAtOnce(one, layout(0.81), R).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const routedBoth = routedDrawing(scene, layout(0.81), R, drawnAtOnce(scene, layout(0.81), R).routing!, router, new AbortController().signal);
  asked[1]!.answer();
  const drawn = (await routedBoth)!;
  assert.deepEqual(drawn.plan.segments.map(segment => segment.links.length), [2], 'both roads run on one shared span');
  const first = nextLiveRoads(new Map(), (await routedOne)!.plan, 0);
  const book = nextLiveRoads(first, drawn.plan, 0.2);
  const later = book.get('b2->a2')!, now = first.get('b1->a1')!.seconds + 0.01;
  assert.ok(now < later.start + later.seconds, 'the later road\'s own time still runs');
  assert.equal(liveRoadProgress(roadSegmentWindows(drawn.plan, book).get(drawn.plan.segments[0]!.id), now, false), 1, 'its one span is drawn whole');
  const moved = drawnAtOnce(scene, layout(0.83), R, { spots: layout(0.81), radius: R, drawing: drawn });
  const waiting = nextLiveRoads(book, moved.drawing.plan, now, true, drawn.plan);
  assert.deepEqual([...waiting.keys()].sort(), ['b1->a1', 'b2->a2'], 'no road drawn whole is forgotten');
  const routing = routedDrawing(scene, layout(0.83), R, moved.routing!, router, new AbortController().signal);
  asked[2]!.answer();
  const rerouted = (await routing)!.plan, after = nextLiveRoads(waiting, rerouted, now);
  const windows = roadSegmentWindows(rerouted, after);
  for (const segment of rerouted.segments) assert.equal(liveRoadProgress(windows.get(segment.id), now, false), 1, 'every rerouted span is drawn whole');
  assert.equal(liveRoadsGrowing(after, now, false), false);
});
