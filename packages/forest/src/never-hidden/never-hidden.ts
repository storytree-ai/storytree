import type { TreeForm } from "../capability-tree/capability-tree.js";

/** A direction from the globe's centre, in globe coordinates (+y is north). Need not be unit length. */
export interface GlobeDirection {
  x: number;
  y: number;
  z: number;
}

/** Only the island's identity, spot and tree forms are needed; no drawing engine is involved. */
export interface FacingIsland {
  story: string;
  spot: GlobeDirection;
  trees: readonly { form: TreeForm }[];
}

/**
 * Absolute globe-to-view rotation, in radians: turn about globe +y by yaw, then view +x by pitch.
 * The eye is on view +z, with +x right and +y up (Three's XYZ Euler: [pitch, yaw, 0]).
 */
export interface GlobeTurn {
  yaw: number;
  pitch: number;
}

export interface EdgeMarker {
  story: string;
  /** On the unit-circle rim: +x right, +y up. The page supplies centre and pixel radius. */
  at: { x: number; y: number };
  /** Absolute turn bringing this marker's island to the centre of the front face. */
  turn: GlobeTurn;
}

export function turnToIsland(spot: GlobeDirection): GlobeTurn {
  throw new Error("turnToIsland is not implemented");
}

export function openingTurn(islands: readonly FacingIsland[]): GlobeTurn {
  throw new Error("openingTurn is not implemented");
}

export function edgeMarkers(islands: readonly FacingIsland[], viewDirection: GlobeDirection): EdgeMarker[] {
  throw new Error("edgeMarkers is not implemented");
}
