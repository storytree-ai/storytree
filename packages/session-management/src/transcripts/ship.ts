/**
 * Capability 9 · Context readings. Streaming a session's transcript into the shared log (ADR-0749 D3), from the machine it runs on.
 * Each hook ships what its session's transcript files gained since the last one: the session's own
 * file, and each subagent's (`<transcript without .jsonl>/subagents/agent-<id>.jsonl`), stored
 * under the parent session by the subagent's id. Only whole records go, each scrubbed (D4); a
 * record still being written waits for the next hook. Where each file is up to is read from the
 * store, so a hook keeps no state of its own and a record is never stored twice. (A session still
 * working when its oldest records expire, 180 days in, would ship its file again from the start.)
 */
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import type { ActivityLog, TranscriptRecord } from "../activity/index.js";
import { scrub } from "./scrub.js";

/** At most this much is shipped by one hook, so a long transcript's first shipping spreads over several hooks. */
export const SHIP_BYTES = 2 * 1024 * 1024;

/** Ship what `session`'s transcript at `transcript`, and its subagents', gained since the last ship. */
export async function shipTranscript(log: ActivityLog, project: string, session: string, transcript: string,
  { maxBytes = SHIP_BYTES }: { maxBytes?: number } = {}): Promise<void> {
  const parts: [string, string][] = [["", transcript], ...(await subagentFiles(transcript))];
  const cursors = await log.transcripts.cursors(project, session);
  let budget = maxBytes;
  for (const [part, file] of parts) {
    if (budget <= 0) break;
    const { records, bytes } = await newRecords(file, part, cursors.get(part) ?? 0, budget);
    budget -= bytes;
    await log.transcripts.store(project, session, records);
  }
}

/** Each subagent's transcript beside `transcript`, by the subagent's id. */
async function subagentFiles(transcript: string): Promise<[string, string][]> {
  const folder = path.join(path.dirname(transcript), path.basename(transcript, ".jsonl"), "subagents");
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.flatMap((name) => {
    const id = /^agent-(.+)\.jsonl$/.exec(name)?.[1];
    return id === undefined ? [] : [[id, path.join(folder, name)] as [string, string]];
  }).sort(([a], [b]) => a.localeCompare(b));
}

/** The whole records in `file` from byte `from`, up to about `budget` bytes, scrubbed; and how many bytes they took. */
async function newRecords(file: string, part: string, from: number, budget: number): Promise<{ records: TranscriptRecord[]; bytes: number }> {
  const handle = await open(file, "r").catch(() => undefined);
  if (handle === undefined) return { records: [], bytes: 0 };
  try {
    const { size } = await handle.stat();
    if (size <= from) return { records: [], bytes: 0 };
    let length = Math.min(size - from, budget);
    let buffer: Buffer;
    let end: number;
    for (;;) {
      buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, from);
      buffer = buffer.subarray(0, bytesRead);
      end = buffer.lastIndexOf(0x0a) + 1;
      // A record longer than the budget is read on to its end rather than never shipped.
      if (end > 0 || from + length >= size) break;
      length = Math.min(size - from, length * 2);
    }
    const records: TranscriptRecord[] = [];
    for (let start = 0; start < end;) {
      const finish = buffer.indexOf(0x0a, start) + 1;
      const record = buffer.subarray(start, finish - 1).toString("utf8").replace(/\r$/, "");
      if (record.trim() !== "") records.push({ part, start: from + start, finish: from + finish, record: scrub(record) });
      start = finish;
    }
    return { records, bytes: end };
  } finally {
    await handle.close();
  }
}
