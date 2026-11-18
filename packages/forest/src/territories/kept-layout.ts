// Capability 3 · Story node render
import type { Link, LinkDock, Seeds } from "./link-layout.js";
import type { Coast, TerritoryShare } from "./territories.js";

export type KeptArrangement = { readonly key: string; readonly seeds: Seeds };
export type SearchAsk = { readonly shares: readonly TerritoryShare[]; readonly coast: Coast; readonly links: readonly Link[]; readonly docks: readonly LinkDock[]; readonly kept?: Seeds; readonly fixed?: readonly string[]; readonly steps?: number };
export type SearchAnswer = { found: { seeds: Seeds; score: number; start: number } | undefined } | { error: string };
export type TerritorySearcher = (ask: SearchAsk, signal: AbortSignal) => Promise<SearchAnswer>;
export interface ArrangementShelf { read(story: string): KeptArrangement | undefined; write(story: string, kept: KeptArrangement): void }

export const TERRITORY_WORKER_META = "storytree-territory-worker";
const SHELF_KEY = "storytree.territories.";

const SCORE = 2;

export function structureKey(shares: readonly TerritoryShare[]): string {
  return JSON.stringify([`score ${SCORE}`, shares.map((s) => s.capability ?? "").sort()]);
}

function sameScore(key: string): boolean {
  try { return (JSON.parse(key) as unknown[])[0] === `score ${SCORE}`; } catch { return false; }
}

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
      try { storage.setItem(SHELF_KEY + story, JSON.stringify(kept)); } catch {}
    },
  };
}

function pageStorage(): Storage | undefined {
  try { return (globalThis as { localStorage?: Storage }).localStorage; } catch { return undefined; }
}

let shelf: ArrangementShelf | undefined | null = null;
const kept = new Map<string, KeptArrangement | undefined>();
const listeners = new Set<() => void>();
let version = 0;

export function shelveOn(next: ArrangementShelf | undefined): void {
  shelf = next; kept.clear(); unanswered.clear(); version++;
  inFlight?.overtaken.abort(); inFlight = undefined; waiting.clear(); onScreen = undefined;
  queueChanged();
}

export function keptArrangement(story: string): KeptArrangement | undefined {
  if (!kept.has(story)) {
    if (shelf === null) shelf = storageShelf();
    kept.set(story, shelf?.read(story));
  }
  return kept.get(story);
}

export function keepArrangement(story: string, arrangement: KeptArrangement): void {
  if (shelf === null) shelf = storageShelf();
  kept.set(story, arrangement);
  shelf?.write(story, arrangement);
  told();
}

const unanswered = new Map<string, string>();

function placed(story: string, shares: readonly TerritoryShare[]): boolean {
  const held = keptArrangement(story);
  if (held === undefined) return false;
  if (held.key === structureKey(shares) || !sameScore(held.key)) return true;
  return shares.every((s) => held.seeds[s.capability ?? ""] !== undefined);
}

export function awaitingLayout(story: string, shares: readonly TerritoryShare[], searcher: TerritorySearcher | undefined): boolean {
  return searcher !== undefined && shares.length > 1 && !placed(story, shares) && unanswered.get(story) !== structureKey(shares);
}

function told(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribeKept(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const keptVersion = (): number => version;

let inFlight: { story: string; key: string; overtaken: AbortController } | undefined;
const waiting = new Map<string, { ask: Omit<SearchAsk, "kept">; searcher: TerritorySearcher }>();
let onScreen: string | undefined;

export function searchFirst(story: string | undefined): void {
  onScreen = story;
}

const queueListeners = new Set<() => void>();
let queueVersion = 0, queueSeen = "[]";
export function islandsSearching(): ReadonlySet<string> {
  return new Set([...(inFlight === undefined ? [] : [inFlight.story]), ...waiting.keys()]);
}
export function subscribeSearching(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => { queueListeners.delete(listener); };
}
export const searchingVersion = (): number => queueVersion;
function queueChanged(): void {
  const now = JSON.stringify([...islandsSearching()].sort());
  if (now === queueSeen) return;
  queueSeen = now; queueVersion++;
  for (const listener of queueListeners) listener();
}

export function searchIsland(story: string, ask: Omit<SearchAsk, "kept">, searcher: TerritorySearcher | undefined): void {
  asked(story, ask, searcher);
  queueChanged();
}

function asked(story: string, ask: Omit<SearchAsk, "kept">, searcher: TerritorySearcher | undefined): void {
  if (searcher === undefined) return;
  const key = structureKey(ask.shares), held = keptArrangement(story);
  if (held?.key === key) { waiting.delete(story); return; }
  const fixed = held && sameScore(held.key) ? ask.shares.map((s) => s.capability ?? "").filter((id) => held.seeds[id] !== undefined) : [];
  if (held && fixed.length === ask.shares.length) {
    if (inFlight?.story === story) { inFlight.overtaken.abort(); inFlight = undefined; }
    waiting.delete(story);
    keepArrangement(story, { key, seeds: held.seeds });
    return;
  }
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
    const order = [...waiting.keys()].sort((a, b) => Number(b === onScreen) - Number(a === onScreen));
    for (const next of order) {
      const turn = waiting.get(next);
      if (turn === undefined) continue;
      waiting.delete(next);
      asked(next, turn.ask, turn.searcher);
      if (inFlight !== undefined) break;
    }
    queueChanged();
  };
  const none = () => { if (keptArrangement(story)?.key !== key && unanswered.get(story) !== key) { unanswered.set(story, key); told(); } };
  void searcher({ ...ask, ...(was && { kept: was.seeds }), ...(fixed.length > 0 && { fixed }) }, signal).then((answer) => {
    if (!signal.aborted) {
      if ("error" in answer) console.error("forest territories: the territory search failed", answer.error);
      if (!("error" in answer) && answer.found !== undefined) keepArrangement(story, { key, seeds: answer.found.seeds });
      else none();
    }
    done();
  }, (error: unknown) => {
    if (!signal.aborted) { console.error("forest territories: the territory search failed", error); none(); }
    done();
  });
}

export interface SearchWorker {
  postMessage(message: SearchAsk): void;
  terminate(): void;
  onmessage: ((event: { data: SearchAnswer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

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

export function pageTerritorySearcher(page: Pick<Document, "querySelector"> | undefined = (globalThis as { document?: Document }).document): TerritorySearcher | undefined {
  const script = page?.querySelector(`meta[name="${TERRITORY_WORKER_META}"]`)?.getAttribute("content");
  return script ? searchInWorker(() => new Worker(script) as unknown as SearchWorker) : undefined;
}
