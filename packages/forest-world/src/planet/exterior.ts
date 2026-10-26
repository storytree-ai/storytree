// Capability 4 · The planet. The drawing engine 4.7: which of the map's exterior layers it draws for the host's switches. Kept apart from
// PlanetWorldCanvas.tsx so it is provable without a GPU (exterior.test.ts).

/** Exterior surfaces owned by the engine. The host owns the marks placed on each island. */
export interface PlanetSurfaceVisibility {
  grounds: boolean;
  roads: boolean;
}

/** What the map draws: `plates` mounts each island with its host children; `grounds` is its bare surface. */
export interface GlobeExterior extends PlanetSurfaceVisibility {
  plates: boolean;
}

/** Each switch defaults on; `surface` false hides the whole exterior, leaving the inside to be seen. */
export function globeExterior(surface: boolean, surfaces: Partial<PlanetSurfaceVisibility> | undefined): GlobeExterior {
  return {
    plates: surface,
    grounds: surface && surfaces?.grounds !== false,
    roads: surface && surfaces?.roads !== false,
  };
}
