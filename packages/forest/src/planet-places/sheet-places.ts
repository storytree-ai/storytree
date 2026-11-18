// Capability 1 · Story nodes
import { rowOf } from "./planet-places.js";
import { SEA_GAP, type GrowingIsland } from "./island-growth.js";

export const NAMEPLATE_ROOM = 28;

export interface SheetPlaces {
  at: Map<string, { x: number; y: number }>;
  bounds: { west: number; east: number; south: number; north: number };
}

export function sheetPlaces(islands: readonly GrowingIsland[]): SheetPlaces {
  const columns = new Map<number, GrowingIsland[]>();
  for (const island of islands) {
    const { row } = rowOf(island.place);
    columns.set(row, [...(columns.get(row) ?? []), island]);
  }
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
