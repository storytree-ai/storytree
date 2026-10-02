import { pageReading, type BoardReads, type Timers } from "@storytree/arc-surface";
import type { Line } from "@storytree/agent-link";
import type { SessionsReads } from "@storytree/forest/view";
import type { TourSnapshot } from "./forest-data.js";

/** The app's read-only surfaces receive the saved records, with the recording's own clock. */
export function savedReading(snapshot: TourSnapshot, { replay = false }: { replay?: boolean } = {}) {
  // Publication omits private optional fields. No missing field is reconstructed.
  const lines = snapshot.recording.lines as readonly Line[];
  let index = replay ? 0 : lines.length;
  let elapsed = 0;
  const at = () => index === lines.length ? snapshot.recording.window.to : lines[index - 1]?.at ?? snapshot.recording.window.from;
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
    arcViews: async () => snapshot.arcs,
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
