// Capability 3 · Data schema
export type ScheduleRule =
  | { readonly kind: "every-run" }
  | { readonly kind: "interval"; readonly minutes: number }
  | { readonly kind: "daily"; readonly times: readonly string[]; readonly graceMinutes?: number };

export const PRECHECKS = ["feedback-waiting", "questions-to-prep"] as const;

export type Precheck = (typeof PRECHECKS)[number];

export const OWNER_TIME_ZONE = "Australia/Sydney";

const UNITS: Readonly<Record<string, number>> = { minute: 1, minutes: 1, hour: 60, hours: 60, day: 1440, days: 1440 };
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function parseSchedule(text: string): { readonly rule: ScheduleRule } | { readonly refused: string } {
  const written = text.trim().toLowerCase();
  const refused = { refused: `${JSON.stringify(text)} is not a schedule: write "every run", "every <n> minutes|hours|days" or "daily at HH:MM[, HH:MM and HH:MM][, grace <n> minutes|hours|days]"` };
  const at = written.search(/[\s,]grace\s/);
  const before = at < 0 ? written : written.slice(0, at).trimEnd();
  const base = at >= 0 && written[at] !== "," && before.endsWith(",") ? before.slice(0, -1) : before;
  const words = base.split(/\s+/);
  if (words.join(" ") === "every run") return at < 0 ? { rule: { kind: "every-run" } } : refused;
  if (words[0] === "every") {
    const counted = words.length === 3;
    const count = counted ? Number(words[1]) : 1;
    const unit = UNITS[words.at(-1)!];
    if (at >= 0 || unit === undefined || words.length > 3 || words.length < 2 || (counted && !/^\d+$/.test(words[1]!)) || count < 1 || (!counted && words[1]!.endsWith("s"))) return refused;
    return { rule: { kind: "interval", minutes: count * unit } };
  }
  if (words[0] !== "daily" || words[1] !== "at") return refused;
  const times = base.slice(base.indexOf("at", "daily".length) + "at".length).split(",").flatMap((part) => part.split(/\band\b/)).map((time) => time.trim());
  if (!times.every((time) => TIME.test(time))) return refused;
  const rule = { kind: "daily" as const, times: [...new Set(times)].sort() };
  if (at < 0) return { rule };
  const grace = written.slice(at + 6).trim().split(/\s+/);
  const unit = grace.length === 2 ? UNITS[grace[1]!] : undefined;
  if (unit === undefined || !/^\d+$/.test(grace[0]!) || Number(grace[0]) < 1) return refused;
  return { rule: { ...rule, graceMinutes: Number(grace[0]) * unit } };
}

export function knownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
