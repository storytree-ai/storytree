// Capability 3 · Story node render
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, type Object3D, type Vector3 } from "three";
import type { IslandRoads } from "../territories/island-roads.js";
import type { Point, TerritoryMap } from "../territories/territories.js";
import { capabilityPlates } from "./nameplates.js";

export type OpenWorkRing = { readonly capability: string; readonly x: number; readonly z: number; readonly radius: number };
export type OpenWorkGate = { readonly gate: number; readonly x: number; readonly z: number; readonly radius: number };
export type OpenWorkMarks = { readonly rings: readonly OpenWorkRing[]; readonly gates?: readonly OpenWorkGate[]; readonly picked?: OpenWorkRing };

export const RING_PX = 3, RING_LEAST_PX = 24;
const SETTLEMENT_ROOM = 0.8;
const PICKED = { room: 1.3, least: 4 * RING_PX } as const;
const GATE_RING = 0.6;
const NAMEPLATE_RING = 0.07;
export const OPEN_WORK = "#8fe3f5";
export const PICK_GOLD = "#ffd34d";
const NONE: OpenWorkMarks = { rings: [] };

export function rungLinks(edges: readonly { from: string; to: string; contracts: readonly string[] }[], contracts: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (contracts === undefined) return undefined;
  const open = new Set(contracts);
  return new Set(edges.flatMap(({ from, to, contracts: held }) => held.some((id) => open.has(id)) ? [`${from}->${to}`] : []));
}

export function ringedCapabilities(named: readonly string[] | undefined, contracts: readonly string[] | undefined, owned: readonly { capability: string; contracts: readonly string[] }[]): ReadonlySet<string> | undefined {
  if (named === undefined) return undefined;
  const open = new Set(contracts ?? []);
  return new Set([...named, ...owned.flatMap(({ capability, contracts: held }) => held.some((id) => open.has(id)) ? [capability] : [])]);
}

export function openWorkCount(scene: { contracts?: readonly { capability: string; contracts: readonly string[] }[]; edges?: readonly { from: string; to: string; contracts: readonly string[] }[] },
  named: readonly string[] | undefined, contracts: readonly string[] | undefined): { parts: number; links: number } | undefined {
  const parts = ringedCapabilities(named, contracts, scene.contracts ?? []);
  return parts === undefined ? undefined : { parts: parts.size, links: rungLinks(scene.edges ?? [], contracts ?? [])!.size };
}

export function openWorkMarks(map: TerritoryMap, circled: ReadonlySet<string> | undefined, roads?: IslandRoads, picked?: string, rung?: ReadonlySet<string>): OpenWorkMarks {
  const ringOf = ({ capability, x, z }: { capability: string; x: number; z: number }): OpenWorkRing => {
    const settlement = roads?.settlements.get(capability);
    return settlement === undefined ? { capability, x, z, radius: map.radius * NAMEPLATE_RING }
      : { capability, x: settlement.at.x, z: settlement.at.z, radius: settlement.size * SETTLEMENT_ROOM };
  };
  const plates = capabilityPlates(map), plate = picked === undefined ? undefined : plates.find(({ capability }) => capability === picked);
  const ring = plate === undefined ? undefined : ringOf(plate), pick = ring === undefined ? {} : { picked: { ...ring, radius: ring.radius * PICKED.room } };
  if (circled === undefined) return ring === undefined ? NONE : { ...NONE, ...pick };
  const rings = plates.flatMap((plate) => circled.has(plate.capability) ? [ringOf(plate)] : []);
  const gates = (roads?.gates ?? []).flatMap((gate, at) => gate.entrances.some((link) => rung?.has(link) === true)
    ? [{ gate: at, x: gate.at.x, z: gate.at.z, radius: gate.opening * GATE_RING }] : []);
  return { rings, ...(gates.length === 0 ? {} : { gates }), ...pick };
}

type RingShape = { readonly centre: Point; readonly radius: number; readonly least: number; width: number; drawn: number };

export function openWorkLayer(marks: OpenWorkMarks, onSurface: (point: Point) => Vector3, zoom: number, inks: OpenWorkInks = openWorkInks()): Group {
  const group = new Group();
  group.name = "open-work";
  group.userData.onSurface = onSurface;
  const add = (mesh: Mesh, name: string, order: number) => { mesh.name = name; mesh.renderOrder = order; mesh.raycast = () => {}; group.add(mesh); };
  for (const { capability, x, z, radius } of marks.rings) add(hollowRing({ x, z }, radius, RING_LEAST_PX, inks.ink, onSurface, zoom), `open-work-ring:${capability}`, 5);
  for (const { gate, x, z, radius } of marks.gates ?? []) add(hollowRing({ x, z }, radius, RING_LEAST_PX, inks.ink, onSurface, zoom), `open-work-gate:${gate}`, 5);
  if (marks.picked !== undefined) {
    const { capability, x, z, radius } = marks.picked;
    add(hollowRing({ x, z }, radius, RING_LEAST_PX + PICKED.least, inks.gold, onSurface, zoom), `picked-ring:${capability}`, 5);
  }
  return group;
}

type OpenWorkInks = { readonly ink: MeshBasicMaterial; readonly gold: MeshBasicMaterial };

function openWorkInks(): OpenWorkInks {
  const flat = (colour: string, opacity: number) => new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  return { ink: flat(OPEN_WORK, 0.95), gold: flat(PICK_GOLD, 1) };
}

export class IslandOpenWork {
  readonly root = new Group();
  private readonly inks = openWorkInks();
  private readonly layers: { arc?: { key: string; layer: Group } | undefined; pick?: { key: string; layer: Group } | undefined } = {};
  private onSurface: ((point: Point) => Vector3) | undefined;

  constructor() { this.root.name = "open-work"; }

  show(marks: OpenWorkMarks, onSurface: (point: Point) => Vector3, zoom: number): Group[] {
    const moved = onSurface !== this.onSurface;
    this.onSurface = onSurface;
    const parts = { arc: { rings: marks.rings, ...(marks.gates === undefined ? {} : { gates: marks.gates }) }, pick: { rings: [], ...(marks.picked === undefined ? {} : { picked: marks.picked }) } };
    const drawn: Group[] = [];
    for (const part of ["arc", "pick"] as const) {
      const key = JSON.stringify(parts[part]), was = this.layers[part];
      if (!moved && was?.key === key) continue;
      if (was !== undefined) { this.root.remove(was.layer); freeRings(was.layer); }
      const layer = openWorkLayer(parts[part], onSurface, zoom, this.inks);
      this.layers[part] = { key, layer };
      this.root.add(layer);
      if (layer.children.length > 0) drawn.push(layer);
    }
    return drawn;
  }

  size(zoom: number): boolean {
    let redrawn = false;
    for (const layer of this.root.children) if (layer.children.length > 0 && sizeOpenWork(layer as Group, zoom)) redrawn = true;
    return redrawn;
  }

  dispose(): void {
    for (const layer of this.root.children) freeRings(layer);
    this.root.clear();
    this.layers.arc = this.layers.pick = undefined;
    this.inks.ink.dispose();
    this.inks.gold.dispose();
  }
}

function freeRings(layer: Object3D): void {
  for (const mark of layer.children) (mark as Mesh).geometry.dispose();
}

export function hollowRing(centre: Point, radius: number, least: number, material: MeshBasicMaterial, onSurface: (point: Point) => Vector3, zoom: number): Mesh {
  const shape: RingShape = { centre, radius, least, width: RING_PX / zoom, drawn: Math.max(radius, least / 2 / zoom) };
  const mesh = new Mesh(annulus(shape, onSurface), material);
  mesh.userData.ring = shape;
  mesh.raycast = () => {};
  return mesh;
}

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
