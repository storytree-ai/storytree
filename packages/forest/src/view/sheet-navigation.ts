/**
 * Capability 3 · Story node render. The forest on the glass sheet (ADR-1043): where its islands lie, where it opens, and
 * what moves it. The sheet is the near pole of a very large sphere (The world's `sheetSpot`), so the globe's turn, its
 * guide and its Home all carry over: a turn of the big sphere by a hair slides the sheet under the eye, flat to within
 * a degree. The user's controls are a pan and the wheel's zoom, nothing more (D4): no drag spins or tilts it.
 */
import { Euler, Quaternion, Vector3 } from "three";
import { sheetPlaces, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import { SHEET_RADIUS, sheetPoint, sheetSpot, type SheetExtent, type SheetPoint } from "@storytree/forest-world/planet";
import type { GlobePose } from "./globe-guide.js";

/** Glass round the land on every side, in ground units. */
const MARGIN = 24;
/** CSS pixels of the window's height kept clear at the opening: the Sessions strip docked over the bottom, as much again at the top. */
const CLEAR_HEIGHT = 170;

/** The islands at their places on the sheet (`sheetPlaces`), centred on the pole, and the glass they stand on. */
export function sheetLayout(scene: ForestScene, places: ReadonlyMap<string, number>) {
  const placed = sheetPlaces(scene.islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  const { west, east, south, north } = placed.bounds;
  const centre = { x: (west + east) / 2, y: (south + north) / 2 };
  const extent: SheetExtent = { width: east - west + 2 * MARGIN, height: north - south + 2 * MARGIN };
  const islands: FacingIsland[] = scene.islands.map(island => {
    const at = placed.at.get(island.story)!;
    return { story: island.story, trees: island.trees, spot: sheetSpot({ x: at.x - centre.x, y: at.y - centre.y }) };
  });
  return { scene, islands, spots: new Map(islands.map(island => [island.story, island.spot])), radius: SHEET_RADIUS, extent };
}

/**
 * The view the sheet opens on, and Home returns to (D4): its whole height framed, clear of the Sessions strip, from its
 * west edge, so the user scrolls east to follow the depth; a sheet narrower than the window sits in its middle.
 */
export function sheetOpening(extent: SheetExtent, size: { width: number; height: number }): GlobePose {
  const zoom = Math.max(size.height - CLEAR_HEIGHT, 1) / extent.height;
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
 * The turn after a drag of `drag` CSS pixels at `zoom` (CSS pixels per ground unit): the sheet follows the pointer, and
 * stops with an edge of the glass in the middle of the view, so it is never dragged out of reach. A sideways scroll is a
 * drag the other way.
 */
export function sheetPan(turn: GlobeTurn, drag: { x: number; y: number }, zoom: number, extent: SheetExtent): GlobeTurn {
  const centre = sheetCentre(turn);
  const clamp = (value: number, half: number) => Math.max(-half, Math.min(half, value));
  return turnToIsland(sheetSpot({ x: clamp(centre.x - drag.x / zoom, extent.width / 2), y: clamp(centre.y + drag.y / zoom, extent.height / 2) }));
}
