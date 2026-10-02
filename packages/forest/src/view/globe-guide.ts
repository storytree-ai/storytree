import { Vector3, type Camera, type Mesh, type Object3D } from "three";
import { turnToIsland, type GlobeTurn } from "@storytree/forest";
export type GlobeTarget = { kind: "story"; story: string } | { kind: "capability"; capability: string } | { kind: "file"; story: string; path: string } | { kind: "core" };
export type GlobePose = { turn: GlobeTurn; framing: number; sideOffset: number };
/** Framing is the short half-side in globe radii; offset is CSS pixels right; duration is milliseconds. */
export type CameraStop = { target: GlobeTarget; framing?: number; sideOffset?: number; duration?: number };
export type ScreenPosition = { x: number; y: number; visible: boolean };
export type GlobeControls = { stop(stop: CameraStop): boolean; position(target: GlobeTarget): ScreenPosition | undefined; cancel(): void };
export function createGlobeGuide(host: { world(): Object3D; camera(): Camera; size(): { width: number; height: number }; read(): GlobePose; write(pose: GlobePose): void; invalidate(): void }): GlobeControls & { frame(milliseconds: number): boolean } {
  let motion: { from: GlobePose; to: GlobePose; elapsed: number; duration: number } | undefined;
  function frame(milliseconds: number): boolean {
    if (motion === undefined) return false;
    motion.elapsed += Math.max(0, milliseconds);
    const progress = Math.min(1, motion.elapsed / motion.duration);
    const eased = progress * progress * (3 - 2 * progress);
    const mix = (from: number, to: number) => progress === 1 ? to : from + (to - from) * eased;
    const { from, to } = motion;
    host.write({ turn: { yaw: mix(from.turn.yaw, to.turn.yaw), pitch: mix(from.turn.pitch, to.turn.pitch) },
      framing: mix(from.framing, to.framing), sideOffset: mix(from.sideOffset, to.sideOffset) });
    if (progress === 1) motion = undefined;
    host.invalidate();
    return motion !== undefined;
  }
  return {
    stop(stop) {
      const world = host.world(); world.updateMatrixWorld(true);
      const target = findTarget(world, stop.target), globe = world.getObjectByName("globe");
      if (target === undefined || globe === undefined) return false;
      const from = host.read();
      const facing = stop.target.kind === "core" ? from.turn : turnToIsland(globe.worldToLocal(target.point.clone()));
      // Take the short way round the poles, retaining the app's north-up yaw/pitch turn.
      const yaw = from.turn.yaw + Math.atan2(Math.sin(facing.yaw - from.turn.yaw), Math.cos(facing.yaw - from.turn.yaw));
      const to = { turn: { yaw, pitch: facing.pitch }, framing: stop.framing ?? from.framing, sideOffset: stop.sideOffset ?? from.sideOffset };
      const duration = stop.duration ?? 600;
      if (!Number.isFinite(to.framing) || to.framing <= 0 || !Number.isFinite(to.sideOffset) || !Number.isFinite(duration) || duration < 0) return false;
      motion = undefined;
      if (duration === 0) host.write(to);
      else motion = { from, to, duration, elapsed: 0 };
      host.invalidate();
      return true;
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
    cancel() { motion = undefined; },
    frame,
  };
}

function findTarget(world: Object3D, target: GlobeTarget): { object: Object3D; point: Vector3 } | undefined {
  const object = target.kind === "story" ? world.getObjectByName(`planet:${target.story}`)
    : target.kind === "capability" ? world.getObjectByName(`territory:${target.capability}`)
    : target.kind === "file" ? world.getObjectByName(`planet:${target.story}`)?.getObjectByName(`file:${target.path}`)
    : world.getObjectByName("globe-core");
  if (object === undefined) return undefined;
  const point = new Vector3();
  const geometry = (object as Mesh).geometry;
  if (target.kind === "capability" && geometry !== undefined) {
    geometry.computeBoundingBox(); geometry.boundingBox?.getCenter(point);
  }
  return { object, point: object.localToWorld(point) };
}

/** Three's raycaster includes invisible objects; every picker must check their ancestors too. */
export function isDrawn(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}
