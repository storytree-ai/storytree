/** The desktop's joins between permanent story places, lane C's turns, and Three's camera. */
import { Euler, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { edgeMarkers, growPlanet, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import { pickProjectedNote, type ProjectedNote } from "./globe-picking.js";
import type { Selection } from "./panel-selection.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";
import { isDrawn } from "./globe-guide.js";
import { globeName } from "./nameplates.js";

export type ForestMode = "forest" | "library";

/** Five CSS pixels or more separates a globe drag from a click (3.12). */
export function isGlobeDrag(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= 5;
}

/**
 * The cursor and tooltip for the actual eligible artifact, file or capability territory beneath the pointer
 * (3.12, 3.17): a territory gives its capability's name, without its number, and its description as the detail (3.32).
 */
export function globeHover(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode): { cursor: string; title: string | undefined; detail?: string } {
  const hit = pickGlobe(world, camera, box, cursor, mode);
  const pointer = hit === undefined ? "" : "pointer";
  if (hit?.kind === "note") return { cursor: pointer, title: world.getObjectByName(`knowledge-point:${hit.id}`)?.userData.title as string | undefined };
  const territory = (capability: string) => world.getObjectByName(`territory:${capability}`)?.userData as { title?: string; description?: string } | undefined;
  const file = pointedFile(world, camera, box, cursor);
  if (file !== undefined) return { cursor: pointer, title: `${file.file} · ${file.lines} lines · ${file.capability === undefined ? "Unclaimed" : globeName(territory(file.capability)?.title ?? file.capability)}` };
  if (hit?.kind !== "story" || hit.capability === undefined) return { cursor: pointer, title: undefined };
  const { title, description } = territory(hit.capability) ?? {};
  return { cursor: pointer, title: globeName(title ?? hit.capability), ...(description === undefined || description.trim() === "" ? {} : { detail: description }) };
}

/**
 * How many radii half the window's short side spans as the globe opens (ADR-0750): 1.18 for the
 * whole planet, so it fills 85% of the short side as it always has; less close up, more with room around.
 */
export function globeFraming(choice: GlobeOpening): number {
  return choice === "close" ? 0.8 : choice === "far" ? 1.7 : 1.18;
}

/**
 * The globe's layout (ADR-0804 D7): each island at its permanent place, nudged only as far as its coast needs
 * room, and the globe's radius, which grows when nudging cannot make room. Every drawing takes `radius` from here.
 */
export function planetLayout(scene: ForestScene, places: ReadonlyMap<string, number>, before?: { spots: ReadonlyMap<string, FacingIsland["spot"]> }, frame?: ForestScene) {
  // A plan still growing, framed by its full plan, keeps every island where the full plan puts it (3.28).
  const grown = growPlanet((frame ?? scene).islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  // An island that did not move keeps the spot on show, so its plate is not drawn again (ADR-0836 D1).
  const kept = (story: string) => {
    const spot = grown.spots.get(story)!, old = before?.spots.get(story);
    return old !== undefined && old.x === spot.x && old.y === spot.y && old.z === spot.z ? old : spot;
  };
  const islands: FacingIsland[] = scene.islands.map(island => ({ story: island.story, trees: island.trees, spot: kept(island.story) }));
  const spots = new Map(islands.map(i => [i.story, i.spot]));
  const same = before !== undefined && before.spots.size === spots.size && [...spots].every(([story, spot]) => before.spots.get(story) === spot);
  return { scene, islands, spots: same ? before.spots : spots, radius: grown.radius };
}

/** How far the globe tilts toward either pole: just short of it, so north always stays up on screen. */
export const TILT_LIMIT = 88 * Math.PI / 180;

/**
 * The globe as turned in the eye's frame: spun about its poles by yaw, then tilted by pitch, held short of
 * each pole. Nothing else turns it, so with an eye that never rolls, north points straight up the screen.
 */
export function focusRotation(turn: GlobeTurn, eye: Quaternion): Quaternion {
  const pitch = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, turn.pitch));
  return eye.clone().multiply(new Quaternion().setFromEuler(new Euler(pitch, turn.yaw, 0)));
}

/**
 * A drag of `drag` pixels on a canvas `height` tall: sideways spins the globe about its poles without limit,
 * up and down tilts it, short of each pole. A drag the canvas's height turns it once around, as the orbit did.
 */
export function dragTurn(turn: GlobeTurn, drag: { x: number; y: number }, height: number): GlobeTurn {
  const rate = 2 * Math.PI / height;
  const pitch = Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, turn.pitch));
  return { yaw: turn.yaw + drag.x * rate, pitch: Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, pitch + drag.y * rate)) };
}

/** Use the actual camera frame for marker bearings, retaining absolute globe turns for clicks. */
export function hiddenMarkers(islands: readonly FacingIsland[], rotation: Quaternion, eye: Quaternion, mode: ForestMode = "forest") {
  // ADR-0660 D4: only the viewer's explicit Library choice hides failure attention.
  if (mode === "library") return [];
  const toView = eye.clone().invert().multiply(rotation);
  const viewed = islands.map(island => ({ ...island, spot: new Vector3(island.spot.x, island.spot.y, island.spot.z).applyQuaternion(toView) }));
  const turns = new Map(islands.map(i => [i.story, turnToIsland(i.spot)]));
  return edgeMarkers(viewed, { x: 0, y: 0, z: 1 }).map(marker => ({ ...marker, turn: turns.get(marker.story)! }));
}

/** Pick the actual rotated land. The see-through shell retains the near-side interaction rule. */
export function pickIsland(ray: Raycaster, world: Object3D): string | undefined {
  return pickLand(ray, world)?.story;
}

/** The land a ray meets first: its story, and the capability whose territory it is, if it is one (3.15). */
function pickLand(ray: Raycaster, world: Object3D): { story: string; capability?: string } | undefined {
  for (const hit of ray.intersectObject(world, true)) {
    if (!isDrawn(hit.object)) continue;
    let capability: string | undefined;
    for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
      if (object.name === "planet:shell") return undefined;
      if (object.name.startsWith("territory:") && typeof object.userData.capability === "string") capability ??= object.userData.capability;
      if (object.name.startsWith("planet:")) return capability === undefined ? { story: object.name.slice("planet:".length) } : { story: object.name.slice("planet:".length), capability };
    }
  }
  return undefined;
}

/** The file circle under the cursor (3.17): its file, lines and capability, or undefined when none is. */
export function pointedFile(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }): { file: string; lines: number; capability?: string } | undefined {
  world.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * (cursor.x - box.left) / box.width - 1, 1 - 2 * (cursor.y - box.top) / box.height), camera);
  for (const hit of ray.intersectObject(world, true)) {
    if (!isDrawn(hit.object)) continue;
    if (hit.object.name === "planet:shell") return undefined;
    if (hit.object.name.startsWith("file:")) return hit.object.userData as { file: string; lines: number; capability?: string };
  }
  return undefined;
}

/** Project the rotating points; the glass admits the near half, solid land still occludes it. */
export function pickGlobe(world: Object3D, camera: Camera,
  box: { left: number; top: number; width: number; height: number }, cursor: { x: number; y: number }, mode: ForestMode): Selection {
  world.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(2 * (cursor.x - box.left) / box.width - 1, 1 - 2 * (cursor.y - box.top) / box.height), camera);
  let landDistance = Infinity;
  if (mode === "forest") {
    for (const hit of ray.intersectObject(world, true)) {
      if (!isDrawn(hit.object)) continue;
      let land = false;
      for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
        if (object.name.startsWith("planet:") && object.name !== "planet:shell") { land = true; break; }
      }
      if (land) { landDistance = hit.distance; break; }
    }
  }
  const notes: ProjectedNote[] = [];
  world.traverse(object => {
    if (!object.name.startsWith("knowledge-point:") || !isDrawn(object)) return;
    const at = object.getWorldPosition(new Vector3());
    const projected = at.clone().project(camera);
    const inViewport = Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    // Library has no shell: either half can be selected. In Forest the far half stays behind it.
    const nearHalf = at.dot(ray.ray.direction) <= 0;
    notes.push({ id: object.name.slice("knowledge-point:".length),
      x: box.left + (projected.x + 1) * box.width / 2, y: box.top + (1 - projected.y) * box.height / 2,
      z: projected.z, distance: at.sub(ray.ray.origin).dot(ray.ray.direction), visible: inViewport && (mode === "library" || nearHalf) });
  });
  const note = pickProjectedNote(notes, cursor, landDistance);
  if (note !== undefined) return { kind: "note", id: note };
  const land = mode === "forest" ? pickLand(ray, world) : undefined;
  if (land === undefined) return undefined;
  return land.capability === undefined ? { kind: "story", id: land.story } : { kind: "story", id: land.story, capability: land.capability };
}

/** `handle`, run at most once a frame with the latest of the calls made since the last frame. */
export function oncePerFrame<T>(handle: (value: T) => void, schedule: (run: () => void) => unknown = requestAnimationFrame): (value: T) => void {
  let latest: { value: T } | undefined;
  return value => {
    const waiting = latest !== undefined;
    latest = { value };
    if (waiting) return;
    schedule(() => {
      const { value } = latest!;
      latest = undefined;
      handle(value);
    });
  };
}
