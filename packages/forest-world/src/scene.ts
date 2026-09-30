/**
 * The forest a story's surface hands this engine to draw: its islands, one per story node, each with
 * its grove, in world units. The forest story (packages/forest) lays it out and imports these shapes
 * from here, so the engine never depends on the story: a workspace dependency back would make a
 * cycle, which pnpm turns into a loop of directory junctions on Windows.
 */

/** How a capability's tree looks. */
export type TreeForm = "seedling" | "pale" | "green" | "dead";

/** How many world units one place-width is: wide enough that neighbouring islands never touch. */
export const PLACE_WIDTH = 16;

/** One tree as it stands on its island, in world units. */
export interface PlacedTree {
  /** The capability's id; undefined for the one seedling of a story with no capabilities yet. */
  capability: string | undefined;
  form: TreeForm;
  /** How many contracts its capability has: 0.2's engine grows that much ground cover on its parcel. */
  contracts: number;
  x: number;
  z: number;
  /** How tall it stands, 1 for a full tree. */
  scale: number;
  /** Which way it is turned, in radians, so a grove does not look stamped. */
  turn: number;
}

/** One story node, as an island. */
export interface Island {
  story: string;
  title: string;
  x: number;
  z: number;
  radius: number;
  trees: PlacedTree[];
  /** The island's territories, in its own flat coordinates about its middle; absent before its code is surveyed. */
  land?: IslandLand;
  /** Changes only when something drawn on the island changes. */
  key: string;
}

/** An island cut into territories (ADR-0804 D2): its cells, each in a territory, and the borders between territories. */
export interface IslandLand {
  /** The round island the territories were cut from, in world units. */
  radius: number;
  /** Each territory's capability; absent for Unclaimed code. */
  territories: readonly { capability?: string }[];
  cells: readonly { polygon: readonly { x: number; z: number }[]; territory: number }[];
  borders: readonly { from: { x: number; z: number }; to: { x: number; z: number } }[];
}

export interface ForestScene {
  islands: Island[];
  /** Recorded capability dependencies; optional for callers drawing land alone. */
  links?: readonly { from: string; to: string }[];
}
