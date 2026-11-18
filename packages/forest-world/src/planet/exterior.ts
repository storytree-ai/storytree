// Capability 4 · The planet

export interface PlanetSurfaceVisibility {
  grounds: boolean;
  roads: boolean;
}

export interface GlobeExterior extends PlanetSurfaceVisibility {
  plates: boolean;
}

export function globeExterior(surface: boolean, surfaces: Partial<PlanetSurfaceVisibility> | undefined): GlobeExterior {
  return {
    plates: surface,
    grounds: surface && surfaces?.grounds !== false,
    roads: surface && surfaces?.roads !== false,
  };
}
