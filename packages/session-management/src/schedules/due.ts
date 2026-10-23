/**
 * Capability 18 · Scheduled processes: when a process is due (ADR-1105, decision_8e018888b69e). A process is due once
 * its schedule has come round since its latest run, or it has never run; nothing else is stored, so this reads the
 * schedule's words through the library's one parser against the latest `process-ran` line.
 */
import { OWNER_TIME_ZONE, parseSchedule, type ScheduleRule } from "@storytree/library";

const MINUTE = 60_000;

/** Whether a process is due at `at`, and since when: `since` is absent when it never ran or runs every run. */
export type Due = { readonly due: false } | { readonly due: true; readonly since?: Date };

/** When a process with `schedule` (in `timeZone`, or the owner's) is due at `at`, its latest run at `last`. */
export function dueAt(schedule: string, timeZone: string | undefined, last: Date | undefined, at: Date): Due {
  const read = parseSchedule(schedule);
  if ("refused" in read) return { due: false };
  const rule: ScheduleRule = read.rule;
  if (rule.kind === "every-run" || last === undefined) return { due: true };
  if (rule.kind === "interval") {
    const since = new Date(last.getTime() + rule.minutes * MINUTE);
    return since <= at ? { due: true, since } : { due: false };
  }
  const since = latestTimeOfDay(rule.times, timeZone ?? OWNER_TIME_ZONE, at);
  return since !== undefined && since > last ? { due: true, since } : { due: false };
}

/** The latest of `times` (HH:MM in `timeZone`) at or before `at`, looking back two days. */
function latestTimeOfDay(times: readonly string[], timeZone: string, at: Date): Date | undefined {
  let latest: Date | undefined;
  for (let back = 0; back <= 2; back++) {
    const [year, month, day] = localDate(new Date(at.getTime() - back * 24 * 60 * MINUTE), timeZone);
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number) as [number, number];
      const instant = instantOf(year, month, day, hour, minute, timeZone);
      if (instant <= at && (latest === undefined || instant > latest)) latest = instant;
    }
  }
  return latest;
}

/** The local date at `instant` in `timeZone`: year, month (1-12), day. */
function localDate(instant: Date, timeZone: string): [number, number, number] {
  const parts = wallClock(instant, timeZone);
  return [parts.year, parts.month, parts.day];
}

/** The wall-clock reading at `instant` in `timeZone`. */
function wallClock(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const part = (type: string) => Number(format.formatToParts(instant).find((one) => one.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

/** The instant the wall clock in `timeZone` reads the given date and time, corrected once for a daylight-saving change. */
function instantOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (instant: number) => {
    const clock = wallClock(new Date(instant), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) - Math.floor(instant / MINUTE) * MINUTE;
  };
  const guess = wanted - offset(wanted);
  return new Date(wanted - offset(guess));
}
