/**
 * Capability 3 · Story node render. The forest on the glass sheet (ADR-1043): where its islands lie, where it opens, and
 * what moves it. The sheet is the near pole of a very large sphere (The world's `sheetSpot`), so the globe's turn, its
 * guide and its Home all carry over: a turn of the big sphere by a hair slides the sheet under the eye, flat to within
 * a degree. The user tilts it like a table (ADR-1062 D2), from looking straight down on the islands, through edge-on, to
 * looking straight up at the knowledge graph beneath, so a sheet's north-south distances are drawn shortened by the tilt's
 * cosine; Stories and Library rest it at a tilt from above or its mirror from below (D3). The user pans it (a drag, WASD or
 * the arrows), zooms it (the wheel or a pinch), spins it about its upright axis (Q and E, a right-drag's sideways part, a
 * Ctrl+drag or a twist) and tilts it (R and F, or that drag's up-and-down part), and a compass or Home faces it back
 * (ADR-1060); nothing switches what a drag does.
 */
import { Euler, Plane, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { sheetPlaces, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoast, islandCoastReach } from "@storytree/forest-world/geometry";
import { islandTerritories } from "../territories/territories.js";
import { PLATE_CLEARANCE, SHEET_FOV, SHEET_RADIUS, SHEET_TILT, sheetPoint, sheetSpot, type SheetExtent, type SheetPoint } from "@storytree/forest-world/planet";
import type { GlobePose } from "./globe-guide.js";
import type { ForestMode } from "./planet-navigation.js";

/** Glass round the land on every side, in ground units. */
const MARGIN = 24;
/** CSS pixels of the window's height kept clear at the opening: the Sessions strip docked over the bottom, as much again at the top. */
const CLEAR_HEIGHT = 170;

/** How wide and deep an island-less sheet's sea floor is, in ground units: with no land to set it, room for the user's factory's notes (3.63). */
const BARE_FLOOR = 180;

/** An island-less sheet opens at once only on its Library face, where the user's factory's notes hang (3.63); on Stories it waits for its islands. */
export function opensBare(mode: ForestMode): boolean {
  return mode === "library";
}

/**
 * The islands at their places on the sheet (`sheetPlaces`), centred on the pole, and the glass they stand on. `under` says
 * where the knowledge graph hangs: each story's shelf under its island's middle, each capability's under its territory's,
 * and the sea floor across the islands' footprint, where notes with no links lie (ADR-1063 D3).
 */
export function sheetLayout(scene: ForestScene, places: ReadonlyMap<string, number>, frame?: ForestScene) {
  // A plan still growing, framed by its full plan, keeps every island where the full plan puts it, on its glass (3.28).
  const placed = sheetPlaces((frame ?? scene).islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  // An island-less sheet (the user's factory, 3.63) has no land to set the floor, so its floor is a square round the pole.
  const { west, east, south, north } = (frame ?? scene).islands.length === 0 ? { west: -BARE_FLOOR / 2, east: BARE_FLOOR / 2, south: -BARE_FLOOR / 2, north: BARE_FLOOR / 2 } : placed.bounds;
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
    // A capability's shelf hangs under its territory's middle: on the plate x runs east and z south.
    const map = islandTerritories(island.land.territories, islandCoast(island));
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
    // A place in the sheet's own frame, drawn on the big sphere: z up from the glass.
    place: ({ x, y, z }: { x: number; y: number; z: number }) => {
      const spot = sheetSpot({ x, y }), out = SHEET_RADIUS + PLATE_CLEARANCE + z;
      return { x: spot.x * out, y: spot.y * out, z: spot.z * out };
    },
  };
  return { scene, islands, spots: new Map(islands.map(island => [island.story, island.spot])), radius: SHEET_RADIUS, extent, under };
}

/** How much deeper under the glass each depth of the knowledge graph hangs than the one above it, in ground units: at the
 * tilt, far enough that each depth is seen hanging lower than the one above it (ADR-1059 D3). */
const DEPTH_STEP = 20;

/** Whether the eye at `tilt` looks at the sheet's underside: past level, toward straight up. */
export function seesUnderside(tilt: number): boolean {
  return tilt > Math.PI / 2;
}

/** Radians a tilting drag tips the sheet for each CSS pixel up or down the window, and the step R and F tip it by. */
export const TILT_PER_PIXEL = Math.PI / 600;
export const TILT_STEP = 15 * Math.PI / 180;

/**
 * The tilt after tipping it by `by` radians, toward the underside for a positive `by`: it stops at straight down on the top
 * face (0) and straight up at the underside (π), and never carries the sheet past either, so it cannot tumble (ADR-1062 D2).
 */
export function sheetTiltBy(tilt: number, by: number): number {
  return Math.min(Math.PI, Math.max(0, tilt + by));
}

/** How much shorter a north-south distance on the sheet is drawn than an east-west one at `tilt`, signed: negative from
 * below, where north is drawn down the window. Edge-on it is kept off nought, so a drag still pans a little. */
function foreshortened(tilt: number): number {
  const c = Math.cos(tilt);
  return Math.sign(c || 1) * Math.max(Math.abs(c), 0.25);
}

/** The eye's focal length on a canvas `size`, in CSS pixels: a unit at a unit's distance spans this many. */
function focal(size: { height: number }): number {
  return Math.max(size.height, 1) / 2 / Math.tan(SHEET_FOV * Math.PI / 360);
}

/**
 * The view the sheet opens on, and Home returns to (D4), at the top resting tilt: its whole height framed in perspective,
 * clear of the Sessions strip, the north edge as far below the window's top as the south edge is above its bottom, from its
 * west edge, so the user scrolls east to follow the depth; a sheet narrower than the window sits in its middle.
 * The perspective draws the near south half bigger than the far north half, so the middle of the view lies a little south
 * of the sheet's middle. At a `framing` asked for, the whole map is the same view zoomed: still from its west edge, or in the
 * middle once the sheet is narrower than the window (3.66).
 */
export function sheetOpening(extent: SheetExtent, size: { width: number; height: number }, framing?: number): GlobePose {
  const f = focal(size), half = Math.max(size.height - CLEAR_HEIGHT, 1) / 2, n = extent.height / 2;
  const sin = Math.sin(SHEET_TILT), cos = Math.cos(SHEET_TILT), lean = half * sin / (f * cos);
  // North of the middle of the view the sheet runs `far` units, south of it `near`; the eye stands `distance` off, or as far
  // as a `framing` asked for puts it, with the middle of the view where the opening has it (3.66).
  const far = n * (1 + lean), near = n * (1 - lean);
  const zoom = framing === undefined ? f / (far * (f * cos - half * sin) / half) : Math.min(size.width, size.height) / (2 * framing * SHEET_RADIUS);
  const distance = f / zoom, y = n - far;
  // The south-west corner, nearest the eye, comes to the window's left edge.
  const closest = distance - near * sin, x = extent.width * f / closest <= size.width ? 0 : -extent.width / 2 + size.width * closest / (2 * f);
  return { turn: turnToIsland(sheetSpot({ x, y })), framing: framing ?? Math.min(size.width, size.height) / (2 * zoom * SHEET_RADIUS), sideOffset: 0 };
}

/** The place on the sheet in the middle of the view at `turn`. */
export function sheetCentre(turn: GlobeTurn): SheetPoint {
  const toSheet = new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)).invert();
  const facing = new Vector3(0, 0, 1).applyQuaternion(toSheet);
  return sheetPoint(facing);
}

/**
 * The turn after a drag of `drag` CSS pixels at `zoom` (CSS pixels per ground unit at the middle of the view), where the
 * pointer's place on the glass cannot be found (`sheetUnder`): the sheet follows the pointer, at the tilt (a drag up or down the window crosses more of the sheet than one across it), and
 * stops with an edge of the glass in the middle of the view, so it is never dragged out of reach. A sideways scroll is a
 * drag the other way. `tilt` and `heading` are the sheet's (`sheetTilted`), so a drag follows the window, whichever way the
 * sheet faces and from either side of it.
 */
export function sheetPan(turn: GlobeTurn, drag: { x: number; y: number }, zoom: number, extent: SheetExtent, tilt = SHEET_TILT, heading = 0): GlobeTurn {
  const centre = sheetCentre(turn);
  // The drag laid flat on the glass, x right and y up the window; seen from below, the window's up is the sheet's south.
  const flat = { x: drag.x / zoom, y: -drag.y / (zoom * foreshortened(tilt)) };
  // The sheet's east and north on the window, spun by the heading; the middle of the view moves against the drag.
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const x = centre.x - (flat.x * cos + flat.y * sin), y = centre.y - (-flat.x * sin + flat.y * cos);
  const clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(x, extent.width / 2), y: clamp(y, extent.height / 2) }));
}

/**
 * The place on the sheet under a point `at` on the window (CSS pixels from the canvas's top left), where the eye's ray
 * through it meets the glass's plane at the middle of the view, or nothing when the ray runs off it (above the horizon, or
 * so near edge-on that the place would lie off the sheet). `globe` is the posed globe group the sheet is the near pole of.
 */
export function sheetUnder(camera: Camera, globe: Object3D, turn: GlobeTurn, at: { x: number; y: number }, size: { width: number; height: number }, extent: SheetExtent): SheetPoint | undefined {
  camera.updateMatrixWorld();
  globe.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * at.x / Math.max(size.width, 1) - 1, 1 - 2 * at.y / Math.max(size.height, 1)), camera);
  // The glass's plane, tangent to the big sphere where the middle of the view lies on it.
  const spot = sheetSpot(sheetCentre(turn)), local = new Vector3(spot.x, spot.y, spot.z).multiplyScalar(SHEET_RADIUS + PLATE_CLEARANCE);
  const point = local.clone().applyMatrix4(globe.matrixWorld), normal = local.clone().normalize().transformDirection(globe.matrixWorld);
  // A ray skimming the glass, or one from an eye in its plane (edge-on), meets it nowhere a pointer could hold.
  const hit = Math.abs(normal.dot(ray.ray.direction)) < 1e-3 ? null : ray.ray.intersectPlane(new Plane().setFromNormalAndCoplanarPoint(normal, point), new Vector3());
  if (hit === null || hit.distanceTo(ray.ray.origin) < 1) return undefined;
  const found = sheetPoint(globe.worldToLocal(hit).normalize()), centre = sheetCentre(turn);
  return Math.hypot(found.x - centre.x, found.y - centre.y) > Math.hypot(extent.width, extent.height) ? undefined : found;
}

/** The turn after a drag that carried the place `grabbed` on the sheet to where `now` lay under the pointer: the sheet moves
 * so the grabbed place is under the pointer again, exactly, at any tilt, and stops with an edge in the middle of the view. */
export function sheetPanUnder(turn: GlobeTurn, grabbed: SheetPoint, now: SheetPoint, extent: SheetExtent): GlobeTurn {
  const centre = sheetCentre(turn), clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(centre.x + grabbed.x - now.x, extent.width / 2), y: clamp(centre.y + grabbed.y - now.y, extent.height / 2) }));
}

/** The sheet's keys (ADR-1060, ADR-1062 D2): WASD and the arrows pan, Q and E spin a quarter turn, R and F tilt a step toward
 * looking down on the islands or up at the graph, and Home faces it back. No key moves the eye for Stories or Library (ADR-1062 D3). */
export type SheetKey = { kind: "pan"; key: string } | { kind: "spin"; by: -1 | 1 } | { kind: "tilt"; by: -1 | 1 } | { kind: "home" };

const PAN_KEYS = new Map<string, { x: number; y: number }>([
  // The drag each key makes, per second: W goes away from you, so what is under the view slides down the window.
  ["w", { x: 0, y: 1 }], ["arrowup", { x: 0, y: 1 }], ["s", { x: 0, y: -1 }], ["arrowdown", { x: 0, y: -1 }],
  ["a", { x: 1, y: 0 }], ["arrowleft", { x: 1, y: 0 }], ["d", { x: -1, y: 0 }], ["arrowright", { x: -1, y: 0 }],
]);

/** CSS pixels a held key pans the sheet across the window each second, the same at every zoom. */
const KEY_PAN_SPEED = 600;

/**
 * What a key press asks of the sheet, or nothing: never while focus is in a text field, and never with Ctrl, Alt or the
 * command key held, which belong to the page and the system.
 */
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

/** The drag, in CSS pixels, that the pan keys `held` make over `seconds`: opposite keys cancel. */
export function sheetKeyPan(held: ReadonlySet<string>, seconds: number): { x: number; y: number } {
  let x = 0, y = 0;
  for (const key of held) { const way = PAN_KEYS.get(key); if (way !== undefined) { x += way.x; y += way.y; } }
  return { x: x * KEY_PAN_SPEED * seconds, y: y * KEY_PAN_SPEED * seconds };
}

export { sheetDrag } from "./sheet-drag.js";

/** Radians a spinning drag turns the sheet for each CSS pixel across the window. */
export const SPIN_PER_PIXEL = Math.PI / 600;

/**
 * The heading and tilt after a rotating drag of `drag` CSS pixels (a right-drag, a Ctrl+drag, or two fingers): across the
 * window it spins the sheet like a table, the edge nearest the eye following the hand, and up the window it tilts it toward
 * the underside, a drag down toward looking down on the islands, stopping at either end. Neither part moves the other.
 * The nearest edge is the sheet's south one at every tilt, so the spin keeps one way as the tilt passes level (3.65).
 */
export function sheetSpinTilt(heading: number, tilt: number, drag: { x: number; y: number }): { heading: number; tilt: number } {
  return { heading: heading + drag.x * SPIN_PER_PIXEL, tilt: sheetTiltBy(tilt, -drag.y * TILT_PER_PIXEL) };
}

/**
 * The heading after a spin of `clockwise` radians, clockwise as seen on the window: a heading turns the sheet anticlockwise
 * on its top face, and its underside, seen from below, turns the other way.
 */
export function sheetSpin(heading: number, clockwise: number, under = false): number {
  return under ? heading + clockwise : heading - clockwise;
}

/** Radians, clockwise on the window, that two fingers turned between `from` and `to`, the short way round. */
export function sheetTwist(from: readonly [{ x: number; y: number }, { x: number; y: number }], to: readonly [{ x: number; y: number }, { x: number; y: number }]): number {
  const angle = (pair: typeof from) => Math.atan2(pair[1].y - pair[0].y, pair[1].x - pair[0].x);
  const turned = angle(to) - angle(from);
  return Math.atan2(Math.sin(turned), Math.cos(turned));
}

/** The starting heading nearest `heading`, which Home and the compass spin back to by the short way round. */
export function headingHome(heading: number): number {
  return 2 * Math.PI * Math.round(heading / (2 * Math.PI));
}

/** Where Home and the compass bring the sheet's heading and tilt: its starting heading the short way round, and the top
 * resting tilt (ADR-1060 D3, ADR-1062 D2). */
export function sheetHome(heading: number): { heading: number; tilt: number } {
  return { heading: headingHome(heading), tilt: SHEET_TILT };
}

/** Where the sheet's starting north lies on the window at `heading`, as an angle anticlockwise from the window's right. */
export function compassNorth(heading: number, under = false): number {
  return under ? -Math.PI / 2 - heading : Math.PI / 2 + heading;
}

/**
 * 3.11 on the glass sheet (ADR-0660): nothing is round the back, but a failing island (storytree's verified word) can lie
 * past the window's edge. Each one whose middle is drawn (`drawn`, in CSS pixels from the canvas's top left) outside a canvas
 * `size` gets a marker there, for `markerSpot` to bring to the edge nearest it. Its turn pans the island to the middle of
 * the view. In Library, where the islands are only outlines over the knowledge, none is marked, from any angle; in Stories
 * one is, from above or below (ADR-0660 D4, ADR-1062 D3).
 */
export function sheetMarkers(islands: readonly FacingIsland[], drawn: (island: FacingIsland) => { left: number; top: number }, size: { width: number; height: number },
  mode: ForestMode = "forest"): { story: string; left: number; top: number; turn: GlobeTurn }[] {
  if (mode === "library") return [];
  return islands.filter(island => island.trees.some(tree => tree.status === "unhealthy")).flatMap(island => {
    const { left, top } = drawn(island);
    if (left >= 0 && left <= size.width && top >= 0 && top <= size.height) return [];
    return [{ story: island.story, left, top, turn: turnToIsland(island.spot) }];
  });
}

/**
 * The globe group's pose with the sheet tilted `tilt` radians (0 straight down on its top face, π straight up at its
 * underside) about the window's horizontal line through the middle of the view, its north edge tipping away from the eye
 * (ADR-1062 D2): `rotation` turned about that line, which crosses the sheet where the eye looks, so the place in the middle
 * stays there, depth still runs west to east, and the sheet's upright axis stays upright on the window, never rolling. First
 * the sheet is spun `heading` radians about its upright axis through that place, anticlockwise on its top face
 * (ADR-1060 D2), which moves neither the place nor the tilt.
 */
export function sheetTilted(rotation: Quaternion, eye: Quaternion, tilt: number, heading = 0): { quaternion: Quaternion; position: Vector3 } {
  const upright = new Vector3(0, 0, 1).applyQuaternion(eye);
  const pivot = upright.clone().multiplyScalar(SHEET_RADIUS + PLATE_CLEARANCE);
  const spin = new Quaternion().setFromAxisAngle(upright, heading);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(eye), -tilt);
  return { quaternion: turn.clone().multiply(spin).multiply(rotation), position: pivot.clone().sub(pivot.clone().applyQuaternion(turn)) };
}
