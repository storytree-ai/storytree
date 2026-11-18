// Capability 1 · Story nodes

export const LAND_PER_LINE = 1.5;

export const MIN_ISLAND_AREA = 800;

export function islandArea(lines: number): number {
  return Math.max(MIN_ISLAND_AREA, lines * LAND_PER_LINE);
}

export const MAPPED_ISLAND_CAP = 12_000;

export function mappedArea(lines: number): number {
  return Math.min(MAPPED_ISLAND_CAP, islandArea(lines));
}

export function unsurveyedArea(capabilities: number): number {
  return Math.max(1, capabilities) * MIN_ISLAND_AREA;
}

export const SEA_GAP = 36;

export interface GrowingIsland { readonly story: string; readonly place: number; readonly reach: number }
