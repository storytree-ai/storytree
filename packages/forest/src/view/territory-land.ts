// Capability 3 · Story node render
import type { CapabilityWord } from "@storytree/forest-world/scene";
import type { IslandRoads } from "../territories/island-roads.js";
import { insideOf, onLand } from "../territories/territories.js";
import { cutOpenings, QUIET_BORDER } from "./island-roads.js";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Object3D, ShapeUtils, Vector2, type Vector3 } from "three";

export const WORD_FILL: Readonly<Record<CapabilityWord, { colour: string; opacity: number }>> = {
  healthy: { colour: "#97C459", opacity: 0.8 },
  unhealthy: { colour: "#E24B4A", opacity: 0.85 },
  proposed: { colour: "#F2D16B", opacity: 0.8 },
  untested: { colour: "#F2D16B", opacity: 0.8 },
};
export const PARKED_FILL = { colour: "#86939D", opacity: 0.8 };
export const MAPPED_FILL = { colour: "#A9794E", opacity: 0.85 };
export const UNCHARTED_FILL = { colour: "#101418", opacity: 0.92 };
export const UNCHARTED_HATCH = { colour: "#8fa8b8", opacity: 0.35 };
const HATCH_SPACING = 0.35;
const BORDER_COLOUR = "#f4f7f8";
const BORDER_OPACITY = 0.85;

type Point = { readonly x: number; readonly z: number };

export type DrawnLand = {
  readonly territories: readonly { readonly capability?: string; readonly title?: string; readonly description?: string; readonly status?: CapabilityWord; readonly parked?: true; readonly mapped?: true }[];
  readonly cells: readonly { readonly polygon: readonly Point[]; readonly territory: number }[];
  readonly borders: readonly { readonly from: Point; readonly to: Point }[];
};

export function territoryLand(land: DrawnLand, onSurface: (point: Point) => Vector3, coast?: readonly (readonly Point[])[], claimed: ReadonlyMap<string, { colour: string; faded: boolean }> = new Map(), roads?: Pick<IslandRoads, "gates" | "passes">): Group {
  const group = new Group();
  group.name = "territory-land";
  const land3 = coast === undefined ? undefined : landTriangles(coast);
  land.territories.forEach((territory, at) => {
    const cells = land.cells.filter((cell) => cell.territory === at && cell.polygon.length >= 3).map((cell) => cell.polygon);
    const pieces = cells.flatMap((cell) => land3 === undefined ? [cell] : land3.map((triangle) => clipToConvex(triangle, cell)).filter((piece) => piece.length >= 3));
    const mesh = new Mesh(fan(pieces, onSurface), territoryFill(territory));
    mesh.name = `territory:${territory.capability ?? (territory.mapped === true ? "mapped" : "unclaimed")}`;
    const claimant = territory.capability === undefined ? undefined : claimed.get(territory.capability);
    mesh.userData = territory.mapped === true && territory.capability === undefined ? { territory: true, mapped: true } : territory.capability === undefined ? { territory: true }
      : { territory: true, ...(territory.mapped === true ? { mapped: true } : {}), capability: territory.capability, title: territory.title ?? territory.capability, ...(territory.description === undefined ? {} : { description: territory.description }), word: territory.status ?? "untested", ...(territory.parked === true ? { parked: true } : {}), ...(claimant === undefined ? {} : { claimedBy: claimant.colour }) };
    mesh.renderOrder = 1;
    groundOf.set(mesh, pieces);
    group.add(mesh);
    if (territory.capability === undefined && territory.mapped !== true) group.add(hatch(pieces, onSurface));
  });
  const ashore = coast === undefined ? land.borders : land.borders.flatMap(({ from, to }) => insideOf(from, to, coast));
  const kept = roads === undefined ? ashore : cutOpenings(ashore, [...roads.gates, ...roads.passes]);
  const segments = kept.flatMap(({ from, to }) => [onSurface(from), onSurface(to)]).flatMap((point) => [point.x, point.y, point.z]);
  const borders = new BufferGeometry();
  borders.setAttribute("position", new Float32BufferAttribute(segments, 3));
  const ink = roads === undefined ? { colour: BORDER_COLOUR, opacity: BORDER_OPACITY } : QUIET_BORDER;
  const lines = new LineSegments(borders, new LineBasicMaterial({ color: ink.colour, transparent: true, opacity: ink.opacity, depthWrite: false }));
  lines.name = "territory-borders";
  lines.userData = { borders: kept.length, ground: kept.flatMap(({ from, to }) => [from.x, from.z, to.x, to.z]) };
  lines.renderOrder = 2;
  group.add(lines);
  return group;
}

const groundOf = new WeakMap<Object3D, readonly (readonly Point[])[]>();

export function filledUnder(before: Group, mark: Object3D): Mesh | undefined {
  const area = (piece: readonly Point[]) => Math.abs(piece.reduce((sum, p, at) => { const q = piece[(at + 1) % piece.length]!; return sum + p.x * q.z - q.x * p.z; }, 0));
  const largest = (groundOf.get(mark) ?? []).reduce<readonly Point[] | undefined>((best, piece) => best === undefined || area(piece) > area(best) ? piece : best, undefined);
  if (largest === undefined) return undefined;
  const middle = { x: largest.reduce((sum, p) => sum + p.x, 0) / largest.length, z: largest.reduce((sum, p) => sum + p.z, 0) / largest.length };
  return before.children.find((old): old is Mesh => old.name.startsWith("territory:") && (groundOf.get(old) ?? []).some((piece) => inConvex(middle, piece)));
}

function territoryFill(territory: DrawnLand["territories"][number]): MeshBasicMaterial {
  const fill = territory.capability === undefined ? (territory.mapped === true ? MAPPED_FILL : UNCHARTED_FILL) : territory.parked === true ? PARKED_FILL : WORD_FILL[territory.status ?? "untested"];
  return new MeshBasicMaterial({ color: new Color(fill.colour), transparent: true, opacity: fill.opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
}

function hatch(pieces: readonly (readonly Point[])[], onSurface: (point: Point) => Vector3): LineSegments {
  const step = HATCH_SPACING * Math.SQRT2;
  const positions = pieces.flatMap((piece) => {
    const [x0, x1] = [Math.min(...piece.map((p) => p.x)), Math.max(...piece.map((p) => p.x))];
    const sums = piece.map((p) => p.x + p.z);
    const lines: { from: Point; to: Point }[] = [];
    for (let n = Math.ceil(Math.min(...sums) / step); n * step <= Math.max(...sums); n++) {
      lines.push(...segmentInConvex({ x: x0, z: n * step - x0 }, { x: x1, z: n * step - x1 }, piece));
    }
    return lines.flatMap(({ from, to }) => [onSurface(from), onSurface(to)]);
  }).flatMap((point) => [point.x, point.y, point.z]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ color: UNCHARTED_HATCH.colour, transparent: true, opacity: UNCHARTED_HATCH.opacity, depthWrite: false }));
  lines.name = "territory-hatch:unclaimed";
  lines.raycast = () => {};
  lines.renderOrder = 1.2;
  return lines;
}

function fan(pieces: readonly (readonly Point[])[], onSurface: (point: Point) => Vector3): BufferGeometry {
  const positions: number[] = [];
  for (const piece of pieces) {
    const corners = piece.map(onSurface);
    for (let i = 1; i < corners.length - 1; i++) for (const corner of [corners[0]!, corners[i]!, corners[i + 1]!]) positions.push(corner.x, corner.y, corner.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function lotDashes(land: DrawnLand, at: number, coast: readonly (readonly Point[])[] | undefined, { inset, on, off }: { inset: number; on: number; off: number }): { from: Point; to: Point }[] {
  const cells = land.cells.filter((cell) => cell.territory === at && cell.polygon.length >= 3).map((cell) => cell.polygon);
  const land3 = coast === undefined ? undefined : landTriangles(coast);
  const pieces = cells.flatMap((cell) => land3 === undefined ? [cell] : land3.map((triangle) => clipToConvex(triangle, cell)).filter((piece) => piece.length >= 3));
  const near = (p: Point, q: Point) => Math.abs(p.x - q.x) + Math.abs(p.z - q.z) < 1e-6;
  const shared = (a: Point, b: Point, own: number) => cells.some((cell, at) => at !== own && cell.some((p, i) => {
    const q = cell[(i + 1) % cell.length]!;
    return (near(p, b) && near(q, a)) || (near(p, a) && near(q, b));
  }));
  const edges = [...cells.flatMap((cell, own) => cell.flatMap((a, i) => {
    const b = cell[(i + 1) % cell.length]!;
    return shared(a, b, own) ? [] : coast === undefined ? [{ from: a, to: b }] : insideOf(a, b, coast);
  })), ...(coast ?? []).flatMap((ring) => ring.flatMap((a, i) => cells.flatMap((cell) => segmentInConvex(a, ring[(i + 1) % ring.length]!, cell))))];
  const inside = (p: Point) => pieces.some((piece) => inConvex(p, piece));
  const clear = (p: Point) => edges.every(({ from, to }) => toSegment(p, from, to) >= inset * 0.98);
  return edges.flatMap(({ from, to }) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 1e-9) return [];
    let normal = { x: -(to.z - from.z) / length, z: (to.x - from.x) / length };
    const middle = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    if (!inside({ x: middle.x + normal.x * 1e-4, z: middle.z + normal.z * 1e-4 })) normal = { x: -normal.x, z: -normal.z };
    const along = (s: number): Point => ({ x: from.x + (to.x - from.x) * s / length + normal.x * inset, z: from.z + (to.z - from.z) * s / length + normal.z * inset });
    const dashes: { from: Point; to: Point }[] = [];
    for (let s = 0; s < length; s += on + off) {
      const [a, b, m] = [along(s), along(Math.min(length, s + on)), along(Math.min(length, s + on / 2))];
      if ([a, b, m].every((p) => inside(p) && clear(p))) dashes.push({ from: a, to: b });
    }
    return dashes;
  });
}

export function toSegment(p: Point, a: Point, b: Point): number {
  const [dx, dz] = [b.x - a.x, b.z - a.z];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

function inConvex(p: Point, loop: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i]!, loop[(i + 1) % loop.length]!];
    const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    if (Math.abs(cross) < 1e-12) continue;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

export function segmentInConvex(from: Point, to: Point, loop: readonly Point[]): { from: Point; to: Point }[] {
  const turn = Math.sign(loop.reduce((sum, p, at) => { const q = loop[(at + 1) % loop.length]!; return sum + p.x * q.z - q.x * p.z; }, 0));
  let [enter, leave] = [0, 1];
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i]!, loop[(i + 1) % loop.length]!];
    const side = (p: Point) => turn * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const [sf, st] = [side(from), side(to)];
    if (sf < 0 && st < 0) return [];
    if (sf < 0) enter = Math.max(enter, sf / (sf - st));
    else if (st < 0) leave = Math.min(leave, sf / (sf - st));
  }
  if (leave - enter < 1e-9) return [];
  const at = (t: number): Point => ({ x: from.x + t * (to.x - from.x), z: from.z + t * (to.z - from.z) });
  return [{ from: at(enter), to: at(leave) }];
}

export function landTriangles(coast: readonly (readonly Point[])[]): Point[][] {
  const loops = coast.filter((ring) => ring.length >= 3);
  const depth = (ring: readonly Point[]) => loops.filter((other) => other !== ring && onLand(ring[0]!, [other])).length;
  return loops.filter((ring) => depth(ring) % 2 === 0).flatMap((outer) => {
    const holes = loops.filter((ring) => depth(ring) % 2 === 1 && onLand(ring[0]!, [outer]));
    const points = [outer, ...holes].flat();
    return ShapeUtils.triangulateShape(outer.map((p) => new Vector2(p.x, p.z)), holes.map((hole) => hole.map((p) => new Vector2(p.x, p.z))))
      .map((triangle) => triangle.map((index) => points[index]!));
  });
}

export function clipToConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const turn = Math.sign(clip.reduce((sum, p, at) => { const q = clip[(at + 1) % clip.length]!; return sum + p.x * q.z - q.x * p.z; }, 0));
  if (turn === 0) return [];
  let out = [...subject];
  clip.forEach((a, at) => {
    const b = clip[(at + 1) % clip.length]!;
    const side = (p: Point) => turn * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const input = out;
    out = [];
    input.forEach((p, i) => {
      const q = input[(i + 1) % input.length]!;
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push({ x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) }); }
    });
  });
  return out;
}

const LIT_TERRITORY = { "in-window": 0.36, faded: 0.26 } as const;

export function lightTerritories(land: Group, lit: ReadonlyMap<string, "in-window" | "faded">, colour: string): void {
  for (const mesh of land.children) {
    const capability = mesh.userData.capability;
    if (typeof capability !== "string" || !(mesh instanceof Mesh)) continue;
    const old = mesh.getObjectByName(`territory-lit:${capability}`) as Mesh | undefined;
    if (old !== undefined) {
      old.removeFromParent();
      (old.material as MeshBasicMaterial).dispose();
    }
    const state = lit.get(capability);
    if (state === undefined) {
      delete mesh.userData.window;
      continue;
    }
    mesh.userData.window = state;
    const wear = new Color(colour);
    if (state === "faded") wear.lerp(new Color("#ffffff"), 0.55);
    const fill = new Mesh(mesh.geometry, new MeshBasicMaterial({ color: wear, transparent: true, opacity: LIT_TERRITORY[state], side: DoubleSide, forceSinglePass: true, depthWrite: false }));
    fill.name = `territory-lit:${capability}`;
    fill.raycast = () => {};
    fill.userData = { traversal: true };
    fill.renderOrder = 1.5;
    mesh.add(fill);
  }
}
