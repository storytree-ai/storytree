// wear-atlas.ts — THE DISTANCE-TO-PATH FIELD, PACKED OVER THE ISLANDS AND DELIVERED TO THE
// FRAGMENT STAGE. Layer 3's carrier, riding the SAME tiles the shore field rides.
//
// ⚠⚠ IT RIDES THE OCCLUSION ATLAS'S OWN TILES, for exactly the reason `shore-atlas.ts` gives: the
// mesh carries one `atlasOrigin` attribute and the material one `uShadowAtlasScale`, and every
// field that wants to be sampled per fragment on this ground reads through them. Taking the built
// occlusion field and returning its `tiles` object makes "the wear and the shadow agree about
// where each island's tile sits" structural rather than two packings that happen to match.
//
// ⚠⚠ AN ISLAND WITH NO PATH IS LEFT AT 255 — THERE IS NO WHOLE-MAP FALLBACK, AND THAT IS THE ONE
// PLACE THIS DELIBERATELY DIFFERS FROM THE SHORE ATLAS. `buildAtlasShore` falls back to the whole
// map's coast when a tile's island id finds no cells, because an island with no coast at all is a
// missing beach, and a slower correct answer beats a silently absent one. The wear has no such
// fallback because the analogous move is WRONG rather than slow: an island no trail reaches has
// no path, and handing its tile every other island's paths would draw, on an unvisited island,
// the worn track of whichever island's path happened to fall inside its tile's ground rect — a
// road to nowhere on land nobody crossed. 255 encodes "at or past the falloff", which `wearOf`
// turns into zero wear, so an unwritten texel draws exactly what the ground drew before the layer.
//
// ⚠ ONE READER PER ISLAND, built from that island's OWN paths and nothing else. It is a cost
// decision with the shore's argument (a tile is one island) and, unlike the shore's, also a
// correctness one: see the paragraph above.

import { WEAR_FALLOFF } from './land-wear.js';
import type { CoastPoint } from './coast-clip.js';
import { blitTile, type AtlasField } from './shadow-atlas.js';
import { shoreTileField } from './shore-atlas.js';
import { wearField } from './trail-wear.js';

/**
 * HOW FAR FROM THE PATH THE FIELD IS RESOLVED, in ground units — the wear falloff itself.
 * `wearOf` reads `1 - d / falloff` clipped to [0, 1], so a distance at or past the falloff
 * delivers zero wear whatever its exact value; the field's cap and the shader's falloff are ONE
 * number, and a field built narrower than the falloff it feeds would deliver a path that stops
 * and then STEPS, the same defect `shore-atlas.ts` names for a shore field narrower than its band.
 */
export const WEAR_FIELD_WIDTH = WEAR_FALLOFF;

/**
 * THE WHOLE MAP'S WEAR FIELD, over the occlusion atlas's own tiles.
 *
 * `pathsByIsland` is `islandPaths()`'s output — every path in the SAME (x, z) basis as the
 * clipped cells, keyed by island id. Each tile samples `wearField` over its own island's paths
 * at the texel's own corner, through `shoreTileField` and `encodeShore` with THIS width, so the
 * byte a fragment decodes is `distance / width` over 0..255 exactly as the shore's is.
 */
export function buildAtlasWear(
  pathsByIsland: ReadonlyMap<string, readonly (readonly CoastPoint[])[]>,
  occlusion: AtlasField,
  width: number = WEAR_FIELD_WIDTH,
): AtlasField {
  const data = new Uint8Array(occlusion.w * occlusion.h);
  // ⚠ THE ATLAS STARTS FULL, NOT EMPTY. Zero encodes distance ZERO — the path's centreline — so
  // an untouched texel would read as "on the path" and deliver pure dirt: every gap between tiles
  // and every unvisited island as a dirt-coloured rectangle. 255 is "past the falloff", i.e. no
  // wear, which makes an unwritten texel deliver exactly what the ground drew before this layer.
  data.fill(255);
  for (const tile of occlusion.tiles) {
    // ⚠ NO `?? everything` HERE — the header says why. An island the map holds no paths for keeps
    // its 255 fill; nothing is drawn on land no trail crossed.
    const own = pathsByIsland.get(tile.island);
    if (own === undefined) continue;
    blitTile(data, occlusion.w, tile, shoreTileField(wearField(own, width), tile, occlusion.gres, width));
  }
  return {
    w: occlusion.w,
    h: occlusion.h,
    gres: occlusion.gres,
    data,
    tiles: occlusion.tiles,
    // No caster is assigned here — the path is a property of where the trails land, not of
    // anything standing on the ground. Stated rather than omitted so the shared shape reads honestly.
    unassigned: 0,
  };
}
