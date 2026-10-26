/** Capability 3 · Story node render. The turn that brings a place on the big sphere, the glass sheet its near pole, to the middle of the view. */
import type { CapabilityWord } from "@storytree/forest-world/scene";

/** A finite, nonzero direction from the globe's centre (+y is north). Need not be unit length. */
export interface GlobeDirection {
  x: number;
  y: number;
  z: number;
}

/** Only the island's identity, spot and its capabilities' words are needed; no drawing engine is involved. */
export interface FacingIsland {
  story: string;
  spot: GlobeDirection;
  /** Its capabilities' words: storytree's verified word, never the agent's report (ADR-0825 D3). */
  trees: readonly { status?: CapabilityWord }[];
}

/**
 * Absolute globe-to-view rotation, in radians: turn about globe +y by yaw, then view +x by pitch.
 * The eye is on view +z, with +x right and +y up (Three's XYZ Euler: [pitch, yaw, 0]).
 */
export interface GlobeTurn {
  yaw: number;
  pitch: number;
}

/** Bring `spot` to view +z, keeping north upward. At a pole, use the zero meridian. */
export function turnToIsland(spot: GlobeDirection): GlobeTurn {
  const horizontal = Math.hypot(spot.x, spot.z);
  return { yaw: horizontal === 0 ? 0 : -Math.atan2(spot.x, spot.z), pitch: Math.atan2(spot.y, horizontal) };
}
