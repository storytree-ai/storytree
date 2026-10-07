// Capability 6 · The planet. The height bound of the ground relief the islands were once drawn with. The field itself
// (`landHeight`, `landGradient`) went with the shore fall, its last reader (2026-10-06); the bound
// stays because `planet/planet.ts` sizes PLATE_CLEARANCE by it, which sets where every island
// surface sits above the shell.

import { LAND_SCALE } from './land-per-capability.js';

/** The weights of the relief's three wave components, as tuned. */
const WAVE_WEIGHTS: readonly number[] = [1.0, 0.6, 0.32];

/** The inherited relief amplitude, in ground units, scaled with the island. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const LAND_RELIEF_AMPLITUDE = 2.2 * LAND_SCALE;

/** The largest height the relief could reach at this amplitude — the sum of its wave weights.
 *  `planet/planet.ts` uses this bound for the tangent plates' clearance above the globe shell. */
export function landHeightRange(amplitude = LAND_RELIEF_AMPLITUDE): number {
  return WAVE_WEIGHTS.reduce((s, weight) => s + Math.abs(weight), 0) * Math.abs(amplitude);
}
