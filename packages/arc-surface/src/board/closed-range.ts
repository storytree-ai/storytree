// Capability 3 · Arc surface.
import type { DayWindow } from "@storytree/library";

export type ClosedRange = { preset: "today" | "yesterday" | "week" } | { from: string; to: string };

export function dayOf(at: number, offset = 0): string {
  const day = new Date(at);
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

export function windowOf(range: ClosedRange, now: number): DayWindow {
  if ("from" in range) return { from: range.from, to: dayOf(Date.parse(`${range.to}T12:00:00`), 1) };
  const from = { today: 0, yesterday: -1, week: -6 }[range.preset];
  return { from: dayOf(now, from), to: dayOf(now, range.preset === "yesterday" ? 0 : 1) };
}

export const recentWindow = (now: number): DayWindow => ({ from: dayOf(now, -1), to: dayOf(now, 1) });

export const covers = (outer: DayWindow, inner: DayWindow): boolean => inner.from >= outer.from && inner.to <= outer.to;
