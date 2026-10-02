import type { OrthographicCamera } from 'three';
import { orthographicZoomFor, type FramingViewport } from '../camera-framing.js';

/** The globe's framing is the number of radii covered by half the viewport's shorter side. */
export function applyPlanetFraming(camera: OrthographicCamera, radius: number, framing: number, size: FramingViewport): void {
  camera.zoom = orthographicZoomFor(radius * framing, Math.min(size.width, size.height));
  camera.updateProjectionMatrix();
}

/** A positive offset moves the globe right in CSS pixels without moving or turning the eye. */
export function applyPlanetSideOffset(camera: OrthographicCamera, size: FramingViewport, sideOffset: number): void {
  const width = Math.max(size.width, 1), height = Math.max(size.height, 1);
  camera.setViewOffset(width, height, -sideOffset, 0, width, height);
}
