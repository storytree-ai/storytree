/** The desktop's joins between permanent story places, lane C's turns, and Three's camera. */
import { Euler, Quaternion, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { edgeMarkers, growPlanet, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import { pickProjectedNote, type ProjectedNote } from "./globe-picking.js";
import type { Selection } from "./panel-selection.js";
import type { GlobeOpening } from "../surfaces/surfaces.js";

export type ForestMode = "forest" | "library";

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
export function planetLayout(scene: ForestScene, places: ReadonlyMap<string, number>) {
  const grown = growPlanet(scene.islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    return { story: island.story, place, reach: islandCoastReach(island) };
  }));
  const islands: FacingIsland[] = scene.islands.map(island => ({ story: island.story, trees: island.trees, spot: grown.spots.get(island.story)! }));
  return { scene, islands, spots: new Map(islands.map(i => [i.story, i.spot])), radius: grown.radius };
}

/** Lane C turns toward view +z. The canvas eye can be elevated, orbited, or rolled. */
export function focusRotation(turn: GlobeTurn, eye: Quaternion): Quaternion {
  return eye.clone().multiply(new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)));
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
      let land = false;
      for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
        if (object.name.startsWith("planet:") && object.name !== "planet:shell") { land = true; break; }
      }
      if (land) { landDistance = hit.distance; break; }
    }
  }
  const notes: ProjectedNote[] = [];
  world.traverse(object => {
    if (!object.name.startsWith("knowledge-point:")) return;
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
