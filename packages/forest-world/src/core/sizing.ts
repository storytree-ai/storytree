// Capability 1 · Scene layout. Territory sizing — the pure curves that turn a story's capability count into the hex tiles its
// island is laid on (ADR-0093, ADR-0528 D1). The globe's `forest-ground.ts` lays each island's hexes
// with `tileQuota` and `ringsOf`. 0.2's crown, reach and art rungs went with the flat canvas
// (ADR-0920).

import { HEX_TILES_PER_CAPABILITY } from './hex.js';

/**
 * THE TILE QUOTA — how many hexes an island is drawn on (ADR-0528 D1): one tile per capability, so a
 * drawn island's footprint is exactly `capabilities × LAND_AREA_PER_CAPABILITY`. The retired
 * `max(3, capabilities + 2)` gave "a tile per capability plus breathing room" for the story tree's
 * own tile and the coast's lobing; the 3D map retired the story tree (ADR-0508) and sizes the island
 * from the ratio alone (ADR-0520). The FLOOR of one tile is structural, not by eye: a lattice island
 * cannot be drawn on none, and a story with no capabilities yet has no land to read — it stands on
 * the smallest tile the lattice has, and `sizeIslandsByCapability` sizes an island with no capability
 * parcels as one capability's worth (`LAND_FLOOR_CAPABILITIES`).
 */
export function tileQuota(capabilities: number): number {
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE HEX_TILES_PER_CAPABILITY IS 1 —
  // the same `k = 1` equivalence `HEX_R` carries; re-picking `k` makes the mutant killable.
  return Math.max(1, capabilities) * HEX_TILES_PER_CAPABILITY;
}

/** Hex rings a territory of `quota` tiles roughly fills (1 / 7 / 19 / 37 centred counts). */
export function ringsOf(quota: number): number {
  return quota <= 1 ? 0 : quota <= 7 ? 1 : quota <= 19 ? 2 : 3;
}
