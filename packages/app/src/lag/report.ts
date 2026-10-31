/**
 * Capability 7 · Lag report. `storytree lag`: the field's readings over the last seven days, per action, against the catalogue's
 * budgets (ADR-1001 D2, D4), the action furthest over its budget first, then a line per view the map was turned in, read by its frames. A report, not a verdict (ADR-1001 D5).
 */
import type { Budget, LagAction } from "@storytree/forest/actions";

import type { KeptReading } from "./readings.js";

const WINDOW_DAYS = 7;
/** Fewer readings than this are too few to judge. */
const ENOUGH = 10;

/** The nearest-rank percentile `p` (0 to 1) of `values`, which are not empty. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

type Row = { name: string; readings: KeptReading[]; budget: Budget | undefined; over: string[]; score: number };

function row(name: string, readings: KeptReading[], budget: Budget | undefined): Row {
  if (budget === undefined) return { name, readings, budget, over: [], score: -1 };
  // A settle past its budget counts only when no progress was on show (ADR-1001 D2).
  const settledMiss = Math.max(0, ...readings.filter((r) => !r.progress).map((r) => r.settled));
  const ratios = {
    response: Math.max(...readings.map((r) => r.response)) / budget.responseMs,
    frame: Math.max(...readings.map((r) => r.longestFrame)) / budget.frameMs,
    settled: settledMiss / budget.settledMs,
  };
  return { name, readings, budget, over: Object.entries(ratios).filter(([, ratio]) => ratio > 1).map(([what]) => what), score: Math.max(...Object.values(ratios)) };
}

/** p50 / p75 / worst of `values`, a value under the browser's threshold shown as under it. */
function spread(values: number[], under?: number): string {
  const ms = (n: number) => (under !== undefined && n < under ? `<${under}` : n.toFixed(0));
  return `${ms(percentile(values, 0.5))} / ${ms(percentile(values, 0.75))} / ${ms(Math.max(...values))}`;
}

/** The report over `readings` as of `now`: the budgets are the catalogue's, by each entry's field name; `file` is where they were read. */
export function lagReport(readings: readonly KeptReading[], options: { now: number; catalogue: readonly LagAction[]; file: string }): string {
  const since = options.now - WINDOW_DAYS * 86_400_000;
  const recent = readings.filter((r) => Date.parse(r.at) >= since);
  if (recent.length === 0) return `No lag readings in the last ${WINDOW_DAYS} days in ${options.file}. The desktop app records them as you use it.`;
  const budgets = new Map<string, Budget>();
  for (const action of options.catalogue) if (action.field !== undefined && !budgets.has(action.field)) budgets.set(action.field, action.budget);
  const names = [...new Set(recent.map((r) => r.name))];
  const rows = names.map((name) => row(name, recent.filter((r) => r.name === name), budgets.get(name))).sort((a, b) => b.score - a.score);
  const table = [["action", "readings", "response p50/p75/worst", "longest frame p50/p75/worst", "settled p50/p75/worst", "budget", "over budget"],
    ...rows.map(({ name, readings: rs, budget, over }) => [name, String(rs.length), spread(rs.map((r) => r.response), 16), spread(rs.map((r) => r.longestFrame), 50),
      spread(rs.map((r) => r.settled)), budget === undefined ? "none in this version's catalogue" : `${budget.responseMs} / ${budget.frameMs} / ${budget.settledMs}`,
      over.length === 0 ? "-" : over.join(", ")])];
  const widths = table[0]!.map((_, column) => Math.max(...table.map((line) => line[column]!.length)));
  const turns = rows.map(({ name, readings: rs }) => ({ name, frames: rs.flatMap((r) => (r.frames === undefined ? [] : [r.frames])) })).filter((turn) => turn.frames.length > 0)
    .map(({ name, frames }) => `${name} frames: p50 ${percentile(frames.map((f) => f.p50), 0.5)} ms, p95 ${percentile(frames.map((f) => f.p95), 0.5)} ms (medians over ${frames.length} turns), `
      + `longest ${Math.max(...frames.map((f) => f.max))} ms, ${frames.reduce((sum, f) => sum + f.over, 0)} over 50 ms`);
  const few = rows.filter((r) => r.readings.length < ENOUGH).map((r) => `${r.name} has fewer than ${ENOUGH} readings: too few to judge.`);
  return [
    `Lag in real use, the last ${WINDOW_DAYS} days, against each action's budget (response / longest frame / settled, in ms; settled may run longer while progress is on show).`,
    ...table.map((line) => line.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd()),
    ...turns,
    ...few,
  ].join("\n");
}
