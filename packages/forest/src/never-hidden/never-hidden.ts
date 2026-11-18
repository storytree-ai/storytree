// Capability 3 · Story node render
import type { CapabilityWord } from "@storytree/forest-world/scene";

export interface GlobeDirection {
  x: number;
  y: number;
  z: number;
}

export interface FacingIsland {
  story: string;
  spot: GlobeDirection;
  trees: readonly { status?: CapabilityWord }[];
}

export interface GlobeTurn {
  yaw: number;
  pitch: number;
}

export function turnToIsland(spot: GlobeDirection): GlobeTurn {
  const horizontal = Math.hypot(spot.x, spot.z);
  return { yaw: horizontal === 0 ? 0 : -Math.atan2(spot.x, spot.z), pitch: Math.atan2(spot.y, horizontal) };
}
