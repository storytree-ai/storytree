/** Islands grow with their code from anchored places (ADR-0804 D3, D7). Not built yet: the red tests stand on this. */
import { PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";

/** Ground units² of land per line of code in a surveyed story. */
export const LAND_PER_LINE = 0;
/** The least land an island has, so a tiny story stays visible. */
export const MIN_ISLAND_AREA = 0;
/** The farthest an island may be nudged from its anchor, in radians of arc. */
export const MAX_NUDGE = 0;
/** The open sea kept between two islands' coasts, in ground units. */
export const SEA_GAP = 0;

/** A surveyed story's land: its lines times the per-line constant, never below the floor. */
export function islandArea(lines: number): number {
  return lines * 0;
}

/** How far an island's coast reaches from its middle, in ground units. */
export function islandReach(area: number): number {
  return Math.sqrt(area / Math.PI);
}

export interface GrowingIsland { readonly story: string; readonly place: number; readonly area: number }

export interface GrownPlanet {
  /** The globe's radius, in ground units: PLANET_RADIUS until the islands no longer fit. */
  readonly radius: number;
  /** Each island's unit direction after nudging. */
  readonly spots: ReadonlyMap<string, PlanetPoint>;
}

export function growPlanet(islands: readonly GrowingIsland[]): GrownPlanet {
  return { radius: PLANET_RADIUS, spots: new Map(islands.map(({ story }) => [story, { x: 0, y: 0, z: 1 }])) };
}
