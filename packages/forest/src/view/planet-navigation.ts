/** Capability 3 · Story node render. The desktop's joins between the sheet's islands, the pointer, and Three's camera. */
import { Euler, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import type { FacingIsland, GlobeTurn } from "@storytree/forest";
import { pickProjectedNote, type ProjectedNote } from "./globe-picking.js";
import type { Selection } from "./panel-selection.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";
import { isDrawn } from "./globe-guide.js";
import { globeName } from "./nameplates.js";

export type ForestMode = "forest" | "library";

/** Five CSS pixels or more separates a drag from a click (3.12). */
export function isGlobeDrag(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= 5;
}

/**
 * The cursor and tooltip for the actual eligible artifact, file or capability territory beneath the pointer
 * (3.12, 3.17): a territory gives its capability's name, without its number, and its description's first paragraph as the detail (3.32).
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
  // What the capability does is its description's first paragraph; later ones are notes for the agents who build it.
  const detail = description?.trim().split(/\r?\n\s*\r?\n/)[0]?.trim();
  return { cursor: pointer, title: globeName(title ?? hit.capability), ...(detail === undefined || detail === "" ? {} : { detail }) };
}

/**
 * How many radii half the window's short side spans as the globe opens (ADR-0750): 1.18 for the
 * whole planet, so it fills 85% of the short side as it always has; less close up, more with room around.
 */
export function globeFraming(choice: GlobeOpening): number {
  return choice === "close" ? 0.8 : choice === "far" ? 1.7 : 1.18;
}

/** How long a host's change of layout takes to move its islands, in seconds (3.28). */
export const MOVE_SECONDS = 1.6;

/**
 * The spots on show `progress` (0 to 1) of the way through a change of layout from `from` to `to` (3.28): an island in both
 * slides along the globe from its old spot to its new, eased in and out; an island new to `to` stands at its spot.
 */
export function movingSpots(from: ReadonlyMap<string, FacingIsland["spot"]>, to: ReadonlyMap<string, FacingIsland["spot"]>, progress: number): Map<string, FacingIsland["spot"]> {
  if (progress >= 1) return new Map(to);
  const eased = progress <= 0 ? 0 : progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  return new Map([...to].map(([story, end]) => {
    const start = from.get(story);
    if (start === undefined) return [story, end];
    if (eased === 0) return [story, start];
    const angle = Math.acos(Math.max(-1, Math.min(1, start.x * end.x + start.y * end.y + start.z * end.z)));
    if (angle < 1e-9) return [story, end];
    const a = Math.sin((1 - eased) * angle) / Math.sin(angle), b = Math.sin(eased * angle) / Math.sin(angle);
    return [story, { x: a * start.x + b * end.x, y: a * start.y + b * end.y, z: a * start.z + b * end.z }];
  }));
}

/**
 * The big sphere the sheet is the near pole of, as turned in the eye's frame: spun about its poles by yaw, then tilted by
 * pitch. A sheet's turns are a hair's breadth, so with an eye that never rolls, north points straight up the screen.
 */
export function focusRotation(turn: GlobeTurn, eye: Quaternion): Quaternion {
  return eye.clone().multiply(new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)));
}

type PaneRect = { left: number; right: number; top: number; bottom: number };

/**
 * 3.11: where an edge marker sits in a canvas `size`, in its pixels: at its spot, kept 20px inside the canvas and
 * 20px above anything docked over the canvas's bottom edge under it (the Sessions strip), so nothing covers it.
 */
export function markerSpot(at: { left: number; top: number }, size: { width: number; height: number }, docked: readonly PaneRect[]): { left: number; top: number } {
  const left = Math.max(20, Math.min(size.width - 20, at.left));
  const lowest = docked.reduce((limit, rect) =>
    rect.bottom >= size.height && rect.left < left + 20 && rect.right > left - 20 ? Math.min(limit, rect.top - 20) : limit, size.height - 20);
  return { left, top: Math.max(20, Math.min(lowest, at.top)) };
}

/** Pick the actual turned land. */
export function pickIsland(ray: Raycaster, world: Object3D): string | undefined {
  return pickLand(ray, world)?.story;
}

/** The land a ray meets first: its story, and the capability whose territory it is, if it is one (3.15). */
function pickLand(ray: Raycaster, world: Object3D): { story: string; capability?: string } | undefined {
  for (const hit of ray.intersectObject(world, true)) {
    if (!isDrawn(hit.object)) continue;
    let capability: string | undefined;
    for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
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
    if (hit.object.name.startsWith("file:")) return hit.object.userData as { file: string; lines: number; capability?: string };
  }
  return undefined;
}

/** Project the drawn points; in Forest, solid land before a point occludes it. */
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
        if (object.name.startsWith("planet:")) { land = true; break; }
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
    notes.push({ id: object.name.slice("knowledge-point:".length),
      x: box.left + (projected.x + 1) * box.width / 2, y: box.top + (1 - projected.y) * box.height / 2,
      z: projected.z, distance: at.sub(ray.ray.origin).dot(ray.ray.direction), visible: inViewport });
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
