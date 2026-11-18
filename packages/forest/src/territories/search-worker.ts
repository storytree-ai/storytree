// Capability 3 · Story node render
import { answerRoads, type RoadsAnswer, type RoadsAsk } from "./island-roads.js";
import type { SearchAnswer, SearchAsk } from "./kept-layout.js";
import { searchTerritories } from "./territory-search.js";

export function answerSearch(ask: SearchAsk): SearchAnswer {
  try {
    return { found: searchTerritories(ask) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function answerAsk(data: SearchAsk | { roads: RoadsAsk }): SearchAnswer | RoadsAnswer {
  return "roads" in data ? answerRoads(data.roads) : answerSearch(data);
}

const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage?: (event: { data: SearchAsk | { roads: RoadsAsk } }) => void; postMessage?: (answer: SearchAnswer | RoadsAnswer) => void };
if (scope.WorkerGlobalScope !== undefined) scope.onmessage = ({ data }) => scope.postMessage!(answerAsk(data));
