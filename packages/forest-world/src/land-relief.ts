// Capability 4 · The planet

import { LAND_SCALE } from './land-per-capability.js';

const WAVE_WEIGHTS: readonly number[] = [1.0, 0.6, 0.32];

export const LAND_RELIEF_AMPLITUDE = 2.2 * LAND_SCALE;

export function landHeightRange(amplitude = LAND_RELIEF_AMPLITUDE): number {
  return WAVE_WEIGHTS.reduce((s, weight) => s + Math.abs(weight), 0) * Math.abs(amplitude);
}
