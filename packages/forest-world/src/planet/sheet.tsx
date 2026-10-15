/** Capability 6 · The planet. The world as a flat sheet of glass, not a globe (ADR-1043 D1).
 *
 * The sheet is drawn as the near pole of a sphere so large that it is flat to the eye: every island keeps its plate, coast,
 * territories and nameplate, and the roads are routed and raised exactly as on the globe, by the same code. The sphere's
 * radius is SHEET_RADIUS; a sheet 3000 units wide then sags 5.6 units at its corners and turns an edge island from an eye over
 * its middle by under half a degree. Turning the big sphere by a hair moves the sheet under the eye, so the globe's turn is the
 * sheet's pan. */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Camera, type Object3D, type OrthographicCamera } from 'three';
import { PLATE_CLEARANCE, type PlanetSpot } from './planet.js';

/** The radius of the sphere whose near pole is the sheet, in ground units. */
export const SHEET_RADIUS = 200_000;

/** A place on the sheet, in ground units from its middle (the pole): x east, y north. */
export interface SheetPoint { readonly x: number; readonly y: number }

/** The sheet's glass, centred on the pole, in ground units. */
export interface SheetExtent { readonly width: number; readonly height: number }

/** Where a place on the sheet sits on the big sphere, as the direction the globe's plates are placed by. */
export function sheetSpot({ x, y }: SheetPoint): PlanetSpot {
  const v = new Vector3(x, y, SHEET_RADIUS).normalize();
  return { x: v.x, y: v.y, z: v.z };
}

/** The place on the sheet a direction from the big sphere's centre points at: `sheetSpot` read back. */
export function sheetPoint(spot: PlanetSpot): SheetPoint {
  return { x: spot.x * SHEET_RADIUS / spot.z, y: spot.y * SHEET_RADIUS / spot.z };
}

/** How far below the pole's flat plane the big sphere lies at (x, y): its sag. */
function sag(x: number, y: number): number {
  return Math.sqrt(SHEET_RADIUS * SHEET_RADIUS - x * x - y * y) - SHEET_RADIUS;
}

/**
 * The eye for a sheet `reach` units across (its diagonal), after the framing has set its zoom: it stands `4 * reach` from
 * the pole along its own line of sight, with its near and far planes `2 * reach` either side of the sheet, so the depth
 * buffer spans the sheet and not the whole sphere, and marks lifted a twentieth of a unit off the land never fight it.
 */
export function applySheetEye(camera: OrthographicCamera, reach: number): void {
  camera.position.setLength(SHEET_RADIUS + PLATE_CLEARANCE + 4 * reach);
  camera.near = 2 * reach;
  camera.far = 6 * reach;
  camera.updateProjectionMatrix();
}

/**
 * Whether the eye looks at the sheet's underside: the top face's normal at the pole, turned with `sheet`, points away from it.
 * The islands' marks draw in orders 0 to 8, so the glass draws before them from above and after them from below (20), and
 * what hangs under the glass draws before it from above and after it from below (`UnderTheGlass`): whichever lies beyond
 * the glass is seen through it, faintly.
 */
export function seenFromBelow(sheet: Object3D, camera: Camera): boolean {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) < 0;
}

/** Each object's own draw order, before the side the eye is on moved it (kept apart from userData, which a host may replace). */
const ownOrders = new WeakMap<Object3D, number>();

/** Sets each object's draw order under `group` for the side the eye is on, keeping their own orders' sequence. */
function drawOrderBySide(group: Object3D | null, camera: Camera, above: number, below: number): void {
  if (group === null) return;
  const offset = seenFromBelow(group, camera) ? below : above;
  group.traverse(object => {
    if (object === group) return;
    if (!ownOrders.has(object)) ownOrders.set(object, object.renderOrder);
    object.renderOrder = ownOrders.get(object)! + offset;
  });
}

/** What hangs beneath the glass (the knowledge graph, ADR-1043 D5): drawn under the glass from above, over it from below. */
export function UnderTheGlass({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => drawOrderBySide(group.current, camera, -30, 21));
  return <group ref={group} name="sheet:under">{children}</group>;
}

/** The glass under the islands: a pane bent to the big sphere's sag, faint, with a bright rim, at the pole. */
export function SheetGlass({ extent }: { extent: SheetExtent }) {
  const glass = useMemo(() => {
    const group = new Group();
    group.name = 'sheet:glass';
    group.position.set(0, 0, SHEET_RADIUS + PLATE_CLEARANCE);
    const plane = new PlaneGeometry(extent.width, extent.height, 48, 32);
    const position = plane.getAttribute('position');
    // The pane lies just under the islands' plates, following the sphere they stand on.
    for (let i = 0; i < position.count; i++) position.setZ(i, sag(position.getX(i), position.getY(i)) - 1.2);
    // Smoked glass over the page.
    const pane = new Mesh(plane, new MeshBasicMaterial({ color: '#1a2832', transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide }));
    pane.name = 'sheet:pane';
    pane.raycast = () => {};
    // The rim, bent with the pane: each side sampled every 20 units.
    const w = extent.width / 2, h = extent.height / 2, loop: Vector3[] = [];
    const corners = [[-w, -h], [w, -h], [w, h], [-w, h]] as const;
    corners.forEach(([x0, y0], i) => {
      const [x1, y1] = corners[(i + 1) % 4]!, steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 20));
      for (let s = 0; s < steps; s++) {
        const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
        loop.push(new Vector3(x, y, sag(x, y) - 1.2));
      }
    });
    const rim = new LineSegments(new BufferGeometry().setFromPoints(loop.flatMap((p, i) => [p, loop[(i + 1) % loop.length]!])),
      new LineBasicMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.55 }));
    rim.name = 'sheet:rim';
    rim.raycast = () => {};
    group.add(pane, rim);
    return group;
  }, [extent.width, extent.height]);
  useEffect(() => () => glass.traverse(object => {
    const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }), [glass]);
  useFrame(({ camera }) => drawOrderBySide(glass, camera, -1, 20));
  return <primitive object={glass} />;
}
