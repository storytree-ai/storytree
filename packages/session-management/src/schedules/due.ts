// Capability 18 · Scheduled processes
import { OWNER_TIME_ZONE, parseSchedule, type ScheduleRule } from "@storytree/library";

const MINUTE = 60_000;

export type Due = { readonly due: false } | { readonly due: true; readonly since?: Date; readonly missed?: { readonly graceMinutes: number } };

export function dueAt(schedule: string, timeZone: string | undefined, last: Date | undefined, at: Date): Due {
  const read = parseSchedule(schedule);
  if ("refused" in read) return { due: false };
  const rule: ScheduleRule = read.rule;
  if (rule.kind === "every-run" || (last === undefined && (rule.kind === "interval" || rule.graceMinutes === undefined))) return { due: true };
  if (rule.kind === "interval") {
    const since = new Date(last!.getTime() + rule.minutes * MINUTE);
    return since <= at ? { due: true, since } : { due: false };
  }
  const since = latestTimeOfDay(rule.times, timeZone ?? OWNER_TIME_ZONE, at);
  if (since === undefined || (last !== undefined && since <= last)) return { due: false };
  const { graceMinutes } = rule;
  return graceMinutes !== undefined && at.getTime() - since.getTime() > graceMinutes * MINUTE ? { due: true, since, missed: { graceMinutes } } : { due: true, since };
}

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

function localDate(instant: Date, timeZone: string): [number, number, number] {
  const parts = wallClock(instant, timeZone);
  return [parts.year, parts.month, parts.day];
}

function wallClock(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
  const part = (type: string) => Number(format.formatToParts(instant).find((one) => one.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

function instantOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (instant: number) => {
    const clock = wallClock(new Date(instant), timeZone);
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) - Math.floor(instant / MINUTE) * MINUTE;
  };
  const guess = wanted - offset(wanted);
  return new Date(wanted - offset(guess));
}
