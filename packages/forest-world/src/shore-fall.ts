// Capability 6 · The planet. What is left of the shore fall: how far its waterline sat below the grass line.
// The relief that fell to that waterline went with the last road that stood on it (2026-10-06):
// roads now end on the island as drawn (`planet/island-surface.ts`). `planet/planet.ts` still
// sizes PLATE_CLEARANCE by this dip, which sets where every island surface sits above the shell.

import { LAND_SCALE } from './land-per-capability.js';

/** The reference generator's own beach dip — how far below the grass line the waterline sits, in
 *  ground units. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const SHORE_DIP = 0.62 * LAND_SCALE;
