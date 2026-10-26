/**
 * Capability 4 · Updates, contracts 4.13–4.14 (ADR-0871 D2): when the user lets a downloaded
 * release install itself. "quiet" (the default) is any quiet moment (4.4); "hours" is only inside a
 * daily local window, which may cross midnight; "manual" is never on its own. The user's own
 * Restart to update installs at once in every mode. Kept in the app's home by install-choice-file.ts; this
 * module is the page's too, so it reads no files.
 */
export type InstallChoice =
  | { readonly mode: "quiet" }
  | { readonly mode: "hours"; readonly from: string; readonly to: string }
  | { readonly mode: "manual" };

/** Whether this app installs releases, so the choice means something here, and the choice. */
export interface InstallChoiceState { readonly available: boolean; readonly choice: InstallChoice }

/** Minutes after midnight for an "HH:MM" clock time; undefined for anything else. */
export function clockMinute(clock: unknown): number | undefined {
  const match = typeof clock === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock) : null;
  return match === null ? undefined : Number(match[1]) * 60 + Number(match[2]);
}

/** The choice a value names, or the reason it names none. */
export function parseInstallChoice(value: unknown): InstallChoice {
  const { mode, from, to } = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (mode === "quiet" || mode === "manual") return { mode };
  if (mode !== "hours") throw new Error("Choose when updates install: when quiet, during quiet hours, or only when you choose.");
  const start = clockMinute(from), end = clockMinute(to);
  if (start === undefined || end === undefined) throw new Error("Say each quiet hour as HH:MM, such as 01:00.");
  if (start === end) throw new Error("Quiet hours need to start and end at different times.");
  return { mode, from: from as string, to: to as string };
}

/** Whether a minute of the day falls inside quiet hours: from its start, up to but not at its end. */
export function insideHours(choice: { from: string; to: string }, minuteOfDay: number): boolean {
  const from = clockMinute(choice.from)!, to = clockMinute(choice.to)!;
  return from < to ? from <= minuteOfDay && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

/** When a release may next install itself (at a quiet moment from then on); undefined for manual only. */
export function nextInstallAt(choice: InstallChoice, now: Date): Date | undefined {
  if (choice.mode === "manual") return undefined;
  if (choice.mode === "quiet" || insideHours(choice, now.getHours() * 60 + now.getMinutes())) return now;
  const from = clockMinute(choice.from)!;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(from / 60), from % 60);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
