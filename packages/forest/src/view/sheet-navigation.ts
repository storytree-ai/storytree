// Capability 3 · Story node render
import { Euler, Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { NAMEPLATE_ROOM, SEA_GAP, sheetPlaces, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoast, islandCoastReach } from "@storytree/forest-world/geometry";
import { islandLayout, type LinkDock } from "../territories/link-layout.js";
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS, SHEET_TILT, sheetPoint, sheetSpot, storeLayout, type SheetExtent, type SheetPoint, type StoreLayout } from "@storytree/forest-world/planet";
import { isDrawn, type GlobePose } from "./globe-guide.js";
import { STORY_PLATE_WIDTH } from "./nameplates.js";
import type { ForestMode } from "./planet-navigation.js";

const MARGIN = 24;
const CLEAR_TOP = 85;
const CLEAR_BOTTOM = 45;

const BARE_FLOOR = 180;

export const SHEET_OPENING_TILT = 0;

export function opensBare(mode: ForestMode): boolean {
  return mode === "library";
}

export function sheetLayout(scene: ForestScene, places: ReadonlyMap<string, number>, frame?: ForestScene, laid?: ReadonlyMap<string, readonly LinkDock[]>) {
  const placed = sheetPlaces((frame ?? scene).islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  const land = (frame ?? scene).islands.length === 0 ? { west: -BARE_FLOOR / 2, east: BARE_FLOOR / 2, south: -BARE_FLOOR / 2, north: BARE_FLOOR / 2 } : placed.bounds;
  const stood = storeColumn((frame ?? scene).stores ?? [], land);
  const { west, east, south, north } = stood.bounds;
  const centre = { x: (west + east) / 2, y: (south + north) / 2 };
  const extent: SheetExtent = { width: east - west + 2 * MARGIN, height: north - south + 2 * MARGIN };
  const at = new Map([...placed.at].map(([story, p]) => [story, { x: p.x - centre.x, y: p.y - centre.y }]));
  const islands: FacingIsland[] = scene.islands.map(island => ({ story: island.story, trees: island.trees, spot: sheetSpot(at.get(island.story)!) }));
  const shelves = new Map<string, SheetPoint>(), stories = new Map<string, string>();
  for (const island of scene.islands) {
    const middle = at.get(island.story)!;
    shelves.set(island.story, middle);
    stories.set(island.story, island.story);
    for (const tree of island.trees) if (tree.capability !== undefined) { stories.set(tree.capability, island.story); shelves.set(tree.capability, middle); }
    if (island.land === undefined) continue;
    const map = islandLayout(island.story, island.land.territories, islandCoast(island), scene.links ?? [], laid?.get(island.story));
    map.territories.forEach((territory, index) => {
      if (territory.capability === undefined) return;
      const cells = map.cells.filter(cell => cell.territory === index);
      if (cells.length === 0) return;
      const x = cells.reduce((sum, cell) => sum + cell.site.x, 0) / cells.length, z = cells.reduce((sum, cell) => sum + cell.site.z, 0) / cells.length;
      shelves.set(territory.capability, { x: middle.x + x, y: middle.y - z });
    });
  }
  const under = {
    shelfAt: (node: string) => shelves.get(node),
    storyOf: (node: string) => stories.get(node),
    floor: { x: west - centre.x, y: south - centre.y, width: east - west, height: north - south },
    depthStep: DEPTH_STEP,
    place: ({ x, y, z }: { x: number; y: number; z: number }) => {
      const spot = sheetSpot({ x, y }), out = SHEET_RADIUS + PLATE_CLEARANCE + z;
      return { x: spot.x * out, y: spot.y * out, z: spot.z * out };
    },
  };
  const stores = stood.stores.map((store) => {
    const at = { x: store.at.x - centre.x, y: store.at.y - centre.y };
    return { ...store, at, spot: sheetSpot(at) };
  });
  return { scene, islands, spots: new Map(islands.map(island => [island.story, island.spot])), radius: SHEET_RADIUS, extent, under, stores };
}

function storeColumn(stores: readonly { address: string; medium: string; tables: readonly string[] }[], land: { west: number; east: number; south: number; north: number }) {
  const laid = stores.map((store) => ({ address: store.address, medium: store.medium, ...storeLayout(store.tables) }));
  if (laid.length === 0) return { stores: [] as (StoreLayout & { address: string; medium: string; at: SheetPoint })[], bounds: land };
  const widest = Math.max(...laid.map(({ width }) => width));
  const x = land.west - SEA_GAP - NAMEPLATE_ROOM - widest / 2;
  const tall = laid.reduce((sum, { depth }) => sum + depth, 0) + (laid.length - 1) * SEA_GAP;
  let top = Math.min(land.north, (land.north + land.south) / 2 + tall / 2);
  const placed = laid.map((store) => {
    const at = { x, y: top - store.depth / 2 };
    top -= store.depth + SEA_GAP;
    return { ...store, at };
  });
  return { stores: placed, bounds: { west: x - widest / 2, east: land.east, south: Math.min(land.south, top + SEA_GAP), north: Math.max(land.north, placed[0]!.at.y + placed[0]!.depth / 2) } };
}

export function withDocks<Docks>(seen: ReadonlyMap<string, Docks>, story: string, docks: Docks | undefined): ReadonlyMap<string, Docks> {
  if (seen.get(story) === docks) return seen;
  const next = new Map(seen);
  if (docks === undefined) next.delete(story); else next.set(story, docks);
  return next;
}

const DEPTH_STEP = 20;

export function seesUnderside(tilt: number): boolean {
  return tilt > Math.PI / 2;
}

export const TILT_PER_PIXEL = Math.PI / 600;
export const TILT_STEP = 15 * Math.PI / 180;

export function sheetTiltBy(tilt: number, by: number): number {
  return Math.min(Math.PI, Math.max(0, tilt + by));
}

function foreshortened(tilt: number): number {
  const c = Math.cos(tilt);
  return Math.sign(c || 1) * Math.max(Math.abs(c), 0.25);
}

function focal(size: { height: number }): number {
  return Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
}

export function sheetOpening(extent: SheetExtent, size: { width: number; height: number }, framing?: number): GlobePose {
  const f = focal(size), n = extent.height / 2;
  const sin = Math.sin(SHEET_OPENING_TILT), cos = Math.cos(SHEET_OPENING_TILT);
  const framed = (scale: number) => {
    const above = scale * Math.max(size.height / 2 - CLEAR_TOP, 0.5), below = scale * Math.max(size.height / 2 - CLEAR_BOTTOM, 0.5);
    const ratio = above * (f * cos + below * sin) / (below * (f * cos - above * sin));
    const far = 2 * n * ratio / (1 + ratio), near = 2 * n / (1 + ratio);
    const zoom = framing === undefined ? f / (far * (f * cos - above * sin) / above) : Math.min(size.width, size.height) / (2 * framing * SHEET_RADIUS);
    const closest = f / zoom - near * sin;
    return { zoom, y: n - far, closest, fits: extent.width * f / closest <= size.width };
  };
  let view = framed(1);
  if (framing === undefined && !view.fits) {
    let low = 0, high = 1;
    for (let step = 0; step < 48; step++) {
      const mid = (low + high) / 2;
      if (framed(mid).fits) low = mid; else high = mid;
    }
    const whole = framed(low);
    if (whole.fits && whole.zoom >= OPENING_FLOOR) view = whole;
  }
  const { zoom, y, closest } = view, x = view.fits ? 0 : -extent.width / 2 + size.width * closest / (2 * f);
  return { turn: turnToIsland(sheetSpot({ x, y })), framing: framing ?? Math.min(size.width, size.height) / (2 * zoom * SHEET_RADIUS), sideOffset: 0 };
}

const OPENING_FLOOR = STORY_PLATE_WIDTH / (SEA_GAP + NAMEPLATE_ROOM);

export function sheetCentre(turn: GlobeTurn): SheetPoint {
  const toSheet = new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)).invert();
  const facing = new Vector3(0, 0, 1).applyQuaternion(toSheet);
  return sheetPoint(facing);
}

export function sheetPan(turn: GlobeTurn, drag: { x: number; y: number }, zoom: number, extent: SheetExtent, tilt = SHEET_TILT, heading = 0): GlobeTurn {
  const centre = sheetCentre(turn);
  const flat = { x: drag.x / zoom, y: -drag.y / (zoom * foreshortened(tilt)) };
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const x = centre.x - (flat.x * cos + flat.y * sin), y = centre.y - (-flat.x * sin + flat.y * cos);
  const clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(x, extent.width / 2), y: clamp(y, extent.height / 2) }));
}

export function sheetUnder(camera: Camera, globe: Object3D, turn: GlobeTurn, at: { x: number; y: number }, size: { width: number; height: number }, extent: SheetExtent): SheetPoint | undefined {
  camera.updateMatrixWorld();
  globe.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * at.x / Math.max(size.width, 1) - 1, 1 - 2 * at.y / Math.max(size.height, 1)), camera);
  const spot = sheetSpot(sheetCentre(turn)), local = new Vector3(spot.x, spot.y, spot.z).multiplyScalar(SHEET_RADIUS + PLATE_CLEARANCE);
  const point = local.clone().applyMatrix4(globe.matrixWorld), normal = local.clone().normalize().transformDirection(globe.matrixWorld);
  const hit = Math.abs(normal.dot(ray.ray.direction)) < 1e-3 ? null : ray.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point), new Vector3());
  if (hit === null || hit.distanceTo(ray.ray.origin) < 1) return undefined;
  const found = sheetPoint(globe.worldToLocal(hit).normalize()), centre = sheetCentre(turn);
  return Math.hypot(found.x - centre.x, found.y - centre.y) > Math.hypot(extent.width, extent.height) ? undefined : found;
}

export function sheetPanUnder(turn: GlobeTurn, grabbed: SheetPoint, now: SheetPoint, extent: SheetExtent): GlobeTurn {
  const centre = sheetCentre(turn), clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(centre.x + grabbed.x - now.x, extent.width / 2), y: clamp(centre.y + grabbed.y - now.y, extent.height / 2) }));
}

export type SheetKey = { kind: "pan"; key: string } | { kind: "spin"; by: -1 | 1 } | { kind: "tilt"; by: -1 | 1 } | { kind: "home" };

const PAN_KEYS = new Map<string, { x: number; y: number }>([
  ["w", { x: 0, y: 1 }], ["arrowup", { x: 0, y: 1 }], ["s", { x: 0, y: -1 }], ["arrowdown", { x: 0, y: -1 }],
  ["a", { x: 1, y: 0 }], ["arrowleft", { x: 1, y: 0 }], ["d", { x: -1, y: 0 }], ["arrowright", { x: -1, y: 0 }],
]);

const KEY_PAN_SPEED = 600;

export function sheetKey(event: { type: string; key?: string; target?: unknown; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): SheetKey | undefined {
  if (event.type !== "keydown" || event.key === undefined || event.ctrlKey === true || event.metaKey === true || event.altKey === true) return undefined;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (target?.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return undefined;
  const key = event.key.toLowerCase();
  if (PAN_KEYS.has(key)) return { kind: "pan", key };
  if (key === "q" || key === "e") return { kind: "spin", by: key === "q" ? -1 : 1 };
  if (key === "r" || key === "f") return { kind: "tilt", by: key === "r" ? -1 : 1 };
  if (key === "home") return { kind: "home" };
  return undefined;
}

export function sheetKeyPan(held: ReadonlySet<string>, seconds: number): { x: number; y: number } {
  let x = 0, y = 0;
  for (const key of held) { const way = PAN_KEYS.get(key); if (way !== undefined) { x += way.x; y += way.y; } }
  return { x: x * KEY_PAN_SPEED * seconds, y: y * KEY_PAN_SPEED * seconds };
}

export { sheetDrag } from "./sheet-drag.js";

export const SPIN_PER_PIXEL = Math.PI / 600;

export function sheetSpinTilt(heading: number, tilt: number, drag: { x: number; y: number }): { heading: number; tilt: number } {
  return { heading: heading + drag.x * SPIN_PER_PIXEL, tilt: sheetTiltBy(tilt, -drag.y * TILT_PER_PIXEL) };
}

export function sheetSpin(heading: number, clockwise: number, under = false): number {
  return under ? heading + clockwise : heading - clockwise;
}

export function sheetTwist(from: readonly [{ x: number; y: number }, { x: number; y: number }], to: readonly [{ x: number; y: number }, { x: number; y: number }]): number {
  const angle = (pair: typeof from) => Math.atan2(pair[1].y - pair[0].y, pair[1].x - pair[0].x);
  const turned = angle(to) - angle(from);
  return Math.atan2(Math.sin(turned), Math.cos(turned));
}

export function headingHome(heading: number): number {
  return 2 * Math.PI * Math.round(heading / (2 * Math.PI));
}

export function sheetHome(heading: number): { heading: number; tilt: number } {
  return { heading: headingHome(heading), tilt: SHEET_OPENING_TILT };
}

export function libraryTilt(tilt: number): number {
  return tilt === SHEET_OPENING_TILT ? SHEET_TILT : tilt;
}

export function compassNorth(heading: number, under = false): number {
  return under ? -Math.PI / 2 - heading : Math.PI / 2 + heading;
}

export function sheetMarkers(islands: readonly FacingIsland[], drawn: (island: FacingIsland) => { left: number; top: number }, size: { width: number; height: number },
  mode: ForestMode = "forest"): { story: string; left: number; top: number; turn: GlobeTurn }[] {
  if (mode === "library") return [];
  return islands.filter(island => island.trees.some(tree => tree.status === "unhealthy")).flatMap(island => {
    const { left, top } = drawn(island);
    if (left >= 0 && left <= size.width && top >= 0 && top <= size.height) return [];
    return [{ story: island.story, left, top, turn: turnToIsland(island.spot) }];
  });
}

export function sheetPointerMarkers(world: Object3D, islands: readonly FacingIsland[], drawn: (at: Vector3) => { left: number; top: number },
  size: { width: number; height: number }, mode: ForestMode = "forest"): { pointer: string; story: string; colour: string; left: number; top: number; turn: GlobeTurn }[] {
  if (mode === "library") return [];
  const found: { pointer: string; story: string; colour: string; left: number; top: number; turn: GlobeTurn }[] = [];
  world.traverse((object) => {
    if (!object.name.startsWith("territory-pointer:")) return;
    const mark = object.getObjectByName("pointer-mark");
    if (mark === undefined || !isDrawn(mark)) return;
    let story: string | undefined;
    for (let at: Object3D | null = object; at !== null && story === undefined; at = at.parent) if (at.name.startsWith("planet:")) story = at.name.slice("planet:".length);
    const island = islands.find((one) => one.story === story);
    if (island === undefined) return;
    const { left, top } = drawn(mark.getWorldPosition(new Vector3()));
    if (left >= 0 && left <= size.width && top >= 0 && top <= size.height) return;
    found.push({ pointer: object.name.slice("territory-pointer:".length), story: island.story, colour: String(object.userData.colour), left, top, turn: turnToIsland(island.spot) });
  });
  return found;
}

export function sheetTilted(rotation: Quaternion, eye: Quaternion, tilt: number, heading = 0): { quaternion: Quaternion; position: Vector3 } {
  const upright = new Vector3(0, 0, 1).applyQuaternion(eye);
  const pivot = upright.clone().multiplyScalar(SHEET_RADIUS + PLATE_CLEARANCE);
  const spin = new Quaternion().setFromAxisAngle(upright, heading);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(eye), -tilt);
  return { quaternion: turn.clone().multiply(spin).multiply(rotation), position: pivot.clone().sub(pivot.clone().applyQuaternion(turn)) };
}
