/**
 * Capability 3 · Story node render: an island's capability territories as drawn (ADR-0804 D2). Each
 * territory is one faintly tinted mesh named `territory:<capability>` (Unclaimed code's is
 * `territory:unclaimed`, with no capability), so a click on its land picks it; the borders between
 * territories are one set of line segments. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, type Vector3 } from "three";
import type { IslandLand } from "@storytree/forest-world/scene";

/** Faint, distinct tints: the land stays pale, so circles and traversal lines read on top of it. */
const TINTS = ["#9cc3d5", "#c9b38f", "#a8c49a", "#c7a0b5", "#b4acd6", "#d4c48a", "#8fc2b8", "#d2a48e", "#a5b8cf", "#bfc98f"];
const UNCLAIMED_TINT = "#b9bec2";
const TERRITORY_OPACITY = 0.22;
const BORDER_COLOUR = "#f4f7f8";
const BORDER_OPACITY = 0.85;

/** The territories of `land`, each point placed on the island's surface by `onSurface`. */
export function territoryLand(land: IslandLand, onSurface: (point: { x: number; z: number }) => Vector3): Group {
  const group = new Group();
  group.name = "territory-land";
  let tint = 0;
  land.territories.forEach((territory, at) => {
    const positions: number[] = [];
    for (const cell of land.cells) {
      if (cell.territory !== at || cell.polygon.length < 3) continue;
      // A cell is convex: a fan from its first corner covers it.
      const corners = cell.polygon.map(onSurface);
      for (let i = 1; i < corners.length - 1; i++) for (const corner of [corners[0]!, corners[i]!, corners[i + 1]!]) positions.push(corner.x, corner.y, corner.z);
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
  const segments = land.borders.flatMap(({ from, to }) => [onSurface(from), onSurface(to)]).flatMap((point) => [point.x, point.y, point.z]);
  const borders = new BufferGeometry();
  borders.setAttribute("position", new Float32BufferAttribute(segments, 3));
  const lines = new LineSegments(borders, new LineBasicMaterial({ color: BORDER_COLOUR, transparent: true, opacity: BORDER_OPACITY, depthWrite: false }));
  lines.name = "territory-borders";
  lines.userData = { borders: land.borders.length };
  lines.renderOrder = 2;
  group.add(lines);
  return group;
}
