/** Capability 1 in a replay (world 7): the core grows as the recording added its notes, each where the finished core draws it. */
import type { RecordEnvelope } from "@storytree/library";
import type { GlobePoint } from "./positions.js";

/** How long a note takes to appear once the replay reaches it, in the replay's seconds. */
const APPEAR = 0.4;

/** When each drawn note appears in a replay: the moment its recorded date falls at, by the replay's own clock. */
export function noteMoments(points: readonly GlobePoint[], notes: ReadonlyMap<string, RecordEnvelope>, moment: (date: string) => number): Map<string, number> {
  return new Map(points.flatMap(({ id }) => {
    const record = notes.get(id);
    return record === undefined ? [] : [[id, moment(record.createdAt)] as const];
  }));
}

/** How far a note has appeared at `now`: nothing before its moment, then fading in over a beat; whole when unscheduled. */
export function noteShown(start: number | undefined, now: number): number {
  if (start === undefined || now >= start + APPEAR) return 1;
  return now <= start ? 0 : (now - start) / APPEAR;
}
