/**
 * Capability 3 · Story node render: an island's capability territories as drawn (ADR-0804 D2). Each
 * territory is one faintly tinted mesh named `territory:<capability>` (Unclaimed code's is
 * `territory:unclaimed`, with no capability), so a click on its land picks it; the borders between
 * territories are one set of line segments. Both stop at the island's coast. Plain three.js, so the
 * marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, ShapeUtils, Vector2, type Vector3 } from "three";
import type { IslandLand } from "@storytree/forest-world/scene";

/** Faint, distinct tints: the land stays pale, so circles and traversal lines read on top of it. */
const TINTS = ["#9cc3d5", "#c9b38f", "#a8c49a", "#c7a0b5", "#b4acd6", "#d4c48a", "#8fc2b8", "#d2a48e", "#a5b8cf", "#bfc98f"];
const UNCLAIMED_TINT = "#b9bec2";
const TERRITORY_OPACITY = 0.22;
const BORDER_COLOUR = "#f4f7f8";
const BORDER_OPACITY = 0.85;

type Point = { readonly x: number; readonly z: number };

/**
 * The territories of `land`, each point placed on the island's surface by `onSurface`, cut to `coast`
 * (its loops, in the same coordinates as the land) when given.
 */
export function territoryLand(land: IslandLand, onSurface: (point: Point) => Vector3, coast?: readonly (readonly Point[])[]): Group {
  const group = new Group();
  group.name = "territory-land";
  let tint = 0;
  land.territories.forEach((territory, at) => {
    const positions: number[] = [];
    for (const cell of land.cells) {
      if (cell.territory !== at || cell.polygon.length < 3) continue;
      const pieces = coast === undefined ? [cell.polygon] : coast.map((ring) => clipToConvex(ring, cell.polygon)).filter((piece) => piece.length >= 3);
      for (const piece of pieces) {
        const corners = piece.map(onSurface);
        for (const triangle of ShapeUtils.triangulateShape(piece.map((p) => new Vector2(p.x, p.z)), [])) {
          for (const index of triangle) positions.push(corners[index]!.x, corners[index]!.y, corners[index]!.z);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const colour = territory.capability === undefined ? UNCLAIMED_TINT : TINTS[tint++ % TINTS.length]!;
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity: TERRITORY_OPACITY, side: DoubleSide, depthWrite: false }));
    mesh.name = `territory:${territory.capability ?? "unclaimed"}`;
    mesh.userData = territory.capability === undefined ? { territory: true } : { territory: true, capability: territory.capability };
    mesh.renderOrder = 1;
    group.add(mesh);
  });
  const kept = coast === undefined ? land.borders : land.borders.flatMap(({ from, to }) => insideOf(from, to, coast));
  const segments = kept.flatMap(({ from, to }) => [onSurface(from), onSurface(to)]).flatMap((point) => [point.x, point.y, point.z]);
  const borders = new BufferGeometry();
  borders.setAttribute("position", new Float32BufferAttribute(segments, 3));
  const lines = new LineSegments(borders, new LineBasicMaterial({ color: BORDER_COLOUR, transparent: true, opacity: BORDER_OPACITY, depthWrite: false }));
  lines.name = "territory-borders";
  lines.userData = { borders: kept.length };
  lines.renderOrder = 2;
  group.add(lines);
  return group;
}

/** The part of `subject` (any simple loop) inside the convex loop `clip`: Sutherland and Hodgman's clipping. */
function clipToConvex(subject: readonly Point[], clip: readonly Point[]): Point[] {
  const turn = Math.sign(clip.reduce((sum, p, at) => { const q = clip[(at + 1) % clip.length]!; return sum + p.x * q.z - q.x * p.z; }, 0));
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

/** Whether `p` is on the land the coast's loops enclose (a loop inside a loop is a lake). */
function onLand(p: Point, coast: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const ring of coast) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i]!, ring[j]!];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** The pieces of the segment from `from` to `to` that lie on the land. */
function insideOf(from: Point, to: Point, coast: readonly (readonly Point[])[]): { from: Point; to: Point }[] {
  const cuts = [0, 1];
  const d = { x: to.x - from.x, z: to.z - from.z };
  for (const ring of coast) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const e = { x: b.x - a.x, z: b.z - a.z };
      const denominator = d.x * e.z - d.z * e.x;
      if (denominator === 0) return;
      const t = ((a.x - from.x) * e.z - (a.z - from.z) * e.x) / denominator;
      const u = ((a.x - from.x) * d.z - (a.z - from.z) * d.x) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    });
  }
  cuts.sort((a, b) => a - b);
  const at = (t: number): Point => ({ x: from.x + t * d.x, z: from.z + t * d.z });
  return cuts.slice(1).flatMap((t, i) => (onLand(at((cuts[i]! + t) / 2), coast) && t > cuts[i]! ? [{ from: at(cuts[i]!), to: at(t) }] : []));
}
