/**
 * Capability 9 · Context readings: what a project's sessions spent, added up from the same fold a reading takes
 * (ADR-1064 D4: an experiment's tokens to date read nothing of a transcript the context reading does not). Each
 * session's own transcript and each of its subagents' is folded from its stored records as its harness writes it,
 * and its running spend taken at the times asked for. A record counts when it was stored, the time the log knows.
 */
import type { ActivityLog, StampedRecord } from "../activity/index.js";
import { ContextFold, readingLines, transcriptOf } from "./context.js";

/**
 * The tokens `project`'s sessions spent by `upTo`, as their stored transcripts say: or, given `after`, only what
 * they spent after it, so a caller adding up a series reads only the transcripts still growing.
 */
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
