/**
 * Capability 3 · Story node render (the forest story): the arrangement the territory search found for an island, kept so
 * the island does not reshuffle when a line of code changes (3.80, rollout 2 step 2b).
 *
 * - Kept per story on this computer, in the page's localStorage where it has one, so it outlives a restart and writes
 *   nothing to the library; elsewhere for as long as the process runs.
 * - A kept arrangement carries its island's structure key (`structureKey`): its territories, its links at home and each
 *   dock's lanes, never sizes or positions. While the key holds the island draws from the kept seeds and is not searched
 *   again, so a change of lines only resizes its territories; another key draws from the kept seeds still, where they
 *   name a territory, and asks for a search.
 * - The search runs in the worker the page names (TERRITORY_WORKER_META), one at a time, never on the page: a page
 *   with no worker draws the start and searches nothing. Every island is laid out (ADR-1253 D2), so a search asked for
 *   another island waits its turn; one asked for a new structure of the island in flight overtakes it.
 */
import type { Link, LinkDock, Seeds } from "./link-layout.js";
import type { Coast, TerritoryShare } from "./territories.js";

/** What is kept for an island: the structure key it was searched for, and the seeds it grows from. */
export type KeptArrangement = { readonly key: string; readonly seeds: Seeds };
/** What a search is asked: the island as it is drawn, and the seeds it is drawn from, if any. */
export type SearchAsk = { readonly shares: readonly TerritoryShare[]; readonly coast: Coast; readonly links: readonly Link[]; readonly docks: readonly LinkDock[]; readonly kept?: Seeds; readonly steps?: number };
/** What the search worker posts back: the best seeds it found, none when no arrangement grows, or why it failed. */
export type SearchAnswer = { found: { seeds: Seeds; score: number; start: number } | undefined } | { error: string };
/** Searches an island somewhere off the page; an aborted signal means it was overtaken. */
export type TerritorySearcher = (ask: SearchAsk, signal: AbortSignal) => Promise<SearchAnswer>;
/** Where kept arrangements live between runs. */
export interface ArrangementShelf { read(story: string): KeptArrangement | undefined; write(story: string, kept: KeptArrangement): void }

/** A page that offers a territory search worker names its script in this meta tag. */
export const TERRITORY_WORKER_META = "storytree-territory-worker";
const SHELF_KEY = "storytree.territories.";

/** The island's structure: the territories it holds, its links at home, and each dock's lanes, sorted, never sizes. */
export function structureKey(shares: readonly TerritoryShare[], links: readonly Link[], docks: readonly LinkDock[]): string {
  const ids = shares.map((s) => s.capability ?? ""), here = new Set(ids);
  const home = links.filter((l) => here.has(l.from) && here.has(l.to) && l.from !== l.to).map((l) => `${l.from}->${l.to}`);
  return JSON.stringify([[...ids].sort(), home.sort(), docks.map((d) => [...d.links].sort()).sort()]);
}

/** The page's localStorage as a shelf, or none where the page has no storage (a test, a worker) or refuses it. */
export function storageShelf(storage: Pick<Storage, "getItem" | "setItem"> | undefined = pageStorage()): ArrangementShelf | undefined {
  if (storage === undefined) return undefined;
  return {
    read(story) {
      try {
        const kept = JSON.parse(storage.getItem(SHELF_KEY + story) ?? "null") as KeptArrangement | null;
        return kept !== null && typeof kept.key === "string" && typeof kept.seeds === "object" ? kept : undefined;
      } catch { return undefined; }
    },
    write(story, kept) {
      try { storage.setItem(SHELF_KEY + story, JSON.stringify(kept)); } catch { /* a full or refused storage keeps it for this run only */ }
    },
  };
}

/** The page's localStorage, or none where reading it throws (a page with no origin, or storage switched off). */
function pageStorage(): Storage | undefined {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
}

let shelf: ArrangementShelf | undefined | null = null;
const kept = new Map<string, KeptArrangement | undefined>();
const listeners = new Set<() => void>();
let version = 0;

/** Kept arrangements are read from and written to `next` from now on (a test's own; undefined for none), forgetting
 * every one read so far. */
export function shelveOn(next: ArrangementShelf | undefined): void {
  shelf = next; kept.clear(); version++;
  inFlight?.overtaken.abort(); inFlight = undefined; waiting.clear();
}

/** The arrangement kept for `story`, if any. */
export function keptArrangement(story: string): KeptArrangement | undefined {
  if (!kept.has(story)) {
    if (shelf === null) shelf = storageShelf();
    kept.set(story, shelf?.read(story));
  }
  return kept.get(story);
}

/** Keeps `arrangement` for `story`, and tells every listener. */
export function keepArrangement(story: string, arrangement: KeptArrangement): void {
  if (shelf === null) shelf = storageShelf();
  kept.set(story, arrangement);
  shelf?.write(story, arrangement);
  version++;
  for (const listener of listeners) listener();
}

/** Hears every arrangement kept from now on (React's useSyncExternalStore, with `keptVersion`). */
export function subscribeKept(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Changes whenever an arrangement is kept. */
export const keptVersion = (): number => version;

let inFlight: { story: string; key: string; overtaken: AbortController } | undefined;
/** The islands waiting their turn, in the order first asked, each with its latest ask. */
const waiting = new Map<string, { ask: Omit<SearchAsk, "kept">; searcher: TerritorySearcher }>();

/**
 * Asks `searcher` to search `story`'s island unless its kept arrangement was searched for this structure, or a search
 * for it is already in flight. Searches run one at a time: another island's waits its turn, and a new structure of the
 * island in flight overtakes it. What the search finds is kept; a search that fails, finds nothing or is overtaken keeps
 * nothing.
 */
export function searchIsland(story: string, ask: Omit<SearchAsk, "kept">, searcher: TerritorySearcher | undefined): void {
  if (searcher === undefined) return;
  const key = structureKey(ask.shares, ask.links, ask.docks);
  if (keptArrangement(story)?.key === key) { waiting.delete(story); return; }
  if (inFlight?.story === story) {
    if (inFlight.key === key) return;
    inFlight.overtaken.abort();
    inFlight = undefined;
  }
  if (inFlight !== undefined) { waiting.set(story, { ask, searcher }); return; }
  waiting.delete(story);
  const overtaken = new AbortController(), { signal } = overtaken, was = keptArrangement(story);
  inFlight = { story, key, overtaken };
  const done = () => {
    if (inFlight?.overtaken !== overtaken) return;
    inFlight = undefined;
    // The next island waiting that still needs its search: one kept meanwhile for its structure is passed over.
    for (const [next, { ask, searcher }] of waiting) {
      waiting.delete(next);
      searchIsland(next, ask, searcher);
      if (inFlight !== undefined) break;
    }
  };
  void searcher({ ...ask, ...(was && { kept: was.seeds }) }, signal).then((answer) => {
    if (!signal.aborted) {
      if ("error" in answer) console.error("forest territories: the territory search failed", answer.error);
      else if (answer.found !== undefined) keepArrangement(story, { key, seeds: answer.found.seeds });
    }
    done();
  }, (error: unknown) => {
    if (!signal.aborted) console.error("forest territories: the territory search failed", error);
    done();
  });
}

/** The part of a Worker the searcher uses. */
export interface SearchWorker {
  postMessage(message: SearchAsk): void;
  terminate(): void;
  onmessage: ((event: { data: SearchAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Searches in a fresh worker from `start`, ended when it answers or is overtaken. A worker that cannot start or fails
 * to load answers an error: the search never falls back to the page. */
export function searchInWorker(start: () => SearchWorker): TerritorySearcher {
  return (ask, signal) => new Promise<SearchAnswer>((resolve, reject) => {
    let worker: SearchWorker;
    try { worker = start(); } catch (error) { resolve({ error: `the territory worker could not start: ${String(error)}` }); return; }
    const end = () => { worker.terminate(); signal.removeEventListener("abort", overtaken); };
    const overtaken = () => { end(); reject(signal.reason); };
    signal.addEventListener("abort", overtaken);
    worker.onmessage = ({ data }) => { end(); resolve(data); };
    worker.onerror = (event) => { end(); resolve({ error: `the territory worker failed to load: ${String((event as { message?: string })?.message ?? event)}` }); };
    worker.postMessage(ask);
  });
}

/** The searcher a page offers: its territory worker when it names one (TERRITORY_WORKER_META), else none. */
export function pageTerritorySearcher(page: Pick<Document, "querySelector"> | undefined = (globalThis as { document?: Document }).document): TerritorySearcher | undefined {
  const script = page?.querySelector(`meta[name="${TERRITORY_WORKER_META}"]`)?.getAttribute("content");
  return script ? searchInWorker(() => new Worker(script) as unknown as SearchWorker) : undefined;
}
