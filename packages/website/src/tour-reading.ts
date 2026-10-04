import { pageReading, type BoardReads, type Timers } from "@storytree/arc-surface";
import type { Line } from "@storytree/agent-link";
import type { SessionsReads } from "@storytree/forest/view";
import type { GrowthSnapshot, TourSnapshot } from "./forest-data.js";

/** A saved growth's public reading as a snapshot the surfaces read, for free play's story panels, arcs and sessions on it (2.14); a growth saved without one has none. */
export function growthReading(growth: GrowthSnapshot): TourSnapshot | undefined {
  return growth.reading && { ...growth, ...growth.reading, changes: growth.changes ?? [] } as unknown as TourSnapshot;
}

/** The app's read-only surfaces receive the saved records, with the recording's own clock. */
/** `until` holds the reading at a recorded moment: only what was recorded by then (2.17). */
export function savedReading(snapshot: TourSnapshot, { replay = false, until }: { replay?: boolean; until?: string } = {}) {
  // Publication omits private optional fields. No missing field is reconstructed.
  const lines = snapshot.recording.lines as readonly Line[];
  let index = replay ? 0 : until === undefined ? lines.length : lines.filter(line => line.at <= until).length;
  let elapsed = 0;
  // Held at a moment, the clock reads that moment; once played on, the last event's.
  let held = replay ? undefined : until;
  const at = () => held ?? (index === lines.length ? snapshot.recording.window.to : lines[index - 1]?.at ?? snapshot.recording.window.from);
  const progress = () => ({ index, total: lines.length, at: at() });
  const jobs = new Set<{ ms: number; elapsed: number; run(): void }>();
  const timers: Timers = {
    now: () => Date.parse(at()),
    every(ms, run) {
      const job = { ms, elapsed: 0, run };
      jobs.add(job);
      return () => { jobs.delete(job); };
    },
  };
  const reads: SessionsReads & BoardReads = {
    projectTree: async () => snapshot.tree,
    arcViews: async () => until === undefined || replay ? snapshot.arcs : arcsAt(snapshot.arcs, lines, until),
    holds: async () => snapshot.holds,
    changesSince: async (_project, cursor) => ({ changes: snapshot.changes.filter(change => change.seq > cursor), cursor: snapshot.changes.at(-1)?.seq ?? cursor }),
    linesSince: async (_project, cursor) => {
      const offered = lines.slice(0, index);
      return { lines: offered.filter(line => line.seq > cursor), cursor: offered.at(-1)?.seq ?? cursor };
    },
    windowReading: async (_project, session) => ({ session, at: at(), absent: "Transcript windows were not included in this public recording." }),
  };
  const reading = pageReading({ project: snapshot.project, reads, timers });
  return {
    reads, reading, timers, lines, progress, now: () => new Date(at()),
    /** Compressed playback: one recorded event per second at 1×; the original event's time is untouched. */
    advance(milliseconds: number, { paused = false, speed = 1 }: { paused?: boolean; speed?: number } = {}) {
      if (paused || !Number.isFinite(milliseconds) || milliseconds <= 0 || !Number.isFinite(speed) || speed <= 0) return progress();
      const delta = milliseconds * speed;
      held = undefined;
      elapsed += delta;
      const before = index;
      index = Math.min(lines.length, index + Math.floor(elapsed / 1000));
      elapsed %= 1000;
      for (const job of jobs) {
        job.elapsed += delta;
        if (job.elapsed >= job.ms || (index === lines.length && before !== index)) { job.elapsed %= job.ms; job.run(); }
      }
      return progress();
    },
  };
}

/**
 * The arcs as they stood at `until`, from the recorded activity: an increment closed by then is closed, one claimed by then is
 * active, any other is ready; what was not yet created is absent; an arc whose increments had all closed is closed.
 */
function arcsAt(arcs: TourSnapshot["arcs"], lines: readonly Line[], until: string): TourSnapshot["arcs"] {
  const offered = lines.filter(line => line.at <= until) as readonly (Line & { increment?: string; capability?: string })[];
  const closed = new Set(offered.flatMap(line => line.kind === "closed" && line.increment ? [line.increment] : []));
  const claimed = new Set(offered.flatMap(line => line.kind === "claimed" && line.increment && !line.capability ? [line.increment] : []));
  return arcs.filter(view => view.arc.createdAt <= until).map(view => {
    const increments = view.increments.filter(increment => increment.createdAt <= until).map(increment => {
      if (closed.has(increment.id)) return increment;
      const { outcome: _outcome, ...fields } = increment.fields;
      return { ...increment, fields: { ...fields, status: claimed.has(increment.id) ? "active" as const : "proposal" as const } };
    });
    return { ...view, increments, state: increments.length > 0 && increments.every(increment => closed.has(increment.id)) ? "closed" as const : "active" as const };
  });
}
