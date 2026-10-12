/** Capability 3 · Story node render. */
import { Box3, Vector3, type Camera, type Mesh, type Object3D } from "three";
import { turnToIsland, type GlobeTurn } from "@storytree/forest";
/** A pathway is a link's (`from->to`) own stretch of road, the one carrying fewest other links, at the share of the way `along`
 * it (its middle by default). */
export type GlobeTarget = { kind: "story"; story: string } | { kind: "capability"; capability: string } | { kind: "file"; story: string; path: string } | { kind: "pathway"; link: string; along?: number } | { kind: "note"; note: string } | { kind: "core" };
export type GlobePose = { turn: GlobeTurn; framing: number; sideOffset: number };
/** Framing is the short half-side in globe radii; offset is CSS pixels right; duration is milliseconds. */
export type CameraStop = { target: GlobeTarget; framing?: number; sideOffset?: number; duration?: number };
export type ScreenPosition = { x: number; y: number; visible: boolean };
/** An island's land as drawn, in CSS pixels on the canvas: the screen box round its ground. */
export type IslandBox = { story: string; x: number; y: number; width: number; height: number };
/** `moving` says a stop's glide is still under way; `notes` lists the Library's notes drawn on the globe, by id; `islands`
 * gives each drawn island on the near side its screen box (3.51). */
export type GlobeControls = { stop(stop: CameraStop): boolean; position(target: GlobeTarget): ScreenPosition | undefined; cancel(): void; moving(): boolean; notes(): string[]; islands(): IslandBox[] };
/** The controls a globe view hands over, with the panel width (CSS pixels) it last placed itself beside (3.40, 3.45). */
export type PlacedGlobeControls = GlobeControls & { aside(): number };
/** The short way round from `from` to face the way `to` does, as a yaw to ease toward. */
const nearestYaw = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function createGlobeGuide(host: { world(): Object3D; camera(): Camera; size(): { width: number; height: number }; read(): GlobePose; write(pose: GlobePose): void; invalidate(): void }): GlobeControls & { frame(milliseconds: number): boolean; home(pose: GlobePose, duration?: number): boolean; slide(to: Omit<GlobePose, "turn">, duration?: number): boolean } {
  // A slide (3.40) moves the zoom and offset only, leaving the turn to whatever turns it meanwhile.
  let motion: { from: GlobePose; to: GlobePose; elapsed: number; duration: number; slide?: boolean } | undefined;
  // 3.44: the host draws a written zoom and offset on its next render, so until it has, the pose written is the one on show.
  let written: GlobePose | undefined;
  const current = (): GlobePose => {
    const drawn = host.read();
    if (written !== undefined && Math.abs(drawn.framing - written.framing) < 1e-6 && Math.abs(drawn.sideOffset - written.sideOffset) < 1e-6) written = undefined;
    return written === undefined ? drawn : { ...written, turn: drawn.turn };
  };
  const write = (pose: GlobePose): void => { written = pose; host.write(pose); };
  function frame(milliseconds: number): boolean {
    if (motion === undefined) return false;
    motion.elapsed += Math.max(0, milliseconds);
    const progress = Math.min(1, motion.elapsed / motion.duration);
    const eased = progress * progress * (3 - 2 * progress);
    const mix = (from: number, to: number) => progress === 1 ? to : from + (to - from) * eased;
    const { from, to } = motion;
    write({ turn: motion.slide ? host.read().turn : { yaw: mix(from.turn.yaw, to.turn.yaw), pitch: mix(from.turn.pitch, to.turn.pitch) },
      framing: mix(from.framing, to.framing), sideOffset: mix(from.sideOffset, to.sideOffset) });
    if (progress === 1) motion = undefined;
    host.invalidate();
    return motion !== undefined;
  }
  function go(from: GlobePose, to: GlobePose, duration: number, slide = false): boolean {
    if (!Number.isFinite(to.framing) || to.framing <= 0 || !Number.isFinite(to.sideOffset) || !Number.isFinite(duration) || duration < 0) return false;
    motion = undefined;
    if (duration === 0) write(to);
    else motion = { from, to, duration, elapsed: 0, slide };
    host.invalidate();
    return true;
  }
  return {
    stop(stop) {
      const world = host.world(); world.updateMatrixWorld(true);
      const target = findTarget(world, stop.target), globe = world.getObjectByName("globe");
      if (target === undefined || globe === undefined) return false;
      const from = current();
      const facing = stop.target.kind === "core" ? from.turn : turnToIsland(globe.worldToLocal(target.point.clone()));
      // Take the short way round the poles, retaining the app's north-up yaw/pitch turn.
      const to = { turn: { yaw: nearestYaw(from.turn.yaw, facing.yaw), pitch: facing.pitch }, framing: stop.framing ?? from.framing, sideOffset: stop.sideOffset ?? from.sideOffset };
      return go(from, to, stop.duration ?? 600);
    },
    // 3.37: back to the opening view, facing the way it opened however many times it was spun round.
    home(pose, duration = 600) {
      const from = current();
      return go(from, { ...pose, turn: { yaw: nearestYaw(from.turn.yaw, pose.turn.yaw), pitch: pose.turn.pitch } }, duration);
    },
    slide(to, duration = 600) {
      const from = current();
      return go(from, { ...to, turn: from.turn }, duration, true);
    },
    position(target) {
      const world = host.world(), camera = host.camera();
      world.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const found = findTarget(world, target);
      if (found === undefined) return undefined;
      const projected = found.point.clone().project(camera), { width, height } = host.size();
      const centre = world.getObjectByName("globe")?.getWorldPosition(new Vector3()) ?? new Vector3();
      const near = target.kind === "core" || found.point.clone().sub(centre).dot(camera.getWorldDirection(new Vector3())) <= 0;
      let marked = target.kind !== "story";
      if (!marked) found.object.traverseVisible(object => {
        const mesh = object as Mesh;
        if (mesh.geometry && [mesh.material].flat().some(material => material?.visible && material.opacity > 0)) marked = true;
      });
      return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2,
        visible: marked && isDrawn(found.object) && near && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1 };
    },
    // A slide cut short by a drag or the wheel still ends beside the panel; its zoom is left where the wheel takes it, so
    // the zoom on show is the wheel's from here, not a pose the guide wrote.
    cancel() {
      const cut = motion;
      motion = undefined;
      if (cut?.slide) { host.write({ ...current(), sideOffset: cut.to.sideOffset }); host.invalidate(); }
      written = undefined;
    },
    moving() {
      current();
      return motion !== undefined || written !== undefined;
    },
    notes() {
      const notes: string[] = [];
      host.world().traverse(object => { if (object.name.startsWith("knowledge-point:")) notes.push(object.name.slice("knowledge-point:".length)); });
      return notes;
    },
    // 3.51: the ground's own box, its eight corners projected, so a turned island is boxed as the camera sees it.
    islands() {
      const world = host.world(), camera = host.camera(), { width, height } = host.size();
      world.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const centre = world.getObjectByName("globe")?.getWorldPosition(new Vector3()) ?? new Vector3(), facing = camera.getWorldDirection(new Vector3());
      const boxes: IslandBox[] = [];
      world.traverse(object => {
        if (!object.name.startsWith("planet:") || object.name === "planet:shell" || !isDrawn(object)) return;
        const ground = object.getObjectByName("island-ground") as Mesh | undefined;
        if (ground?.geometry === undefined || object.getWorldPosition(new Vector3()).sub(centre).dot(facing) > 0) return;
        ground.geometry.computeBoundingBox();
        const { min, max } = ground.geometry.boundingBox ?? new Box3();
        const xs: number[] = [], ys: number[] = [];
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          const at = ground.localToWorld(new Vector3(x, y, z)).project(camera);
          xs.push((at.x + 1) * width / 2); ys.push((1 - at.y) * height / 2);
        }
        const left = Math.min(...xs), top = Math.min(...ys);
        boxes.push({ story: object.name.slice("planet:".length), x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top });
      });
      return boxes;
    },
    frame,
  };
}

function findTarget(world: Object3D, target: GlobeTarget): { object: Object3D; point: Vector3 } | undefined {
  const object = target.kind === "story" ? world.getObjectByName(`planet:${target.story}`)
    : target.kind === "capability" ? world.getObjectByName(`territory:${target.capability}`)
    : target.kind === "file" ? world.getObjectByName(`planet:${target.story}`)?.getObjectByName(`file:${target.path}`)
    : target.kind === "pathway" ? ownStretch(world, target.link)
    : target.kind === "note" ? world.getObjectByName(`knowledge-point:${target.note}`)
    : world.getObjectByName("globe-core");
  if (object === undefined) return undefined;
  const point = new Vector3();
  const geometry = (object as Mesh).geometry;
  if (target.kind === "capability" && geometry !== undefined) {
    geometry.computeBoundingBox(); geometry.boundingBox?.getCenter(point);
  }
  // A road's ribbon runs its length as pairs of points, one each side: the point is the middle of the pair that far along.
  const along = geometry?.getAttribute("position");
  if (target.kind === "pathway" && along !== undefined && along.count >= 2) {
    const pair = Math.round(Math.min(1, Math.max(0, target.along ?? .5)) * (Math.floor(along.count / 2) - 1)) * 2;
    point.set((along.getX(pair) + along.getX(pair + 1)) / 2, (along.getY(pair) + along.getY(pair + 1)) / 2, (along.getZ(pair) + along.getZ(pair + 1)) / 2);
  }
  return { object, point: object.localToWorld(point) };
}

/** The drawn stretch of road that carries `link` and the fewest other links: where roads merge, its own branch. */
function ownStretch(world: Object3D, link: string): Object3D | undefined {
  let found: Object3D | undefined;
  world.traverse(object => {
    const links = object.userData.links as readonly string[] | undefined;
    if (!object.name.startsWith("pathway:") || !links?.includes(link)) return;
    if (!found || links.length < (found.userData.links as readonly string[]).length) found = object;
  });
  return found;
}

/** Three's raycaster includes invisible objects; every picker must check their ancestors too. */
export function isDrawn(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}
