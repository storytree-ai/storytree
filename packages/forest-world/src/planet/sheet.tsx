// Capability 4 · The planet
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { AmbientLight, BackSide, BufferGeometry, DirectionalLight, Float32BufferAttribute, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, Vector3, type Camera, type Light, type Object3D, type PerspectiveCamera } from 'three';
import { PLATE_CLEARANCE, type PlanetSpot } from './planet.js';
import { applyPlanetSideOffset } from './camera.js';

export const SHEET_RADIUS = 200_000;

export const SHEET_TILT = 40 * Math.PI / 180;

export const SHEET_GLASS_BELOW = 1.2;

export const SHEET_GLASS_THICKNESS = 4;

export const SHEET_FOV = 35;

export const SHEET_LAND_THICKNESS = 3;

export const SHEET_LAND_LIFT = SHEET_LAND_THICKNESS - SHEET_GLASS_BELOW;

export interface SheetPoint { readonly x: number; readonly y: number }

export interface SheetExtent { readonly width: number; readonly height: number }

export function sheetSpot({ x, y }: SheetPoint): PlanetSpot {
  const v = new Vector3(x, y, SHEET_RADIUS).normalize();
  return { x: v.x, y: v.y, z: v.z };
}

export function sheetPoint(spot: PlanetSpot): SheetPoint {
  return { x: spot.x * SHEET_RADIUS / spot.z, y: spot.y * SHEET_RADIUS / spot.z };
}

function sag(x: number, y: number): number {
  return Math.sqrt(SHEET_RADIUS * SHEET_RADIUS - x * x - y * y) - SHEET_RADIUS;
}

function focal(size: { height: number }): number {
  return Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
}

function eyeDistance(camera: Camera): number {
  return camera.position.length() - SHEET_RADIUS - PLATE_CLEARANCE;
}

export function sheetEyeZoom(camera: Camera, size: { height: number }): number {
  return focal(size) / Math.max(eyeDistance(camera), Number.EPSILON);
}

export function applySheetEye(camera: PerspectiveCamera, reach: number, zoom: number, size: { height: number }): void {
  camera.zoom = 1;
  camera.position.setLength(SHEET_RADIUS + PLATE_CLEARANCE + focal(size) / Math.max(zoom, Number.EPSILON));
  sheetDepthRange(camera, reach);
}

export function sheetKeptOnResize(camera: PerspectiveCamera, reach: number, from: { width: number; height: number; left: number }, to: { width: number; height: number; left: number }): void {
  const zoom = sheetEyeZoom(camera, from), offset = camera.view?.enabled ? -camera.view.offsetX : 0;
  const grown = (to.width - from.width) / 2;
  applySheetEye(camera, reach, zoom, to);
  applyPlanetSideOffset(camera, to, offset + (to.left !== from.left ? grown : -grown));
}

export function sheetDepthRange(camera: PerspectiveCamera, reach: number): void {
  const distance = eyeDistance(camera);
  camera.near = Math.max(distance / 50, distance - reach);
  camera.far = distance + reach;
  camera.updateProjectionMatrix();
}

export function seenFromBelow(sheet: Object3D, camera: Camera): boolean {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.dot(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion)) < 0;
}

const ownOrders = new WeakMap<Object3D, number>();

function drawOrderAfter(group: Object3D, offset: number): void {
  group.traverse(object => {
    if (object === group) return;
    if (!ownOrders.has(object)) ownOrders.set(object, object.renderOrder);
    object.renderOrder = ownOrders.get(object)! + offset;
  });
}

function drawOrderBySide(group: Object3D, camera: Camera, above: number, below: number): void {
  drawOrderAfter(group, seenFromBelow(group, camera) ? below : above);
}

export function tiltFromEye(sheet: Object3D, camera: Camera): number {
  const up = new Vector3(0, 0, 1).applyQuaternion(sheet.getWorldQuaternion(new Quaternion()));
  return up.angleTo(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion));
}

export const UNDER_SHOWS_FROM = 60 * Math.PI / 180;

export function hangUnderTheGlass(group: Object3D, camera: Camera, clear = false): void {
  const tilt = tiltFromEye(group, camera);
  group.visible = clear || tilt >= UNDER_SHOWS_FROM;
  if (group.visible) drawOrderAfter(group, tilt > Math.PI / 2 ? 21 : -30);
}

export function UnderTheGlass({ children, clear = false }: { children: ReactNode; clear?: boolean }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => { if (group.current !== null) hangUnderTheGlass(group.current, camera, clear); });
  return <group ref={group} name="sheet:under">{children}</group>;
}

const GLASS_EDGE_COLOUR = '#7fa6bb';

const SMOKED = { 'sheet:pane': 0.72, 'sheet:pane-under': 0.35, 'sheet:edge': 0.8 } as const;
const CLEAR = { 'sheet:pane': 0.05, 'sheet:pane-under': 0.03, 'sheet:edge': 0.25 } as const;

export function clearGlass(glass: Object3D, clear: boolean): void {
  const opacity = clear ? CLEAR : SMOKED;
  for (const name of Object.keys(opacity) as (keyof typeof opacity)[]) {
    const part = glass.getObjectByName(name) as Mesh<BufferGeometry, MeshBasicMaterial[]> | undefined;
    for (const face of part?.material ?? []) face.opacity = opacity[name];
  }
}

function twoFaced<M extends MeshBasicMaterial | MeshLambertMaterial>(geometry: BufferGeometry, face: (side: typeof BackSide | typeof FrontSide) => M): Mesh<BufferGeometry, M[]> {
  const whole = geometry.index?.count ?? geometry.getAttribute('position').count;
  geometry.addGroup(0, whole, 0);
  geometry.addGroup(0, whole, 1);
  return new Mesh(geometry, [face(BackSide), face(FrontSide)]);
}

export function sheetGlass(extent: SheetExtent): Group {
  const group = new Group();
  group.name = 'sheet:glass';
  group.position.set(0, 0, SHEET_RADIUS + PLATE_CLEARANCE);
  const top = -SHEET_GLASS_BELOW, bottom = top - SHEET_GLASS_THICKNESS;
  const pane = (name: string, z: number) => {
    const plane = new PlaneGeometry(extent.width, extent.height, 48, 32), position = plane.getAttribute('position');
    for (let i = 0; i < position.count; i++) position.setZ(i, sag(position.getX(i), position.getY(i)) + z);
    const mesh = twoFaced(plane, side => new MeshBasicMaterial({ color: '#1a2832', transparent: true, opacity: SMOKED[name as keyof typeof SMOKED], depthWrite: false, side }));
    mesh.name = name;
    mesh.raycast = () => {};
    return mesh;
  };
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

export function sheetLights(): Light[] {
  const lamp = new DirectionalLight('#ffffff', 1.6);
  lamp.position.set(-0.45, 0.8, 0.6);
  lamp.name = 'sheet:lamp';
  const soft = new AmbientLight('#ffffff', 0.9);
  soft.name = 'sheet:soft-light';
  return [soft, lamp];
}

export function SheetLights() {
  const lights = useMemo(sheetLights, []);
  return <>{lights.map(light => <primitive key={light.name} object={light} />)}</>;
}

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
