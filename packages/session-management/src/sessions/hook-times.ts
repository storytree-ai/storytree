/**
 * Capability 4 · Sessions. `storytree session hook-times`: how long the hooks took that machines uploaded to this project's
 * log (hooks/timing.ts, ADR-1056 D1), per harness, event and machine over the last days: how many, the median, 75th
 * percentile and worst total, and the median of each part, the worst first. A reading, never a gate (decision_fbe2cec9f404).
 */
import type { ActivityLog } from "../activity/index.js";

const DAY_MS = 86_400_000;

/** One harness, event and machine's readings, in ms. */
interface Row {
  harness: string;
  event: string;
  machine: string;
  count: number;
  median: number;
  p75: number;
  worst: number;
  parts: Record<string, number>;
}

/** The nearest-rank percentile `p` (0 to 1) of `values`, which are not empty. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/** The hook times of `project`'s log over the last `days` (7) before `now`: a table, or with `json` its rows. */
export async function hookTimes(log: Pick<ActivityLog, "lines">, project: string, { days = 7, json = false, now = Date.now() }: { days?: number; json?: boolean; now?: number } = {}): Promise<string> {
  const since = now - days * DAY_MS;
  const lines = await log.lines(project, { kinds: ["hook-times"], since: new Date(since).toISOString() });
  const groups = new Map<string, { harness: string; event: string; machine: string; totals: number[]; parts: Map<string, number[]> }>();
  for (const line of lines) {
    if (line.kind !== "hook-times") continue;
    const machine = line.machine ?? "unknown";
    for (const reading of line.readings) {
      if (Date.parse(reading.at) < since) continue;
      const key = JSON.stringify([reading.harness, reading.event, machine]);
      const group = groups.get(key) ?? { harness: reading.harness, event: reading.event, machine, totals: [] as number[], parts: new Map<string, number[]>() };
      groups.set(key, group);
      group.totals.push(reading.total);
      for (const [part, ms] of Object.entries(reading.parts)) if (ms !== undefined) group.parts.set(part, [...(group.parts.get(part) ?? []), ms]);
    }
  }
  const rows: Row[] = [...groups.values()].map(({ harness, event, machine, totals, parts }) => ({
    harness, event, machine, count: totals.length, median: percentile(totals, 0.5), p75: percentile(totals, 0.75), worst: Math.max(...totals),
    parts: Object.fromEntries([...parts].map(([part, values]) => [part, percentile(values, 0.5)])),
  })).sort((a, b) => b.worst - a.worst);
  if (json) return JSON.stringify(rows);
  if (rows.length === 0) return `No hook times in the last ${days} days. Each machine's hooks record them, and the look around the machine uploads them once a minute.`;
  const ms = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(0));
  const table = [["harness", "event", "machine", "count", "total p50 / p75 / worst", "startup", "connect", "write", "handoff"],
    ...rows.map((row) => [row.harness, row.event, row.machine, String(row.count), `${ms(row.median)} / ${ms(row.p75)} / ${ms(row.worst)}`,
      ms(row.parts.startup), ms(row.parts.connect), ms(row.parts.write), ms(row.parts.handoff)])];
  const widths = table[0]!.map((_, column) => Math.max(...table.map((cells) => cells[column]!.length)));
  return [
    `How long hooks took, the last ${days} days, in ms: the total from the process's start to its exit, and the median of each part; the worst first.`,
    ...table.map((cells) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd()),
  ].join("\n");
}
