/** Islands grow with their code from anchored places (ADR-0804 D3, D7). Not built yet: the red tests stand on this. */
import { placeOnPackedGlobe, PLANET_RADIUS, type PlanetPoint } from "./planet-places.js";

/** Ground units² of land per line of code in a surveyed story. */
export const LAND_PER_LINE = 0.75;
/** The least land an island has, so a tiny story stays visible. */
export const MIN_ISLAND_AREA = 318;
/** The farthest an island may be nudged from its anchor, in radians of arc. */
export const MAX_NUDGE = 0.3;
/** The open sea kept between two islands' coasts, in ground units. */
export const SEA_GAP = 6;

/** A surveyed story's land: its lines times the per-line constant, never below the floor. */
export function islandArea(lines: number): number {
  return Math.max(MIN_ISLAND_AREA, lines * LAND_PER_LINE);
}

/** An island to place: its permanent place, and how far its coast reaches from its middle, in ground units. */
export interface GrowingIsland { readonly story: string; readonly place: number; readonly reach: number }

export interface GrownPlanet {
  /** The globe's radius, in ground units: PLANET_RADIUS until the islands no longer fit. */
  readonly radius: number;
  /** Each island's unit direction after nudging. */
  readonly spots: ReadonlyMap<string, PlanetPoint>;
}

export function growPlanet(islands: readonly GrowingIsland[]): GrownPlanet {
  return { radius: PLANET_RADIUS, spots: new Map(islands.map(({ story, place }) => {
    const p = placeOnPackedGlobe(place);
    return [story, { x: p.x / PLANET_RADIUS, y: p.y / PLANET_RADIUS, z: p.z / PLANET_RADIUS }];
  })) };
}
