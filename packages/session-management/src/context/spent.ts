// Capability 9 · Context readings
import type { ActivityLog, StampedRecord } from "../activity/index.js";
import { ContextFold, readingLines, transcriptOf } from "./context.js";

export async function tokensSpent(log: ActivityLog, project: string, { upTo, after }: { upTo: Date; after?: Date }): Promise<number> {
  const records = await log.transcripts.storedUpTo(project, upTo, after);
  const parts = new Map<string, StampedRecord[]>();
  for (const record of records) {
    const key = `${record.session}\0${record.part}`;
    const part = parts.get(key);
    if (part === undefined) parts.set(key, [record]);
    else part.push(record);
  }
  const sessions = [...new Set(records.map((record) => record.session))];
  const lines = sessions.length === 0 ? [] : await readingLines(log, project, sessions);
  let spent = 0;
  for (const part of parts.values()) {
    const { session, part: subagent } = part[0]!;
    const fold = new ContextFold(transcriptOf(lines, session)?.harness, { subagent: subagent !== "" });
    let before = 0;
    for (const record of part) {
      fold.feed(record.record);
      if (after !== undefined && record.at <= after) before = fold.spent();
    }
    spent += fold.spent() - before;
  }
  return spent;
}
