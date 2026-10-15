/**
 * Capability 3 · Story node render. The forest on the glass sheet (ADR-1043): where its islands lie, where it opens, and
 * what moves it. The sheet is the near pole of a very large sphere (The world's `sheetSpot`), so the globe's turn, its
 * guide and its Home all carry over: a turn of the big sphere by a hair slides the sheet under the eye, flat to within
 * a degree. The eye rests at one fixed tabletop tilt (ADR-1059 D1), so a sheet's north-south distances are drawn
 * shortened by its cosine. The user pans it (a drag, WASD or the arrows), zooms it (the wheel or a pinch) and spins it about
 * its upright axis (Q and E, a right-drag, a Ctrl+drag or a twist), and a compass or Home faces it back (ADR-1060); the
 * tilt never changes, and nothing switches what a drag does.
 */
import { Euler, Quaternion, Vector3 } from "three";
import { sheetPlaces, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoast, islandCoastReach } from "@storytree/forest-world/geometry";
import { islandTerritories } from "../territories/territories.js";
import { PLATE_CLEARANCE, SHEET_RADIUS, SHEET_TILT, sheetPoint, sheetSpot, type SheetExtent, type SheetPoint } from "@storytree/forest-world/planet";
import type { GlobePose } from "./globe-guide.js";
import type { ForestMode } from "./planet-navigation.js";

/** Glass round the land on every side, in ground units. */
const MARGIN = 24;
/** CSS pixels of the window's height kept clear at the opening: the Sessions strip docked over the bottom, as much again at the top. */
const CLEAR_HEIGHT = 170;

/** The depth of the pool along the sheet's south edge, where notes on no shelf lie (ADR-1043 D5), in ground units. */
const POOL_HEIGHT = 90;

/**
 * The islands at their places on the sheet (`sheetPlaces`), centred on the pole, and the glass they stand on, which runs on
 * south past the islands for the pool of notes no shelf reaches. `under` says where the knowledge graph hangs: each
 * story's shelf under its island's middle, each capability's under its territory's, and the pool along the south edge.
 */
export function sheetLayout(scene: ForestScene, places: ReadonlyMap<string, number>) {
  const placed = sheetPlaces(scene.islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  const { west, east, south, north } = placed.bounds;
  const pool = { x: west, y: south - MARGIN - POOL_HEIGHT, width: east - west, height: POOL_HEIGHT };
  const centre = { x: (west + east) / 2, y: (pool.y + north) / 2 };
  const extent: SheetExtent = { width: east - west + 2 * MARGIN, height: north - pool.y + 2 * MARGIN };
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
    pool: { x: pool.x - centre.x, y: pool.y - centre.y, width: pool.width, height: pool.height },
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

/** How much shorter a north-south distance on the sheet is drawn than an east-west one, at the tilt. */
const FORESHORTENED = Math.cos(SHEET_TILT);

/**
 * The view the sheet opens on, and Home returns to (D4): its whole height framed, clear of the Sessions strip, from its
 * west edge, so the user scrolls east to follow the depth; a sheet narrower than the window sits in its middle.
 */
export function sheetOpening(extent: SheetExtent, size: { width: number; height: number }): GlobePose {
  const zoom = Math.max(size.height - CLEAR_HEIGHT, 1) / (extent.height * FORESHORTENED);
  const x = extent.width * zoom <= size.width ? 0 : -extent.width / 2 + size.width / (2 * zoom);
  return { turn: turnToIsland(sheetSpot({ x, y: 0 })), framing: Math.min(size.width, size.height) / (2 * zoom * SHEET_RADIUS), sideOffset: 0 };
}

/** The place on the sheet in the middle of the view at `turn`. */
export function sheetCentre(turn: GlobeTurn): SheetPoint {
  const toSheet = new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)).invert();
  const facing = new Vector3(0, 0, 1).applyQuaternion(toSheet);
  return sheetPoint(facing);
}

/**
 * The turn after a drag of `drag` CSS pixels at `zoom` (CSS pixels per ground unit): the sheet follows the pointer, at the
 * tilt (a drag up or down the window crosses more of the sheet than one across it), and
 * stops with an edge of the glass in the middle of the view, so it is never dragged out of reach. A sideways scroll is a
 * drag the other way. `under` is the sheet turned over to its underside, and `heading` its spin (`sheetTurnedOver`), so a
 * drag follows the window, whichever way the sheet faces.
 */
export function sheetPan(turn: GlobeTurn, drag: { x: number; y: number }, zoom: number, extent: SheetExtent, under = false, heading = 0): GlobeTurn {
  const centre = sheetCentre(turn);
  // The drag laid flat on the glass, x right and y up the window; turned over north to south, the window's up is flipped (ADR-1043 D3).
  const flat = { x: drag.x / zoom, y: (under ? drag.y : -drag.y) / (zoom * FORESHORTENED) };
  // The sheet's east and north on the window, spun by the heading; the middle of the view moves against the drag.
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const x = centre.x - (flat.x * cos + flat.y * sin), y = centre.y - (-flat.x * sin + flat.y * cos);
  const clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(x, extent.width / 2), y: clamp(y, extent.height / 2) }));
}

/** The sheet's keys (ADR-1060): WASD and the arrows pan, Q and E spin a quarter turn, Home faces it back, T turns it over. */
export type SheetKey = { kind: "pan"; key: string } | { kind: "spin"; by: -1 | 1 } | { kind: "home" } | { kind: "turn" };

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
  if (key === "home") return { kind: "home" };
  if (key === "t") return { kind: "turn" };
  return undefined;
}

/** The drag, in CSS pixels, that the pan keys `held` make over `seconds`: opposite keys cancel. */
export function sheetKeyPan(held: ReadonlySet<string>, seconds: number): { x: number; y: number } {
  let x = 0, y = 0;
  for (const key of held) { const way = PAN_KEYS.get(key); if (way !== undefined) { x += way.x; y += way.y; } }
  return { x: x * KEY_PAN_SPEED * seconds, y: y * KEY_PAN_SPEED * seconds };
}

/** What a pointer press drags: the left button pans, the right button or Ctrl with the left spins (ADR-1060 D2). */
export function sheetDrag(event: { button: number; ctrlKey: boolean; isPrimary: boolean }): "pan" | "spin" | undefined {
  if (!event.isPrimary) return undefined;
  if (event.button === 2 || (event.button === 0 && event.ctrlKey)) return "spin";
  return event.button === 0 ? "pan" : undefined;
}

/** Radians a spinning drag turns the sheet for each CSS pixel across the window. */
export const SPIN_PER_PIXEL = Math.PI / 600;

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

/** Where the sheet's starting north lies on the window at `heading`, as an angle anticlockwise from the window's right. */
export function compassNorth(heading: number, under = false): number {
  return under ? -Math.PI / 2 - heading : Math.PI / 2 + heading;
}

/**
 * 3.11 on the glass sheet (ADR-0660): nothing is round the back, but a failing island (storytree's verified word) can lie
 * past the window's edge. Each one whose middle lies outside a canvas `size` gets a marker at the place it is drawn, in
 * CSS pixels from the canvas's top left, for `markerSpot` to bring to the edge nearest it; `middle` is where the middle
 * of the view is drawn. Its turn pans the island to the middle of the view. Only the Library's face hides them (D4).
 */
export function sheetMarkers(islands: readonly FacingIsland[], turn: GlobeTurn, zoom: number, size: { width: number; height: number },
  middle = { left: size.width / 2, top: size.height / 2 }, mode: ForestMode = "forest", heading = 0): { story: string; left: number; top: number; turn: GlobeTurn }[] {
  if (mode === "library") return [];
  const centre = sheetCentre(turn), cos = Math.cos(heading), sin = Math.sin(heading);
  return islands.filter(island => island.trees.some(tree => tree.status === "unhealthy")).flatMap(island => {
    const at = sheetPoint(island.spot);
    // At the tilt the big sphere's sag away from the middle of the view shows too, a little lower in the window.
    const x = at.x - centre.x, y = at.y - centre.y, sag = (x * x + y * y) / (2 * SHEET_RADIUS);
    // Spun by the heading, then seen at the tilt.
    const across = x * cos - y * sin, up = x * sin + y * cos;
    const left = middle.left + across * zoom, top = middle.top - (up * FORESHORTENED - sag * Math.sin(SHEET_TILT)) * zoom;
    if (left >= 0 && left <= size.width && top >= 0 && top <= size.height) return [];
    return [{ story: island.story, left, top, turn: turnToIsland(island.spot) }];
  });
}

/**
 * The globe group's pose with the sheet turned `over` radians (0 its top face, π its underside) north to south, about the
 * window's horizontal line through the middle of the view (ADR-1043 D3), and tipped back by the fixed tilt (ADR-1059 D1), so
 * the edge at the window's top lies away from the eye on either face: `rotation` turned about that line, which crosses the
 * sheet where the eye looks, so the place in the middle stays there and depth still runs west to east. First the sheet is
 * spun `heading` radians about its upright axis through that place, anticlockwise on its top face (ADR-1060 D2), which
 * moves neither the place nor the tilt.
 */
export function sheetTurnedOver(rotation: Quaternion, eye: Quaternion, over: number, heading = 0): { quaternion: Quaternion; position: Vector3 } {
  const upright = new Vector3(0, 0, 1).applyQuaternion(eye);
  const pivot = upright.clone().multiplyScalar(SHEET_RADIUS + PLATE_CLEARANCE);
  const spin = new Quaternion().setFromAxisAngle(upright, heading);
  const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0).applyQuaternion(eye), over - SHEET_TILT);
  return { quaternion: turn.clone().multiply(spin).multiply(rotation), position: pivot.clone().sub(pivot.clone().applyQuaternion(turn)) };
}
