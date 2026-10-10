/** Capability 6 · The planet. */
import type { OrthographicCamera } from 'three';

/** The elevation the islands' light and tilt were signed at: the owner's 50° (ADR-0517 D2). */
export const SHIPPED_ELEVATION_DEG: number = 50;

/** The viewport the globe is framed into, CSS px. */
export interface FramingViewport {
  readonly width: number;
  readonly height: number;
}

/** The orthographic `zoom` that frames `halfHeight` world units of a viewport whose shorter side is
 *  `shortSideCssPx` CSS pixels: R3F divides its CSS-pixel frustum by `zoom`, so `zoom` is the CSS px
 *  per world unit, and the shorter side binds. */
export function orthographicZoomFor(halfHeight: number, shortSideCssPx: number): number {
  return Math.max(shortSideCssPx, 1) / (2 * Math.max(halfHeight, Number.EPSILON));
}

/** The globe's framing is the number of radii covered by half the viewport's shorter side. */
export function applyPlanetFraming(camera: OrthographicCamera, radius: number, framing: number, size: FramingViewport): void {
  camera.zoom = orthographicZoomFor(radius * framing, Math.min(size.width, size.height));
  camera.updateProjectionMatrix();
}

/** 6.18 (ADR-0977): the least zoom the wheel may reach, where the globe is half the size `framing` gives it.
 *  The wheel alone is held to it; a host's own framing sets the zoom directly. */
export function wheelFloor(radius: number, framing: number, size: FramingViewport): number {
  return orthographicZoomFor(radius * framing, Math.min(size.width, size.height)) / 2;
}

/** A positive offset moves the globe right in CSS pixels without moving or turning the eye. */
export function applyPlanetSideOffset(camera: OrthographicCamera, size: FramingViewport, sideOffset: number): void {
  const width = Math.max(size.width, 1), height = Math.max(size.height, 1);
  camera.setViewOffset(width, height, -sideOffset, 0, width, height);
}
