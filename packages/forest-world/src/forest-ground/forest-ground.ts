/**
 * The one join between 0.3's forest and 0.2's drawing engine (stories/forest.md, capability 3).
 *
 * 0.3 decides WHERE and WHAT: each story node's place on the spiral (P1, `storyNodes`) and its
 * grove, one tree per capability in one of four forms (G1, `grove`), both carried by
 * `forestScene`. 0.2's engine decides HOW IT LOOKS: the relaxed-mesh ground, the smoothed coast, the
 * parcels and the kit trees standing on them. Between the two, this file builds the input 0.2's
 * scene core takes (`SceneInput`), the way 0.2's own website did for islands whose centres it
 * already knew (`composePublicGroundScene` in 0.2's `packages/forest-world`): a hexagon of tiles
 * per island, relaxed into the mesh, its boundary smoothed into a coast, and one parcel per
 * capability seeded on its own cell. Only the input is new; the ground is 0.2's.
 *
 * What it leaves to 0.2 unchanged: an island's size follows its capability count (0.2's
 * `LAND_AREA_PER_CAPABILITY`, applied by `worldTo3D`), and what stands on a parcel follows the
 * status it wears (`stateForm` in `kit-vocabulary.ts`). What it takes from 0.3 alone: the place and
 * the form. The form a tree takes is 0.3's `grove`'s decision; `statusOf` only names which of 0.2's
 * statuses draws that form.
 *
 * The trail network is left empty: 0.2's canvas hides trails unless asked (ADR-0169 §3), and 0.3's
 * drill-down draws how capabilities connect.
 */
import { PLACE_WIDTH, type ForestScene, type Island, type TreeForm } from "@storytree/forest";

import {
  AXIAL_DIRS,
  COAST_OUTSET_ON_TILE,
  HEX_R,
  PLAN_VIEW_ELEVATION_DEG,
  axialKey,
  buildRelaxedCells,
  buildScene,
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
  type SceneInput,
  type SceneParcelInput,
  type SceneStatus,
  type SceneTerritoryInput,
  type SurfaceTheme,
} from "../core/index.js";
import { worldTo3D, type Descriptor3D, type InstanceDescriptor, type Transform3D } from "../world-to-3d.js";

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
 * Which of 0.2's statuses draws each of 0.3's tree forms: a seedling wears 0.2's building tint
 * (planned or being built), a pale tree 0.2's `mapped` tint (landed, nothing reported), a green tree
 * the kit's own needles (landed and reported passing), and a dead tree 0.2's bare trunk (landed,
 * reported failing).
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

/** 0.2's three parcel surfaces, dealt round the capabilities in build order. */
const THEMES: readonly SurfaceTheme[] = ["meadow", "woodland", "heath"];

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
 *  parcels (and the trees standing on them) share the island rather than crowding one side of it. */
function spreadIndex(index: number, count: number, cells: number): number {
  return Math.min(cells - 1, Math.floor(((index + 0.5) * cells) / count));
}

function centroid(poly: readonly Pt[]): Pt {
  return { x: poly.reduce((sum, p) => sum + p.x, 0) / poly.length, y: poly.reduce((sum, p) => sum + p.y, 0) / poly.length };
}

/** The input 0.2's scene core draws `scene` from: every island at its place, on the plan-view ground. */
export function groundInput(scene: ForestScene): SceneInput {
  const centres = scene.islands.map((island): Pt => ({ x: island.x * GROUND_PER_WORLD_UNIT, y: island.z * GROUND_PER_WORLD_UNIT }));
  const grounds = scene.islands.map((island, owner) => groundFor(island, owner, centres[owner]!));
  return {
    offset: { x: 0, y: 0 },
    width: 0,
    height: 0,
    empties: [],
    relaxedCells: grounds.flatMap(({ cells }) => cells),
    drawTiles: [],
    wheatSets: [],
    cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG,
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: scene.islands.map((island, owner): SceneTerritoryInput => {
      const centre = centres[owner]!;
      const { cells, coast, radius } = grounds[owner]!;
      return {
        id: island.story,
        status: islandStatus(island),
        caps: island.trees.filter(({ capability }) => capability !== undefined).length,
        centroid: { ...centre },
        groundRadius: radius,
        screenRadius: radius,
        treeSpot: { ...centre },
        anchorSpace: "ground",
        labelY: centre.y,
        coastGroundLoops: coast,
        decor: [],
        plants: [],
        parcels: island.trees.map(({ form, contracts }, index): SceneParcelInput => {
          const parcel: SceneParcelInput = {
            capId: parcelId(island, index),
            status: statusOf(form),
            theme: THEMES[index % THEMES.length]!,
            seed: centroid(cells[spreadIndex(index, island.trees.length, cells.length)]!.poly),
          };
          // 0.2 grew a parcel's ground cover from its test count; 0.3's is its contracts. None
          // reported leaves the count out, which 0.2 draws as bare ground rather than as zero tests.
          if (contracts > 0) parcel.testCount = contracts;
          return parcel;
        }),
        treeTitle: island.title,
        wisps: [],
        claims: [],
        plate: { w: 0, h: 0, rx: 0, idY: 0, subY: 0, idText: island.title, subText: "", title: island.title },
      };
    }),
  };
}

/** The 3D stream 0.2's canvas draws for `scene`: its ground, coast and parcels, sized per capability as 0.2 sized them. */
export function forestDescriptors(scene: ForestScene): Descriptor3D[] {
  return worldTo3D(buildScene(groundInput(scene)));
}

function groundCells(descriptors: readonly Descriptor3D[]): InstanceDescriptor[] {
  return descriptors.filter((d): d is InstanceDescriptor => d.kind === "cell-ground" && d.points !== undefined);
}

/** Whether (x, z) is inside the closed ring `ring` (even-odd rule). */
function inside(ring: readonly Transform3D[], x: number, z: number): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) within = !within;
  }
  return within;
}

/** The story whose ground is under (x, z), in 0.2 ground units, or undefined over open sea. */
export function islandAt(descriptors: readonly Descriptor3D[], x: number, z: number): string | undefined {
  return groundCells(descriptors).find((cell) => inside(cell.points!, x, z))?.island;
}

/** Where each capability's parcel lies, as the middle of its cells, in 0.2 ground units: the tree stands on it. */
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
