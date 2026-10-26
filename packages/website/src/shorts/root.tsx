/** Capability 6 · Pixel-art shorts. Every short, as a Remotion composition: 1920×1080 at 30 frames a second. Remotion's
 * entry point: bundling this file registers them for a render to name. */
import { Composition, registerRoot } from "remotion";
import { LENGTH as MEMORY_LENGTH } from "./memory.js";
import { MEMORY } from "./memory-scene.js";
import { LENGTH as ONE_MAP_LENGTH } from "./one-map.js";
import { ONE_MAP } from "./one-map-scene.js";
import { LENGTH } from "./script.js";
import { MapShortFrame, SeeingWhatAgentsBuilt } from "./short.js";

/** The first short's composition id, its frame rate and its length in frames. */
export const FIRST_SHORT = { id: "seeing-what-agents-built", fps: 30, frames: LENGTH * 30 } as const;
/** The second short's, claim 2's. */
export const SECOND_SHORT = { id: "one-map-for-you-and-your-agents", fps: 30, frames: ONE_MAP_LENGTH * 30 } as const;
/** The third short's, claim 3's. */
export const THIRD_SHORT = { id: "memory-that-lives-where-your-code-lives", fps: 30, frames: MEMORY_LENGTH * 30 } as const;

const OneMap = ({ lateBy = 0 }: { lateBy?: number }) => <MapShortFrame short={ONE_MAP} lateBy={lateBy} />;
const Memory = ({ lateBy = 0 }: { lateBy?: number }) => <MapShortFrame short={MEMORY} lateBy={lateBy} />;

export function Shorts() {
  return <>
    <Composition id={FIRST_SHORT.id} component={SeeingWhatAgentsBuilt} durationInFrames={FIRST_SHORT.frames} fps={FIRST_SHORT.fps} width={1920} height={1080} />
    <Composition id={SECOND_SHORT.id} component={OneMap} durationInFrames={SECOND_SHORT.frames} fps={SECOND_SHORT.fps} width={1920} height={1080} />
    <Composition id={THIRD_SHORT.id} component={Memory} durationInFrames={THIRD_SHORT.frames} fps={THIRD_SHORT.fps} width={1920} height={1080} />
  </>;
}

registerRoot(Shorts);
