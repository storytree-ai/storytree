/**
 * Capability 2 · First encounters. The journal of cards a user has seen, kept on their machine so a
 * kind taught on one project is not taught again on another, in the order seen.
 */
import { KINDS, type Kind } from "./cards.js";
import type { Encounter } from "./encounters.js";

export interface Seen { kind: Kind; at: string }

export interface Journal {
  /** Every card seen, oldest first. */
  seen(): Seen[];
  /** The encounters whose kind this user has not seen yet, now marked seen. */
  fresh(found: readonly Encounter[]): Encounter[];
}

const KEY = "storytree.teaching.seen.v1";

/** The journal kept in `storage` (the page's localStorage), stamped by `now`. */
export function journal(storage: Pick<Storage, "getItem" | "setItem">, now: () => string = () => new Date().toISOString()): Journal {
  const read = (): Seen[] => {
    try {
      const kept: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
      return Array.isArray(kept) ? kept.filter((one): one is Seen => KINDS.includes(one?.kind) && typeof one?.at === "string") : [];
    } catch { return []; }
  };
  return {
    seen: read,
    fresh(found) {
      const seen = read();
      const unseen = found.filter(one => !seen.some(was => was.kind === one.kind));
      if (unseen.length === 0) return [];
      const at = now();
      storage.setItem(KEY, JSON.stringify([...seen, ...unseen.map(one => ({ kind: one.kind, at }))]));
      return unseen;
    },
  };
}
