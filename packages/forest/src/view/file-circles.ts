/**
 * Capability 3 · Story node render: each code file's flat circle as drawn (ADR-0804 D3, 3.16). A circle
 * is a disc lying on the island's surface, face turned to the surface's normal, so it never stands up
 * and hides a neighbour; it is named `file:<path>` and carries the file, its lines and its capability,
 * which is what pointing at it names (3.17). Plain three.js, so the marks are read without a browser.
 */
import { CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3 } from "three";
import { codePathKey, IN_VIEW, type CodeState } from "@storytree/knowledge-core";

type Point = { readonly x: number; readonly z: number };

/** A file's circle as the scene carries it: its middle and radius in plate coordinates. */
export type FileCircleMark = { readonly path: string; readonly lines: number; readonly capability?: string; readonly x: number; readonly z: number; readonly radius: number };

/** Pale on the faint territories, so a lit circle (the traversal's) can stand out against them. */
const CIRCLE_COLOUR = "#e9eef0";
const CIRCLE_OPACITY = 0.5;
/** Lifted off the surface, above the territories' tint. */
const CIRCLE_LIFT = 0.1;
const FACE = new Vector3(0, 0, 1);

/** The circles, each placed by `onSurface` and turned to `normalAt` at its middle. */
export function fileCircleMarks(circles: readonly FileCircleMark[], onSurface: (point: Point) => Vector3, normalAt: (point: Point) => Vector3): Group {
  const group = new Group();
  group.name = "file-circles";
  const geometry = new CircleGeometry(1, 32);
  const material = new MeshBasicMaterial({ color: CIRCLE_COLOUR, transparent: true, opacity: CIRCLE_OPACITY, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  for (const circle of circles) {
    const mark = new Mesh(geometry, material);
    const normal = normalAt(circle).clone().normalize();
    mark.name = `file:${circle.path}`;
    mark.userData = circle.capability === undefined ? { file: circle.path, lines: circle.lines } : { file: circle.path, lines: circle.lines, capability: circle.capability };
    mark.quaternion.copy(new Quaternion().setFromUnitVectors(FACE, normal));
    mark.position.copy(onSurface(circle)).addScaledVector(normal, CIRCLE_LIFT);
    mark.scale.setScalar(circle.radius);
    mark.renderOrder = 3;
    group.add(mark);
  }
  return group;
}

/** Where each circle lies once its island is set on the globe (`plate`: the island's place and turn there), keyed as the knowledge core keys a file: its package and its path in the package (ADR-0804 D5). */
export function circleStops(marks: Group, pkg: string, plate: { position: Vector3; quaternion: Quaternion }): Map<string, { x: number; y: number; z: number }> {
  const stops = new Map<string, { x: number; y: number; z: number }>();
  for (const mark of marks.children) {
    if (typeof mark.userData.file !== "string") continue;
    const { x, y, z } = mark.position.clone().applyQuaternion(plate.quaternion).add(plate.position);
    stops.set(codePathKey(pkg, mark.userData.file), { x, y, z });
  }
  return stops;
}

/** A lit circle's fill: the session's colour over the pale circle, full while the read is in the window, lighter and fainter once compacted out (as a note's dot is, ADR-0756). */
const LIT_OPACITY = { "in-window": 0.9, faded: 0.6 } as const;
const RING_INNER = 1.18;
const RING_OUTER = 1.42;

/** Marks what lighting adds, so the session emphasis that dims an island leaves them at full strength: the traversal reads on every island. */
const traversalMark = (mark: Mesh, name: string): Mesh => {
  mark.name = name;
  mark.raycast = () => {};
  mark.userData = { traversal: true };
  return mark;
};

/**
 * Lights the circles the selected session opened (ADR-0804 D5), `lit` keyed as `circleStops` keys them, in the
 * session's `colour`: a fill over the circle, and for a read in the window the in-view ring around it; a
 * compacted read is lighter with no ring. What lighting adds is laid over the circle, never swapped into it,
 * so calling it again with less lit lets the rest go and the circle itself is as it was.
 */
export function lightFileCircles(marks: Group, lit: ReadonlyMap<string, CodeState>, colour: string, pkg: string): void {
  for (const mark of marks.children) {
    const path = mark.userData.file;
    if (typeof path !== "string" || !(mark instanceof Mesh)) continue;
    for (const added of [`file-lit:${path}`, `file-ring:${path}`]) {
      const old = mark.getObjectByName(added) as Mesh | undefined;
      if (old === undefined) continue;
      old.removeFromParent();
      (old.material as MeshBasicMaterial).dispose();
      if (old.geometry !== mark.geometry) old.geometry.dispose();
    }
    const state = lit.get(codePathKey(pkg, path));
    if (state === undefined) {
      delete mark.userData.window;
      continue;
    }
    mark.userData.window = state;
    const wear = new Color(colour);
    if (state === "faded") wear.lerp(new Color("#ffffff"), 0.55);
    // Children of the circle, so they lie as flat as it does and grow with it.
    const fill = traversalMark(new Mesh(mark.geometry, new MeshBasicMaterial({ color: wear, transparent: true, opacity: LIT_OPACITY[state], side: DoubleSide, forceSinglePass: true, depthWrite: false })), `file-lit:${path}`);
    fill.renderOrder = 4;
    mark.add(fill);
    if (state === "in-window") {
      const ring = traversalMark(new Mesh(new RingGeometry(RING_INNER, RING_OUTER, 40), new MeshBasicMaterial({ color: IN_VIEW, transparent: true, opacity: 0.95, side: DoubleSide, forceSinglePass: true, depthWrite: false })), `file-ring:${path}`);
      ring.renderOrder = 5;
      mark.add(ring);
    }
  }
}
