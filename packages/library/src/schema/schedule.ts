// Capability 3 · Data schema

export type ScheduleRule =
  | { readonly kind: "every-run" }
  | { readonly kind: "interval"; readonly minutes: number }
  | { readonly kind: "daily"; readonly times: readonly string[]; readonly graceMinutes?: number };

export const PRECHECKS = ["feedback-waiting", "questions-to-prep"] as const;
export type Precheck = (typeof PRECHECKS)[number];

export const OWNER_TIME_ZONE = "Australia/Sydney";

const UNIT_MINUTES: Readonly<Record<string, number>> = { minute: 1, hour: 60, day: 24 * 60 };

const SAID = 'a schedule is "every run", "every N minutes", "every N hours", "every N days" or "daily at HH:MM", such as "daily at 09:15 and 21:15"';

export function parseSchedule(text: string): { readonly rule: ScheduleRule } | { readonly refused: string } {
  const said = text.trim().toLowerCase().replace(/\s+/g, " ");
  const at = said.indexOf(" grace ");
  if (at < 1) return parseRule(said);
  const words = said.endsWith(",", at) && at > 1 ? said.slice(0, at - 1) : said.slice(0, at);
  const grace = said.slice(at + " grace ".length);
  const read = parseRule(words);
  if ("refused" in read) return read;
  if (read.rule.kind !== "daily") return { refused: `a grace is for a daily schedule's times, such as "daily at 09:15, grace 2 hours"; "${words}" has no time to be late for` };
  const length = /^(\d+) (minute|hour|day)s?$/.exec(grace);
  const graceMinutes = length === null ? 0 : Number(length[1]) * (UNIT_MINUTES[length[2] ?? ""] ?? 0);
  if (graceMinutes < 1) return { refused: `"grace ${grace}" is no grace: a grace is N minutes, hours or days, at least one minute` };
  return { rule: { ...read.rule, graceMinutes } };
}

function parseRule(words: string): { readonly rule: ScheduleRule } | { readonly refused: string } {
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

export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
