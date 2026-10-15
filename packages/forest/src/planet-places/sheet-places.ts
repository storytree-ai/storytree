/**
 * Capability 1 · Story nodes. SPIKE (spike/glass-sheet, never merged): story nodes' places on a flat sheet instead of a globe.
 * The same permanent places (a row by dependency depth, a slot in it) give each island its spot: rows run west to east with
 * north at the top, the bottom row the shallowest; within a row each island stands its reach plus the sea gap from the last,
 * starting from the sheet's west edge. A row only ever grows east, so adding a story moves no other, and the sheet is as wide
 * as its longest row (the owner's answer to question_232f5f22ae4d, "A": the sheet grows wider). Rows stand as close as their
 * own islands allow: two neighbouring rows are their largest reaches, the sea gap and a nameplate's room apart.
 */
import { rowOf } from "./planet-places.js";
import { SEA_GAP, type GrowingIsland } from "./island-growth.js";

/** Room under each island for its nameplate, in ground units, on top of the sea gap between rows. */
export const NAMEPLATE_ROOM = 28;

export interface SheetPlaces {
  /** Each island's middle on the sheet: x east from the west edge, y north from the bottom row. */
  at: Map<string, { x: number; y: number }>;
  /** The land's bounds, coast to coast. */
  bounds: { west: number; east: number; south: number; north: number };
  /** The widest row pitch used, for sizing what hangs below the bottom row. */
  rowPitch: number;
}

/**
 * `across` "rows" is the brief's sheet: depth runs south to north. "columns" is a variant the spike adds for comparison only:
 * the same lines run north to south instead, depth growing east, so a deep, narrow library lies landscape.
 */
export function sheetPlaces(islands: readonly GrowingIsland[], across: "rows" | "columns" = "rows"): SheetPlaces {
  const rows = new Map<number, GrowingIsland[]>();
  for (const island of islands) {
    const { row } = rowOf(island.place);
    rows.set(row, [...(rows.get(row) ?? []), island]);
  }
  // Each row's middle line, from the bottom row's at 0: a row with no story yet takes no room.
  const order = [...rows.keys()].sort((a, b) => a - b), largest = (row: number) => Math.max(...rows.get(row)!.map(({ reach }) => reach));
  const lineOf = new Map<number, number>();
  let rowPitch = 0;
  order.forEach((row, k) => {
    const pitch = k === 0 ? 0 : largest(order[k - 1]!) + SEA_GAP + NAMEPLATE_ROOM + largest(row);
    rowPitch = Math.max(rowPitch, pitch);
    lineOf.set(row, k === 0 ? 0 : lineOf.get(order[k - 1]!)! + pitch);
  });
  const at = new Map<string, { x: number; y: number }>();
  const bounds = { west: 0, east: 0, south: Infinity, north: -Infinity };
  for (const [row, members] of rows) {
    members.sort((a, b) => rowOf(a.place).slot - rowOf(b.place).slot);
    let x = 0;
    members.forEach((island, k) => {
      // Down a column, each island also leaves its nameplate's room under it.
      x += k === 0 ? island.reach : members[k - 1]!.reach + SEA_GAP + (across === "columns" ? NAMEPLATE_ROOM : 0) + island.reach;
      const spot = across === "rows" ? { x, y: lineOf.get(row)! } : { x: lineOf.get(row)!, y: -x };
      at.set(island.story, spot);
      bounds.west = Math.min(bounds.west, spot.x - island.reach);
      bounds.east = Math.max(bounds.east, spot.x + island.reach);
      bounds.south = Math.min(bounds.south, spot.y - island.reach);
      bounds.north = Math.max(bounds.north, spot.y + island.reach);
    });
  }
  if (at.size === 0) Object.assign(bounds, { south: 0, north: 0 });
  return { at, bounds, rowPitch };
}
