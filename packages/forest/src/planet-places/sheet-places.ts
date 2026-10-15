/**
 * Capability 1 · Story nodes. Story nodes' places on the glass sheet (ADR-1043 D2): the same permanent places (a row by
 * dependency depth, a slot in it) give each island its spot, but a depth is a column, not a row. The foundation stories'
 * column stands at the sheet's west edge and each deeper one east of the last, so a deeper library grows the sheet eastward;
 * down a column each island stands its reach, the sea gap and its nameplate's room south of the one before, by slot, from
 * the sheet's north edge. Neighbouring columns sit as close as their own islands allow.
 */
import { rowOf } from "./planet-places.js";
import { SEA_GAP, type GrowingIsland } from "./island-growth.js";

/** Room under each island for its nameplate, in ground units, on top of the sea gap. */
export const NAMEPLATE_ROOM = 28;

export interface SheetPlaces {
  /** Each island's middle on the sheet: x east from the west edge, y north (the first of each column at 0). */
  at: Map<string, { x: number; y: number }>;
  /** The land's bounds, coast to coast. */
  bounds: { west: number; east: number; south: number; north: number };
}

export function sheetPlaces(islands: readonly GrowingIsland[]): SheetPlaces {
  const columns = new Map<number, GrowingIsland[]>();
  for (const island of islands) {
    const { row } = rowOf(island.place);
    columns.set(row, [...(columns.get(row) ?? []), island]);
  }
  // Each column's middle line, from the foundations' at 0: a depth with no story yet takes no room.
  const order = [...columns.keys()].sort((a, b) => a - b), largest = (depth: number) => Math.max(...columns.get(depth)!.map(({ reach }) => reach));
  const lineOf = new Map<number, number>();
  order.forEach((depth, k) => lineOf.set(depth, k === 0 ? 0 : lineOf.get(order[k - 1]!)! + largest(order[k - 1]!) + SEA_GAP + NAMEPLATE_ROOM + largest(depth)));
  const at = new Map<string, { x: number; y: number }>();
  const bounds = { west: 0, east: 0, south: 0, north: 0 };
  let first = true;
  for (const [depth, members] of columns) {
    members.sort((a, b) => rowOf(a.place).slot - rowOf(b.place).slot);
    let south = 0;
    members.forEach((island, k) => {
      south += k === 0 ? 0 : members[k - 1]!.reach + SEA_GAP + NAMEPLATE_ROOM + island.reach;
      const spot = { x: lineOf.get(depth)!, y: -south };
      at.set(island.story, spot);
      const edges = { west: spot.x - island.reach, east: spot.x + island.reach, south: spot.y - island.reach, north: spot.y + island.reach };
      if (first) Object.assign(bounds, edges);
      else Object.assign(bounds, { west: Math.min(bounds.west, edges.west), east: Math.max(bounds.east, edges.east),
        south: Math.min(bounds.south, edges.south), north: Math.max(bounds.north, edges.north) });
      first = false;
    });
  }
  return { at, bounds };
}
