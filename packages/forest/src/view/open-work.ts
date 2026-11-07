/**
 * Capability 3 · Story node render. Where work is landing (ADR-1253 D1 as corrected 2026-11-05): an arc selected draws a hollow
 * ring, like a game's unit-selection ring, round each capability its open increments name, round its own marker (its settlement
 * symbol, or its nameplate where it has none), and dims the rest (3.83), at every zoom (ADR-1272 D2). Every ring keeps one line
 * width on screen at any zoom, as a claim's flag keeps its size (ADR-1062 D1), and is never less than `RING_LEAST_PX` across
 * (3.86). With no arc selected open work draws nothing (3.84). A selected capability gets the same ring in the pick's gold,
 * outside any blue one, so a pick reads one way and blue keeps meaning open work (3.91).
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import type { IslandRoads } from "../territories/island-roads.js";
import type { Point, TerritoryMap } from "../territories/territories.js";
import type { SessionEmphasis } from "./session-emphasis.js";
import { capabilityPlates } from "./nameplates.js";

/** A capability's ring: a circle of `radius` round its marker at (`x`, `z`). */
export type OpenWorkRing = { readonly capability: string; readonly x: number; readonly z: number; readonly radius: number };
/** What an island draws of the open work: its capabilities' rings and the territories (by position) an arc selected dims; and
 * the selected capability's ring, if it is on the island (3.91). */
export type OpenWorkMarks = { readonly rings: readonly OpenWorkRing[]; readonly dimmed: readonly number[]; readonly picked?: OpenWorkRing };

/** The ring's line on screen, in CSS pixels, at every zoom; and the least a capability's ring is across, in CSS pixels, so a
 * ring round a settlement drawn only a few pixels wide still reads. */
export const RING_PX = 3, RING_LEAST_PX = 24;
/** A ring's room round its settlement symbol, as a share of the symbol's size: its 24-unit box's corners lie at 0.71. */
const SETTLEMENT_ROOM = 0.8;
/** A selected capability's ring: its room outside an open-work ring's, as a share of that ring's radius, and the least it is
 * across past that ring's least, in CSS pixels, so the two stay apart at any zoom. */
const PICKED = { room: 1.3, least: 4 * RING_PX } as const;
/** A ring's radius round a nameplate where the capability has no settlement, as a share of the island's reach. */
const NAMEPLATE_RING = 0.07;
/** The selected arc's rings: a pale cyan no health fill, gold selection or white border wears. */
export const OPEN_WORK = "#8fe3f5";
/** A pick's gold: a picked gate's ring (3.88) and a selected capability's (3.91). */
export const PICK_GOLD = "#ffd34d";
/** What an arc selected lays over the territories it does not ring. */
const DIM = { colour: "#0b0f14", opacity: 0.5 };

const NONE: OpenWorkMarks = { rings: [], dimmed: [] };

/**
 * The open work on `map` for the selected arc's open increments' capabilities (`circled`; undefined, no arc selected): a ring
 * round each named capability's settlement on `roads` (sized to it, with room), or round its nameplate where it has none, every
 * other territory on the island dimmed; and round the selected capability (`picked`), if it is on the island, a ring outside
 * that one (3.91).
 */
export function openWorkMarks(map: TerritoryMap, circled: ReadonlySet<string> | undefined, roads?: IslandRoads, picked?: string): OpenWorkMarks {
  const ringOf = ({ capability, x, z }: { capability: string; x: number; z: number }): OpenWorkRing => {
    const settlement = roads?.settlements.get(capability);
    return settlement === undefined ? { capability, x, z, radius: map.radius * NAMEPLATE_RING }
      : { capability, x: settlement.at.x, z: settlement.at.z, radius: settlement.size * SETTLEMENT_ROOM };
  };
  const plates = capabilityPlates(map), plate = picked === undefined ? undefined : plates.find(({ capability }) => capability === picked);
  const ring = plate === undefined ? undefined : ringOf(plate), pick = ring === undefined ? {} : { picked: { ...ring, radius: ring.radius * PICKED.room } };
  if (circled === undefined) return ring === undefined ? NONE : { ...NONE, ...pick };
  const rings = plates.flatMap((plate) => circled.has(plate.capability) ? [ringOf(plate)] : []);
  // An island it rings nothing on is dimmed whole (arcEmphasis), so its territories are not dimmed again.
  if (rings.length === 0) return { ...NONE, ...pick };
  const dimmed = map.territories.flatMap(({ capability }, at) => capability !== undefined && circled.has(capability) ? [] : [at]);
  return { rings, dimmed, ...pick };
}

/** An arc selected dims an island none of whose territories it rings (3.83), as a session's hover dims the islands it holds none of. */
export function arcEmphasis(territories: readonly { readonly capability?: string }[], circled: ReadonlySet<string> | undefined): SessionEmphasis {
  if (circled === undefined) return undefined;
  return territories.some(({ capability }) => capability !== undefined && circled.has(capability)) ? undefined : "dimmed";
}

/** A ring mesh's circle: its radius round its marker, the least it is across on screen (`least`, CSS pixels), and its line's
 * width and radius as drawn, so `sizeOpenWork` can redraw it for another zoom. */
type RingShape = { readonly centre: Point; readonly radius: number; readonly least: number; width: number; drawn: number };

/**
 * The marks of `marks` on the land: each dim laid over its territory's own fill in `land` (territoryLand's group), each ring
 * (the selected capability's in gold) placed by `onSurface`, drawn for an eye at `zoom` (CSS px per ground unit) until `sizeOpenWork` draws it for another. Nothing
 * in it takes a pointer, so a click still picks the land.
 */
export function openWorkLayer(marks: OpenWorkMarks, land: Object3D, onSurface: (point: Point) => Vector3, zoom: number): Group {
  const group = new Group();
  group.name = "open-work";
  group.userData.onSurface = onSurface;
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
  // Over the roads, under the settlements, names and flags that stand on them.
  for (const { capability, x, z, radius } of marks.rings) add(hollowRing({ x, z }, radius, RING_LEAST_PX, ink, onSurface, zoom), `open-work-ring:${capability}`, 5);
  if (marks.picked !== undefined) {
    const { capability, x, z, radius } = marks.picked;
    add(hollowRing({ x, z }, radius, RING_LEAST_PX + PICKED.least, flat(PICK_GOLD, 1), onSurface, zoom), `picked-ring:${capability}`, 5);
  }
  return group;
}

/** A hollow ring of `radius` round `centre`, at least `least` CSS pixels across, placed by `onSurface` in `material`, its
 * line drawn `RING_PX` wide on screen for an eye at `zoom` until `sizeOpenWork` draws it for another (a layer holding it
 * names its `onSurface` in its userData). It takes no pointer. */
export function hollowRing(centre: Point, radius: number, least: number, material: MeshBasicMaterial, onSurface: (point: Point) => Vector3, zoom: number): Mesh {
  const shape: RingShape = { centre, radius, least, width: RING_PX / zoom, drawn: Math.max(radius, least / 2 / zoom) };
  const mesh = new Mesh(annulus(shape, onSurface), material);
  mesh.userData.ring = shape;
  mesh.raycast = () => {};
  return mesh;
}

/**
 * Redraws every ring of `layer` for an eye at `zoom` (CSS px per ground unit): its line `RING_PX` wide on screen, and a
 * capability's ring `RING_LEAST_PX` across at least. A zoom within a twentieth of the one a ring was drawn for leaves it alone,
 * so a still eye redraws nothing. Whether it redrew any.
 */
export function sizeOpenWork(layer: Group, zoom: number): boolean {
  const onSurface = layer.userData.onSurface as ((point: Point) => Vector3) | undefined;
  const width = RING_PX / zoom;
  let redrawn = false;
  for (const mark of layer.children) {
    const shape = mark.userData.ring as RingShape | undefined;
    if (shape === undefined || onSurface === undefined || Math.abs(shape.width - width) <= width / 20) continue;
    shape.width = width;
    shape.drawn = Math.max(shape.radius, shape.least / 2 / zoom);
    const mesh = mark as Mesh;
    mesh.geometry.dispose();
    mesh.geometry = annulus(shape, onSurface);
    redrawn = true;
  }
  return redrawn;
}

/** The hollow circle of `shape` as drawn, its line `width` across, as triangles on the surface. */
function annulus({ centre, drawn: radius, width }: RingShape, onSurface: (point: Point) => Vector3): BufferGeometry {
  const sides = Math.max(48, Math.min(160, Math.ceil(radius / width) * 4)), positions: number[] = [];
  const at = (r: number, k: number) => onSurface({ x: centre.x + r * Math.cos(k * 2 * Math.PI / sides), z: centre.z + r * Math.sin(k * 2 * Math.PI / sides) });
  const inner = Math.max(radius - width / 2, 0), outer = radius + width / 2;
  for (let k = 0; k < sides; k++) {
    const a = at(inner, k), b = at(outer, k), c = at(outer, k + 1), d = at(inner, k + 1);
    for (const corner of [a, b, c, a, c, d]) positions.push(corner.x, corner.y, corner.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}
