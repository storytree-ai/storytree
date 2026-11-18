// Capability 4 · The planet
import type { ForestScene } from '../scene.js';
import type { CoastPoint } from '../coast-clip.js';
import { islandsOnly, keepRoutes, pathwayRouting, planetPathwayDrawing, routePlanet, routesKept, type CrossRouting, type PathwayDrawing, type PlanetNetworks, type PlanetPathways } from './pathways.js';
import type { PlanetSpot } from './planet.js';

export type RoadRouter = (routing: CrossRouting, signal: AbortSignal) => Promise<PlanetNetworks>;

export const ROAD_WORKER_META = 'storytree-road-worker';

export function drawnAtOnce(scene: ForestScene, spots: ReadonlyMap<string, PlanetSpot>, radius: number,
  before?: { spots: ReadonlyMap<string, PlanetSpot>; radius: number; drawing: PathwayDrawing }): {
  drawing: PathwayDrawing; routing: { key: string; routing: CrossRouting } | undefined;
} {
  const routing = pathwayRouting(scene, spots, radius);
  if (routing === undefined) return { drawing: planetPathwayDrawing(scene, spots, radius), routing };
  const islands = islandsOnly(scene);
  if (before === undefined || before.radius !== radius) return { drawing: islands, routing };
  return { drawing: { plan: { ...islands.plan, lanes: before.drawing.plan.lanes }, issue: before.drawing.issue }, routing };
}

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

export interface RoadLayout {
  scene: ForestScene; spots: ReadonlyMap<string, PlanetSpot>; radius: number;
  routing: { key: string; routing: CrossRouting } | undefined;
}

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

export const routeOnThePage: RoadRouter = async (routing, signal) => {
  await new Promise<void>(resolve => (globalThis.requestAnimationFrame ?? setTimeout)(() => setTimeout(resolve, 0)));
  if (signal.aborted) throw signal.reason;
  return routePlanet(routing);
};

export type RoadWorkerAnswer = { network: PlanetNetworks } | { error: string };

export interface RoadWorker {
  postMessage(message: CrossRouting): void;
  terminate(): void;
  onmessage: ((event: { data: RoadWorkerAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

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

export function pageRoadRouter(page: Pick<Document, 'querySelector'> | undefined = globalThis.document): RoadRouter {
  const script = page?.querySelector(`meta[name="${ROAD_WORKER_META}"]`)?.getAttribute('content');
  return script ? routeInWorker(() => new Worker(script) as unknown as RoadWorker) : routeOnThePage;
}

export interface IslandDock { local: CoastPoint; links: readonly string[] }

export function islandDocks(plan: PlanetPathways, routing: boolean): ReadonlyMap<string, readonly IslandDock[]> | undefined {
  if (routing && plan.lanes.docks.length === 0) return undefined;
  const out = new Map<string, IslandDock[]>();
  for (const dock of plan.lanes.docks) (out.get(dock.story) ?? out.set(dock.story, []).get(dock.story)!).push({ local: dock.local, links: dock.links });
  return out;
}
