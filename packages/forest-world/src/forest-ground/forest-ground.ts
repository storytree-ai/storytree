// Capability 1 · Scene layout
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

export const GROUND_PER_PLACE = 110;

export const GROUND_PER_WORLD_UNIT = GROUND_PER_PLACE / PLACE_WIDTH;

const STATUS: Readonly<Record<TreeForm, SceneStatus>> = {
  seedling: "building",
  pale: "mapped",
  green: "healthy",
  dead: "unhealthy",
};

export function statusOf(form: TreeForm): SceneStatus {
  return STATUS[form];
}

const WORST_FIRST: readonly TreeForm[] = ["dead", "seedling", "pale", "green"];

function islandStatus(island: Island): SceneStatus {
  const forms = new Set(island.trees.map(({ form }) => form));
  return statusOf(WORST_FIRST.find((form) => forms.has(form)) ?? "seedling");
}

function parcelId(island: Island, index: number): string {
  return island.trees[index]?.capability ?? `${island.story}#seedling`;
}

function groundFor(island: Island, owner: number, centre: Pt): { cells: RelaxedCell[]; coast: Pt[][]; radius: number } {
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

function spreadIndex(index: number, count: number, cells: number): number {
  return Math.min(cells - 1, Math.floor(((index + 0.5) * cells) / count));
}

function centroid(poly: readonly Pt[]): Pt {
  return { x: poly.reduce((sum, p) => sum + p.x, 0) / poly.length, y: poly.reduce((sum, p) => sum + p.y, 0) / poly.length };
}

function groundCells(descriptors: readonly Descriptor3D[]): InstanceDescriptor[] {
  return descriptors.filter((d): d is InstanceDescriptor => d.kind === "cell-ground" && d.points !== undefined);
}

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

export function islandReach(descriptors: readonly Descriptor3D[], centres: ReadonlyMap<string, { x: number; z: number }>): Map<string, number> {
  const reach = new Map<string, number>();
  for (const cell of groundCells(descriptors)) {
    const centre = cell.island === undefined ? undefined : centres.get(cell.island);
    if (centre === undefined) continue;
    for (const point of cell.points!) reach.set(cell.island!, Math.max(reach.get(cell.island!) ?? 0, Math.hypot(point.x - centre.x, point.z - centre.z)));
  }
  return reach;
}

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
