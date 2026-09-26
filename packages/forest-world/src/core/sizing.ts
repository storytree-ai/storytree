// Territory + tree sizing — the pure curves that turn a story's tile quota and
// capability count into pixel radii. The studio's CANONICAL numbers (ADR-0093):
// crown grows with capability count; island radius with the tile quota.
//
// `estRadius`/`crownRadius` stay GROUND/plan-view quantities deliberately: `estRadius` feeds the
// row/column LAYOUT spacing (a hex-lattice distance, projected the same way every other lattice
// distance is, by `hexCenter`/`pixelToHex`'s own round trip — ADR-0367 D1) and `crownRadius` feeds
// the story tree's own hand-drawn SVG geometry, an app-owned 2D icon that is not itself projected
// through the land camera (ADR-0367 D3). `storyTreeReach` is the one exception: it is added
// directly against an already-PROJECTED screen coordinate (`treeSpot.y`) to size the scene's
// vertical bounds, so — like `TILE_DEPTH` in `hex.ts` — it carries the camera's UPRIGHT
// foreshortening (cos θ) itself rather than leaving the call site to remember to apply it.

import { HEX_R, HEX_TILES_PER_CAPABILITY, HEX_W, TILE_SCALE } from './hex.js';
import { LAND_CAMERA_ELEVATION_DEG, uprightForeshortening } from './camera.js';

/**
 * THE TILE QUOTA — how many hexes an island is drawn on (ADR-0528 D1): one tile per capability, so a
 * drawn island's footprint is exactly `capabilities × LAND_AREA_PER_CAPABILITY`. The retired
 * `max(3, capabilities + 2)` gave "a tile per capability plus breathing room" for the story tree's
 * own tile and the coast's lobing; the 3D map retired the story tree (ADR-0508) and sizes the island
 * from the ratio alone (ADR-0520), and the 2D map now draws the same island. The FLOOR of one tile is
 * structural, not by eye: a lattice island cannot be drawn on none, and a story with no capabilities
 * yet has no land to read — it stands on the smallest tile the lattice has, and the 3D mapper leaves
 * an island with no capability parcels as drawn (ADR-0520 D1).
 */
export function tileQuota(capabilities: number): number {
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE HEX_TILES_PER_CAPABILITY IS 1 —
  // the same `k = 1` equivalence `HEX_R` carries; re-picking `k` makes the mutant killable.
  return Math.max(1, capabilities) * HEX_TILES_PER_CAPABILITY;
}

/**
 * THE STORY TREE'S DRAWING SCALE — the 2D art pass's rung for the central tree (ADR-0528 D2).
 * `crownRadius` is the tree's radius in its OWN drawing frame (the curve the tree sprite was
 * authored against); this factor is what the frame is scaled by onto the derived tile. At
 * `TILE_SCALE` the tree keeps the exact on-screen size it had at the designed resting view (the view
 * is pinned to island count), which is the baseline every other rung is judged against on the
 * increment's 2D sheet. Above it the tree grows relative to its island; the island shrank harder than
 * the lattice on small stories (one hex where there were three), so the tree already reads larger on
 * those without any help.
 */
export const TREE_ART_RUNG = 1;
// Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE TREE_ART_RUNG IS 1 — the rung is
// the owner's dial and ships at 1, so `×` and `÷` agree; moving it off 1 makes the mutant killable.
export const TREE_SCALE = TILE_SCALE * TREE_ART_RUNG;

/** The nameplate's rung (ADR-0528 D2) — the 2D map is a WORKING tool and the plate is what an
 *  operator reads a story's id and state off, so this is the rung the increment's sheet judges
 *  hardest, at the working zoom. 1 = the plate keeps its resting-view size. */
export const PLATE_ART_RUNG = 1;
/** The parcel flora's rung (ADR-0528 D2). 1 = the grass and shrubs keep their resting-view size. */
export const FLORA_ART_RUNG = 1;
/** The 2D trail stroke's rung (ADR-0528 D2), on `trailFillWidth` — the ONE width rule the 3D mapper
 *  reads directly and which therefore never moves. 1 = the 2D trail keeps its resting-view width;
 *  `1 / TILE_SCALE` would stroke it as wide relative to its island as the 3D ribbon is. */
export const TRAIL_ART_RUNG = 1;

/** Hex rings a territory of `quota` tiles roughly fills (1 / 7 / 19 / 37 centred counts). */
export function ringsOf(quota: number): number {
  return quota <= 1 ? 0 : quota <= 7 ? 1 : quota <= 19 ? 2 : 3;
}

/** Rough px radius a territory will grow to from its tile quota. */
export function estRadius(quota: number): number {
  return Math.sqrt(quota) * HEX_W * 0.62 + HEX_R;
}

/** Crown radius of the central story tree in the tree's OWN drawing frame — grows with capability
 *  count. Multiply by {@link TREE_SCALE} for the ground-unit size ({@link crownRadiusWorld}); the
 *  builders that draw the tree inside a `scale(TREE_SCALE)` wrapper read this one. */
export function crownRadius(capCount: number): number {
  return Math.min(32, 18 + 2.2 * capCount);
}

/** The story tree's crown radius in GROUND units — what a keep-out, a ring radius or a fit measures
 *  against once the tree is drawn at {@link TREE_SCALE}. */
export function crownRadiusWorld(capCount: number, treeScale: number = TREE_SCALE): number {
  return crownRadius(capCount) * treeScale;
}

/**
 * How far above its base a story tree reaches ON SCREEN — the withered bare branches top out at
 * 2.64·R and the canopy at ~2.7·R (StoryTree geometry); +18 covers blob jitter and the signpost.
 * `buildWorld` subtracts this directly from an already-projected `treeSpot.y` for the scene's
 * vertical bounds, so it carries the land camera's upright foreshortening (cos θ) the same way
 * `TILE_DEPTH` does — an EXTRUSION/upright measure, not a ground-plane one (ADR-0367 D1).
 */
export function storyTreeReach(
  capCount: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): number {
  return (2.72 * crownRadius(capCount) + 18) * TREE_SCALE * uprightForeshortening(elevationDeg);
}
