/** Capability 3 · Story node render. The globe's two switches, Stories and Library, each on or off by itself (ADR-1002 D1, D2). */
import type { ForestMode } from "./planet-navigation.js";

export type GlobeSwitch = "stories" | "library";
export type GlobeSwitches = Record<GlobeSwitch, boolean>;

/** A launch opens with Stories on and Library off: the islands on a solid globe, the core one press away. */
export const LAUNCH_SWITCHES: GlobeSwitches = { stories: true, library: false };

export function flipSwitch(switches: GlobeSwitches, which: GlobeSwitch): GlobeSwitches {
  return { ...switches, [which]: !switches[which] };
}

/**
 * What the globe draws for its switches, given whether the Surfaces menu offers the Library (ADR-0750): Stories off
 * is the islands hidden (`mode` "library"), Library off a solid globe, and both off nothing at all.
 */
export function globeLayers(switches: GlobeSwitches, libraryOffered: boolean): { mode: ForestMode; library: boolean; shown: boolean; offered: GlobeSwitch[] } {
  const library = libraryOffered && switches.library;
  return {
    mode: switches.stories ? "forest" : "library",
    library,
    shown: switches.stories || library,
    offered: libraryOffered ? ["stories", "library"] : ["stories"],
  };
}

/** The glass sheet's two looks (ADR-1062 D3): Stories, smoked glass and solid islands, and Library, clear glass and outlined
 * islands over the notes. Only its button sets one; the angle the user tilts the sheet to never does. */
export type SheetFace = GlobeSwitch;

/** Every project, the user's factory included, opens on the sheet's top face (owner, 2026-10-21: "it should start with stories"). */
export const LAUNCH_FACE: SheetFace = "stories";

/**
 * What the forest page offers on the glass sheet for the face pressed: the two looks replace the switches' four combinations
 * outright, so one button is pressed at a time. With the Surfaces menu's Library off (ADR-0750) nothing hangs beneath to
 * show, and only Stories is offered.
 */
export function sheetFaces(face: SheetFace, libraryOffered: boolean): { mode: ForestMode; library: boolean; pressed: GlobeSwitches; offered: GlobeSwitch[] } {
  const under = libraryOffered && face === "library";
  return {
    mode: under ? "library" : "forest",
    library: libraryOffered,
    pressed: { stories: !under, library: under },
    offered: libraryOffered ? ["stories", "library"] : ["stories"],
  };
}
