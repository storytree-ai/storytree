/** Story nodes' globe book (ADR-0646 W2). Distances use the forest engine's ground units. */
export const PLANET_RADIUS = 390;
/** Historical places, including retired stories. Growing this set would move existing places. */
export const PLANET_CAPACITY = 128;

// The permanent deal of the 128 Fibonacci indices. Starting at index 0, each next index was
// chosen to maximise its angular distance to the nearest dealt spot (the largest empty patch).
// Keep the measured order: recomputing it at runtime lets rounding break symmetric ties
// differently across machines. Changing this table would move stories already placed.
const DEAL = [
  0, 127, 61, 62, 68, 72, 92, 99, 31, 37, 22, 20, 103, 110, 109, 19,
  21, 106, 46, 66, 63, 57, 56, 73, 120, 4, 121, 10, 26, 104, 16, 88,
  17, 123, 64, 65, 94, 108, 6, 71, 36, 54, 89, 87, 40, 15, 42, 83,
  82, 47, 80, 38, 45, 119, 98, 122, 28, 5, 30, 97, 115, 105, 35, 23,
  91, 90, 24, 25, 102, 114, 13, 101, 39, 100, 27, 29, 107, 12, 96, 32,
  95, 33, 34, 93, 14, 113, 49, 78, 48, 79, 60, 67, 59, 81, 77, 50,
  58, 69, 51, 76, 70, 44, 84, 43, 52, 75, 85, 55, 74, 53, 41, 86,
  2, 11, 116, 18, 117, 112, 9, 118, 8, 111, 1, 126, 7, 125, 124, 3,
] as const;

/** A point relative to the globe's centre: x right, y up, z toward the initial viewer. */
export interface PlanetPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A story node's permanent place number (1-based, retired stories included) becomes a spot on
 * the sphere. The caller gets a fresh point in ground units; dividing by PLANET_RADIUS gives
 * the outward unit normal for mounting a flat island. Neither project size nor island size
 * enters the calculation. See measurements.md for the radius and the bounded clearance proof.
 *
 * Places beyond 128 have no spot in this book: reject them rather than wrap, reuse or move a
 * place. The page can keep showing the flat forest; a later book decides how the globe grows.
 */
export function placeOnGlobe(place: number): PlanetPoint {
  if (!Number.isInteger(place) || place < 1 || place > PLANET_CAPACITY) {
    throw new RangeError(`Globe places are integers from 1 to ${PLANET_CAPACITY}; received ${place}`);
  }
  const index = DEAL[place - 1]!;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const z = 1 - 2 * (index + 0.5) / PLANET_CAPACITY;
  const ring = Math.sqrt(1 - z * z);
  return {
    x: ring * Math.cos(index * goldenAngle) * PLANET_RADIUS,
    y: ring * Math.sin(index * goldenAngle) * PLANET_RADIUS,
    z: z * PLANET_RADIUS,
  };
}
