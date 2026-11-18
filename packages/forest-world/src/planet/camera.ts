// Capability 4 · The planet
import type { OrthographicCamera, PerspectiveCamera } from 'three';

export const SHIPPED_ELEVATION_DEG: number = 50;

export interface FramingViewport {
  readonly width: number;
  readonly height: number;
}

export function orthographicZoomFor(halfHeight: number, shortSideCssPx: number): number {
  return Math.max(shortSideCssPx, 1) / (2 * Math.max(halfHeight, Number.EPSILON));
}

export function wheelFloor(radius: number, framing: number, size: FramingViewport): number {
  return orthographicZoomFor(radius * framing, Math.min(size.width, size.height)) / 2;
}

export function applyPlanetSideOffset(camera: OrthographicCamera | PerspectiveCamera, size: FramingViewport, sideOffset: number): void {
  const width = Math.max(size.width, 1), height = Math.max(size.height, 1);
  camera.setViewOffset(width, height, -sideOffset, 0, width, height);
}
