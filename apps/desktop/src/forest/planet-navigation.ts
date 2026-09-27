/** The desktop's joins between permanent story places, lane C's turns, and Three's camera. */
import { Euler, Quaternion, Vector3, type Object3D, type Raycaster } from "three";
import { edgeMarkers, PLANET_RADIUS, turnToIsland, type FacingIsland, type ForestScene, type GlobeTurn } from "@storytree/forest";

import { placeOnPackedGlobe } from "../../../../packages/forest/src/planet-places/planet-places.js";

export function planetLayout(scene: ForestScene, places: ReadonlyMap<string, number>) {
  const islands: FacingIsland[] = scene.islands.map(island => {
    const place = places.get(island.story);
    if (place === undefined) throw new Error(`No permanent place for ${island.title}`);
    const p = placeOnPackedGlobe(place);
    return { story: island.story, trees: island.trees, spot: { x: p.x / PLANET_RADIUS, y: p.y / PLANET_RADIUS, z: p.z / PLANET_RADIUS } };
  });
  return { scene, islands, spots: new Map(islands.map(i => [i.story, i.spot])) };
}

/** Lane C turns toward view +z. The canvas eye can be elevated, orbited, or rolled. */
export function focusRotation(turn: GlobeTurn, eye: Quaternion): Quaternion {
  return eye.clone().multiply(new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0)));
}

/** Use the actual camera frame for marker bearings, retaining absolute globe turns for clicks. */
export function hiddenMarkers(islands: readonly FacingIsland[], rotation: Quaternion, eye: Quaternion) {
  const toView = eye.clone().invert().multiply(rotation);
  const viewed = islands.map(island => ({ ...island, spot: new Vector3(island.spot.x, island.spot.y, island.spot.z).applyQuaternion(toView) }));
  const turns = new Map(islands.map(i => [i.story, turnToIsland(i.spot)]));
  return edgeMarkers(viewed, { x: 0, y: 0, z: 1 }).map(marker => ({ ...marker, turn: turns.get(marker.story)! }));
}

/** Pick the actual rotated land. The see-through shell retains the near-side interaction rule. */
export function pickIsland(ray: Raycaster, world: Object3D): string | undefined {
  for (const hit of ray.intersectObject(world, true)) {
    for (let object: Object3D | null = hit.object; object !== null; object = object.parent) {
      if (object.name === "planet:shell") return undefined;
      if (object.name.startsWith("planet:")) return object.name.slice("planet:".length);
    }
  }
  return undefined;
}
