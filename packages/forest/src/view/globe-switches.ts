/** Capability 3 · Story node render. The globe's two switches, Stories and Library, each on or off by itself (ADR-1002 D1, D2). */
import type { ForestMode } from "./planet-navigation.js";
import { seesUnderside } from "./sheet-navigation.js";

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

/** The glass sheet's two resting views (ADR-1062 D3): Stories, from above its top, and Library, from below its underside,
 * where the notes hang. */
export type SheetFace = GlobeSwitch;

/** The face whose button is pressed with the eye at `tilt`: Library once the user has tilted it past level to below the
 * glass, Stories above it (ADR-1062 D3). */
export function faceAt(tilt: number): SheetFace {
  return seesUnderside(tilt) ? "library" : "stories";
}

/** A launch opens on the sheet's top face. */
export const LAUNCH_FACE: SheetFace = "stories";

/**
 * The face the sheet opens on (3.63): the user's factory holds no stories, only its system's roles, notes and checks, so it
 * opens turned over to the Library face where they hang, when the Surfaces menu offers it; everything else opens on Stories.
 */
export function openingFace({ factory, libraryOffered }: { factory: boolean; libraryOffered: boolean }): SheetFace {
  return factory && libraryOffered ? "library" : LAUNCH_FACE;
}

/**
 * What the forest page offers on the glass sheet for the face pressed: the two resting views replace the switches' four
 * combinations outright, so one button is pressed at a time. With the Surfaces menu's Library off (ADR-0750) there is no
 * underside to turn to, and only Stories is offered.
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
