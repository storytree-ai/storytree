// land-per-capability.ts — THE ISLAND'S SIZE COMES FROM A DECLARED LAND-PER-CAPABILITY RATIO.
//
// The owner, 2026-09-05, on the one-tree-per-capability sheet: *"i want one tree per a capability,
// we need to scale the land size, can we build a ratio based on this as land should also scale per
// land size."* One tree per capability stood then (ADR-0518 D1; no tree is drawn since ADR-0804
// D1). What was wrong was the SIZE of the land under it: the island the 2D layout drew was
// `max(3, capabilities + 2)` hex tiles of `HEX_R = 27` (`apps/studio/src/components/TreeView.tsx`,
// `packages/forest-world/src/sizing.ts`), so island area already scaled with capability count — through a constant nobody chose. On the fixture island it
// came to ~2,240 units² of land per capability, and one tree standing on 2,240 units² is a tree
// adrift on a field. The picture he called nicer stood a tree on roughly 320.
//
// ⚠ CORRECTED IN PLACE 2026-09-06 (ADR-0528): the 2D tile now FOLLOWS the ratio — one hex per
// capability, the hex sized so a drawn island is exactly `capabilities × LAND_AREA_PER_CAPABILITY`
// — and the ratio itself moved DOWN to the engine (`packages/forest-world/src/hex.ts`), which this
// module re-exports. The mapper below is unchanged in effect: it still sizes every island to exactly
// the ratio about its own centre, and on a correctly-drawn island that factor is close to 1. What
// this module now guards is the TUNED BASIS: every band and lattice constant in this package was
// judged on the pre-ADR-0528 tile, so `HEX_TILE_AREA` is frozen on that tile (`PRE_ADR0528_TILE`)
// rather than read off the engine's live `HEX_R` — otherwise `LAND_SCALE` would have jumped from
// 0.377 to 0.925 and every feature on the shipped island would have grown 2.4× overnight.
//
// So the mapper sizes each island from a RATIO, per island, about the island's own centre
// (`scaleAboutIslands`, the same per-island affine seam ADR-0517 D1's footprint restoration uses):
//
//     island area  =  capabilities × LAND_AREA_PER_CAPABILITY
//
// exactly — the `+ 2` tile quota and the coast's lobing no longer leak into the size. The ratio's
// value is DERIVED from the two densities the owner has approved (see {@link LAND_AREA_PER_CAPABILITY})
// and laddered for his pick; the pick lands here and nowhere else.
//
// ⚠⚠ THE LAYOUT HOLDS STILL, AND THAT IS A MEASURED CONSEQUENCE, NOT A CHOICE MADE HERE. Each island
// scales about its own centre, so the forest's arrangement — the 2D layout's spacing — does not move;
// only each island's size does. Shrinking every island 2.6–4.4× linearly inside a fixed layout is the
// picture the increment's evidence sheet renders (`docs/research/chapter2-land-per-capability-*`),
// and whether the layout should compact with the islands is the OWNER'S layout question, escalated
// on `land-ground-stack-arc` rather than decided by a mapper constant. Compacting the layout on this
// side would be a second decision wearing this one's name.
//
// ⚠ NO TREE STANDS ON AN ISLAND ANY MORE (corrected in place 2026-10-05, ADR-0804 D1). This paragraph
// used to say the ratio was land per tree at the kit tree's fixed size. That was 0.2's pine forest,
// gone with the flat canvas (ADR-0920). Today the globe draws each island as one flat surface cut
// into capability territories, so the ratio is simply land per capability, for an island whose story
// has no surveyed code (a surveyed island's land follows its lines of code instead:
// `landRatioFactor`'s `area` below, `Island.area`). Tree size and spacing
// constrain nothing here. What does follow the island is every feature sized as a fraction of it —
// the beach band, the worn path, the noise lattices, the relief, the skirt, the coast's smoothing —
// through {@link LAND_SCALE}, so a band tuned as a fraction of the 234-unit island stays that
// fraction of a 90-unit one.
//
// Pure: no React, no three — behind the provability firewall with `forest-ground.ts`.

import { LAND_AREA_PER_CAPABILITY, PRE_ADR0528_TILE } from './core/index.js';

import { scaleAboutIslands, type IslandCentre, type IslandScale } from './true-footprint.js';
import type { Descriptor3D, Transform3D } from './descriptors.js';

/** One hex tile's ground-plane area in the TRUE basis ON THE TUNED TILE — a regular hexagon of the
 *  pre-ADR-0528 circumradius 27, `(3√3 / 2) · R²` ≈ 1,894. The unit every 2D island WAS built from,
 *  so the unit the old ratio hid in — and the basis every constant here was judged against. ⚠ It
 *  reads `PRE_ADR0528_TILE`, never the engine's live `HEX_R`, on purpose: the tile is derived now
 *  (≈ 11.06) and this basis must not follow it, or `LAND_SCALE` moves and so does every band. */
export const HEX_TILE_AREA = ((3 * Math.sqrt(3)) / 2) * PRE_ADR0528_TILE.hexR * PRE_ADR0528_TILE.hexR;

/**
 * The historical tuning island had thirteen hex tiles carrying eleven capabilities: the
 * `capabilities + 2` quota the layout gives an eleven-capability story. Its counts are retained
 * here as the basis of LAND_SCALE; they do not depend on a fixture file.
 */
export const TUNED_FIXTURE = { tiles: 13, capabilities: 11 } as const;

/**
 * THE RATIO THE MAP INHERITED, on the fixture island: thirteen tiles over eleven capabilities, in
 * the true basis. ≈ 2,238.4 units² per capability. Every band, lattice and relief constant in this
 * package was judged on an island of this density, which is what {@link LAND_SCALE} is measured
 * against. (The delivered land reads a little smaller — the coast clip lobes the outline — and a
 * story with fewer capabilities inherits MORE per capability, since the `+ 2` is a larger share
 * of a smaller quota: a three-capability island gets 5/3 of this.)
 */
export const TUNED_LAND_AREA_PER_CAPABILITY = (HEX_TILE_AREA * TUNED_FIXTURE.tiles) / TUNED_FIXTURE.capabilities;

/**
 * THE LADDER, in ground units² of land per capability — rendered on the increment's sheet at both
 * zooms, one island and the forest, for the owner's pick. Its rungs are the increment's own, and
 * each carries its provenance:
 *
 *   318  the density of the arm the owner called nicer on 2026-09-05 (`today` on the
 *        one-tree-per-capability sheet): 72 trees — 11 capability trees and 61 grove pines — on
 *        the fixture island, ≈ 318 units² of delivered land per tree. ⚠ THE APPROVED CYCLES
 *        RENDER AGREES WITH IT once both are read in the same basis: `RECIPE_ISLAND_AREA` is
 *        24,631.8 units² in the true basis and the recipe stands thirteen stands of 4–8 pines
 *        (≈ 78), ≈ 316 per pine. `land-per-capability.test.ts` holds the two within a few percent.
 *   200  the midpoint rung between the two the increment names.
 *   108  the increment's reading of the recipe's density — `RECIPE_ISLAND_AREA` as it stood in the
 *        SQUASHED basis (8,424.6) over ~78 pines. It is the recipe density read through the
 *        drawing's 0.342 foreshortening, i.e. 2.9× too dense; it is rendered because the increment
 *        asked for it and because it is the boldest rung, not because it is a second approved density.
 *
 * The rungs are history: tree densities from 2026-09-05, when a pine stood on every capability's
 * land. Since ADR-0804 D1 no tree is drawn on an island, so a rung is no longer a tree spacing and
 * nothing about trees argues for or against any value of the ratio.
 */
export const LAND_AREA_PER_CAPABILITY_RUNGS = [318, 200, 108] as const;

/**
 * ⚠⚠ THE SHIPPED RATIO — the rung the map draws. PICKED ON THE LOOK (ADR-0489 D3, ADR-0503 D1),
 * from the ladder above rendered at both zooms on the RTX 2060
 * (`docs/research/chapter2-land-per-capability-2026-09-05/`). Its provenance is the ladder's: the
 * density of the pine forest the owner called nicer, which the approved render's own density agrees
 * with in the true basis. That forest is retired (ADR-0804 D1), so the provenance is history, not a
 * constraint. What the value does today: it is the land one capability gets on an island whose
 * story has no surveyed code, and, through `HEX_R`, the size of the hex every island's coast is
 * built from (`core/hex.ts`). A change to it is judged on the globe's islands, not on tree spacing.
 *
 * ⚠ DECLARED IN THE ENGINE since ADR-0528 (`packages/forest-world/src/hex.ts`), because the 2D
 * lattice derives from it and that package is the root; re-exported here so every reader in this
 * package keeps its import. The value and its provenance are unchanged — 318.
 */
export { LAND_AREA_PER_CAPABILITY };

/**
 * THE LINEAR FACTOR EVERY ISLAND-RELATIVE CONSTANT FOLLOWS: how much smaller, edge to edge, the
 * shipped island is than the one the constants were tuned on — `√(shipped / tuned)`. A beach band,
 * a path width, a noise lattice or a relief amplitude authored in ground units against the tuned
 * island multiplies by this to stay the same FRACTION of the island it was judged as. It is one
 * global factor where the per-island factor varies a little (the `+ 2` quota), so a band is the
 * same absolute width on every island and a slightly larger fraction of a small story's.
 */
export const LAND_SCALE = Math.sqrt(LAND_AREA_PER_CAPABILITY / TUNED_LAND_AREA_PER_CAPABILITY);

/**
 * ⚠⚠ THE FLOOR: THE FEWEST CAPABILITIES AN ISLAND IS SIZED AS IF IT HELD — ONE.
 *
 * The owner, 2026-09-06, on finding the zero-capability islands: **"no capabilities should just be
 * 1 hex which should be the minimum."** Until then `landRatioFactor` LEFT a story with no
 * capabilities at the size the drawing gave it — three hex tiles of the old radius-27 lattice,
 * ≈ 5,680 units² — while every island that held work shrank to `capabilities × 318`. Measured on
 * the real forest (`docs/research/chapter2-one-hex-floor-2026-09-06/`): the four islands holding
 * NO work were the third- to sixth-largest things on the map, bigger than a sixteen-capability
 * story and eighteen times the one-capability one.
 *
 * ONE HEX OF THE DERIVED SIZE, NOT OF TODAY'S TILE. Under ADR-0528 the 2D tile itself follows the
 * ratio — one hex per capability, a hex being exactly `LAND_AREA_PER_CAPABILITY` units² — so "one
 * hex" and "one capability's worth of land" are the same quantity, and the floor is written in the
 * ratio's own terms: an island is sized as if it held at least this many capabilities. That is
 * correct on today's radius-27 drawing (the mapper scales the three tiles down to 318) and stays
 * correct once the tile lands (one derived hex is 318 already, factor ≈ 1); writing it as 1,894
 * units² of today's tile would have left a zero-capability island six times a one-capability one.
 *
 * ⚠ ZERO IS THE MAP AS IT STOOD, typed as history for the comparison page's control arm: a floor of
 * 0 counts nothing an island does not hold, so a zero-capability island is left as drawn exactly as
 * before. The shipped canvas never passes it.
 */
export const LAND_FLOOR_CAPABILITIES = 1;

/** A ground ring's area by the shoelace, absolute, in units² — fewer than three points sum to
 *  zero on their own, so there is no guard to mutate. */
export function ringArea(points: readonly Transform3D[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    // Stryker disable next-line AssignmentOperator: EQUIVALENT — the winding's sign is discarded
    // by the `abs` below, so accumulating the negative sum delivers the same area.
    twice += p.x * q.z - q.x * p.z;
  }
  return Math.abs(twice) / 2;
}

/** What an island's size is derived from: how many capabilities it holds and how much land it
 *  draws — the sum of its parcel rings' areas, which do not overlap. */
export interface IslandLand {
  island: string;
  /** Distinct capability parcels on this island — the `parcel` ids of its `cell-ground` cells. */
  capabilities: number;
  /** The island's drawn land, in ground units². */
  area: number;
}

/** Every island's capability count and drawn land, read off its `cell-ground` descriptors. An
 *  island with cells that name no parcel counts no capability from them. */
export function islandLand(descriptors: readonly Descriptor3D[]): Map<string, IslandLand> {
  const out = new Map<string, IslandLand>();
  const parcels = new Map<string, Set<string>>();
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground' || d.island === undefined) continue;
    const land = out.get(d.island) ?? { island: d.island, capabilities: 0, area: 0 };
    land.area += ringArea(d.points ?? []);
    if (d.parcel !== undefined) {
      const seen = parcels.get(d.island) ?? new Set<string>();
      seen.add(d.parcel);
      parcels.set(d.island, seen);
      land.capabilities = seen.size;
    }
    out.set(d.island, land);
  }
  return out;
}

/**
 * THE FACTOR ONE ISLAND SCALES BY, edge to edge: `√(counted × ratio / area)`, where `counted` is
 * the island's capabilities or the floor, whichever is more — so that its scaled area is exactly
 * `max(floor, capabilities) × ratio`. An island holding no capability is sized as ONE
 * ({@link LAND_FLOOR_CAPABILITIES}); an island drawing no land has nothing to derive a size from
 * and is left as drawn (factor 1). With a floor of 0 — the comparison page's control — a
 * zero-capability island is left as drawn too, which is the rule as it stood until 2026-09-06.
 */
export function landRatioFactor(land: IslandLand, areaPerCapability: number, floorCapabilities: number = LAND_FLOOR_CAPABILITIES, area?: number): number {
  if (!Number.isFinite(areaPerCapability) || areaPerCapability <= 0) {
    throw new Error(`land-per-capability: the ratio must be a positive finite number of units² per capability, got ${areaPerCapability}`);
  }
  if (!Number.isFinite(floorCapabilities) || floorCapabilities < 0) {
    throw new Error(`land-per-capability: the floor must be a non-negative finite number of capabilities, got ${floorCapabilities}`);
  }
  if (area !== undefined && (!Number.isFinite(area) || area <= 0)) {
    throw new Error(`land-per-capability: an island's set area must be a positive finite number of units², got ${area}`);
  }
  const counted = Math.max(floorCapabilities, land.capabilities);
  // ⚠ A SET AREA (ADR-0804 D3, D7: an island's land follows its story's lines of code) stands in for
  // `counted × ratio`; every island without one is sized by capabilities exactly as before.
  const wanted = area ?? counted * areaPerCapability;
  if (wanted === 0 || land.area === 0) return 1;
  const factor = Math.sqrt(wanted / land.area);
  // ⚠ REFUSED, NOT DRAWN. No island on this map is a hundred times too small or too large for its
  // capabilities — the drawing's own ratio is within a factor of three of any rung — so a factor
  // past this is an arithmetic fault (a ratio multiplied where it should divide), and the honest
  // answer is a refusal in a microsecond rather than a shore field over a continent that never
  // finishes building. The mutation rung scored exactly that inversion as a TIMEOUT for want of it.
  if (factor > MAX_LAND_FACTOR || factor < 1 / MAX_LAND_FACTOR) {
    throw new Error(
      `land-per-capability: island "${land.island}" would scale by ${factor} (${land.capabilities} capabilities × ${areaPerCapability} over ${land.area} units²) — past ${MAX_LAND_FACTOR}× either way, which is an arithmetic fault and not a size`,
    );
  }
  return factor;
}

/** The most an island may scale by, edge to edge, either way — see the refusal in {@link landRatioFactor}. */
export const MAX_LAND_FACTOR = 100;

/**
 * SIZE EVERY ISLAND FROM THE RATIO: each island scaled isotropically about its own centre by
 * {@link landRatioFactor}: every `cell-ground` cell, through the same per-island affine seam the
 * footprint restoration uses. The layout holds still (see the header). Islands absent from the stream's `cell-ground` cells are untouched.
 */
export function sizeIslandsByCapability<T extends Descriptor3D>(
  descriptors: readonly T[],
  /** REQUIRED rather than defaulted: the one caller that means "the shipped ratio" says so
   *  (`forest-ground.ts`'s `forestDescriptors`), so a caller that forgot the ratio is a refusal and not a silent default. */
  areaPerCapability: number,
  /** The fewest capabilities an island is sized as if it held — {@link LAND_FLOOR_CAPABILITIES}
   *  unless a COMPARISON arm asks for the map as it stood (0). The shipped mapper never passes it. */
  floorCapabilities: number = LAND_FLOOR_CAPABILITIES,
  /** Islands whose land is SET, in ground units² (ADR-0804 D3: their story's lines of code), by island id.
   *  They leave the capability rule, so {@link islandSizeInversions} reads only the islands not named here. */
  areas: ReadonlyMap<string, number> = new Map(),
): T[] {
  const land = islandLand(descriptors);
  return scaleAboutIslands(descriptors, (island: string, _centre: IslandCentre): IslandScale => {
    // Every island the scale is asked about has ring vertices (`islandCentres` reads the same
    // cells), so it is in the land map.
    const f = landRatioFactor(land.get(island) as IslandLand, areaPerCapability, floorCapabilities, areas.get(island));
    return { x: f, z: f };
  });
}

/** One island drawn larger than another that holds MORE capabilities — the reading the floor
 *  exists to make impossible. */
export interface IslandSizeInversion {
  /** The island with FEWER capabilities and MORE land. */
  smaller: IslandLand;
  /** The island with more capabilities and less land. */
  larger: IslandLand;
}

/**
 * THE INVARIANT, AS A READER: no island with fewer capabilities is drawn larger than one with more.
 * Every pair that breaks it, so a report can name them; empty is the invariant holding. Equal
 * capability counts are never an inversion (two four-capability islands may differ by the coast's
 * lobing), and an area within `tolerance` units² of the other is read as equal — the floor makes a
 * zero-capability island EXACTLY a one-capability one, and the shoelace over two different rings
 * agrees to rounding, not to the bit.
 */
export function islandSizeInversions(lands: Iterable<IslandLand>, tolerance = 1e-6): IslandSizeInversion[] {
  const all = [...lands];
  const out: IslandSizeInversion[] = [];
  for (const a of all) {
    for (const b of all) {
      if (a.capabilities < b.capabilities && a.area > b.area + tolerance) out.push({ smaller: a, larger: b });
    }
  }
  return out;
}
