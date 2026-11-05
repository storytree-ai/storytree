/** Capability 4 · The planet. Roads routed off the page's main thread (The drawing engine 4.21, ADR-1001 D2).
 * Routing the roads between islands takes seconds, and while the page routes it answers no hover, drag or click. So
 * a layout draws its islands at once and its roads when they are routed: in a worker where the page offers one,
 * otherwise on the page once the islands are drawn. What is routed does not change, only when. */
import type { ForestScene } from '../scene.js';
import type { CoastPoint } from '../coast-clip.js';
import { islandsOnly, keepRoutes, pathwayRouting, planetPathwayDrawing, routePlanet, routesKept, type CrossRouting, type PathwayDrawing, type PlanetNetworks, type PlanetPathways } from './pathways.js';
import type { PlanetSpot } from './planet.js';

/** Routes a drawing's roads and lanes between islands somewhere, answering the networks `routePlanet` would. An aborted signal
 * means the layout was overtaken: the router may stop, and what it answers is never drawn. */
export type RoadRouter = (routing: CrossRouting, signal: AbortSignal) => Promise<PlanetNetworks>;

/** A page that offers a road worker names its script in this meta tag: `<meta name="storytree-road-worker" content="road-worker.js">`. */
export const ROAD_WORKER_META = 'storytree-road-worker';

/** What a layout draws at once, and the routing its roads still wait on, if any. A layout whose routes are kept from
 * the last routing (an island's health changed, say, and nothing moved, or every island moved by one shift) draws its
 * roads at once. Any other layout at `before`'s radius (a dependency was added, or an island grew and the rest moved)
 * keeps `before`'s roads on show, as they were drawn, until its own are routed (the drawing engine 4.38), so the map is
 * never left without roads and a road already drawn is not drawn on again. At another radius the old roads would float
 * or sink, so it shows its islands only. */
export function drawnAtOnce(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number,
  before?: { spots: ReadonlyMap<string, PlanetSpot>; radius: number; drawing: PathwayDrawing }): {
  drawing: PathwayDrawing; routing: { key: string; routing: CrossRouting } | undefined;
} {
  const routing = pathwayRouting(scene, spots, radius);
  if (routing === undefined) return { drawing: planetPathwayDrawing(scene, spots, radius), routing };
  const islands = islandsOnly(scene);
  if (before === undefined || before.radius !== radius) return { drawing: islands, routing };
  const { segments, edges, docks, plumbing, lanes } = before.drawing.plan;
  return { drawing: { plan: { ...islands.plan, segments, edges, docks, lanes, ...plumbing ? { plumbing } : {} }, issue: before.drawing.issue }, routing };
}

/** The drawing with its roads, once `router` has routed them; undefined when `signal` aborts first, so an overtaken
 * layout draws nothing. A router that fails leaves the islands with the drawing's notice, as a failed routing always has. */
export async function routedDrawing(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number,
  pending: { key: string; routing: CrossRouting }, router: RoadRouter, signal: AbortSignal): Promise<PathwayDrawing | undefined> {
  let network: PlanetNetworks;
  try {
    network = await router(pending.routing, signal);
  } catch (error) {
    return signal.aborted ? undefined : planetPathwayDrawing(scene, spots, radius, () => { throw error; });
  }
  if (signal.aborted) return undefined;
  keepRoutes(pending, network);
  return planetPathwayDrawing(scene, spots, radius);
}

/** A layout to draw, with the routing its roads wait on (`drawnAtOnce`'s), if any. */
export interface RoadLayout {
  scene: ForestScene; spots: ReadonlyMap<string, PlanetSpot>; radius: number;
  routing: { key: string; routing: CrossRouting } | undefined;
}

/** Routes each layout shown's roads and hands `draw` the drawing with them (the drawing engine 4.39). A layout with the
 * same routing key as the one in flight (a new scene with nothing moved, say) leaves that routing running, and its
 * answer is drawn for the latest layout shown; a layout with another key overtakes it, and one waiting on nothing ends
 * it. A layout whose routing was answered since it was laid out is drawn at once. */
export function roadsWhenRouted<L extends RoadLayout>(router: RoadRouter, draw: (layout: L, drawing: PathwayDrawing) => void): { show(layout: L): void; stop(): void } {
  let inFlight: { key: string; overtaken: AbortController } | undefined;
  let latest: L | undefined;
  const stop = () => { inFlight?.overtaken.abort(); inFlight = undefined; };
  return {
    show(layout) {
      latest = layout;
      const pending = layout.routing;
      if (pending !== undefined && inFlight?.key === pending.key) return;
      stop();
      if (pending === undefined) return;
      if (routesKept(pending.key)) { draw(layout, planetPathwayDrawing(layout.scene, layout.spots, layout.radius)); return; }
      const overtaken = new AbortController(), { signal } = overtaken;
      inFlight = { key: pending.key, overtaken };
      void router(pending.routing, signal).then(network => {
        if (signal.aborted) return;
        inFlight = undefined;
        keepRoutes(pending, network);
        const shown = latest!;
        draw(shown, planetPathwayDrawing(shown.scene, shown.spots, shown.radius));
      }, error => {
        if (signal.aborted) return;
        inFlight = undefined;
        const shown = latest!;
        draw(shown, planetPathwayDrawing(shown.scene, shown.spots, shown.radius, () => { throw error; }));
      });
    },
    stop,
  };
}

/** Routes on the page itself, once the islands have had a frame to be drawn: for a host that offers no worker. */
export const routeOnThePage: RoadRouter = async (routing, signal) => {
  await new Promise<void>(resolve => (globalThis.requestAnimationFrame ?? setTimeout)(() => setTimeout(resolve, 0)));
  if (signal.aborted) throw signal.reason;
  return routePlanet(routing);
};

/** The answer a road worker posts back: the network, or why routing failed. */
export type RoadWorkerAnswer = { network: PlanetNetworks } | { error: string };

/** The part of a Worker the router uses. */
export interface RoadWorker {
  postMessage(message: CrossRouting): void;
  terminate(): void;
  onmessage: ((event: { data: RoadWorkerAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Routes in a fresh worker from `start`, ended when it answers or its layout is overtaken. A worker that cannot start
 * or fails to load (a host without the script) leaves the routing to `fallback`, and is logged; one that answers an error fails it. */
export function routeInWorker(start: () => RoadWorker, fallback: RoadRouter = routeOnThePage): RoadRouter {
  return (routing, signal) => {
    let worker: RoadWorker;
    try {
      worker = start();
    } catch (error) {
      console.error('forest-world planet: the road worker could not start; routing on the page', error);
      return fallback(routing, signal);
    }
    return new Promise<PlanetNetworks>((resolve, reject) => {
      const end = () => { worker.terminate(); signal.removeEventListener('abort', overtaken); };
      const overtaken = () => { end(); reject(signal.reason); };
      signal.addEventListener('abort', overtaken);
      worker.onmessage = ({ data }) => {
        end();
        if ('network' in data) resolve(data.network);
        else reject(new Error(data.error));
      };
      worker.onerror = event => {
        console.error('forest-world planet: the road worker failed to load; routing on the page', event);
        end();
        fallback(routing, signal).then(resolve, reject);
      };
      worker.postMessage(routing);
    });
  };
}

/** The router a page offers: its road worker when it names one (ROAD_WORKER_META), else routing on the page. */
export function pageRoadRouter(page: Pick<Document, 'querySelector'> | undefined = globalThis.document): RoadRouter {
  const script = page?.querySelector(`meta[name="${ROAD_WORKER_META}"]`)?.getAttribute('content');
  return script ? routeInWorker(() => new Worker(script) as unknown as RoadWorker) : routeOnThePage;
}

/** A dock on an island, in the island's own ground coordinates, with the links (`from->to`) its roads carry. */
export interface IslandDock { local: CoastPoint; links: readonly string[] }

/** Each island's docks, by story: where its roads between islands come ashore. Undefined while the drawing still
 * waits on its first routing, so a host can tell an island with no docks from one whose docks are not yet known. */
export function islandDocks(plan: PlanetPathways, routing: boolean): ReadonlyMap<string, readonly IslandDock[]> | undefined {
  if (routing && plan.docks.length === 0) return undefined;
  const out = new Map<string, IslandDock[]>();
  for (const dock of plan.docks) (out.get(dock.story) ?? out.set(dock.story, []).get(dock.story)!).push({ local: dock.local, links: dock.links });
  return out;
}
