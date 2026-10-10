/** Capability 3 · Story node render. The mini globe in the corner: where the land is, where the poles are, and which face is on show (ADR-0977). */
import { Euler, Quaternion, Vector3 } from "three";
import type { FacingIsland, GlobeTurn } from "@storytree/forest";
import { TILT_LIMIT } from "./planet-navigation.js";

/** A point on the mini globe: x right and y up, in globe radii from its centre; `front` when it faces the viewer. */
export type MiniPoint = { x: number; y: number; front: boolean };

export type MiniGlobe = { islands: (MiniPoint & { story: string })[]; north: MiniPoint; south: MiniPoint; equator: MiniPoint[]; facing: MiniPoint };

/**
 * The globe drawn as it stands at `home` (its opening view), so it never moves: each island where it lies,
 * both poles, and the point of the globe facing the viewer at `turn`, which sits at its centre when the globe is home.
 */
export function miniGlobe(islands: readonly FacingIsland[], home: GlobeTurn, turn: GlobeTurn): MiniGlobe {
  const atHome = turned(home);
  const shown = (local: Vector3): MiniPoint => {
    const at = local.clone().normalize().applyQuaternion(atHome);
    return { x: at.x, y: at.y, front: at.z >= -1e-9 };
  };
  return {
    islands: islands.map(({ story, spot }) => ({ story, ...shown(new Vector3(spot.x, spot.y, spot.z)) })),
    north: shown(new Vector3(0, 1, 0)),
    south: shown(new Vector3(0, -1, 0)),
    equator: Array.from({ length: 49 }, (_, i) => shown(new Vector3(Math.sin(i * Math.PI / 24), 0, Math.cos(i * Math.PI / 24)))),
    // The globe turned by `turn` shows the eye the point it carries to +z; undoing the turn finds it.
    // Held to the tilt stop, as the globe itself is (focusRotation).
    facing: shown(new Vector3(0, 0, 1).applyQuaternion(turned({ yaw: turn.yaw, pitch: Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, turn.pitch)) }).invert())),
  };
}

function turned(turn: GlobeTurn): Quaternion {
  return new Quaternion().setFromEuler(new Euler(turn.pitch, turn.yaw, 0));
}

/** The Home key returns the globe to its opening view, unless it is typed into a field; nothing else does (no double-click). */
export function asksForHome(event: { type: string; key?: string; target?: unknown }): boolean {
  if (event.type !== "keydown" || event.key !== "Home") return false;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  return !(target?.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? ""));
}
