/** The Surfaces menu's bridge to the main process (ADR-0750). Data only: safe for the page and preload. */
import type { SurfaceReading } from "./switches.js";

export type SurfacesResult = { readonly ok: true; readonly value: readonly SurfaceReading[] } | { readonly ok: false; readonly error: string };

export interface SurfacesBridge {
  readSurfaces(): Promise<SurfacesResult>;
  /** Save a change given as words: `<surface> on|off`, or `<surface> <setting> <choice>`. */
  saveSurface(words: readonly string[]): Promise<SurfacesResult>;
}

export const SURFACES_CHANNELS = {
  readSurfaces: "storytree:read-surfaces",
  saveSurface: "storytree:save-surface",
} as const;

/** Whether surface `id` is on in `readings`; one the list does not name is on. */
export function surfaceOn(readings: readonly SurfaceReading[], id: string): boolean {
  return readings.find((surface) => surface.id === id)?.on ?? true;
}
