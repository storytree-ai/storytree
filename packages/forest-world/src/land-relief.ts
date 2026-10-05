// Continuous ground relief used by `shore-fall.ts` for the globe's pathway routing.
// `planet/planet.ts` uses its height bound to keep tangent plates clear of the shell.
// The field depends only on position, never capability status or identity.
//
// The inherited tuning used cells averaging 16.5 ground units across: wavelengths 62 / 41 / 27
// are wider than a cell. LAND_SCALE scales both wavelength and amplitude, preserving slope.
// Shared coordinates sample the same field, so adjoining parcels cannot disagree at a seam.

import { LAND_SCALE } from './land-per-capability.js';

/** Three components, each [kx, kz, weight, phase]. */
const TUNED_WAVES: readonly (readonly [number, number, number, number])[] = [
  [0.0811, 0.0608, 1.0, 0.0],
  [0.0536, -0.1439, 0.6, 1.7],
  [-0.1396, 0.1862, 0.32, 4.1],
];

// ⚠ ÷ LAND_SCALE (`land-per-capability.ts`): the wavenumbers above were judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, so the wavelengths shrink with it and each
// stays the same fraction of the island (and the same multiple of a cell).
const WAVES: readonly (readonly [number, number, number, number])[] = TUNED_WAVES.map(
  ([kx, kz, w, phase]) => [kx / LAND_SCALE, kz / LAND_SCALE, w, phase] as const,
);

/** The inherited relief amplitude, in ground units, scaled with the island. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const LAND_RELIEF_AMPLITUDE = 2.2 * LAND_SCALE;

/** Ground height at a point, in ground units. Deterministic, continuous, C-infinity, and a
 *  function of POSITION ONLY — see the semantics note at the top of this file. */
export function landHeight(x: number, z: number, amplitude = LAND_RELIEF_AMPLITUDE): number {
  let h = 0;
  for (const [kx, kz, weight, phase] of WAVES) h += Math.sin(x * kx + z * kz + phase) * weight;
  return h * amplitude;
}

/** The largest height the field can reach at this amplitude — the sum of the wave weights,
 *  which every component hits together only in principle but which bounds the field exactly.
 *  `planet/planet.ts` uses this bound for the tangent plates' clearance above the globe shell. */
export function landHeightRange(amplitude = LAND_RELIEF_AMPLITUDE): number {
  return WAVES.reduce((s, [, , weight]) => s + Math.abs(weight), 0) * Math.abs(amplitude);
}

export interface LandGradientResult { dx: number; dz: number }

/** The field's gradient `[dh/dx, dh/dz]`. Analytic rather than sampled: a finite-difference
 *  normal is a function of the step you happened to pick, and on a banded material a
 *  slightly-wrong normal is not a slightly-wrong colour — it is a different rung. */
export function landGradient(
  x: number,
  z: number,
  amplitude = LAND_RELIEF_AMPLITUDE,
): LandGradientResult {
  let dx = 0;
  let dz = 0;
  for (const [kx, kz, weight, phase] of WAVES) {
    const c = Math.cos(x * kx + z * kz + phase) * weight;
    dx += c * kx;
    dz += c * kz;
  }
  return { dx: dx * amplitude, dz: dz * amplitude };
}
