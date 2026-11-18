// Capability 9 · Context readings
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import type { ActivityLog, TranscriptRecord } from "../activity/index.js";
import { scrub } from "./scrub.js";

export const SHIP_BYTES = 2 * 1024 * 1024;

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

async function subagentFiles(transcript: string): Promise<[string, string][]> {
  const folder = path.join(path.dirname(transcript), path.basename(transcript, ".jsonl"), "subagents");
  const names = await readdir(folder).catch(() => [] as string[]);
  return names.flatMap((name) => {
    const id = /^agent-(.+)\.jsonl$/.exec(name)?.[1];
    return id === undefined ? [] : [[id, path.join(folder, name)] as [string, string]];
  }).sort(([a], [b]) => a.localeCompare(b));
}

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
