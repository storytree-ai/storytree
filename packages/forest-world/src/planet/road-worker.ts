/** Capability 4 · The planet. The road worker (The drawing engine 4.21): a host bundles this as its own script and names it in its
 * page (road-routing.ts, ROAD_WORKER_META); the globe posts it each layout's routing and draws the roads it answers. */
import { routePlanet, type CrossRouting } from './pathways.js';
import type { RoadWorkerAnswer } from './road-routing.js';

/** Routes one layout's roads and lanes, as the page would. */
export function answerRouting(routing: CrossRouting): RoadWorkerAnswer {
  try {
    return { network: routePlanet(routing) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// In a worker, answer every routing the page posts.
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage?: (event: { data: CrossRouting }) => void; postMessage?: (answer: RoadWorkerAnswer) => void };
if (scope.WorkerGlobalScope !== undefined) scope.onmessage = ({ data }) => scope.postMessage!(answerRouting(data));
