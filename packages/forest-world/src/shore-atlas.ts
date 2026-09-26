// shore-atlas.ts — THE DISTANCE-TO-COAST FIELD, PACKED OVER THE ISLANDS AND DELIVERED TO THE
// FRAGMENT STAGE. Layer 2's carrier, and layer 3's after it.
//
// ⚠⚠ IT IS A GROUND-SPACE TEXTURE AND NOT A VERTEX ATTRIBUTE, WHICH IS ADR-0490 D4 AND NOT A
// PREFERENCE. In `build_land.py` the shore value is a per-vertex attribute on a 0.55-unit grid.
// The shipped mesh's ground vertices lie either exactly ON the coast or >= 8.66 units inland —
// about 16x coarser than the feature — so a vertex attribute is smeared away entirely between
// them: the sand band would be a linear ramp across a parcel rather than a band along the water.
// Sampled per fragment from a field at {@link SHADOW_GRES} = 3 samples per ground unit, the
// delivered spacing is 0.33 units, which is FINER than the 0.55 Blender authored against. So the
// mechanism is not an approximation of the recipe here; it is the recipe at better resolution.
//
// ⚠⚠ IT RIDES THE OCCLUSION ATLAS'S OWN TILES, AND THAT IS THE WHOLE DESIGN. The mesh already
// carries one `atlasOrigin` attribute and the material already carries one `uShadowAtlasScale`;
// a second packing would need a second attribute and a second scale, and the two would have to
// AGREE about where each island's tile sits. This module takes the built occlusion field and
// reads its `tiles` — so the agreement is structural rather than two computations that happen to
// match today. When it broke, every island would read another island's stretch of coast and wear
// a sand band belonging to the wrong shape of land, which is the failure `shadow-atlas.ts`
// already records paying for once.
//
// ⚠ WHY A SECOND TEXTURE RATHER THAN A SECOND CHANNEL OF THE FIRST. The occlusion atlas is
// `RedFormat` / `UnsignedByteType` — one byte per texel. Widening it to two channels would double
// the payload of a texture every committed shadow figure was measured against and would put this
// layer's bytes on the shadow's ledger. A second single-channel texture over the same tiles keeps
// the shadow path BYTE-IDENTICAL, which is the claim the whole banded-ground line of work rests
// on, and costs one sampler and one fetch.

import {
  SHADOW_GRES,
  indices,
  type ShadowField,
} from './land-shadow.js';
import { blitTile, type AtlasField, type AtlasTile } from './shadow-atlas.js';
import { AUTHORED_SHORE_WIDTH, shoreField } from './shore-fall.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SAND_SHIPPED_DIVISOR } from './land-sand.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/**
 * HOW FAR INLAND THE FIELD IS RESOLVED, in ground units — and it is DERIVED from the recipe's own
 * arithmetic rather than chosen.
 *
 * `build_land.py:880` divides the shore value by `BEACH + 0.9`, and `:878` puts the sand ramp's
 * upper stop at 0.70 — so the largest shore distance that can still change a delivered pixel is
 * `0.70 * (BEACH + 0.9)`, about 2.8 units. Past that every fragment is pure grass whatever the
 * exact distance is.
 *
 * ⚠ THE FIELD IS BUILT TO THE FULL DIVISOR, NOT TO THAT PRODUCT, and the margin is load-bearing:
 * the recipe adds a 0..1 noise to the distance BEFORE dividing (`:872-876`), so a fragment at 2.8
 * units can still be pushed under the ramp's top by the noise. Capping at 2.8 would clip the very
 * break-up the noise exists to create, and it would do it invisibly — as a sand line that goes
 * subtly straight exactly where the noise was trying hardest.
 *
 * ⚠ AND `ShoreSample.distance` IS CAPPED AT THE FIELD'S WIDTH, so this constant is what the cap
 * is; it is not merely how far we bothered to look.
 */
export const SAND_FIELD_WIDTH = SAND_SHIPPED_DIVISOR;

/** The RECIPE's own field width, kept so a comparison arm can build the transcribed band and be
 *  measured against the widened one on the same instrument. */
export const SAND_RECIPE_FIELD_WIDTH = AUTHORED_SHORE_WIDTH + 0.9 * LAND_SCALE;

/**
 * THE BYTE ENCODING — `distance / SAND_FIELD_WIDTH`, clamped, over 0..255.
 *
 * ⚠ THE QUANTISER IS NOT THE RESOLUTION LIMIT AND IT IS WORTH SAYING SO. A byte over 4.0 units is
 * 0.0157 units per step, while the field's own spacing is 0.33 — twenty times coarser. So the
 * transport carries more precision than the field has, which is the right way round: the reverse
 * (storing more precision than the transport carries) is the lie `ShadowField` names in its own
 * comment.
 */
export function encodeShore(distance: number, width: number = SAND_FIELD_WIDTH): number {
  const t = Math.max(0, Math.min(1, distance / width));
  return Math.round(t * 255);
}

/** The inverse, for the pure twin of the shader — so a test can state what a fragment reads
 *  without a GPU, through the same rounding the texture actually carries. */
export function decodeShore(byte: number, width: number = SAND_FIELD_WIDTH): number {
  return (byte / 255) * width;
}

/**
 * ONE TILE'S SHORE FIELD — the same grid `buildGroundOcclusion` produces for the same tile, so
 * {@link blitTile}'s size refusal is a real check rather than one that can never fire.
 *
 * ⚠ THE SAMPLE POINT IS THE TEXEL'S OWN CORNER, `minX + i / gres`, which is what
 * `occlusionGrid` uses. A half-texel offset here would shift the whole sand band by an eighth of
 * a unit against the shadows on the same island — small, systematic, and attributable to nothing.
 */
export function shoreTileField(
  reader: { sample(x: number, z: number): { distance: number } },
  tile: AtlasTile,
  gres: number,
  width: number = SAND_FIELD_WIDTH,
): ShadowField {
  const data = new Uint8Array(tile.w * tile.h);
  for (const j of indices(tile.h)) {
    const z = tile.bounds.minZ + j / gres;
    for (const i of indices(tile.w)) {
      data[j * tile.w + i] = encodeShore(reader.sample(tile.bounds.minX + i / gres, z).distance, width);
    }
  }
  return { minX: tile.bounds.minX, minZ: tile.bounds.minZ, w: tile.w, h: tile.h, gres, data };
}

/**
 * THE WHOLE MAP'S SHORE FIELD, over the occlusion atlas's own tiles.
 *
 * ⚠⚠ IT TAKES THE BUILT OCCLUSION FIELD RATHER THAN RE-PACKING, which is what makes "the two
 * atlases agree about where each island is" true by construction. See the header.
 *
 * ⚠ AND IT READS THE CLIPPED DESCRIPTORS, for the reason `shoreField` states at length: after
 * `clipToCoast` the boundary of the mesh IS the coast, so the distance to the mesh's rim is the
 * distance to the water. Handed the pre-clip parcels it would measure to the hex silhouette and
 * lay the sand a beach's width inland of the sea.
 */
export function buildAtlasShore(
  cells: readonly InstanceDescriptor[],
  occlusion: AtlasField,
  /** ⚠ THE FIELD'S CAP AND THE SHADER'S DIVISOR MUST BE THE SAME NUMBER. A field built narrower
   *  than the band it feeds delivers a beach that stops at the field's cap and then STEPS — which
   *  reads as a defect in the edge noise rather than in a constant. `buildGroundMaterial` passes
   *  one value to both. */
  width: number = SAND_FIELD_WIDTH,
): AtlasField {
  const data = new Uint8Array(occlusion.w * occlusion.h);
  // ⚠ THE ATLAS STARTS FULL, NOT EMPTY. Zero encodes distance ZERO — the waterline — so an
  // untouched texel would read as "this fragment is exactly on the coast" and deliver pure sand.
  // Every gap between tiles, and every island whose tile the loop somehow missed, would come out
  // as a sand-coloured rectangle. 255 is "far inland", i.e. pure grass: the value that makes an
  // unwritten texel deliver what the ground drew before this layer existed.
  data.fill(255);

  // ⚠⚠ ONE READER PER ISLAND, NOT ONE FOR THE MAP, AND IT IS A COST DECISION WITH NO EFFECT ON THE
  // ANSWER. `shoreField.sample` walks every coast loop, pruning by bounding box — so a whole-map
  // reader charges every texel 35 box tests to reach the one loop that can possibly win. A tile
  // IS one island, and `shoreField`'s own header states the geometric reason the nearest loop is
  // always the containing island's: a point inside island A must cross A's rim and the open sea to
  // reach B's. So restricting each tile to its own island's cells returns identical distances and
  // stops paying for the other 34.
  const byIsland = bucketByIsland(cells);
  for (const tile of occlusion.tiles) {
    // ⚠ FALLING BACK TO THE WHOLE MAP rather than to an empty ring: a tile whose island id finds no
    // cells would otherwise get a reader with no coast, and every texel would read "far inland" —
    // an island silently missing its entire beach, which is far worse than being slow.
    const own = byIsland.get(tile.island) ?? cells;
    blitTile(
      data,
      occlusion.w,
      tile,
      shoreTileField(shoreField(own, width), tile, occlusion.gres, width),
    );
  }

  return {
    w: occlusion.w,
    h: occlusion.h,
    gres: occlusion.gres,
    data,
    tiles: occlusion.tiles,
    // No caster is assigned here — the shore is a property of the land's own shape, not of
    // anything standing on it. Stated rather than omitted so the shared shape reads honestly.
    unassigned: 0,
  };
}

/** The field's own spacing in ground units, for the evidence sheet — the number the "finer than
 *  Blender's 0.55" claim is made of, derived rather than repeated. */
export function shoreSampleSpacing(gres: number = SHADOW_GRES): number {
  return 1 / gres;
}

/**
 * THE MAP'S CELLS, GROUPED BY THEIR ISLAND — the per-tile reader's input.
 *
 * ⚠⚠ IT IS EXPORTED SO IT CAN BE TESTED DIRECTLY, and that is a `check:mutation-diff` finding
 * rather than a preference. Inlined in {@link buildAtlasShore} every way this can break ends at
 * that function's `?? cells` fallback, which computes the IDENTICAL field from the whole map's
 * coast and merely pays for the other islands — so five separate mutants inside it survived every
 * assertion about a delivered distance. The grouping is real logic with a real contract; the
 * fallback is what stops a mistake being VISIBLE, not what stops it being a mistake.
 *
 * ⚠ AN ISLAND-LESS CELL BUCKETS UNDER THE EMPTY STRING rather than being dropped. Dropping it
 * would leave its coast out of every reader, so an island assembled from unlabelled parcels would
 * silently lose its whole shore — and `shadow-atlas.ts` already gives the empty string a name
 * (`UNHOMED_ISLAND`) precisely because the shipped stream can contain one.
 */
export function bucketByIsland(
  cells: readonly InstanceDescriptor[],
): ReadonlyMap<string, InstanceDescriptor[]> {
  const byIsland = new Map<string, InstanceDescriptor[]>();
  for (const cell of cells) {
    const id = cell.island ?? '';
    const bucket = byIsland.get(id);
    if (bucket === undefined) byIsland.set(id, [cell]);
    else bucket.push(cell);
  }
  return byIsland;
}
