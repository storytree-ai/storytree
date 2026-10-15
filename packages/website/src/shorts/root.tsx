/** Capability 6 · Pixel-art shorts. Every short, as a Remotion composition: 1920×1080 at 30 frames a second. Remotion's
 * entry point: bundling this file registers them for a render to name. */
import { Composition, registerRoot } from "remotion";
import { LENGTH } from "./script.js";
import { SeeingWhatAgentsBuilt } from "./short.js";

/** The first short's composition id, its frame rate and its length in frames. */
export const FIRST_SHORT = { id: "seeing-what-agents-built", fps: 30, frames: LENGTH * 30 } as const;

export function Shorts() {
  return <Composition id={FIRST_SHORT.id} component={SeeingWhatAgentsBuilt} durationInFrames={FIRST_SHORT.frames} fps={FIRST_SHORT.fps} width={1920} height={1080} />;
}

registerRoot(Shorts);
