// Capability 3 · Story node render
import { Box3, Vector3, type Camera, type Mesh, type Object3D } from "three";
import { turnToIsland, type GlobeTurn } from "@storytree/forest";
export type GlobeTarget = { kind: "story"; story: string } | { kind: "capability"; capability: string } | { kind: "note"; note: string } | { kind: "point"; at: readonly [number, number, number] } | { kind: "core" };
export type GlobePose = { turn: GlobeTurn; framing: number; sideOffset: number };
export type CameraStop = { target: GlobeTarget; framing?: number; sideOffset?: number; duration?: number };
export type ScreenPosition = { x: number; y: number; visible: boolean };
export type IslandBox = { story: string; x: number; y: number; width: number; height: number };
export type GlobeControls = { stop(stop: CameraStop): boolean; position(target: GlobeTarget): ScreenPosition | undefined;
  positions(targets: readonly GlobeTarget[]): (ScreenPosition | undefined)[]; cancel(): void; moving(): boolean; notes(): string[]; islands(): IslandBox[] };
export type PlacedGlobeControls = GlobeControls & { aside(): number };
const nearestYaw = (from: number, to: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function createGlobeGuide(host: { world(): Object3D; camera(): Camera; size(): { width: number; height: number }; read(): GlobePose; write(pose: GlobePose): void; invalidate(): void;
  opening(framing?: number): GlobePose }): GlobeControls & { frame(milliseconds: number): boolean; home(pose: GlobePose, duration?: number): boolean; slide(to: Omit<GlobePose, "turn">, duration?: number): boolean;
    heading(): GlobePose;
    reframe(): boolean } {
  let motion: { from: GlobePose; to: GlobePose; elapsed: number; duration: number; slide?: boolean } | undefined;
  let written: GlobePose | undefined;
  let whole: CameraStop | undefined;
  const toWhole = (stop: CameraStop): boolean => {
    const from = current(), opening = host.opening(stop.framing);
    return go(from, { turn: { yaw: nearestYaw(from.turn.yaw, opening.turn.yaw), pitch: opening.turn.pitch }, framing: opening.framing, sideOffset: stop.sideOffset ?? from.sideOffset }, stop.duration ?? 600);
  };
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
  function positions(targets: readonly GlobeTarget[]): (ScreenPosition | undefined)[] {
    const world = host.world(), camera = host.camera();
    world.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const named = new Map<string, Object3D>();
    world.traverse(object => { if (object.name !== "" && !named.has(object.name)) named.set(object.name, object); });
    const { width, height } = host.size(), sheet = named.has("sheet:glass");
    const centre = named.get("globe")?.getWorldPosition(new Vector3()) ?? new Vector3(), facing = camera.getWorldDirection(new Vector3());
    return targets.map(target => {
      const found = findTarget(world, target, name => named.get(name));
      if (found === undefined) return undefined;
      const projected = found.point.clone().project(camera);
      const near = target.kind === "core" || sheet || underTheGlass(found.object) || found.point.clone().sub(centre).dot(facing) <= 0;
      let marked = target.kind !== "story";
      if (!marked) found.object.traverseVisible(object => {
        const mesh = object as Mesh;
        if (mesh.geometry && [mesh.material].flat().some(material => material?.visible && material.opacity > 0)) marked = true;
      });
      return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2,
        visible: marked && isDrawn(found.object) && near && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1 };
    });
  }
  return {
    stop(stop) {
      const world = host.world(); world.updateMatrixWorld(true);
      whole = undefined;
      if (stop.target.kind === "core" && onTheSheet(world)) {
        if (!toWhole(stop)) return false;
        whole = stop;
        return true;
      }
      const target = findTarget(world, stop.target), globe = world.getObjectByName("globe");
      if (target === undefined || globe === undefined) return false;
      const from = current();
      const facing = stop.target.kind === "core" ? from.turn : turnToIsland(globe.worldToLocal(target.point.clone()));
      const to = { turn: { yaw: nearestYaw(from.turn.yaw, facing.yaw), pitch: facing.pitch }, framing: stop.framing ?? from.framing, sideOffset: stop.sideOffset ?? from.sideOffset };
      return go(from, to, stop.duration ?? 600);
    },
    home(pose, duration = 600) {
      whole = undefined;
      const from = current();
      return go(from, { ...pose, turn: { yaw: nearestYaw(from.turn.yaw, pose.turn.yaw), pitch: pose.turn.pitch } }, duration);
    },
    slide(to, duration = 600) {
      const from = current();
      return go(from, { ...to, turn: from.turn }, duration, true);
    },
    heading() {
      const now = current();
      return motion === undefined ? now : { ...now, framing: motion.to.framing, sideOffset: motion.to.sideOffset };
    },
    position: target => positions([target])[0],
    positions,
    cancel() {
      whole = undefined;
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
    islands() {
      const world = host.world(), camera = host.camera(), { width, height } = host.size();
      world.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      const centre = world.getObjectByName("globe")?.getWorldPosition(new Vector3()) ?? new Vector3(), facing = camera.getWorldDirection(new Vector3());
      const sheet = onTheSheet(world);
      const boxes: IslandBox[] = [];
      world.traverse(object => {
        if (!object.name.startsWith("planet:") || object.name === "planet:shell" || !isDrawn(object)) return;
        const ground = object.getObjectByName("island-ground") as Mesh | undefined;
        if (ground?.geometry === undefined || (!sheet && object.getWorldPosition(new Vector3()).sub(centre).dot(facing) > 0)) return;
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
    reframe: () => whole !== undefined && toWhole(whole),
    frame,
  };
}

function findTarget(world: Object3D, target: GlobeTarget, byName = (name: string) => world.getObjectByName(name)): { object: Object3D; point: Vector3 } | undefined {
  if (target.kind === "point") return target.at.every(Number.isFinite) ? { object: world, point: new Vector3(...target.at) } : undefined;
  const object = target.kind === "story" ? byName(`planet:${target.story}`)
    : target.kind === "capability" ? byName(`territory:${target.capability}`)
    : target.kind === "note" ? byName(`knowledge-point:${target.note}`)
    : byName("globe-core");
  if (object === undefined) return undefined;
  const point = new Vector3();
  const geometry = (object as Mesh).geometry;
  if (target.kind === "capability" && geometry !== undefined) {
    geometry.computeBoundingBox(); geometry.boundingBox?.getCenter(point);
  }
  return { object, point: object.localToWorld(point) };
}

function underTheGlass(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (at.name === "sheet:under") return true;
  return false;
}

export function isDrawn(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}

function onTheSheet(world: Object3D): boolean {
  return world.getObjectByName("sheet:glass") !== undefined;
}
