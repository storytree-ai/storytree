/**
 * Capability 3 · Story node render: each code file's flat circle as drawn (ADR-0804 D3, 3.16). A circle
 * is a disc lying on the island's surface, face turned to the surface's normal, so it never stands up
 * and hides a neighbour; it is named `file:<path>` and carries the file, its lines and its capability,
 * which is what pointing at it names (3.17). Plain three.js, so the marks are read without a browser.
 */
import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";

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
  const material = new MeshBasicMaterial({ color: CIRCLE_COLOUR, transparent: true, opacity: CIRCLE_OPACITY, side: DoubleSide, depthWrite: false });
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
