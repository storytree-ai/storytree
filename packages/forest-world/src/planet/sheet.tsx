/** Capability 6 · The planet. SPIKE (spike/glass-sheet, never merged): the world as a flat sheet of glass, not a globe.
 *
 * The sheet is drawn as the near pole of a sphere so large that it is flat to the eye: every island keeps its plate,
 * coast, territories and nameplate, and the roads are routed and raised exactly as on the globe, by the same code. The
 * sphere's radius is SHEET_RADIUS; a sheet 3000 units wide then sags 5.6 units at its corners and tilts an edge island
 * by under half a degree. The page draws the sheet when its address carries `?sheet`. */
import { useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, Group, Quaternion, Vector3, type Camera, type Object3D } from 'three';
import type { PlanetSpot } from './planet.js';

/** The radius of the sphere whose near pole is the sheet, in ground units. */
export const SHEET_RADIUS = 200_000;

/** True on a page opened with `?sheet`: the spike's one switch, so one bundle draws today's globe and the sheet. */
export const SHEET: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sheet');
/** `?sheet=columns`: the comparison variant, depth running west to east instead of south to north. */
export const SHEET_ACROSS: 'rows' | 'columns' = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sheet') === 'columns' ? 'columns' : 'rows';

/** The sheet's own frame: x east, y north, the top face toward +z (the globe's front, toward the eye at rest). */
export interface SheetPoint { readonly x: number; readonly y: number }

/** Where a point of the sheet sits on the big sphere, as a direction the globe's plates are placed by. */
export function sheetSpot({ x, y }: SheetPoint): PlanetSpot {
  const v = new Vector3(x, y, SHEET_RADIUS).normalize();
  return { x: v.x, y: v.y, z: v.z };
}

/** How far below the flat plane z = 0 the big sphere lies at (x, y): its sag, for anything drawn flat beside it. */
export function sheetSag({ x, y }: SheetPoint): number {
  return Math.sqrt(SHEET_RADIUS * SHEET_RADIUS - x * x - y * y) - SHEET_RADIUS;
}

/** The sheet's glass, centred on the frame's origin, in ground units. */
export interface SheetExtent { readonly width: number; readonly height: number }

/**
 * Whether the eye looks at the sheet's underside. Island marks draw in render orders 1 to 8, so the glass draws after the
 * graph and before the islands from above (order -1, the graph -2), and after the islands and before the graph from below
 * (20, the graph 21): whichever lies beyond the glass is seen through it, faintly.
 */
export function seenFromBelow(sheet: Object3D, camera: Camera): boolean {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) < 0;
}

/** The glass under the islands: a pane bent to the big sphere's sag, faint, with a bright edge, so it reads as glass edge-on too. */
export function SheetGlass({ extent }: { extent: SheetExtent }) {
  const glass = useMemo(() => {
    const group = new Group();
    group.name = 'sheet:glass';
    const plane = new PlaneGeometry(extent.width, extent.height, 48, 32);
    const position = plane.getAttribute('position');
    // The pane lies just under the islands' plates, following the sphere they stand on.
    for (let i = 0; i < position.count; i++) position.setZ(i, sheetSag({ x: position.getX(i), y: position.getY(i) }) - 1.2);
    plane.computeVertexNormals();
    // Smoked glass: what lies beyond it, the graph from above or the islands from below, shows faintly through it.
    const pane = new Mesh(plane, new MeshBasicMaterial({ color: '#1a2832', transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide }));
    pane.name = 'sheet:pane';
    pane.raycast = () => {};
    // The rim, bent with the pane: each side sampled every 20 units.
    const w = extent.width / 2, h = extent.height / 2, loop: Vector3[] = [];
    const corners = [[-w, -h], [w, -h], [w, h], [-w, h]] as const;
    corners.forEach(([x0, y0], i) => {
      const [x1, y1] = corners[(i + 1) % 4]!, steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 20);
      for (let s = 0; s < steps; s++) {
        const x = x0 + (x1 - x0) * s / steps, y = y0 + (y1 - y0) * s / steps;
        loop.push(new Vector3(x, y, sheetSag({ x, y }) - 1.2));
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
  useFrame(({ camera }) => {
    const order = seenFromBelow(glass, camera) ? 20 : -1;
    for (const child of glass.children) child.renderOrder = order;
  });
  return <primitive object={glass} />;
}
