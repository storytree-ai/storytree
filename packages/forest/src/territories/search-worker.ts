/** Capability 3 · Story node render. The territory search worker (3.80): a host bundles this as its own script and names
 * it in its page (kept-layout.ts, TERRITORY_WORKER_META); the page posts it the selected island and keeps what it answers.
 * It routes the selected island's roads too, asked `{ roads }` (island-roads.ts, 3.82). */
import { answerRoads, type RoadsAnswer, type RoadsAsk } from "./island-roads.js";
import type { SearchAnswer, SearchAsk } from "./kept-layout.js";
import { searchTerritories } from "./territory-search.js";

/** Searches one island, as the page asks. */
export function answerSearch(ask: SearchAsk): SearchAnswer {
  try {
    return { found: searchTerritories(ask) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// In a worker, answer every search the page posts.
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage?: (event: { data: SearchAsk | { roads: RoadsAsk } }) => void; postMessage?: (answer: SearchAnswer | RoadsAnswer) => void };
if (scope.WorkerGlobalScope !== undefined) scope.onmessage = ({ data }) => scope.postMessage!("roads" in data ? answerRoads(data.roads) : answerSearch(data));
