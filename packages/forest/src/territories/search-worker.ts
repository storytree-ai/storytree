/** Capability 3 · Story node render. The territory search worker (3.80): a host bundles this as its own script and names
 * it in its page (kept-layout.ts, TERRITORY_WORKER_META); the page posts it the selected island and keeps what it answers. */
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
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; onmessage?: (event: { data: SearchAsk }) => void; postMessage?: (answer: SearchAnswer) => void };
if (scope.WorkerGlobalScope !== undefined) scope.onmessage = ({ data }) => scope.postMessage!(answerSearch(data));
