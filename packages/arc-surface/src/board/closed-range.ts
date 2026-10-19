/** Capability 3 · Arc surface. */
import type { DayWindow } from "@storytree/library";

/** The Closed tab's range (3.12), as the sessions History tab's: a preset, or a From–to of days, both ends included. */
export type ClosedRange = { preset: "today" | "yesterday" | "week" } | { from: string; to: string };

/** A local day as a date input writes it (YYYY-MM-DD), `offset` days from `at`'s. */
export function dayOf(at: number, offset = 0): string {
  const day = new Date(at);
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** The days a range covers at `now`, to its end excluded, as the library's closed-arc reads take them. */
export function windowOf(range: ClosedRange, now: number): DayWindow {
  if ("from" in range) return { from: range.from, to: dayOf(Date.parse(`${range.to}T12:00:00`), 1) };
  const from = { today: 0, yesterday: -1, week: -6 }[range.preset];
  return { from: dayOf(now, from), to: dayOf(now, range.preset === "yesterday" ? 0 : 1) };
}

/** The board's routine read of closed arcs (3.12): those closed yesterday and today. */
export const recentWindow = (now: number): DayWindow => ({ from: dayOf(now, -1), to: dayOf(now, 1) });

/** Whether `outer` holds every day of `inner`. */
export const covers = (outer: DayWindow, inner: DayWindow): boolean => inner.from >= outer.from && inner.to <= outer.to;
