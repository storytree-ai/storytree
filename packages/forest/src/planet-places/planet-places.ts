// Capability 1 · Story nodes

const ROW_PLACES = 1000;

export function placeInRow(row: number, slot: number): number {
  if (!Number.isInteger(row) || !Number.isInteger(slot) || row < 0 || slot < 0 || slot >= ROW_PLACES) {
    throw new RangeError(`A place is a row from 0 and a slot from 0 to ${ROW_PLACES - 1}; received row ${row}, slot ${slot}`);
  }
  return row * ROW_PLACES + slot + 1;
}

export function rowOf(place: number): { row: number; slot: number } {
  return { row: Math.floor((place - 1) / ROW_PLACES), slot: (place - 1) % ROW_PLACES };
}
