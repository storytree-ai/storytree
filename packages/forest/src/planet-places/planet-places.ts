/**
 * Capability 1 · Story nodes. Story nodes' places: rows by dependency depth (the rows decision, which supersedes ADR-0646's
 * permanent places and ADR-0648's packed book). A place is a row and a slot in it; the glass sheet lays each row out as a
 * column, deeper rows further east (sheet-places).
 */

/** The slots a row's places are numbered across: a place is its row times this, plus its slot, plus one. */
const ROW_PLACES = 1000;

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
