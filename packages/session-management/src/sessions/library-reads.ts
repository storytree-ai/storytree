/**
 * Capability 4 · Sessions. `storytree session reads`: what the library sent each reader on one UTC day, per machine, from
 * the totals every process records beside the log (activity/library-reads.ts, increment_28a5cea44ef7): each machine's
 * total, then its readers, the most bytes first. A reading, never a gate.
 */
import type { ActivityLog } from "../activity/index.js";

/** `bytes` as a person reads it: "7.0 MB", "512 KB". */
function sized(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** The library's reads on `day` (today, UTC), of `machine` or of every machine: a table, or with `json` its rows. */
export async function libraryReads(log: Pick<ActivityLog, "reads">, { day = new Date().toISOString().slice(0, 10), machine, json = false }: { day?: string; machine?: string; json?: boolean } = {}): Promise<string> {
  const rows = (await log.reads.day(day)).filter((row) => machine === undefined || row.machine === machine);
  if (json) return JSON.stringify(rows);
  if (rows.length === 0) return `No library reads recorded on ${day}${machine === undefined ? "" : ` from ${machine}`}. Each process that reads the library records its readers' totals as it closes.`;
  const machines = [...new Set(rows.map((row) => row.machine))];
  const lines = machines.flatMap((name) => {
    const own = rows.filter((row) => row.machine === name);
    const sum = (field: "bytes" | "statements") => own.reduce((total, row) => total + row[field], 0);
    const width = Math.max(...own.map((row) => row.reader.length));
    return [
      `${name}  ${sized(sum("bytes"))}  ${sum("statements")} statements`,
      ...own.map((row) => `  ${row.reader.padEnd(width)}  ${sized(row.bytes).padStart(8)}  ${row.statements}`),
    ];
  });
  return [`What the library sent each reader on ${day} (UTC), by machine, the most first: bytes, then statements.`, ...lines].join("\n");
}
