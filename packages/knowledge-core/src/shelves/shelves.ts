/** Capability 1's founding book (D1): knowledge hangs under its shelves, as deep as its longest chain. */
import type { Change } from "@storytree/library";

import type { Knowledge } from "../ghosts/ghosts.js";

/** What an empty shelf says. */
export const EMPTY_SHELF = "no knowledge on this shelf yet";
/** What a loop says: the knowledge graph refuses loops (ADR-0647 D2), so one met here is an error. */
export const LOOP_LABEL = "loop: a refused shape; the knowledge graph allows no loops (ADR-0647)";

/** A story's or capability's shelf: an entrance into the core, on its story's island. */
export interface Shelf {
  node: string;
  story: string;
  /** Its front covers, oldest first. */
  covers: string[];
  empty?: string;
}

export interface Placement {
  note: string;
  /** The longest chain from a shelf, the shelf-to-cover step counting 1. */
  depth: number;
  /** The shelf it hangs under: a cover's own, else the oldest shelf that reaches it. */
  home: string;
  /** Every shelf that reaches it, oldest first. */
  entrances: string[];
  /** The loop it belongs to, if any. */
  loop: string | undefined;
}

export interface Loop {
  id: string;
  members: string[];
  /** The group's depth; undefined when no shelf reaches it. */
  depth: number | undefined;
  label: string;
}

export interface Core {
  shelves: Shelf[];
  placed: ReadonlyMap<string, Placement>;
  /** Active notes no shelf reaches, by id. */
  outside: string[];
  loops: Loop[];
}

export function underShelves(_changes: readonly Change[], _knowledge: Knowledge): Core {
  return { shelves: [], placed: new Map(), outside: [], loops: [] };
}
