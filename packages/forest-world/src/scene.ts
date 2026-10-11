/**
 * Capability 1 · Scene layout. The forest a story's surface hands this engine to draw: its islands, one per story node, each with
 * its capabilities (still typed as a grove of trees, 0.2's names), in world units. Since ADR-0804 D1
 * no tree is drawn: an island is a flat surface cut into capability territories, and a `PlacedTree`
 * is only a capability's record on it. The forest story (packages/forest) lays it out and imports these shapes
 * from here, so the engine never depends on the story: a workspace dependency back would make a
 * cycle, which pnpm turns into a loop of directory junctions on Windows.
 */

/** A capability's work-state form (0.2 drew it as a tree's look; nothing draws it since ADR-0804 D1). */
export type TreeForm = "seedling" | "pale" | "green" | "dead";

/** A capability's word (ADR-0744): what storytree verified about it, never the agent's report alone. */
export type CapabilityWord = "proposed" | "healthy" | "unhealthy" | "untested";

/** How many world units one place-width is: wide enough that neighbouring islands never touch. */
export const PLACE_WIDTH = 16;

/** One capability on its island: 0.2's tree, of which only the record remains (no tree is drawn, ADR-0804 D1, ADR-0920). */
export interface PlacedTree {
  /** The capability's id; undefined for the one seedling of a story with no capabilities yet. */
  capability: string | undefined;
  form: TreeForm;
  /** Its capability's word; absent for the one seedling of a story with no capabilities yet. */
  status?: CapabilityWord;
  /** How many contracts its capability has. */
  contracts: number;
}

/** One story node, as an island. */
export interface Island {
  story: string;
  title: string;
  x: number;
  z: number;
  trees: PlacedTree[];
  /** The island's territories, in its own flat coordinates about its middle; files stay empty before its code is surveyed. */
  land?: IslandLand;
  /** The island's land in ground units², when its story's code sets it (ADR-0804 D3, D7); absent, the land follows its capability count. */
  area?: number;
  /** Changes only when something drawn on the island changes. */
  key: string;
}

/** An island's territories and surveyed files (ADR-0804 D2, D3), for the page to lay on its land. */
export interface IslandLand {
  /**
   * Each territory's capability, title, description, word and lines (equal weights of 1 before survey); no capability or word for Unclaimed code.
   * `parked` when its capability is not proven and parked on purpose (ADR-0992), so it is filled grey;
   * `mapped` for a mapped story's one territory, the whole island, filled brown (ADR-0993 D3).
   */
  territories: readonly { capability?: string; title?: string; description?: string; status?: CapabilityWord; parked?: true; mapped?: true; lines: number }[];
  files: readonly { path: string; lines: number; capability?: string }[];
  /** The package its story's code lives in, so a file's path in the package can be named from the repository's root (ADR-0804 D5). */
  package?: string;
  /** Which of its files imports which, by their paths in the package. */
  imports?: readonly { from: string; to: string }[];
}

export interface ForestScene {
  islands: Island[];
  /** Capability dependencies, `from` building on `to`: derived from the code's imports or recorded (ADR-0991 D1, D3),
   * type-only when only the code's types join them; optional for callers drawing land alone. An end may instead name an
   * island as a whole, by its story, where there is no capability to name (a mapped island, ADR-0993). */
  links?: readonly { from: string; to: string; typeOnly?: true }[];
}
