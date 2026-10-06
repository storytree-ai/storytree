/**
 * Capability 1 · Story nodes. Story nodes' places on the globe: rows by dependency depth (the rows decision, which supersedes ADR-0646's
 * permanent places and ADR-0648's packed book). A place is a row and a slot in it; the rows are bands of
 * latitude, the bottom one about 46° south and the top one about 46° north, evenly spaced, so a story with a
 * deeper chain of dependencies sits further north. Distances use the forest engine's ground units.
 */
export const PLANET_RADIUS = 218;

/** The latitude of the top row, and (south) of the bottom row, in radians. */
export const ROW_LATITUDE = 46 * Math.PI / 180;

/** The slots a row's places are numbered across: a place is its row times this, plus its slot, plus one. */
const ROW_PLACES = 1000;

/** A point relative to the globe's centre: x right, y up (north), z toward the initial viewer. */
export interface PlanetPoint { x: number; y: number; z: number }

/** The 1-based place of slot `slot` (0 the westernmost) in row `row` (0 the bottom). */
export function placeInRow(row: number, slot: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(slot) || row < 0 || slot < 0 || slot >= ROW_PLACES) {
    throw new RangeError(`A place is a row from 0 and a slot from 0 to ${ROW_PLACES - 1}; received row ${row}, slot ${slot}`);
  }
  return row * ROW_PLACES + slot + 1;
}

/** The row and slot a place names. */
export function rowOf(place: number): { row: number; slot: number } {
  return { row: Math.floor((place - 1) / ROW_PLACES), slot: (place - 1) % ROW_PLACES };
}

/** The latitude, in radians, of row `row` of `rows`: evenly spaced from the bottom row's to the top row's; one row sits on the equator. */
export function rowLatitude(row: number, rows: number): number {
  return rows <= 1 ? 0 : -ROW_LATITUDE + 2 * ROW_LATITUDE * row / (rows - 1);
}
