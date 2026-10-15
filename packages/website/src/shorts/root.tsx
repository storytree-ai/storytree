/** Capability 6 · Pixel-art shorts. Every short, as a Remotion composition: 1920×1080 at 30 frames a second. */
import { Composition } from "remotion";
import { PipelineSpike } from "./spike.js";

/** The spike's composition id, its frame rate and its length in frames (five seconds). */
export const SPIKE = { id: "pipeline-spike", fps: 30, frames: 150 } as const;

export function Shorts() {
  return <Composition id={SPIKE.id} component={PipelineSpike} durationInFrames={SPIKE.frames} fps={SPIKE.fps} width={1920} height={1080} />;
}
