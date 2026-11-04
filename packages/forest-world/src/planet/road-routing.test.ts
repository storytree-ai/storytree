import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { routeTrails, type TrailNetwork } from '../core/routing.js';
import { planetPathwayDrawing, type CrossRouting } from './pathways.js';
import { drawnAtOnce, islandDocks, roadsWhenRouted, routedDrawing, routeInWorker, type RoadRouter, type RoadWorker } from './road-routing.js';
import { SHEET_RADIUS, sheetSpot } from './sheet.js';
import { plateTransform, type PlanetSpot } from './planet.js';
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
});

test('4.38 a layout whose islands moved relative to each other keeps the roads on show, as they were drawn, until its own are routed', async () => {
  const spots = layout(0.75);
  const { router, asked } = heldRouter();
  const first = routedDrawing(scene, spots, R, drawnAtOnce(scene, spots, R).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  const moved = drawnAtOnce(scene, layout(0.85), R, { spots, radius: R, drawing: drawn });
  assert.ok(moved.routing, 'the moved layout waits on its own routing');
  assert.equal(roads(moved.drawing), roads(drawn), 'the roads drawn before stay on show, as they were');
  const again = drawnAtOnce(scene, layout(0.87), R, { spots: layout(0.85), radius: R, drawing: moved.drawing });
  assert.equal(roads(again.drawing), roads(drawn), 'and through a second move before the first is routed');
  const rescaled = drawnAtOnce(scene, layout(0.85), R * 2, { spots, radius: R, drawing: drawn });
  assert.equal(rescaled.drawing.plan.segments.length, 0, 'roads at another radius would float or sink, so a new radius shows islands only');
});

/** The two islands on the desktop's glass sheet, `shift` along it from where they first stood. */
const onSheet = (shift: { x: number; y: number }, apart = 60) => new Map([['a', sheetSpot({ x: apart + shift.x, y: shift.y })], ['b', sheetSpot({ x: -apart + shift.x, y: shift.y })]]);
const dockOffsets = (plan: { docks: { story: string; point: { x: number; y: number; z: number } }[] }, spots: ReadonlyMap<string, PlanetSpot>) =>
  plan.docks.map(dock => {
    const [x, y, z] = plateTransform(spots.get(dock.story)!, SHEET_RADIUS).position;
    return [dock.story, Math.hypot(dock.point.x - x, dock.point.y - y, dock.point.z - z)] as const;
  });

test('4.37 a layout whose islands all moved by one shift draws the roads at once, moved with them, routes nothing, and draws none of them on again', async () => {
  const spots = onSheet({ x: 0, y: 0 });
  const { router, asked } = heldRouter();
  const first = routedDrawing(scene, spots, SHEET_RADIUS, drawnAtOnce(scene, spots, SHEET_RADIUS).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  assert.ok(drawn.plan.segments.length > 0);
  const shifted = onSheet({ x: 23, y: -11 });
  const now = drawnAtOnce(scene, shifted, SHEET_RADIUS, { spots, radius: SHEET_RADIUS, drawing: drawn });
  assert.equal(now.routing, undefined, 'nothing waits on a routing');
  assert.equal(asked.length, 1, 'the router was asked once');
  assert.equal(now.drawing.plan.segments.length, drawn.plan.segments.length, 'the roads are drawn at once');
  assert.deepEqual(now.drawing.plan.edges, drawn.plan.edges);
  const before = dockOffsets(drawn.plan, spots), after = dockOffsets(now.drawing.plan, shifted);
  assert.equal(after.length, before.length);
  after.forEach(([story, reach], i) => {
    assert.equal(story, before[i]![0]);
    assert.ok(Math.abs(reach - before[i]![1]) < 0.1, `each dock still stands on its island's coast (${reach} against ${before[i]![1]})`);
  });
  const arrived = nextLiveRoads(new Map(), drawn.plan, 0);
  assert.equal(nextLiveRoads(arrived, now.drawing.plan, 5), arrived, 'a live globe draws none of the moved roads on again');
  const apart = drawnAtOnce(scene, onSheet({ x: 23, y: -11 }, 90), SHEET_RADIUS, { spots: shifted, radius: SHEET_RADIUS, drawing: now.drawing });
  assert.ok(apart.routing, 'islands moved apart are routed afresh');
});

test('4.39 a routing in flight is kept while new layouts with the same routing key arrive, and its answer is drawn for the latest', async () => {
  const spots = layout(0.89);
  const { router, asked } = heldRouter();
  const drawn: { layout: unknown; drawing: { plan: { segments: unknown[]; edges: unknown[]; docks: unknown[] } } }[] = [];
  const roadsOf = roadsWhenRouted(router, (layout, drawing) => { drawn.push({ layout, drawing }); });
  const first = { scene, spots, radius: R, routing: drawnAtOnce(scene, spots, R).routing };
  roadsOf.show(first);
  // An island's health changes while its roads are routed: a new scene, the same routing.
  const healthier: ForestScene = { ...scene, islands: [{ ...scene.islands[0]!, trees: scene.islands[0]!.trees.map(tree => ({ ...tree, status: 'unhealthy' as const })) }, scene.islands[1]!] };
  const second = { scene: healthier, spots: layout(0.89), radius: R, routing: drawnAtOnce(healthier, layout(0.89), R).routing };
  assert.equal(second.routing?.key, first.routing?.key);
  roadsOf.show(second);
  assert.equal(asked.length, 1, 'the routing in flight is not started over');
  assert.equal(asked[0]!.signal.aborted, false, 'nor aborted');
  asked[0]!.answer();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0]!.layout, second, 'its answer is drawn for the latest layout');
  assert.ok(drawn[0]!.drawing.plan.segments.length > 0);
  // A layout computed before the answer landed, shown after it: its roads are drawn at once.
  const third = { scene, spots, radius: R, routing: first.routing };
  roadsOf.show(third);
  assert.equal(asked.length, 1, 'a routing already answered is not asked again');
  assert.equal(drawn.at(-1)!.layout, third);
  assert.equal(roads(drawn.at(-1)!.drawing), roads(drawn[0]!.drawing));
  // A new key overtakes the routing in flight.
  const fourth = { scene, spots: layout(0.91), radius: R, routing: drawnAtOnce(scene, layout(0.91), R).routing };
  roadsOf.show(fourth);
  const fifth = { scene, spots: layout(0.93), radius: R, routing: drawnAtOnce(scene, layout(0.93), R).routing };
  roadsOf.show(fifth);
  assert.equal(asked.length, 3);
  assert.equal(asked[1]!.signal.aborted, true, 'a routing for another key is overtaken');
  roadsOf.stop();
  assert.equal(asked[2]!.signal.aborted, true, 'and stopping ends the one in flight');
});

test('4.21 while a moved layout\'s roads are routed, a live globe forgets no road it drew, and draws on only the new one', async () => {
  const one: ForestScene = { ...scene, links: [{ from: 'b1', to: 'a1' }] };
  const { router, asked } = heldRouter();
  const before = drawnAtOnce(one, layout(0.77), R);
  const routedBefore = routedDrawing(one, layout(0.77), R, before.routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await routedBefore)!;
  const arrived = nextLiveRoads(new Map(), drawn.plan, 0);
  // A dependency is added and the globe is laid out again: its islands move relative to each other.
  const moved = drawnAtOnce(scene, layout(0.79), R, { spots: layout(0.77), radius: R, drawing: drawn });
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

test('4.36 each island is handed the docks its roads come ashore at, with the links each carries, once its roads are routed', async () => {
  const spots = layout(0.65);
  const now = drawnAtOnce(scene, spots, R);
  assert.equal(islandDocks(now.drawing.plan, true), undefined, 'none while the first routing is pending');
  const { router, asked } = heldRouter();
  const drawing = routedDrawing(scene, spots, R, now.routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const docks = islandDocks((await drawing)!.plan, false)!;
  assert.deepEqual([...docks.get('a') ?? []].flatMap(dock => dock.links).sort(), ['b1->a1', 'b2->a2']);
  assert.deepEqual([...docks.get('b') ?? []].flatMap(dock => dock.links).sort(), ['b1->a1', 'b2->a2']);
  for (const dock of docks.get('a')!) assert.ok(Number.isFinite(dock.local.x) && Number.isFinite(dock.local.z), 'in the island\'s own coordinates');
});
