// Capability 6 · CI times.
import type { CiTimesReading } from "./reading.js";

export interface CiTimesLines {
  readonly toMerge: string;
  readonly was: string;
  readonly spark: { readonly before: string; readonly week: string };
  readonly run: string;
  readonly queue: string;
  readonly going: string;
  readonly detail: string;
}

const SYSTEMS: Readonly<Record<string, string>> = { linux: "Linux", win32: "Windows", darwin: "macOS" };
const BARS = "▁▂▃▄▅▆▇█";

export function minutesSaid(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const whole = Math.round(minutes);
  return whole < 90 ? `${whole} min` : `${Math.floor(whole / 60)} h ${String(whole % 60).padStart(2, "0")}`;
}

export function sparkline(days: readonly (number | null)[]): string {
  const known = days.filter((day): day is number => day !== null);
  const low = Math.min(...known);
  const high = Math.max(...known);
  return days.map((day) => (day === null ? "·" : BARS[high === low ? 3 : Math.round(((day - low) / (high - low)) * (BARS.length - 1))])).join("");
}

function ago(at: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export interface CiGoing {
  readonly inCi: number;
  readonly inQueue: number;
}

export function ciTimesLines(reading: CiTimesReading, now = new Date(), going?: CiGoing): CiTimesLines {
  const { toMerge, run, queue } = reading;
  const spark = sparkline(toMerge.days);
  const bound = run.bound === undefined ? "" : `, ${SYSTEMS[run.bound] ?? run.bound} slowest`;
  return {
    toMerge: `To merge ${minutesSaid(toMerge.median)}`,
    was: toMerge.was === undefined ? "" : `${minutesSaid(toMerge.was)} last week`,
    spark: { before: spark.slice(0, 7), week: spark.slice(7) },
    run: `Run ${minutesSaid(run.median)}${bound}`,
    queue: `Queue reds ${queue.runs === 0 ? "—" : `${Math.round((queue.reds / queue.runs) * 100)}%`}`,
    going: going === undefined ? `In CI ${reading.now.inCi}, in queue ${reading.now.inQueue}, ${ago(reading.readAt, now)}` : `In CI ${going.inCi}, in queue ${going.inQueue}, live`,
    detail: [
      `${reading.repository}, the last 7 days against the 7 before.`,
      `To merge: ready for review to merged, the median of ${toMerge.merged} pull requests this week; the bars, each day's median over two weeks, last week's dimmed.`,
      `Run: a commit's longest workflow run, start to end, the median of ${run.runs} passing commits; slowest: the system of the longest job in most of them.`,
      `Queue reds: ${queue.reds} of ${queue.runs} merge-queue runs failed.`,
      going === undefined ? `In CI and in queue: as the last recording saw them, ${new Date(reading.readAt).toLocaleString()}.`
        : "In CI and in queue: the open pull requests as their branch states say them now.",
    ].join("\n"),
  };
}

export function ciTimesText(reading: CiTimesReading, now = new Date()): string {
  const lines = ciTimesLines(reading, now);
  return [`${lines.toMerge} ${lines.spark.before}${lines.spark.week} ${lines.was}`.trimEnd(), lines.run, lines.queue, lines.going].join("\n");
}
