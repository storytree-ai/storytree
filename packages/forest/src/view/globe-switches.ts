// Capability 3 · Story node render
import type { ForestMode } from "./planet-navigation.js";

export type GlobeSwitch = "stories" | "library";
export type GlobeSwitches = Record<GlobeSwitch, boolean>;

export const LAUNCH_SWITCHES: GlobeSwitches = { stories: true, library: false };

export function flipSwitch(switches: GlobeSwitches, which: GlobeSwitch): GlobeSwitches {
  return { ...switches, [which]: !switches[which] };
}

export function globeLayers(switches: GlobeSwitches, libraryOffered: boolean): { mode: ForestMode; library: boolean; shown: boolean; offered: GlobeSwitch[] } {
  const library = libraryOffered && switches.library;
  return {
    mode: switches.stories ? "forest" : "library",
    library,
    shown: switches.stories || library,
    offered: libraryOffered ? ["stories", "library"] : ["stories"],
  };
}

export type SheetFace = GlobeSwitch;

export const LAUNCH_FACE: SheetFace = "stories";

export function sheetFaces(face: SheetFace, libraryOffered: boolean): { mode: ForestMode; library: boolean; pressed: GlobeSwitches; offered: GlobeSwitch[] } {
  const under = libraryOffered && face === "library";
  return {
    mode: under ? "library" : "forest",
    library: under,
    pressed: { stories: !under, library: under },
    offered: libraryOffered ? ["stories", "library"] : ["stories"],
  };
}
