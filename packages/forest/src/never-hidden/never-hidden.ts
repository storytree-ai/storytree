/** Capability 3 · Story node render. Capability 3's planet book: face failures on opening and keep hidden ones reachable at the rim. */
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

export interface EdgeMarker {
  story: string;
  /** On the unit-circle rim: +x right, +y up. The page supplies centre and pixel radius. */
  at: { x: number; y: number };
  /** Absolute turn bringing this marker's island to the centre of the front face. */
  turn: GlobeTurn;
}

/** Bring `spot` to view +z, keeping north upward. At a pole, use the zero meridian. */
export function turnToIsland(spot: GlobeDirection): GlobeTurn {
  const horizontal = Math.hypot(spot.x, spot.z);
  return { yaw: horizontal === 0 ? 0 : -Math.atan2(spot.x, spot.z), pitch: Math.atan2(spot.y, horizontal) };
}

/**
 * Face the first failing island in input order; with none failing, the islands' middle (the mean of their
 * directions), so a chain of rows opens centred rather than from its bottom story, or the first story where
 * the islands ring the globe and have no middle. An empty globe stays neutral.
 */
export function openingTurn(islands: readonly FacingIsland[]): GlobeTurn {
  const failing = islands.find(isFailing);
  if (failing !== undefined) return turnToIsland(failing.spot);
  if (islands.length === 0) return { yaw: 0, pitch: 0 };
  const middle = islands.reduce((sum, { spot }) => {
    const length = Math.hypot(spot.x, spot.y, spot.z);
    return { x: sum.x + spot.x / length, y: sum.y + spot.y / length, z: sum.z + spot.z / length };
  }, { x: 0, y: 0, z: 0 });
  // Islands spread all round have a middle near the globe's centre, which points nowhere in particular.
  return turnToIsland(Math.hypot(middle.x, middle.y, middle.z) > 0.25 * islands.length ? middle : islands[0]!.spot);
}

/**
 * One marker per failing island on or behind the horizon. `viewDirection` points FROM the globe
 * centre TO the eye in globe coordinates, with the north-up view defined by turnToIsland(viewDirection).
 * Project each hidden spot into that view and extend its bearing to the unit rim. Directly behind
 * the centre has no bearing, so its marker sits at the top. The page flips y for CSS coordinates.
 */
export function edgeMarkers(islands: readonly FacingIsland[], viewDirection: GlobeDirection): EdgeMarker[] {
  const { yaw, pitch } = turnToIsland(viewDirection);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return islands.filter(isFailing).flatMap(({ story, spot }) => {
    const turnedZ = -spot.x * sy + spot.z * cy;
    const x = spot.x * cy + spot.z * sy;
    const y = spot.y * cp - turnedZ * sp;
    const depth = spot.y * sp + turnedZ * cp;
    // Trig roundoff must not hide an edge-on island or give a directly-behind one a random bearing.
    const tolerance = 1e-12 * Math.hypot(spot.x, spot.y, spot.z);
    if (depth > tolerance) return [];
    const reach = Math.hypot(x, y);
    const at = reach <= tolerance ? { x: 0, y: 1 } : { x: x / reach, y: y / reach };
    return [{ story, at, turn: turnToIsland(spot) }];
  });
}

/** One capability storytree verified unhealthy makes the island failing (ADR-0825 D3). */
function isFailing(island: FacingIsland): boolean {
  return island.trees.some(({ status }) => status === "unhealthy");
}
