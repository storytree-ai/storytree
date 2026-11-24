// Capability 1 · Base structure measures
import { functionsOf } from "./complexity.js";
import { sourcesOf, type SourceText } from "./source.js";

export const ERODED_OVER = 10;

export interface ErosionReading {
  readonly mass: number;
  readonly eroded: number;
  readonly share: number;
}

export function erosionOf(files: readonly SourceText[]): ErosionReading {
  let mass = 0;
  let eroded = 0;
  for (const fn of sourcesOf(files).flatMap(functionsOf)) {
    const own = fn.cyclomatic * Math.sqrt(fn.length);
    mass += own;
    if (fn.cyclomatic > ERODED_OVER) eroded += own;
  }
  return { mass, eroded, share: mass === 0 ? 0 : eroded / mass };
}
