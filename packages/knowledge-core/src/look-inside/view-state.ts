/** Capability 4's founding book (E1): "Look inside" is a deliberate view, and the globe comes back as it was. */

export interface CoreViewState {
  mode: "globe" | "inside" | "forest";
  /** The selected story, kept across every view. */
  selected: string | undefined;
  /** The note pinned inside the core. */
  pinned: string | undefined;
}

/** What a view shows. */
export interface Shown {
  sea: boolean;
  islands: boolean;
  entrances: boolean;
  failureMarkers: boolean;
  forestButton: boolean;
  globeButton: boolean;
}

/** Open the core from the globe or the forest, keeping the selection. */
export function lookInside(state: CoreViewState): CoreViewState {
  return { ...state, mode: "inside" };
}

/** Back to the globe: its islands and sea return, the selection stays, and the pin is let go. */
export function returnToGlobe(state: CoreViewState): CoreViewState {
  return { mode: "globe", selected: state.selected, pinned: undefined };
}

/** The flat forest, one click from any view. */
export function toForest(state: CoreViewState): CoreViewState {
  return { mode: "forest", selected: state.selected, pinned: undefined };
}

/**
 * What each view shows. Looking inside hides the sea and island surfaces and shows the shelf
 * entrances, and keeps the failure attention: opening the core cannot hide a failing story.
 */
export function shown(state: CoreViewState): Shown {
  const inside = state.mode === "inside";
  return {
    sea: state.mode === "globe",
    islands: state.mode !== "inside",
    entrances: inside,
    failureMarkers: state.mode !== "forest",
    forestButton: true,
    globeButton: true,
  };
}
