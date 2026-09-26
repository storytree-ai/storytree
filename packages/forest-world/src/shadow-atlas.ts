// shadow-atlas.ts — THE OCCLUSION FIELD, ALLOCATED OVER THE ISLANDS RATHER THAN OVER THE RECT
// THAT CONTAINS THEM. Pure, browser-free, node:test-provable — it imports the shared occlusion
// grid and the field builders and adds a packing, nothing else.
//
// WHAT PROBLEM THIS IS. `occlusionGres` is `min(SHADOW_GRES, SHADOW_TEXTURE_MAX / widestSpan)`,
// and the span it divides by is the whole GROUND's — so one island (234 units) gets the authored
// 3.000 samples per ground unit and a thirty-five-island forest (~3,500 units) gets 0.585, which
// is 5.1x coarser in each axis. The contact pool under a story tree stops being a soft round
// shadow and becomes a shrunken jagged blob. That is measured, not argued:
// `docs/research/chapter2-shipped-crowd-2026-08-31/` section 4.
//
// ⚠ AND THE EMPTINESS IS WHERE THE ANSWER IS. The forest's field is occluded on 0.16% of its
// samples against one island's 3.11% — a twentyfold dilution that is not the shadow getting
// sparser but the FIELD getting mostly-water. Thirty-five islands of 234 x 46 units cover about
// 4.7% of the rect that contains them; the other 95.3% is open sea that will never be occluded by
// anything, allocated at full resolution because a texture is a rectangle and the islands are not.
//
// SO: ONE TEXTURE, ONE MATERIAL, ONE DRAW — and the islands packed into it side by side, each at
// the authored resolution, with the sea between them left out of the allocation entirely.
//
// ⚠⚠ WHY A PER-VERTEX ATTRIBUTE IS ADMISSIBLE HERE WHEN IT WAS REJECTED FOR THE SHADOW ITSELF,
// which is the one thing about this file a reader will suspect. `land-shadow.ts` rejected a
// per-vertex shadow attribute because the mesh is a triangle fan per parcel on parcels whose mean
// diameter is 16.57 ground units, and a shadow ~13 units long carries features FINER than that —
// so interpolating it across a parcel smears it into a lighting bug. The atlas ORIGIN is not a
// spatial signal at all: it is one constant per ISLAND, identical at all three vertices of every
// triangle on that island, so the interpolator returns it exactly. It is the same argument
// `banded-ground-material.ts` already makes about `vStatus`, one rider further along. The field
// stays sampled in the fragment stage at its own resolution; only WHICH PART of the texture a
// fragment reads is carried by the mesh.
//
// ⚠ AND BILINEAR FILTERING AT A TILE EDGE IS ALREADY PAID FOR, by a constant that exists for a
// different reason. {@link OCCLUSION_PAD} extends every island's field two ground units past its
// own bounds so a shadow leaning off the coast is not cut off; at {@link SHADOW_GRES} that is six
// texels of margin between an island's own land and its tile's border, and a bilinear tap reaches
// one. A tile can therefore never bleed its neighbour under any ground the mesh actually covers.
// If the pad were ever reduced below one texel this file would need its own gutter — which is why
// {@link tileMargin} exists to say what the margin currently is rather than leaving it implied.

import { buildGroundOcclusion, type ContactBand, type GroundOcclusionOptions } from './contact-shade.js';
import type { InstanceDescriptor } from './world-to-3d.js';
import {
  OCCLUSION_PAD,
  SHADOW_GRES,
  axisSpan,
  indices,
  type GroundBounds,
  type ShadowCaster,
  type ShadowField,
} from './land-shadow.js';

/**
 * The largest atlas edge, in texels.
 *
 * ⚠ IT IS NOT {@link SHADOW_TEXTURE_MAX} AND THE DIFFERENCE IS THE POINT. That cap bounds a field
 * allocated over a RECT, where every texel past the islands is sea; this one bounds a field
 * allocated over the islands themselves, where every texel is land somebody might stand on. The
 * two caps buy different things at the same nominal size, so a shared number would be a
 * coincidence dressed as a rule.
 *
 * 4096 rather than 2048 because thirty-five tiles of 714 x 150 texels need 3.75 million texels and
 * a 2048-wide shelf fits only two of them per row — 2048 x 2700, which exceeds a 2048 edge in the
 * other axis. It is also the widest edge this package may assume: WebGL 2 guarantees 2048 and
 * every desktop and current mobile GPU reports at least 4096, so the instrument READS
 * `MAX_TEXTURE_SIZE` off the renderer rather than trusting this number.
 */
export const SHADOW_ATLAS_MAX = 4096;

/** How many times {@link packShadowAtlas} may shrink the resolution before giving up. A refit
 *  scales the tiles by the ratio it overshot by, so it converges in two or three; the bound is a
 *  loop that cannot hang rather than a budget anybody is meant to spend. */
export const ATLAS_REFIT_ATTEMPTS = 8;

/** One island's ground rect, keyed by the island id the descriptor stream carries. */
export interface IslandBounds {
  island: string;
  bounds: GroundBounds;
}

/** One island's place in the atlas. */
export interface AtlasTile {
  island: string;
  /** Texel origin of the tile within the atlas. */
  x: number;
  y: number;
  /** Tile size in texels — the island's PADDED extent at the atlas resolution. */
  w: number;
  h: number;
  /** Ground coordinate the tile's texel (0, 0) sits at — the island's bounds, less the pad. */
  minX: number;
  minZ: number;
  /** The island's OWN rect, unpadded.
   *
   *  ⚠ CARRIED RATHER THAN LOOKED UP, and that is a mutation-rung finding as much as a
   *  convenience. A builder that took a layout and then re-found each tile's island in the list it
   *  was packed from needed an `if (island === undefined) continue` for a case that cannot arise —
   *  an unreachable branch, which is a survivor no test can ever kill and which reads to a later
   *  reader as a case somebody handled. */
  bounds: GroundBounds;
}

/** Where every island sits in one packed texture. */
export interface AtlasLayout {
  /** Atlas size in texels. */
  w: number;
  h: number;
  /** Samples per ground unit — the SAME for every tile, which is what lets the shader carry one
   *  scale as a uniform and only the origin per vertex. */
  gres: number;
  tiles: readonly AtlasTile[];
}

/**
 * EVERY ISLAND'S OWN GROUND RECT, from the descriptor stream.
 *
 * ⚠ CELLS WITH NO ISLAND ID ARE NOT SILENTLY MERGED INTO A NEIGHBOUR — they are grouped under
 * their own key, {@link UNHOMED_ISLAND}. `InstanceDescriptor.island` is set on every `cell-ground`
 * the shipped mapper emits, but a fixture or an older stream may carry none, and folding those
 * cells into whichever island happened to be first would put their shadow in another island's
 * tile: a contact pool drawn on the wrong land, which looks like a rendering artefact.
 *
 * ⚠ SORTED BY ISLAND ID, so the packing below is a function of the descriptors and not of their
 * arrival order. Two runs over the same map must produce the same atlas or a committed picture is
 * a picture of one particular shuffle.
 */
export function islandGroundBounds(cells: readonly InstanceDescriptor[]): IslandBounds[] {
  const byIsland = new Map<string, GroundBounds>();
  for (const cell of cells) {
    const key = cell.island ?? UNHOMED_ISLAND;
    for (const p of cell.points ?? []) {
      const seen = byIsland.get(key);
      if (seen === undefined) {
        byIsland.set(key, { minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z });
      } else {
        seen.minX = Math.min(seen.minX, p.x);
        seen.maxX = Math.max(seen.maxX, p.x);
        seen.minZ = Math.min(seen.minZ, p.z);
        seen.maxZ = Math.max(seen.maxZ, p.z);
      }
    }
  }
  return [...byIsland.entries()]
    .map(([island, bounds]) => ({ island, bounds }))
    .sort((a, b) => byIslandId(a.island, b.island));
}

/** Order two island ids. ONE function rather than the same ternary in two sorts: written twice,
 *  each copy's `<` and `>` are separate mutants, and a test that pins the order in one place
 *  proves nothing about the other. */
export function byIslandId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The key cells carrying no island id are grouped under. A real id, so a tile lookup for it
 *  behaves like any other rather than needing an absent case at every call site. */
export const UNHOMED_ISLAND = '';

/** A tile's texel size at a resolution — the island's padded extent, rounded up, never below one
 *  sample. Extracted because the same arithmetic decides whether a layout FITS and where the next
 *  tile starts, and two copies could disagree by a texel in exactly the case that matters. */
export function tileEdge(span: number, gres: number): number {
  return Math.max(1, Math.ceil(span * gres));
}

/** Texels of margin between an island's own land and its tile's border, at a resolution. A
 *  bilinear tap reaches ONE texel, so anything above one is a tile that cannot bleed its
 *  neighbour. Named rather than asserted inline because the pad it reads exists for a different
 *  reason and could move for that reason. */
export function tileMargin(gres: number = SHADOW_GRES): number {
  return OCCLUSION_PAD * gres;
}

/**
 * SHELF PACKING, at a GIVEN resolution — or `null` when the tiles do not fit inside `max`.
 *
 * Tiles are placed left to right along a shelf; a tile that does not fit starts a new shelf below
 * the tallest one so far. Sorted TALLEST FIRST, which is what makes shelf packing tight rather
 * than merely simple: a short tile landing on a tall shelf wastes that shelf's whole height.
 *
 * ⚠ THE TIE-BREAK IS THE ISLAND ID, not the input order, for the same reason `islandGroundBounds`
 * sorts: identical islands are exactly the case where a stable order is invisible until a picture
 * changes between two runs that measured the same thing.
 */
export function shelfPack(
  islands: readonly IslandBounds[],
  gres: number,
  max: number = SHADOW_ATLAS_MAX,
): AtlasLayout | null {
  const sized = islands
    .map((i) => ({
      island: i.island,
      bounds: i.bounds,
      minX: i.bounds.minX - OCCLUSION_PAD,
      minZ: i.bounds.minZ - OCCLUSION_PAD,
      w: tileEdge(axisSpan(i.bounds.minX, i.bounds.maxX), gres),
      h: tileEdge(axisSpan(i.bounds.minZ, i.bounds.maxZ), gres),
    }))
    .sort((a, b) => b.h - a.h || byIslandId(a.island, b.island));

  const tiles: AtlasTile[] = [];
  let penX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let widest = 0;
  for (const t of sized) {
    // A tile wider than the whole atlas can never be placed at this resolution, whatever the
    // shelf state — reported as "does not fit" rather than as an infinite loop of new shelves.
    if (t.w > max) return null;
    if (penX + t.w > max) {
      penX = 0;
      shelfY += shelfH;
      shelfH = 0;
    }
    if (shelfY + t.h > max) return null;
    tiles.push({
      island: t.island,
      x: penX,
      y: shelfY,
      w: t.w,
      h: t.h,
      minX: t.minX,
      minZ: t.minZ,
      bounds: t.bounds,
    });
    penX += t.w;
    widest = Math.max(widest, penX);
    shelfH = Math.max(shelfH, t.h);
  }
  return { w: Math.max(1, widest), h: Math.max(1, shelfY + shelfH), gres, tiles };
}

/**
 * THE ATLAS FOR THIS SET OF ISLANDS — at the authored resolution where it fits, and at the
 * highest resolution that does fit where it does not.
 *
 * ⚠ IT DEGRADES THE SAME WAY `occlusionGres` DOES, and that is deliberate rather than inherited:
 * a map big enough to overflow even a packed atlas must go coarser rather than refuse, because
 * refusing is a black island and coarsening is a soft shadow. What changes is WHEN — the rect
 * form reaches its cap at ~680 ground units of span and this reaches it at about twenty times the
 * land area, so the degradation stops being something an ordinary map can provoke.
 *
 * The refit scales by the ratio it overshot by rather than by a fixed step, so it converges in
 * two or three attempts; {@link ATLAS_REFIT_ATTEMPTS} bounds it so a pathological set cannot hang
 * the canvas.
 */
export function packShadowAtlas(
  islands: readonly IslandBounds[],
  gres: number = SHADOW_GRES,
  max: number = SHADOW_ATLAS_MAX,
): AtlasLayout {
  let attempt = gres;
  for (const _ of indices(ATLAS_REFIT_ATTEMPTS)) {
    const layout = shelfPack(islands, attempt, max);
    if (layout !== null) return layout;
    attempt *= atlasShrink(islands, attempt, max);
  }
  throw new Error(
    `shadow-atlas: ${islands.length} islands do not fit a ${max}x${max} atlas at any resolution ` +
      `reached in ${ATLAS_REFIT_ATTEMPTS} attempts (from ${gres} samples per ground unit)`,
  );
}

/**
 * How much to shrink a resolution that did not fit.
 *
 * The tiles' total AREA scales with the square of the resolution, so the ratio that would fit the
 * area inside the atlas is the square root of the budget over the need. It is multiplied by
 * {@link ATLAS_SHRINK_MARGIN} because a packing wastes some of the atlas and an area that exactly
 * fills it never packs — without the margin the loop would spend every attempt asymptotically
 * approaching a resolution that is still one texel too large.
 */
export function atlasShrink(
  islands: readonly IslandBounds[],
  gres: number,
  max: number = SHADOW_ATLAS_MAX,
): number {
  let need = 0;
  for (const i of islands) {
    need +=
      tileEdge(axisSpan(i.bounds.minX, i.bounds.maxX), gres) *
      tileEdge(axisSpan(i.bounds.minZ, i.bounds.maxZ), gres);
  }
  // ⚠ NO EMPTY-SET GUARD, and its absence is arithmetic rather than bravery: an empty set gives
  // `need` of 0, `max² / 0` is Infinity, `Math.min(1, Infinity)` is 1, and the margin comes back
  // unchanged — which is exactly what a guard would have returned. Written, it was a branch no
  // test could ever distinguish from its absence.
  return Math.min(1, Math.sqrt((max * max) / need)) * ATLAS_SHRINK_MARGIN;
}

/** The slack a refit leaves for packing waste. Below 1 by enough that a set needing exactly the
 *  atlas's area lands inside it. */
export const ATLAS_SHRINK_MARGIN = 0.95;

/** Texels in an atlas — its memory in bytes, because the field is a single-channel byte texture
 *  and saying "bytes" is what a reader is actually asking. */
export function atlasBytes(layout: AtlasLayout): number {
  return layout.w * layout.h;
}

/** What fraction of the atlas is a tile rather than packing waste. A layout that fills 89% of its
 *  texture is spending 11% on the shelf ends, and that number belongs in the comparison beside the
 *  memory rather than being inferred from it. */
export function atlasOccupancy(layout: AtlasLayout): number {
  let used = 0;
  for (const t of layout.tiles) used += t.w * t.h;
  // ⚠ NO DIVIDE-BY-ZERO GUARD, and its absence is deliberate. {@link shelfPack} floors both edges
  // at one sample, so an atlas is never zero texels — even the empty one is 1 x 1. A guard here
  // would be an unreachable branch: a mutant no test can kill, reading to a later reader as a case
  // somebody had handled.
  return used / atlasBytes(layout);
}

/** The tile an island landed in, or `undefined` for an island the layout never saw. */
export function tileOf(layout: AtlasLayout, island: string): AtlasTile | undefined {
  return layout.tiles.find((t) => t.island === island);
}

/**
 * THE LINEAR MAP FROM GROUND COORDINATES TO ATLAS UV, SPLIT INTO THE HALF THAT VARIES PER ISLAND
 * AND THE HALF THAT DOES NOT.
 *
 * A sample at ground `(gx, gz)` on island `i` sits at atlas texel
 * `(tile.x + (gx - tile.minX) * gres, tile.y + (gz - tile.minZ) * gres)`, so in UV
 *
 *     u = (tile.x - tile.minX * gres) / atlasW  +  gx * (gres / atlasW)
 *
 * — an ORIGIN that depends only on the island and a SCALE that is the same for every tile because
 * every tile is packed at one resolution. That split is what keeps the per-vertex cost at a vec2:
 * the scale rides as a uniform. Both halves come from here rather than being spelled at the two
 * call sites, because a shader and a test holding private copies of one derivation prove nothing
 * about each other.
 */
export interface AtlasUv {
  u: number;
  v: number;
}

export function atlasScale(layout: AtlasLayout): AtlasUv {
  return { u: layout.gres / layout.w, v: layout.gres / layout.h };
}

export function atlasOrigin(layout: AtlasLayout, island: string): AtlasUv {
  const tile = tileOf(layout, island);
  // An island with no tile gets the atlas's own origin rather than a NaN: a fragment reading
  // texel (0, 0) is an unshadowed fragment, which is what a missing tile honestly means, where a
  // NaN uv is an undefined sample and paints whatever the driver felt like.
  if (tile === undefined) return { u: 0, v: 0 };
  return {
    u: (tile.x - tile.minX * layout.gres) / layout.w,
    v: (tile.y - tile.minZ * layout.gres) / layout.h,
  };
}

/** An island id → its atlas origin, in the shape `cellGroundGeometry` takes. Curried here so the
 *  geometry builder never learns what a layout is. */
export function atlasOriginResolver(layout: AtlasLayout): (island: string | undefined) => AtlasUv {
  return (island) => atlasOrigin(layout, island ?? UNHOMED_ISLAND);
}

/** Which island each caster stands on, and which stand on none. */
export interface CasterAssignment {
  byIsland: Map<string, ShadowCaster[]>;
  /** Casters inside no island's padded bounds. Returned rather than dropped silently: a story
   *  tree whose shadow went missing because its island could not be identified is exactly the
   *  defect that reads as "the shadow just is not showing". */
  unassigned: ShadowCaster[];
}

/**
 * DOES THIS CASTER STAND ON THIS ISLAND? Against the PADDED bounds, so a tree on the very rim
 * belongs to it — {@link OCCLUSION_PAD} is exactly how far the island's own field extends past its
 * coast, so a caster inside that margin has somewhere for its pool to land.
 *
 * ⚠ ONE FUNCTION, FOUR COMPARISONS, AND IT IS THE ONLY PLACE THEY ARE WRITTEN. Spelled inline at
 * each call site, each copy carries its own `>=`-vs-`>` and its own `-`-vs-`+` on the pad; a
 * boundary test that pins one copy proves nothing about the others, and the copies are exactly
 * where they would silently disagree.
 */
export function casterWithin(
  bounds: GroundBounds,
  caster: ShadowCaster,
  pad: number = OCCLUSION_PAD,
): boolean {
  if (caster.x < bounds.minX - pad) return false;
  if (caster.x > bounds.maxX + pad) return false;
  if (caster.z < bounds.minZ - pad) return false;
  if (caster.z > bounds.maxZ + pad) return false;
  return true;
}

/**
 * ASSIGN EVERY CASTER TO THE ISLAND(S) IT STANDS ON.
 *
 * ⚠ A CASTER IN TWO ISLANDS' PADDED BOUNDS GOES TO BOTH, which needs two islands within four
 * ground units of each other and is correct rather than tolerated: the two tiles OVERLAP in ground
 * space there, so both draw the pool on the same land, and dropping it from one would leave a hole
 * on whichever tile the fragment happened to sample.
 */
export function assignCasters(
  islands: readonly IslandBounds[],
  casters: readonly ShadowCaster[],
): CasterAssignment {
  const byIsland = new Map<string, ShadowCaster[]>();
  for (const i of islands) {
    byIsland.set(
      i.island,
      casters.filter((c) => casterWithin(i.bounds, c)),
    );
  }
  return {
    byIsland,
    unassigned: casters.filter((c) => !islands.some((i) => casterWithin(i.bounds, c))),
  };
}

/** One packed occlusion texture: the atlas layout plus the bytes to upload. */
export interface AtlasField {
  w: number;
  h: number;
  gres: number;
  /** Occlusion, 0..255, row-major over the WHOLE atlas. A byte for the same reason a
   *  `ShadowField` carries bytes: it is uploaded as an 8-bit texture. */
  data: Uint8Array;
  tiles: readonly AtlasTile[];
  /** Casters that stood on no island and therefore cast nothing. Zero on the shipped stream;
   *  carried so a page can REPORT it rather than a missing shadow having to be noticed. */
  unassigned: number;
}

export interface AtlasOcclusionOptions {
  /** The `cell-ground` descriptors — the islands are read off their `island` ids. */
  cells: readonly InstanceDescriptor[];
  /** Relief amplitude the land is wearing. */
  relief: number;
  /** Everything standing on the land, over the whole map. Assigned to islands here. */
  casters: readonly ShadowCaster[];
  gres?: number;
  max?: number;
  /** The cast term's soft-edge width, handed to every tile's builder unchanged. */
  penumbra?: number;
  /** Which rung the contact term lands on, handed to every tile's builder unchanged. */
  contactBand?: ContactBand;
  /** How far the contact pool spreads, handed to every tile's builder unchanged. */
  contactSpread?: number;
}

/**
 * BUILD ONE ISLAND'S FIELD AT A TIME AND BLIT EACH INTO THE ATLAS.
 *
 * ⚠ EACH TILE IS `buildGroundOcclusion` VERBATIM, over that island's own bounds — the same
 * function the shipped canvas calls, at the same resolution it gets on a one-island map. That is
 * the whole claim this remedy makes: an island in a forest of thirty-five is shaded exactly as it
 * is when it stands alone. A second field builder here would make that a coincidence instead.
 *
 * ⚠ AND ONLY THAT ISLAND'S CASTERS REACH IT. Handing every island the whole map's casters would
 * be correct and thirty-five times the work — a stamp is bounded to its caster's own box, so a
 * caster on another island writes nothing, but it is still tested. Assigning them first is what
 * keeps the build linear in the map rather than quadratic.
 */
export function buildAtlasOcclusion(opts: AtlasOcclusionOptions): AtlasField {
  const islands = islandGroundBounds(opts.cells);
  const layout = packShadowAtlas(islands, opts.gres ?? SHADOW_GRES, opts.max ?? SHADOW_ATLAS_MAX);
  const assignment = assignCasters(islands, opts.casters);
  const data = new Uint8Array(layout.w * layout.h);

  for (const tile of layout.tiles) {
    const tileOpts: GroundOcclusionOptions = {
      bounds: tile.bounds,
      relief: opts.relief,
      casters: opts.casters.filter((c) => casterWithin(tile.bounds, c)),
      gres: layout.gres,
    };
    // By statement, for `exactOptionalPropertyTypes`' reason: absent means the authored width.
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — an explicit `undefined` meets
    // the tile builder's own defaults; the statement exists for the type, not the runtime.
    if (opts.penumbra !== undefined) tileOpts.penumbra = opts.penumbra;
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — the same, for the band.
    if (opts.contactBand !== undefined) tileOpts.contactBand = opts.contactBand;
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — the same, for the spread.
    if (opts.contactSpread !== undefined) tileOpts.contactSpread = opts.contactSpread;
    const field = buildGroundOcclusion(tileOpts);
    blitTile(data, layout.w, tile, field);
  }

  return {
    w: layout.w,
    h: layout.h,
    gres: layout.gres,
    data,
    tiles: layout.tiles,
    unassigned: assignment.unassigned.length,
  };
}

/**
 * Copy one island's field into its tile in the atlas.
 *
 * ⚠⚠ IT REFUSES ON A SIZE MISMATCH RATHER THAN CLAMPING TO THE SMALLER, and the difference is
 * whether a later reader can see a defect at all. `occlusionGrid` rounds a field's edges UP to
 * whole samples and {@link tileEdge} rounds the tile's up the same way, so the two agree — today,
 * and by two independent pieces of arithmetic. A `Math.min` bound would silently absorb the first
 * disagreement by dropping a row, and the result is a shadow one texel short along one edge of one
 * island: invisible, unattributable, and a mutant no assertion about the delivered atlas can kill.
 * A throw makes the same event loud.
 */
export function blitTile(
  data: Uint8Array,
  atlasW: number,
  tile: AtlasTile,
  field: ShadowField,
): void {
  if (field.w !== tile.w || field.h !== tile.h) {
    throw new Error(
      `shadow-atlas: island "${tile.island}" built a ${field.w}x${field.h} field for a ` +
        `${tile.w}x${tile.h} tile — the grid arithmetic and the packing arithmetic have parted`,
    );
  }
  for (const j of indices(field.h)) {
    const from = j * field.w;
    data.set(field.data.subarray(from, from + field.w), (tile.y + j) * atlasW + tile.x);
  }
}

/** How much of the atlas is occluded past the material's own threshold — the same measurement
 *  `shadowCoverage` makes about a rect field, over the packed one. It is NOT comparable to that
 *  number across the two forms and saying so is the point: the rect field's denominator is mostly
 *  sea, so a remedy that removed the sea would show a HIGHER coverage while drawing exactly the
 *  same shadows. Compare a tile's coverage against a one-island field's, never an atlas's against
 *  a forest rect's. */
export function atlasCoverage(field: AtlasField, threshold = 0.5): number {
  let n = 0;
  for (const v of field.data) if (v / 255 > threshold) n += 1;
  return n / field.data.length;
}
