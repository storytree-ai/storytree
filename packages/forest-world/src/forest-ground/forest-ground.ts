/**
 * Capability 1 · Scene layout. The one join between 0.3's forest and 0.2's drawing engine (the forest story, capability 3).
 *
 * 0.3 decides WHERE and WHAT: each story node's place (P1, `storyNodes`) and its capabilities, one
 * entry per capability in build order with its work-state form (`grove`), both carried by
 * `forestScene`. This file builds the ground from 0.2's geometry core, the way 0.2's own website did
 * for islands whose centres it already knew (`composePublicGroundScene` in 0.2's
 * `packages/forest-world`): a hexagon of tiles per island, relaxed into the mesh, its boundary
 * smoothed into a coast, and one parcel per capability seeded on its own cell, each cell joining the
 * parcel of the seed nearest it. The primitives are 0.2's; only the join is new.
 *
 * ⚠ NO TREE STANDS ON THESE PARCELS (corrected in place 2026-10-05, ADR-0804 D1). This header used
 * to say 0.2's engine also stands its kit trees on them. This join yields only cells
 * (`forestDescriptors`' `cell-ground`): each island's coast, parcels and reach, under its flat
 * surface and its capability territories. An island's size follows its capability count
 * (`LAND_AREA_PER_CAPABILITY`, applied by `sizeIslandsByCapability`) unless its story's surveyed code
 * sets it (`Island.area`, ADR-0804 D3). Each capability's form still reaches the cell as its parcel's
 * status (`statusOf`), which nothing draws; the globe fills a territory by its capability's verified
 * word instead (ADR-0825 D3).
 *
 * This first pass builds land. The globe's `buildPlanetPathways` joins recorded capability links
 * to these actual clipped coasts and parcel centres, then feeds the ground's worn paths and the
 * cross-island ribbon from one shared network (ADR-0169, ADR-0655 D3).
 */
import { PLACE_WIDTH, type ForestScene, type Island, type TreeForm } from "../scene.js";

import {
  AXIAL_DIRS,
  COAST_OUTSET_ON_TILE,
  HEX_R,
  PLAN_VIEW_ELEVATION_DEG,
  axialKey,
  buildRelaxedCells,
  hexCenter,
  hexCorners,
  hash,
  hexDist,
  ringsOf,
  smoothCoast,
  tileQuota,
  type BoundarySeg,
  type Pt,
  type RelaxedCell,
  type SceneStatus,
} from "../core/index.js";
import type { Descriptor3D, InstanceDescriptor, Transform3D } from "../descriptors.js";
import { LAND_AREA_PER_CAPABILITY, sizeIslandsByCapability } from "../land-per-capability.js";

/**
 * How many of 0.2's ground units one of 0.3's place-widths spans. The spiral keeps places at least
 * 0.97 of a width apart, and an island of 0.2's tiles reaches at most 11 units from its middle with
 * one capability, 29 with up to six and 48 with up to nineteen (measured over twenty story ids each),
 * so at this width neighbouring stories of up to nineteen capabilities never touch, and the sea
 * between smaller ones stays close to 0.2's packed forest. It is fixed, never fitted to the
 * project, so a new story moves no island (P1).
 */
export const GROUND_PER_PLACE = 110;

/** 0.3 world units (`forestScene`'s, a place-width of `PLACE_WIDTH`) to 0.2 ground units. */
export const GROUND_PER_WORLD_UNIT = GROUND_PER_PLACE / PLACE_WIDTH;

/**
 * Which of 0.2's statuses each of 0.3's forms becomes on its parcel: a seedling 0.2's `building`
 * (planned or being built), pale 0.2's `mapped` (landed, nothing reported), green `healthy` (landed
 * and reported passing), and dead `unhealthy` (landed, reported failing). 0.2 drew these as a
 * tree's tint, needles or bare trunk; since ADR-0804 D1 no tree is drawn, and the globe ignores
 * these statuses.
 */
const STATUS: Readonly<Record<TreeForm, SceneStatus>> = {
  seedling: "building",
  pale: "mapped",
  green: "healthy",
  dead: "unhealthy",
};

export function statusOf(form: TreeForm): SceneStatus {
  return STATUS[form];
}

/** The island's own colour, as 0.2 folded a story's status from its parts: the worst form wins. */
const WORST_FIRST: readonly TreeForm[] = ["dead", "seedling", "pale", "green"];

function islandStatus(island: Island): SceneStatus {
  const forms = new Set(island.trees.map(({ form }) => form));
  return statusOf(WORST_FIRST.find((form) => forms.has(form)) ?? "seedling");
}

/** The parcel id of a story's lone seedling, for a story with no capabilities yet. */
function parcelId(island: Island, index: number): string {
  return island.trees[index]?.capability ?? `${island.story}#seedling`;
}

/** One island's ground: its relaxed cells and coast, centred on its place, in 0.2 ground units. */
function groundFor(island: Island, owner: number, centre: Pt): { cells: RelaxedCell[]; coast: Pt[][]; radius: number } {
  // 0.2 gave each island one hex tile per capability (`tileQuota`), grown out from its middle; which
  // tiles of the outer ring it takes is seeded by the story, so each island has its own shape.
  const quota = tileQuota(island.trees.length);
  const rings = ringsOf(quota);
  const axis = Array.from({ length: rings * 2 + 1 }, (_, index) => index - rings);
  const tiles = axis
    .flatMap((q) => axis.map((r) => ({ q, r })))
    .filter((h) => hexDist(h, { q: 0, r: 0 }) <= rings)
    .sort((a, b) => hexDist(a, { q: 0, r: 0 }) - hexDist(b, { q: 0, r: 0 }) || hash(`${island.story}:${a.q},${a.r}`) - hash(`${island.story}:${b.q},${b.r}`))
    .slice(0, quota);
  const ground = { elevationDeg: PLAN_VIEW_ELEVATION_DEG };
  const drawTiles = tiles.map((h) => ({ h, owner }));
  const coarse = buildRelaxedCells(drawTiles, [], "mesh", undefined, ground);
  // As 0.2's composer did: subdivide until every capability can own at least one cell.
  const extraPasses = Math.max(0, Math.ceil(Math.log(island.trees.length / Math.max(1, coarse.length)) / Math.log(4)));
  const cells = (extraPasses && buildRelaxedCells(drawTiles, [], "mesh", { subdiv: 1 + extraPasses }, ground)) || coarse;

  const mine = new Set(tiles.map(axialKey));
  const boundary: BoundarySeg[] = [];
  for (const tile of tiles) {
    const at = hexCenter(tile, ground);
    const corners = hexCorners(at.x, at.y, HEX_R, PLAN_VIEW_ELEVATION_DEG);
    AXIAL_DIRS.forEach((direction, edge) => {
      if (mine.has(axialKey({ q: tile.q + direction.q, r: tile.r + direction.r }))) return;
      const a = corners[edge]!;
      const b = corners[(edge + 1) % corners.length]!;
      boundary.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  }
  const coast = smoothCoast(boundary, island.story, COAST_OUTSET_ON_TILE).loops;
  const place = (point: Pt): Pt => ({ x: centre.x + point.x, y: centre.y + point.y });
  return {
    cells: cells.map((cell) => ({ ...cell, poly: cell.poly.map(place) })),
    coast: coast.map((loop) => loop.map(place)),
    radius: coast.flat().reduce((extent, point) => Math.max(extent, Math.hypot(point.x, point.y)), 0),
  };
}

/** The cell the `index`th of `count` parcels is seeded on: spread evenly through the island's cells, so the
 *  parcels (and the pathway ends set on their centres) share the island rather than crowding one side of it. */
function spreadIndex(index: number, count: number, cells: number): number {
  return Math.min(cells - 1, Math.floor(((index + 0.5) * cells) / count));
}

function centroid(poly: readonly Pt[]): Pt {
  return { x: poly.reduce((sum, p) => sum + p.x, 0) / poly.length, y: poly.reduce((sum, p) => sum + p.y, 0) / poly.length };
}

function groundCells(descriptors: readonly Descriptor3D[]): InstanceDescriptor[] {
  return descriptors.filter((d): d is InstanceDescriptor => d.kind === "cell-ground" && d.points !== undefined);
}

/** Where each capability's parcel lies, as the middle of its cells, in 0.2 ground units: the globe's pathways end there (`planet/pathways.ts`). */
export function parcelSpots(descriptors: readonly Descriptor3D[]): Map<string, { x: number; z: number }> {
  const sums = new Map<string, { x: number; z: number; n: number }>();
  for (const cell of groundCells(descriptors)) {
    if (cell.parcel === undefined) continue;
    const sum = sums.get(cell.parcel) ?? { x: 0, z: 0, n: 0 };
    for (const point of cell.points!) {
      sum.x += point.x;
      sum.z += point.z;
      sum.n += 1;
    }
    sums.set(cell.parcel, sum);
  }
  return new Map([...sums].map(([parcel, { x, z, n }]) => [parcel, { x: x / n, z: z / n }]));
}

/** How far each island's ground reaches from its middle, in 0.2 ground units. */
export function islandReach(descriptors: readonly Descriptor3D[], centres: ReadonlyMap<string, { x: number; z: number }>): Map<string, number> {
  const reach = new Map<string, number>();
  for (const cell of groundCells(descriptors)) {
    const centre = cell.island === undefined ? undefined : centres.get(cell.island);
    if (centre === undefined) continue;
    for (const point of cell.points!) reach.set(cell.island!, Math.max(reach.get(cell.island!) ?? 0, Math.hypot(point.x - centre.x, point.z - centre.z)));
  }
  return reach;
}

/**
 * The ground the globe draws for `scene`: each island's relaxed-mesh cells at its place, each cell in
 * the parcel of the capability whose seed is nearest it, sized per capability as 0.2 sized them,
 * except an island whose land is set (`Island.area`, from its story's lines).
 */
export function forestDescriptors(scene: ForestScene): Descriptor3D[] {
  const centres = scene.islands.map((island): Pt => ({ x: island.x * GROUND_PER_WORLD_UNIT, y: island.z * GROUND_PER_WORLD_UNIT }));
  const out: InstanceDescriptor[] = [];
  scene.islands.forEach((island, owner) => {
    const { cells } = groundFor(island, owner, centres[owner]!);
    const parcels = island.trees.map(({ form }, index) => ({
      capId: parcelId(island, index),
      status: statusOf(form),
      seed: centroid(cells[spreadIndex(index, island.trees.length, cells.length)]!.poly),
    }));
    if (!parcels.length) {
      for (const cell of cells) pushCell(out, cell.poly, islandStatus(island), undefined, island.story);
      return;
    }
    parcelGroups(cells, parcels.map(({ seed }) => seed)).forEach((group, index) => {
      for (const cell of group) pushCell(out, cell.poly, parcels[index]!.status, parcels[index]!.capId, island.story);
    });
  });
  const islandAreas = new Map(scene.islands.flatMap((island) => (island.area === undefined ? [] : [[island.story, island.area] as const])));
  return sizeIslandsByCapability(out, LAND_AREA_PER_CAPABILITY, undefined, islandAreas);
}

/**
 * Each parcel's cells: every cell goes to the parcel whose seed is nearest its middle (ties to the
 * first), then a parcel left with none takes the cell nearest its seed from a parcel holding two or
 * more, so no capability is left without ground.
 */
function parcelGroups(cells: readonly RelaxedCell[], seeds: readonly Pt[]): RelaxedCell[][] {
  const middle = new Map(cells.map((cell) => [cell, centroid(cell.poly)]));
  const distance = (cell: RelaxedCell, seed: Pt): number => (middle.get(cell)!.x - seed.x) ** 2 + (middle.get(cell)!.y - seed.y) ** 2;
  const groups: RelaxedCell[][] = seeds.map(() => []);
  for (const cell of cells) {
    let best = 0;
    seeds.forEach((seed, index) => {
      if (distance(cell, seed) < distance(cell, seeds[best]!)) best = index;
    });
    groups[best]!.push(cell);
  }
  seeds.forEach((seed, index) => {
    if (groups[index]!.length > 0) return;
    let spare: { from: number; at: number } | undefined;
    let nearest = Infinity;
    groups.forEach((group, from) => {
      if (group.length < 2) return;
      group.forEach((cell, at) => {
        const d = distance(cell, seed);
        if (d < nearest) [nearest, spare] = [d, { from, at }];
      });
    });
    if (spare) groups[index]!.push(groups[spare.from]!.splice(spare.at, 1)[0]!);
  });
  return groups;
}

/** One ground cell as the globe reads it: its ring at a tenth of a ground unit, its middle, its parcel's status, and whose it is. */
function pushCell(out: InstanceDescriptor[], poly: readonly Pt[], status: SceneStatus, parcel: string | undefined, island: string): void {
  const points = poly.map((p) => ({ x: 0 + Number(p.x.toFixed(1)), y: 0, z: 0 + Number(p.y.toFixed(1)) }));
  if (points.length < 3) return;
  const cell: InstanceDescriptor = {
    kind: "cell-ground",
    transform: { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: 0, z: points.reduce((sum, p) => sum + p.z, 0) / points.length },
    group: "cell-ground",
    material: status,
    points,
  };
  if (parcel !== undefined) cell.parcel = parcel;
  cell.island = island;
  out.push(cell);
}
