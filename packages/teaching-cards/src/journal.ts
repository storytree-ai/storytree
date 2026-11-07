/**
 * Capability 2 · First encounters. The journal of cards a user has seen, kept on their machine so a
 * kind taught on one project is not taught again on another, in the order seen, and the user's answer
 * to the tour, without which no card shows.
 */
import { KINDS, type Kind } from "./cards.js";
import type { Encounter } from "./encounters.js";

export interface Seen { kind: Kind; at: string }

export interface Journal {
  /** Every card seen, oldest first. */
  seen(): Seen[];
  /** The encounters whose kind this user has not seen yet. */
  unseen(found: readonly Encounter[]): Encounter[];
  /** Keep `kind` as seen now, once its card has shown; a kind already seen is left as it was. */
  mark(kind: Kind): void;
  /** Whether this user said yes or no to the tour of first-time cards, or has not answered yet. */
  tour(): Tour | undefined;
  /** Keep the user's answer to the tour, and tell every listener. */
  answer(tour: Tour): void;
  /** Hear each answer given from now on, until the returned stop is called. */
  listen(heard: (tour: Tour) => void): () => void;
}

/** The user's answer to "want a quick tour?": the cards show only on a yes. */
export type Tour = "yes" | "no";

const KEY = "storytree.teaching.seen.v1";
const TOUR = "storytree.teaching.tour.v1";

/** The journal kept in `storage` (the page's localStorage), stamped by `now`. */
export function journal(storage: Pick<Storage, "getItem" | "setItem">, now: () => string = () => new Date().toISOString()): Journal {
  const read = (): Seen[] => {
    try {
      const kept: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
      return Array.isArray(kept) ? kept.filter((one): one is Seen => KINDS.includes(one?.kind) && typeof one?.at === "string") : [];
    } catch { return []; }
  };
  const listeners = new Set<(tour: Tour) => void>();
  return {
    seen: read,
    unseen(found) {
      const seen = read();
      return found.filter(one => !seen.some(was => was.kind === one.kind));
    },
    mark(kind) {
      const seen = read();
      if (!seen.some(was => was.kind === kind)) storage.setItem(KEY, JSON.stringify([...seen, { kind, at: now() }]));
    },
    tour() {
      const kept = storage.getItem(TOUR);
      return kept === "yes" || kept === "no" ? kept : undefined;
    },
    answer(tour) {
      storage.setItem(TOUR, tour);
      for (const heard of [...listeners]) heard(tour);
    },
    listen(heard) {
      listeners.add(heard);
      return () => { listeners.delete(heard); };
    },
  };
}
