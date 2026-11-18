// Capability 1 · Knowledge under its shelves
import type { RecordEnvelope } from "@storytree/library";
import type { GlobePoint } from "./positions.js";

const APPEAR = 0.4;

export function noteMoments(points: readonly GlobePoint[], notes: ReadonlyMap<string, RecordEnvelope>, moment: (date: string) => number): Map<string, number> {
  return new Map(points.flatMap(({ id }) => {
    const record = notes.get(id);
    return record === undefined ? [] : [[id, moment(record.createdAt)] as const];
  }));
}

export function noteShown(start: number | undefined, now: number): number {
  if (start === undefined || now >= start + APPEAR) return 1;
  return now <= start ? 0 : (now - start) / APPEAR;
}
