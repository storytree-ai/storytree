/** Capability 6 · Pixel-art shorts. The cast's sprite sheet and its frame map (public/sprites, drawn by
 * the first short's assemble-cast.mjs): every pose of the developer as frames, and every prop, as rectangles of one picture;
 * and the holes in the room a prop leaves (its screen), in the room's own pixels. */
import type { Pose, Prop } from "./script.js";

export type Rect = { x: number; y: number; w: number; h: number };
export type CastMap = {
  image: string; width: number; height: number;
  /** A pose that plays `once` holds its last frame; from frame `chairApart` on, the pose is drawn without the chair, which the
   * scene draws apart. */
  poses: Record<string, { fps: number; frames: Rect[]; once?: boolean; chairApart?: number }>;
  props: Record<string, Rect>;
  holes: Record<string, Rect>;
};

/** Which of `pose`'s frames shows at `seconds` into its beat: the pose loops at its own frame rate, or plays once and holds. */
export function poseIndex(cast: CastMap, pose: Pose, seconds: number): number {
  const { fps, frames, once } = cast.poses[pose] ?? { fps: 1, frames: [] };
  const step = Math.floor(Math.max(0, seconds) * fps);
  return once ? Math.min(step, frames.length - 1) : step % Math.max(1, frames.length);
}

/** The frame of `pose` showing at `seconds` into its beat. */
export function poseFrame(cast: CastMap, pose: Pose, seconds: number): Rect {
  const frame = cast.poses[pose]?.frames[poseIndex(cast, pose, seconds)];
  if (frame === undefined) throw new Error(`The cast has no frame for the pose "${pose}"`);
  return frame;
}

export function propFrame(cast: CastMap, prop: Prop): Rect {
  const frame = cast.props[prop];
  if (frame === undefined) throw new Error(`The cast has no prop "${prop}"`);
  return frame;
}

/** Every pose or prop among `names` the map cannot draw: missing, frameless, or reaching past the sheet's edge. */
export function unresolved(cast: CastMap, names: { poses: readonly string[]; props: readonly string[] }): string[] {
  const inside = ({ x, y, w, h }: Rect) => w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= cast.width && y + h <= cast.height;
  return [
    ...names.poses.filter(pose => !(cast.poses[pose]?.frames.length && cast.poses[pose]!.frames.every(inside))).map(pose => `pose ${pose}`),
    ...names.props.filter(prop => !(cast.props[prop] && inside(cast.props[prop]!))).map(prop => `prop ${prop}`),
  ];
}
