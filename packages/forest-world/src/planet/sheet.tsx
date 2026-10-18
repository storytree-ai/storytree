/** Capability 4 · The planet. The world as a flat sheet of glass, not a globe (ADR-1043 D1).
 *
 * The sheet is drawn as the near pole of a sphere so large that it is flat to the eye: every island keeps its plate, coast,
 * territories and nameplate, and the roads are routed and raised exactly as on the globe, by the same code. The sphere's
 * radius is SHEET_RADIUS; a sheet 3000 units wide then sags 5.6 units at its corners and turns an edge island from an eye over
 * its middle by under half a degree. Turning the big sphere by a hair moves the sheet under the eye, so the globe's turn is the
 * sheet's pan. It is a floating slab of glass in a lit, perspective scene (ADR-1062 D1): the eye is a perspective one whose
 * distance from the middle of the view is the zoom, and a lamp shades the islands' sides and the glass's edge. */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { AmbientLight, BackSide, BufferGeometry, DirectionalLight, Float32BufferAttribute, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, Vector3, type Camera, type Light, type Object3D, type PerspectiveCamera } from 'three';
import { PLATE_CLEARANCE, type PlanetSpot } from './planet.js';

/** The radius of the sphere whose near pole is the sheet, in ground units. */
export const SHEET_RADIUS = 200_000;

/**
 * The eye's resting tabletop tilt (ADR-1059 D1, ADR-1062 D3), in radians: how far the sheet is tipped from facing the eye
 * square-on, its north edge away. Steep enough to show the islands' sides, the glass's edge and the graph's depth, shallow
 * enough that names stay legible. The user tilts it anywhere from straight down on the top face (0) to straight up at the
 * underside (π), and Home and the Stories button rest it here; the Library button rests it at the mirror tilt, π less this.
 */
export const SHEET_TILT = 40 * Math.PI / 180;

/** How far under the islands' resting plates the glass lies, in ground units: the roads ride just above it. */
export const SHEET_GLASS_BELOW = 1.2;

/** How thick the glass is, in ground units: its underside lies this far below its top face, and its edge shows between them. */
export const SHEET_GLASS_THICKNESS = 4;

/** The eye's field of view from the window's top to its bottom, in degrees: a moderate lens, so the slab reads as an object
 * near the eye without the near edge swelling. */
export const SHEET_FOV = 35;

/** Every island's thickness on the sheet (ADR-1059 D2), from its land down to the glass, in ground units: one for all, so
 * an island's height stays free to carry a signal later. */
export const SHEET_LAND_THICKNESS = 9;

/** How far above its resting place an island's plate is raised on the sheet, for its land to stand that thick on the glass. */
export const SHEET_LAND_LIFT = SHEET_LAND_THICKNESS - SHEET_GLASS_BELOW;

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

/** The eye's focal length in CSS pixels for a canvas `size`: how many pixels a unit spans at a unit's distance. */
function focal(size: { height: number }): number {
  return Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
}

/** How far the perspective eye stands from the middle of the view on the glass, which lies on its line of sight. */
function eyeDistance(camera: Camera): number {
  return camera.position.length() - SHEET_RADIUS - PLATE_CLEARANCE;
}

/** The zoom the eye shows on a canvas `size`: CSS pixels per ground unit at the middle of the view, where its distance sets it. */
export function sheetEyeZoom(camera: Camera, size: { height: number }): number {
  return focal(size) / Math.max(eyeDistance(camera), Number.EPSILON);
}

/**
 * Stands the perspective eye on its line of sight as far from the middle of the view as `zoom` (CSS pixels per ground unit
 * there) asks on a canvas `size`: a zoom moves the eye, never the lens. Its depth range then spans the sheet, `reach` units
 * across (its diagonal), whichever way it is tilted (`sheetDepthRange`).
 */
export function applySheetEye(camera: PerspectiveCamera, reach: number, zoom: number, size: { height: number }): void {
  camera.zoom = 1;
  camera.position.setLength(SHEET_RADIUS + PLATE_CLEARANCE + focal(size) / Math.max(zoom, Number.EPSILON));
  sheetDepthRange(camera, reach);
}

/**
 * Sets the eye's near and far planes round the sheet from where it stands now, so the depth buffer spans the sheet and not
 * the whole sphere: the far plane past the sheet's farthest corner, the near one short of its nearest (or a fiftieth of the
 * way to the middle of the view, when the eye is close enough that the sheet reaches past it).
 */
export function sheetDepthRange(camera: PerspectiveCamera, reach: number): void {
  const distance = eyeDistance(camera);
  camera.near = Math.max(distance / 50, distance - reach);
  camera.far = distance + reach;
  camera.updateProjectionMatrix();
}

/**
 * Whether the eye looks at the sheet's underside: the top face's normal at the pole, turned with `sheet`, points away from it.
 * The islands' marks draw in orders 0 to 8, so the glass draws before them from above and after them from below (20), and
 * the islands are seen through it, faintly; what hangs under the glass is drawn only from below, after it (`UnderTheGlass`).
 */
export function seenFromBelow(sheet: Object3D, camera: Camera): boolean {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) < 0;
}

/** Each object's own draw order, before the side the eye is on moved it (kept apart from userData, which a host may replace). */
const ownOrders = new WeakMap<Object3D, number>();

/** Sets each object's draw order under `group` to its own order moved by `offset`, keeping their sequence. */
function drawOrderAfter(group: Object3D, offset: number): void {
  group.traverse(object => {
    if (object === group) return;
    if (!ownOrders.has(object)) ownOrders.set(object, object.renderOrder);
    object.renderOrder = ownOrders.get(object)! + offset;
  });
}

/** Sets each object's draw order under `group` for the side the eye is on, keeping their own orders' sequence. */
function drawOrderBySide(group: Object3D, camera: Camera, above: number, below: number): void {
  drawOrderAfter(group, seenFromBelow(group, camera) ? below : above);
}

/** How far the sheet is tilted from facing the eye square-on with its top face, in radians: 0 straight down on the top, π/2
 * edge-on, π straight up at the underside. */
export function tiltFromEye(sheet: Object3D, camera: Camera): number {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.angleTo(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
}

/** The tilt from which what hangs under the glass comes into view below the slab, 30 degrees short of level: steeper, the
 * smoked glass hides it all (ADR-1062 D4), so the top resting view shows no knowledge, not even faintly (ADR-1061 D1). */
export const UNDER_SHOWS_FROM = 60 * Math.PI / 180;

/**
 * What hangs beneath the glass (the knowledge graph, ADR-1043 D5) shows by the angle under smoked glass (ADR-1062 D4): hidden
 * from well above, in view from near level, drawn before the glass it hangs behind, and from below drawn over the glass it
 * hangs beyond. Under `clear` glass (the Library button, D3) it shows at every angle, from above included.
 */
export function hangUnderTheGlass(group: Object3D, camera: Camera, clear = false): void {
  const tilt = tiltFromEye(group, camera);
  group.visible = clear || tilt >= UNDER_SHOWS_FROM;
  if (group.visible) drawOrderAfter(group, tilt > Math.PI / 2 ? 21 : -30);
}

/** What hangs beneath the glass, drawn as `hangUnderTheGlass` says, so it comes into view as the sheet tilts toward level,
 * or shows at every angle under `clear` glass. */
export function UnderTheGlass({ children, clear = false }: { children: ReactNode; clear?: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => { if (group.current !== null) hangUnderTheGlass(group.current, camera, clear); });
  return <group ref={group} name="sheet:under">{children}</group>;
}

/** The colour of the glass's edge, lit by the scene's lamp (ADR-1062 D1). */
const GLASS_EDGE_COLOUR = '#7fa6bb';

/** How opaque each part of the glass is, smoked (Stories) and clear (Library, ADR-1062 D3): clear, the panes all but vanish
 * and only the rim and a faint edge say where the slab is, so what hangs beneath shows through from any angle. */
const SMOKED = { 'sheet:pane': 0.72, 'sheet:pane-under': 0.35, 'sheet:edge': 0.8 } as const;
const CLEAR = { 'sheet:pane': 0.05, 'sheet:pane-under': 0.03, 'sheet:edge': 0.25 } as const;

/** Makes `glass` (`sheetGlass`) clear or smoked again, changing only how opaque its panes and edge are. */
export function clearGlass(glass: Object3D, clear: boolean): void {
  const opacity = clear ? CLEAR : SMOKED;
  for (const name of Object.keys(opacity) as (keyof typeof opacity)[]) {
    const part = glass.getObjectByName(name) as Mesh<BufferGeometry, MeshBasicMaterial[]> | undefined;
    for (const face of part?.material ?? []) face.opacity = opacity[name];
  }
}

/** `geometry` drawn see-through on both faces, the far one blended first, as three's own two-pass double-sided draw
 * would; but each face keeps its own material and program, where that draw re-versions one material twice a frame
 * (ADR-0836 D1). */
function twoFaced<M extends MeshBasicMaterial | MeshLambertMaterial>(geometry: BufferGeometry, face: (side: typeof BackSide | typeof FrontSide) => M): Mesh<BufferGeometry, M[]> {
  const whole = geometry.index?.count ?? geometry.getAttribute('position').count;
  geometry.addGroup(0, whole, 0);
  geometry.addGroup(0, whole, 1);
  return new Mesh(geometry, [face(BackSide), face(FrontSide)]);
}

/**
 * The glass under the islands: a smoked slab `SHEET_GLASS_THICKNESS` thick, bent to the big sphere's sag, at the pole,
 * `extent` across. Its two faces are faint panes, each with a bright rim, and its edge a lit band between them, so the
 * slab shows its thickness from any tilt.
 */
export function sheetGlass(extent: SheetExtent): Group {
  const group = new Group();
  group.name = 'sheet:glass';
  group.position.set(0, 0, SHEET_RADIUS + PLATE_CLEARANCE);
  const top = -SHEET_GLASS_BELOW, bottom = top - SHEET_GLASS_THICKNESS;
  // Smoked glass, its top face just under the islands' resting plates, following the sphere they stand on.
  const pane = (name: string, z: number) => {
    const plane = new PlaneGeometry(extent.width, extent.height, 48, 32), position = plane.getAttribute('position');
    for (let i = 0; i < position.count; i++) position.setZ(i, sag(position.getX(i), position.getY(i)) + z);
    const mesh = twoFaced(plane, side => new MeshBasicMaterial({ color: '#1a2832', transparent: true, opacity: SMOKED[name as keyof typeof SMOKED], depthWrite: false, side }));
    mesh.name = name;
    mesh.raycast = () => {};
    return mesh;
  };
  // The rim, bent with the panes: each side sampled every 20 units.
  const w = extent.width / 2, h = extent.height / 2, loop: { x: number; y: number }[] = [];
  const corners = [[-w, -h], [w, -h], [w, h], [-w, h]] as const;
  corners.forEach(([x0, y0], i) => {
    const [x1, y1] = corners[(i + 1) % 4]!, steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 20));
    for (let s = 0; s < steps; s++) loop.push({ x: x0 + (x1 - x0) * s / steps, y: y0 + (y1 - y0) * s / steps });
  });
  const rim = (name: string, z: number) => {
    const at = loop.map(({ x, y }) => new Vector3(x, y, sag(x, y) + z));
    const line = new LineSegments(new BufferGeometry().setFromPoints(at.flatMap((p, i) => [p, at[(i + 1) % at.length]!])),
      new LineBasicMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.55 }));
    line.name = name;
    line.raycast = () => {};
    return line;
  };
  // The edge: a wall round the loop from the top face down to the underside, each facing outward for the lamp to shade.
  const position: number[] = [], normal: number[] = [], indices: number[] = [];
  loop.forEach((p, i) => {
    const q = loop[(i + 1) % loop.length]!, out = new Vector3(q.y - p.y, -(q.x - p.x), 0).normalize(), at = position.length / 3;
    for (const { x, y } of [p, q]) position.push(x, y, sag(x, y) + top, x, y, sag(x, y) + bottom);
    for (let k = 0; k < 4; k++) normal.push(out.x, out.y, out.z);
    indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
  });
  const wall = new BufferGeometry();
  wall.setAttribute('position', new Float32BufferAttribute(position, 3));
  wall.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  wall.setIndex(indices);
  const edge = twoFaced(wall, side => new MeshLambertMaterial({ color: GLASS_EDGE_COLOUR, transparent: true, opacity: SMOKED['sheet:edge'], depthWrite: false, side }));
  edge.name = 'sheet:edge';
  edge.raycast = () => {};
  group.add(pane('sheet:pane-under', bottom), edge, pane('sheet:pane', top), rim('sheet:rim', top), rim('sheet:rim-under', bottom));
  return group;
}

/**
 * The sheet's lights (ADR-1062 D1): soft light all round, so nothing lit goes black, and one lamp above the eye's left
 * shoulder, fixed with the eye, so a side turned toward it brightens as the user tilts or spins the slab.
 */
export function sheetLights(): Light[] {
  const lamp = new DirectionalLight('#ffffff', 1.6);
  lamp.position.set(-0.45, 0.8, 0.6);
  lamp.name = 'sheet:lamp';
  const soft = new AmbientLight('#ffffff', 0.9);
  soft.name = 'sheet:soft-light';
  return [soft, lamp];
}

/** The sheet's lights, mounted where the eye's frame is the scene's, so the lamp stays over the eye's shoulder. */
export function SheetLights() {
  const lights = useMemo(sheetLights, []);
  return <>{lights.map(light => <primitive key={light.name} object={light} />)}</>;
}

/** The glass under the islands, drawn (`sheetGlass`), smoked or `clear`. */
export function SheetGlass({ extent, clear = false }: { extent: SheetExtent; clear?: boolean }) {
  const glass = useMemo(() => sheetGlass(extent), [extent.width, extent.height]);
  useEffect(() => clearGlass(glass, clear), [glass, clear]);
  useEffect(() => () => glass.traverse(object => {
    const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    mesh.geometry?.dispose();
    for (const material of [mesh.material ?? []].flat()) material.dispose();
  }), [glass]);
  useFrame(({ camera }) => drawOrderBySide(glass, camera, -1, 20));
  return <primitive object={glass} />;
}
