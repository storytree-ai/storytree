/** Capability 1 · Knowledge under its shelves. Capability 1's drawing coordinates, shared by the sheet and the inspection view. */
export interface Point { x: number; y: number; z: number }
export interface GlobePoint {
  id: string;
  at: Point;
  depth: number | undefined;
  home: string | undefined;
  /** Under the glass sheet, the shelves pulling it, strongest first (ADR-1063 D1). */
  toward?: string[];
}

export const length = (p: Point) => Math.hypot(p.x, p.y, p.z);
export const scale = (p: Point, by: number): Point => ({ x: p.x * by, y: p.y * by, z: p.z * by });
export const unit = (p: Point): Point => scale(p, 1 / length(p));
