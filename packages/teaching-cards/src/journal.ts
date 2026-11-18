// Capability 2 · First encounters
import { KINDS, type Kind } from "./cards.js";
import type { Encounter } from "./encounters.js";

export interface Seen { kind: Kind; at: string }

export interface Journal {
  seen(): Seen[];
  unseen(found: readonly Encounter[]): Encounter[];
  mark(kind: Kind): void;
  tour(): Tour | undefined;
  answer(tour: Tour): void;
  listen(heard: (tour: Tour) => void): () => void;
}

export type Tour = "yes" | "no";

const KEY = "storytree.teaching.seen.v1";
const TOUR = "storytree.teaching.tour.v1";

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
