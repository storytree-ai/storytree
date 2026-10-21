/**
 * Capability 3 · Data schema: a process's schedule (ADR-1105), when it should run, in the words a person writes. The
 * record stores the words; this reads them into a rule, so the words stay the one source and a reader that works out
 * what is due (`process due`) reads them the same way the library validated them.
 *
 * The words it takes, case and spacing aside:
 * - `every run`: whenever the runner runs;
 * - `every hour`, `every day`, `every N minutes`, `every N hours`, `every N days`: at most that often;
 * - `daily at 09:15`, `daily at 09:15 and 21:15` (more times joined by commas or `and`): at those times of day.
 *
 * A schedule's times are in its record's `timeZone`, an IANA name, or the owner's, OWNER_TIME_ZONE, when it has none.
 */

/** A schedule read into a rule: every run, at most every so many minutes, or at the given times of day (HH:MM, in order). */
export type ScheduleRule = { readonly kind: "every-run" } | { readonly kind: "interval"; readonly minutes: number } | { readonly kind: "daily"; readonly times: readonly string[] };

/** The time zone a schedule's times are in when its record names none: the owner's. */
export const OWNER_TIME_ZONE = "Australia/Sydney";

const UNIT_MINUTES: Readonly<Record<string, number>> = { minute: 1, hour: 60, day: 24 * 60 };

const SAID = 'a schedule is "every run", "every N minutes", "every N hours", "every N days" or "daily at HH:MM", such as "daily at 09:15 and 21:15"';

/** The rule the words say, or the reason they say none. */
export function parseSchedule(text: string): { readonly rule: ScheduleRule } | { readonly refused: string } {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (words === "every run") return { rule: { kind: "every-run" } };
  const every = /^every (?:(\d+) )?(minute|hour|day)(s?)$/.exec(words);
  if (every !== null) {
    const [, count, unit = "", plural] = every;
    const n = count === undefined ? 1 : Number(count);
    if (count === undefined && plural !== "") return { refused: SAID };
    if (n < 1) return { refused: `a schedule's interval is at least one ${unit}` };
    return { rule: { kind: "interval", minutes: n * (UNIT_MINUTES[unit] ?? 0) } };
  }
  const daily = /^daily at (.+)$/.exec(words);
  if (daily !== null) {
    const times = (daily[1] ?? "").split(/ ?, ?(?:and )?| and /);
    const bad = times.find((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time));
    if (bad !== undefined) return { refused: `"${bad}" is no time of day: a schedule's time is HH:MM, from 00:00 to 23:59` };
    return { rule: { kind: "daily", times: [...new Set(times)].sort() } };
  }
  return { refused: SAID };
}

/** Whether the name is a time zone this machine knows (an IANA name, such as Australia/Sydney). */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
