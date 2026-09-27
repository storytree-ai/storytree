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

export function lookInside(state: CoreViewState): CoreViewState {
  return state;
}

export function returnToGlobe(state: CoreViewState): CoreViewState {
  return state;
}

export function toForest(state: CoreViewState): CoreViewState {
  return state;
}

export function shown(_state: CoreViewState): Shown {
  return { sea: false, islands: false, entrances: false, failureMarkers: false, forestButton: false, globeButton: false };
}
