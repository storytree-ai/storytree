import type { Camera, Object3D } from "three";
import type { GlobeTurn } from "@storytree/forest";
export type GlobeTarget = { kind: "story"; story: string } | { kind: "capability"; capability: string } | { kind: "file"; story: string; path: string } | { kind: "core" };
export type GlobePose = { turn: GlobeTurn; framing: number; sideOffset: number };
export type CameraStop = { target: GlobeTarget; framing?: number; sideOffset?: number; duration?: number };
export type ScreenPosition = { x: number; y: number; visible: boolean };
export type GlobeControls = { stop(stop: CameraStop): boolean; position(target: GlobeTarget): ScreenPosition | undefined; cancel(): void };
export function createGlobeGuide(host: { world(): Object3D; camera(): Camera; size(): { width: number; height: number }; read(): GlobePose; write(pose: GlobePose): void; invalidate(): void }): GlobeControls & { frame(milliseconds: number): boolean } {
  throw new Error("Guided camera stops are not implemented");
}
