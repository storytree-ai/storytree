// Node-only: storytree's own saved growth (ADR-0889 2.2b). Act 2's arrival grows storytree's real project, so its
// stages are sampled from the library's dated history: each a moment something was recorded, never drawn by hand.
import type { Change } from "@storytree/library";

const time = (value: string) => Date.parse(value);
/** The notes the knowledge core grows from: everything the library keeps but the plan's own records and health. */
const plan = new Set(["story", "capability", "contract", "health"]);

/**
 * The moments the arrival grows storytree through, all from its records: empty before its first change, each story's
 * arrival (stories made within `apart` of each other arrive together), after every `notes` knowledge notes were made
 * (a tenth of them unless given), and complete after the last record or landing. Moments closer than `apart` to an earlier one fold into it.
 */
export function ownStages(changes: readonly Change[], merges: readonly { at: string }[], options: { notes?: number; apart?: number } = {}) {
  const apart = options.apart ?? 60_000;
  const seconds = (at: number, by: number) => new Date(at + by * 1000).toISOString();
  const made = new Map<string, Change>();
  for (const change of [...changes].sort((a, b) => time(a.record.updatedAt) - time(b.record.updatedAt) || a.seq - b.seq)) {
    if (change.action === "created" && !made.has(change.recordId)) made.set(change.recordId, change);
  }
  // Reduced, not spread: storytree's history is far longer than a call's arguments may be.
  const first = changes.reduce((least, change) => Math.min(least, time(change.record.updatedAt)), Infinity);
  const last = [...changes.map(change => change.record.updatedAt), ...merges.map(merge => merge.at)].reduce((most, at) => Math.max(most, time(at)), -Infinity);
  const window = { from: seconds(first, -60), to: seconds(last, 300) };

  const moments: { id: string; at: number }[] = [];
  for (const story of [...made.values()].filter(change => change.type === "story")) {
    const when = time(story.record.updatedAt);
    const near = moments.find(moment => moment.id.startsWith("story_") && when - moment.at < apart);
    if (near) near.id += `+${story.recordId}`;
    else moments.push({ id: story.recordId, at: when });
  }
  const knowledge = [...made.values()].filter(change => !plan.has(change.type));
  // By default ten steps of notes: with an island per story, months fold into a time-lapse of about twenty-five stages.
  const notes = options.notes ?? Math.max(1, Math.ceil(knowledge.length / 10));
  for (let count = notes; count < knowledge.length; count += notes) moments.push({ id: `notes-${count}`, at: time(knowledge[count - 1]!.record.updatedAt) });

  const stages: { id: string; at: string }[] = [{ id: "empty", at: window.from }];
  let kept = -Infinity;
  for (const moment of moments.sort((a, b) => a.at - b.at)) {
    if (moment.at - kept < apart && !moment.id.startsWith("story_")) continue;
    // A moment is drawn a second after it, so what it recorded stands; a story's arrival is never folded away.
    stages.push({ id: moment.id, at: seconds(moment.at, 1) });
    kept = moment.at;
  }
  stages.push({ id: "complete", at: seconds(last, 60) });
  return { window, stages };
}
