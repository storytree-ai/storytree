// Capability 4 · The planet
import { routePlanet, type CrossRouting } from './pathways.js';
import type { RoadWorkerAnswer } from './road-routing.js';

export function answerRouting(routing: CrossRouting): RoadWorkerAnswer {
  try {
    return { network: routePlanet(routing) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage?: (event: { data: CrossRouting }) => void; postMessage?: (answer: RoadWorkerAnswer) => void };
if (scope.WorkerGlobalScope !== undefined) scope.onmessage = ({ data }) => scope.postMessage!(answerRouting(data));
