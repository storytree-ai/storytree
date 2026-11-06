import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForestScene, Island } from '../scene.js';
import { planetPathwayDrawing, routePlanet, type CrossRouting, type PathwayDrawing, type PlanetNetworks } from './pathways.js';
import { drawnAtOnce, islandDocks, roadsWhenRouted, routedDrawing, routeInWorker, type RoadRouter, type RoadWorker } from './road-routing.js';
import { SHEET_RADIUS, sheetSpot } from './sheet.js';
import { plateTransform, type PlanetSpot } from './planet.js';
import { answerRouting } from './road-worker.js';

const R = 218;
const island = (story: string, capabilities: string[]): Island => ({
  story, title: story, x: 0, z: 0, key: story,
  trees: capabilities.map((capability, i) => ({ capability, form: 'green', status: 'healthy', contracts: 1, x: i, z: 0, scale: 1, turn: 0 })),
});
const scene: ForestScene = { islands: [island('a', ['a1', 'a2']), island('b', ['b1', 'b2'])], links: [{ from: 'b1', to: 'a1' }, { from: 'b2', to: 'a2' }] };
/** The two islands `apart` radians apart: each angle is its own layout. */
const layout = (apart: number) => new Map([['a', { x: R * Math.sin(apart / 2), y: 0, z: R * Math.cos(apart / 2) }], ['b', { x: -R * Math.sin(apart / 2), y: 0, z: R * Math.cos(apart / 2) }]]);
const lanes = (drawing: PathwayDrawing) => JSON.stringify(drawing.plan.lanes);

/** A router that answers only when told to, as a worker does, counting what it is asked. */
function heldRouter() {
  const asked: { routing: CrossRouting; signal: AbortSignal; answer: () => void }[] = [];
  const router: RoadRouter = (routing, signal) => new Promise<PlanetNetworks>((resolve, reject) => {
    asked.push({ routing, signal, answer: () => { const reply = answerRouting(routing); 'network' in reply ? resolve(reply.network) : reject(new Error(reply.error)); } });
  });
  return { router, asked };
}

test('4.21 a layout draws every island before its lanes are routed, then the same lanes routing on the page draws', async () => {
  const spots = layout(0.61);
  const now = drawnAtOnce(scene, spots, R);
  assert.ok(now.routing, 'the lanes wait on a routing');
  assert.deepEqual([...now.drawing.plan.plates.keys()], ['a', 'b'], 'both islands are on show at once');
  assert.equal(now.drawing.plan.lanes.segments.length, 0, 'no lane is routed before the routing answers');
  const { router, asked } = heldRouter();
  const drawing = routedDrawing(scene, spots, R, now.routing, router, new AbortController().signal);
  asked[0]!.answer();
  const routed = (await drawing)!;
  assert.ok(routed.plan.lanes.segments.length > 0);
  assert.equal(routed.plan.plates.get('a'), now.drawing.plan.plates.get('a'), 'the islands drawn at once are kept, not drawn again');
  // The page routing the same layout afresh, once another layout has been routed since.
  planetPathwayDrawing(scene, layout(0.67), R);
  assert.equal(lanes(planetPathwayDrawing(scene, spots, R)), lanes(routed), 'the lanes are the ones routing on the page draws');
});

test('4.21 a layout is routed once: drawn again with nothing moved, its lanes are drawn at once', async () => {
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
  assert.equal(lanes(again.drawing), lanes(routed), 'its lanes are drawn at once');
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

test('4.21 a road worker routes the lanes off the page; a page whose worker cannot load still gets its lanes, and the failure is written to the console', async t => {
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
  const onThePage = routePlanet(pending.routing);
  assert.ok(onThePage.lanes.segments.length > 0);
  assert.deepEqual(network, onThePage, 'and answers the lanes routing on the page would');

  const missing: RoadWorker = { onmessage: null, onerror: null, terminate: () => {}, postMessage() { queueMicrotask(() => missing.onerror!({})); } };
  let routedOnThePage = 0;
  const fallback: RoadRouter = async routing => { routedOnThePage++; return (answerRouting(routing) as { network: PlanetNetworks }).network; };
  assert.deepEqual(await routeInWorker(() => missing, fallback)(pending.routing, new AbortController().signal), onThePage);
  await routeInWorker(() => { throw new Error('no workers here'); }, fallback)(pending.routing, new AbortController().signal);
  assert.equal(routedOnThePage, 2, 'a worker that fails to load, or to start, leaves the routing to the page');
  assert.deepEqual(logged.mock.calls.map(call => call.arguments[0]), [
    'forest-world planet: the road worker failed to load; routing on the page', 'forest-world planet: the road worker could not start; routing on the page'], 'so app.log');
  assert.equal((logged.mock.calls[1]!.arguments[1] as Error).message, 'no workers here');
});

test('4.21 a routing that fails leaves the islands on show with the notice that lanes could not be drawn, and writes it to the console', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const spots = layout(0.71);
  const pending = drawnAtOnce(scene, spots, R).routing!;
  const failing: RoadRouter = async () => { throw new Error('the router gave up'); };
  const drawing = (await routedDrawing(scene, spots, R, pending, failing, new AbortController().signal))!;
  assert.deepEqual([...drawing.plan.plates.keys()], ['a', 'b']);
  assert.equal(drawing.plan.lanes.segments.length, 0);
  assert.match(drawing.issue ?? '', /the router gave up/);
  assert.deepEqual(logged.mock.calls.map(call => [call.arguments[0], (call.arguments[1] as Error).message]),
    [['forest-world planet: the lanes could not be drawn', 'the router gave up']], 'once, so app.log');
});

test('4.21 a dependency added with no island moved is drawn at once between islands already joined, and keeps every lane while one to a new pair is routed', async () => {
  const spots = new Map([...layout(0.73), ['c', { x: 0, y: R * Math.sin(0.4), z: R * Math.cos(0.4) }]]);
  const islands = [...scene.islands, island('c', ['c1'])];
  const one: ForestScene = { islands, links: [{ from: 'b1', to: 'a1' }] };
  const { router, asked } = heldRouter();
  const first = routedDrawing(one, spots, R, drawnAtOnce(one, spots, R).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  // Lanes are routed by pair of islands: a second link between a and b rides the route they already have.
  const same = drawnAtOnce({ islands, links: scene.links! }, spots, R, { spots, radius: R, drawing: drawn });
  assert.equal(same.routing, undefined, 'nothing waits on a routing');
  assert.deepEqual(same.drawing.plan.lanes.edges.map(edge => `${edge.from}->${edge.to}`), ['b1->a1', 'b2->a2'], 'both links have their lane at once');
  const added = drawnAtOnce({ islands, links: [...scene.links!, { from: 'c1', to: 'a1' }] }, spots, R, { spots, radius: R, drawing: drawn });
  assert.ok(added.routing, 'a dependency joining a new pair of islands waits on a routing');
  assert.equal(lanes(added.drawing), lanes(drawn), 'the lanes already routed stay meanwhile');
  assert.equal(asked.length, 1, 'the router was asked once');
});

test('4.38 a layout whose islands moved relative to each other keeps the lanes, as they were routed, until its own are routed', async () => {
  const spots = layout(0.75);
  const { router, asked } = heldRouter();
  const first = routedDrawing(scene, spots, R, drawnAtOnce(scene, spots, R).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  const moved = drawnAtOnce(scene, layout(0.85), R, { spots, radius: R, drawing: drawn });
  assert.ok(moved.routing, 'the moved layout waits on its own routing');
  assert.equal(lanes(moved.drawing), lanes(drawn), 'the lanes routed before stay, as they were');
  const again = drawnAtOnce(scene, layout(0.87), R, { spots: layout(0.85), radius: R, drawing: moved.drawing });
  assert.equal(lanes(again.drawing), lanes(drawn), 'and through a second move before the first is routed');
  const rescaled = drawnAtOnce(scene, layout(0.85), R * 2, { spots, radius: R, drawing: drawn });
  assert.equal(rescaled.drawing.plan.lanes.segments.length, 0, 'lanes at another radius would float or sink, so a new radius shows islands only');
});

/** The two islands on the desktop's glass sheet, `shift` along it from where they first stood. */
const onSheet = (shift: { x: number; y: number }, apart = 60) => new Map([['a', sheetSpot({ x: apart + shift.x, y: shift.y })], ['b', sheetSpot({ x: -apart + shift.x, y: shift.y })]]);
const dockOffsets = (plan: { docks: { story: string; point: { x: number; y: number; z: number } }[] }, spots: ReadonlyMap<string, PlanetSpot>) =>
  plan.docks.map(dock => {
    const [x, y, z] = plateTransform(spots.get(dock.story)!, SHEET_RADIUS).position;
    return [dock.story, Math.hypot(dock.point.x - x, dock.point.y - y, dock.point.z - z)] as const;
  });

test('4.37 a layout whose islands all moved by one shift draws the lanes at once, moved with them, and routes nothing', async () => {
  const spots = onSheet({ x: 0, y: 0 });
  const { router, asked } = heldRouter();
  const first = routedDrawing(scene, spots, SHEET_RADIUS, drawnAtOnce(scene, spots, SHEET_RADIUS).routing!, router, new AbortController().signal);
  asked[0]!.answer();
  const drawn = (await first)!;
  assert.deepEqual(drawn.plan.lanes.edges.map(edge => `${edge.from}->${edge.to}`), ['b1->a1', 'b2->a2'], 'every link has its lane');
  const shifted = onSheet({ x: 23, y: -11 });
  const now = drawnAtOnce(scene, shifted, SHEET_RADIUS, { spots, radius: SHEET_RADIUS, drawing: drawn });
  assert.equal(now.routing, undefined, 'nothing waits on a routing');
  assert.equal(asked.length, 1, 'the router was asked once');
  assert.equal(now.drawing.plan.lanes.segments.length, drawn.plan.lanes.segments.length, 'the lanes are drawn at once');
  assert.deepEqual(now.drawing.plan.lanes.edges, drawn.plan.lanes.edges);
  const before = dockOffsets(drawn.plan.lanes, spots), after = dockOffsets(now.drawing.plan.lanes, shifted);
  assert.ok(after.length > 0 && after.length === before.length);
  after.forEach(([story, reach], i) => {
    assert.equal(story, before[i]![0]);
    assert.ok(Math.abs(reach - before[i]![1]) < 0.1, `each lane's dock still stands on its island's coast (${reach} against ${before[i]![1]})`);
  });
  const apart = drawnAtOnce(scene, onSheet({ x: 23, y: -11 }, 90), SHEET_RADIUS, { spots: shifted, radius: SHEET_RADIUS, drawing: now.drawing });
  assert.ok(apart.routing, 'islands moved apart are routed afresh');
});

test('4.39 a routing in flight is kept while new layouts with the same routing key arrive, and its answer is drawn for the latest', async () => {
  const spots = layout(0.89);
  const { router, asked } = heldRouter();
  const drawn: { layout: unknown; drawing: PathwayDrawing }[] = [];
  let answered!: () => void;
  const firstDraw = new Promise<void>(resolve => { answered = resolve; });
  const roadsOf = roadsWhenRouted(router, (layout, drawing) => { drawn.push({ layout, drawing }); answered(); });
  const first = { scene, spots, radius: R, routing: drawnAtOnce(scene, spots, R).routing };
  roadsOf.show(first);
  // An island's health changes while its lanes are routed: a new scene, the same routing.
  const healthier: ForestScene = { ...scene, islands: [{ ...scene.islands[0]!, trees: scene.islands[0]!.trees.map(tree => ({ ...tree, status: 'unhealthy' as const })) }, scene.islands[1]!] };
  const second = { scene: healthier, spots: layout(0.89), radius: R, routing: drawnAtOnce(healthier, layout(0.89), R).routing };
  assert.equal(second.routing?.key, first.routing?.key);
  roadsOf.show(second);
  assert.equal(asked.length, 1, 'the routing in flight is not started over');
  assert.equal(asked[0]!.signal.aborted, false, 'nor aborted');
  asked[0]!.answer();
  await firstDraw;
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0]!.layout, second, 'its answer is drawn for the latest layout');
  assert.deepEqual(drawn[0]!.drawing.plan.lanes.edges.map(edge => `${edge.from}->${edge.to}`), ['b1->a1', 'b2->a2'], 'with every link\'s lane');
  // A layout computed before the answer landed, shown after it: its lanes are drawn at once.
  const third = { scene, spots, radius: R, routing: first.routing };
  roadsOf.show(third);
  assert.equal(asked.length, 1, 'a routing already answered is not asked again');
  assert.equal(drawn.at(-1)!.layout, third);
  assert.equal(lanes(drawn.at(-1)!.drawing), lanes(drawn[0]!.drawing));
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

test('4.36 each island is handed the docks its lanes come ashore at, with the links each carries, once its lanes are routed', async () => {
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
