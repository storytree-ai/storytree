/** Capability 11 · The planet. Roads routed off the page's main thread (Map view 11.21, ADR-1001 D2).
 * Routing the roads between islands takes seconds, and while the page routes it answers no hover, drag or click. So
 * a layout draws its islands at once and its roads when they are routed: in a worker where the page offers one,
 * otherwise on the page once the islands are drawn. What is routed does not change, only when. */
import { routeTrails, type TrailNetwork } from '../core/routing.js';
import type { ForestScene } from '../scene.js';
import { islandsOnly, keepRoutes, pathwayRouting, planetPathwayDrawing, type CrossRouting, type PathwayDrawing } from './pathways.js';
import type { PlanetSpot } from './planet.js';

/** Routes a drawing's roads between islands somewhere, answering the network `routeTrails` would. An aborted signal
 * means the layout was overtaken: the router may stop, and what it answers is never drawn. */
export type RoadRouter = (routing: CrossRouting, signal: AbortSignal) => Promise<TrailNetwork>;

/** A page that offers a road worker names its script in this meta tag: `<meta name="storytree-road-worker" content="road-worker.js">`. */
export const ROAD_WORKER_META = 'storytree-road-worker';

/** What a layout draws at once, and the routing its roads still wait on, if any. A layout whose routes are kept from
 * the last routing (an island's health changed, say, and nothing moved) draws its roads at once. One whose islands
 * stand where `before` drew them (a dependency was added, say) keeps `before`'s roads on show until its own are routed,
 * so a road already drawn is not drawn on again. */
export function drawnAtOnce(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number,
  before?: { spots: ReadonlyMap<string, PlanetSpot>; radius: number; drawing: PathwayDrawing }): {
  drawing: PathwayDrawing; routing: { key: string; routing: CrossRouting } | undefined;
} {
  const routing = pathwayRouting(scene, spots, radius);
  if (routing === undefined) return { drawing: planetPathwayDrawing(scene, spots, radius), routing };
  const islands = islandsOnly(scene);
  if (before === undefined || before.radius !== radius || !samePlaces(before.spots, spots)) return { drawing: islands, routing };
  const { segments, edges, docks } = before.drawing.plan;
  return { drawing: { plan: { ...islands.plan, segments, edges, docks }, issue: before.drawing.issue }, routing };
}

function samePlaces(a: ReadonlyMap<string, PlanetSpot>, b: ReadonlyMap<string, PlanetSpot>): boolean {
  return a === b || (a.size === b.size && [...b].every(([story, spot]) => {
    const old = a.get(story);
    return old !== undefined && old.x === spot.x && old.y === spot.y && old.z === spot.z;
  }));
}

/** The drawing with its roads, once `router` has routed them; undefined when `signal` aborts first, so an overtaken
 * layout draws nothing. A router that fails leaves the islands with the drawing's notice, as a failed routing always has. */
export async function routedDrawing(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number,
  pending: { key: string; routing: CrossRouting }, router: RoadRouter, signal: AbortSignal): Promise<PathwayDrawing | undefined> {
  let network: TrailNetwork;
  try {
    network = await router(pending.routing, signal);
  } catch (error) {
    return signal.aborted ? undefined : planetPathwayDrawing(scene, spots, radius, () => { throw error; });
  }
  if (signal.aborted) return undefined;
  keepRoutes(pending.key, network);
  return planetPathwayDrawing(scene, spots, radius);
}

/** Routes on the page itself, once the islands have had a frame to be drawn: for a host that offers no worker. */
export const routeOnThePage: RoadRouter = async (routing, signal) => {
  await new Promise<void>(resolve => (globalThis.requestAnimationFrame ?? setTimeout)(() => setTimeout(resolve, 0)));
  if (signal.aborted) throw signal.reason;
  return routeTrails(routing.islands, routing.edges, routing.seed, routing.tuning);
};

/** The answer a road worker posts back: the network, or why routing failed. */
export type RoadWorkerAnswer = { network: TrailNetwork } | { error: string };

/** The part of a Worker the router uses. */
export interface RoadWorker {
  postMessage(message: CrossRouting): void;
  terminate(): void;
  onmessage: ((event: { data: RoadWorkerAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Routes in a fresh worker from `start`, ended when it answers or its layout is overtaken. A worker that cannot start
 * or fails to load (a host without the script) leaves the routing to `fallback`; one that answers an error fails it. */
export function routeInWorker(start: () => RoadWorker, fallback: RoadRouter = routeOnThePage): RoadRouter {
  return (routing, signal) => {
    let worker: RoadWorker;
    try {
      worker = start();
    } catch {
      return fallback(routing, signal);
    }
    return new Promise<TrailNetwork>((resolve, reject) => {
      const end = () => { worker.terminate(); signal.removeEventListener('abort', overtaken); };
      const overtaken = () => { end(); reject(signal.reason); };
      signal.addEventListener('abort', overtaken);
      worker.onmessage = ({ data }) => {
        end();
        if ('network' in data) resolve(data.network);
        else reject(new Error(data.error));
      };
      worker.onerror = () => { end(); fallback(routing, signal).then(resolve, reject); };
      worker.postMessage(routing);
    });
  };
}

/** The router a page offers: its road worker when it names one (ROAD_WORKER_META), else routing on the page. */
export function pageRoadRouter(page: Pick<Document, 'querySelector'> | undefined = globalThis.document): RoadRouter {
  const script = page?.querySelector(`meta[name="${ROAD_WORKER_META}"]`)?.getAttribute('content');
  return script ? routeInWorker(() => new Worker(script) as unknown as RoadWorker) : routeOnThePage;
}
