/**
 * Capability 3 · Story node render. Where work is landing (ADR-1253 D1): an arc selected rings each territory its open increments
 * name, its own outline traced just inside its border, and dims the rest (3.83), and a dot, always shown, marks each territory
 * any open increment names (3.84). A circle as wide as a territory spills onto its neighbours, so the ring follows the land.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import { shows, type Detail } from "./zoom-detail.js";
import type { IslandRoads } from "../territories/island-roads.js";
import type { Point, TerritoryMap } from "../territories/territories.js";
import type { SessionEmphasis } from "./session-emphasis.js";
import { capabilityPlates } from "./nameplates.js";
import { lotDashes, toSegment } from "./territory-land.js";

/** A territory's ring: its outline, in pieces, just inside its border. */
export type OpenWorkRing = { readonly capability: string; readonly outline: readonly { readonly from: Point; readonly to: Point }[] };
/** A territory's open-work dot. */
export type OpenWorkDot = { readonly capability: string; readonly x: number; readonly z: number };
/** What an island draws of the open work: its rings, its dots, and the territories (by position) an arc selected dims. */
export type OpenWorkMarks = { readonly rings: readonly OpenWorkRing[]; readonly dots: readonly OpenWorkDot[]; readonly dimmed: readonly number[] };

/** The ring's band and the dot, as shares of the island's reach: thin enough to leave the land readable. */
const RING_WIDTH = 0.022;
const DOT_RADIUS = 0.045;
/** The selected arc's ring and the open-work dot: a pale cyan no health fill, gold selection or white border wears. */
export const OPEN_WORK = "#8fe3f5";
const DOT_CASING = { colour: "#10202a", opacity: 0.7 };
/** What an arc selected lays over the territories it does not ring. */
const DIM = { colour: "#0b0f14", opacity: 0.5 };

const NONE: OpenWorkMarks = { rings: [], dots: [], dimmed: [] };

/**
 * The open work on `map` (cut to `coast`, when given): with an arc selected (`circled`, its open increments' capabilities), a ring
 * along the inside of each territory it names and every other territory on the island dimmed; and a dot on each territory `open`
 * names, at the cell site of its own land with the most room round it: furthest from every name, settlement and gate on the
 * island (`roads`, when the island is laid out by them), and clear of its coast and its neighbours.
 */
export function openWorkMarks(map: TerritoryMap, { circled, open }: { circled: ReadonlySet<string> | undefined; open: ReadonlySet<string> }, roads?: IslandRoads, coast?: readonly (readonly Point[])[]): OpenWorkMarks {
  const named = map.territories.some(({ capability }) => capability !== undefined && (open.has(capability) || circled?.has(capability) === true));
  if (!named && circled === undefined) return NONE;
  const plates = capabilityPlates(map);
  const plateOf = new Map(plates.map((plate) => [plate.capability, plate]));
  // The band's middle a band's width inside the border, in pieces as long as the band is wide, so a corner leaves only a short gap.
  const width = map.radius * RING_WIDTH;
  const rings = circled === undefined ? [] : map.territories.flatMap(({ capability }, at): OpenWorkRing[] =>
    capability === undefined || !circled.has(capability) || !plateOf.has(capability) ? []
      : [{ capability, outline: lotDashes(map, at, coast, { inset: width, on: width, off: 0 }) }]);
  // An island it rings nothing on is dimmed whole (arcEmphasis), so its territories are not dimmed again.
  const dimmed = rings.length === 0 ? [] : map.territories.flatMap(({ capability }, at) => capability !== undefined && circled?.has(capability) === true ? [] : [at]);
  const avoided: Point[] = [...plates, ...[...roads?.settlements.values() ?? []].map(({ at }) => at), ...(roads?.gates ?? []).map(({ at }) => at)];
  const shore = coast === undefined || coast.length === 0 ? (p: Point) => map.radius - Math.hypot(p.x, p.z)
    : (p: Point) => Math.min(...coast.flatMap((ring) => ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length]!))));
  const dots = map.territories.flatMap(({ capability }, at): OpenWorkDot[] => {
    if (capability === undefined || !open.has(capability)) return [];
    const sites = map.cells.filter(({ territory }) => territory === at).map(({ site }) => site);
    if (sites.length === 0) return [];
    // Clear of every mark, and a dot's width or more inside its own land: half the way to the nearest other territory's site
    // is about where the border runs.
    const others = map.cells.filter(({ territory }) => territory !== at).map(({ site }) => site);
    const room = (p: Point): number => Math.min(...avoided.map((q) => Math.hypot(p.x - q.x, p.z - q.z)),
      2 * shore(p), ...others.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
    const best = sites.reduce((best, site) => room(site) > room(best) ? site : best);
    return [{ capability, x: best.x, z: best.z }];
  });
  return { rings, dots, dimmed };
}

/** An arc selected dims an island none of whose territories it rings (3.83), as a session's hover dims the islands it holds none of. */
export function arcEmphasis(territories: readonly { readonly capability?: string }[], circled: ReadonlySet<string> | undefined): SessionEmphasis {
  if (circled === undefined) return undefined;
  return territories.some(({ capability }) => capability !== undefined && circled.has(capability)) ? undefined : "dimmed";
}

/**
 * The marks of `marks` on the land: each dim laid over its territory's own fill in `land` (territoryLand's group), each ring and
 * dot placed by `onSurface`, sized by the island's `reach`. Nothing in it takes a pointer, so a click still picks the land.
 */
export function openWorkLayer(marks: OpenWorkMarks, land: Object3D, onSurface: (point: Point) => Vector3, reach: number): Group {
  const group = new Group();
  group.name = "open-work";
  const flat = (colour: string, opacity: number) => new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  const add = (mesh: Mesh, name: string, order: number) => { mesh.name = name; mesh.renderOrder = order; mesh.raycast = () => {}; group.add(mesh); };
  if (marks.dimmed.length > 0) {
    const dim = flat(DIM.colour, DIM.opacity);
    for (const at of marks.dimmed) {
      const fill = land.children.filter((child): child is Mesh => child instanceof Mesh && child.name.startsWith("territory:"))[at];
      if (fill !== undefined) add(new Mesh(fill.geometry, dim), `open-work-dim:${fill.name.slice("territory:".length)}`, 1.5);
    }
  }
  const ink = flat(OPEN_WORK, 0.95);
  const width = reach * RING_WIDTH;
  for (const ring of marks.rings) add(new Mesh(strokes(ring.outline, width, onSurface), ink), `open-work-ring:${ring.capability}`, 7);
  const casing = flat(DOT_CASING.colour, DOT_CASING.opacity), dot = reach * DOT_RADIUS;
  for (const at of marks.dots) {
    add(new Mesh(disc(at, dot * 1.35, onSurface), casing), `open-work-dot:${at.capability}`, 7);
    add(new Mesh(disc(at, dot, onSurface), ink), `open-work-dot-fill:${at.capability}`, 7.01);
  }
  return group;
}

/** Shows as much of an island's open-work `layer` as the eye's zoom asks (3.86): its dots always (3.84), its rings and dims
 * only where its territories show (3.83). */
export function presentOpenWork(layer: Group, detail: Detail): void {
  for (const mark of layer.children) mark.visible = mark.name.startsWith("open-work-dot:") || shows(detail, "territories");
}

/** The disc of `radius` round `centre`, as triangles on the surface. */
function disc(centre: Point, radius: number, onSurface: (point: Point) => Vector3): BufferGeometry {
  const sides = 32, positions: number[] = [], middle = onSurface(centre);
  const at = (k: number) => onSurface({ x: centre.x + radius * Math.cos(k * 2 * Math.PI / sides), z: centre.z + radius * Math.sin(k * 2 * Math.PI / sides) });
  for (let k = 0; k < sides; k++) for (const corner of [middle, at(k), at(k + 1)]) positions.push(corner.x, corner.y, corner.z);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Each piece as a band `width` wide along it, as triangles on the surface, its ends drawn out by half the width to close corners. */
function strokes(pieces: readonly { readonly from: Point; readonly to: Point }[], width: number, onSurface: (point: Point) => Vector3): BufferGeometry {
  const positions: number[] = [];
  for (const { from, to } of pieces) {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 1e-9) continue;
    const ux = (to.x - from.x) / length, uz = (to.z - from.z) / length, h = width / 2;
    const a = { x: from.x - ux * h, z: from.z - uz * h }, b = { x: to.x + ux * h, z: to.z + uz * h };
    const corners = [{ x: a.x - uz * h, z: a.z + ux * h }, { x: b.x - uz * h, z: b.z + ux * h }, { x: b.x + uz * h, z: b.z - ux * h }, { x: a.x + uz * h, z: a.z - ux * h }].map(onSurface);
    for (const corner of [corners[0]!, corners[1]!, corners[2]!, corners[0]!, corners[2]!, corners[3]!]) positions.push(corner.x, corner.y, corner.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}
