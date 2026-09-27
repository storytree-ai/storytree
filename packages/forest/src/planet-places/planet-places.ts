export const PLANET_RADIUS = 390;
export const PLANET_CAPACITY = 128;

export interface PlanetPoint {
  x: number;
  y: number;
  z: number;
}

export function placeOnGlobe(_place: number): PlanetPoint {
  return { x: 0, y: 0, z: 0 };
}
