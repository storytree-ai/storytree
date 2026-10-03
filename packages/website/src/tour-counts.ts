import type { GrowthSnapshot, TourSnapshot } from "./forest-data.js";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (at: Date) => `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
const time = (at: Date) => `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;

/** The saved reading's own numbers and dates, for the tour's {name} placeholders: the words never outrun the data. */
export function tourCounts(snapshot: Pick<TourSnapshot, "capturedAt" | "tree" | "changes" | "recording">): Record<string, string> {
  const live = new Map<string, string>();
  for (const change of snapshot.changes) {
    if (change.action === "retired") live.delete(change.recordId);
    else live.set(change.recordId, change.type);
  }
  const kinds = [...live.values()];
  const notes = kinds.filter(kind => kind !== "story" && kind !== "capability").length;
  const capabilities = snapshot.tree.stories.flatMap(story => story.capabilities);
  const from = new Date(snapshot.recording.window.from), to = new Date(snapshot.recording.window.to);
  const count = (n: number) => n.toLocaleString("en-GB");
  return {
    stories: count(snapshot.tree.stories.length),
    capabilities: count(capabilities.length),
    contracts: count(capabilities.reduce((sum, item) => sum + item.contracts.length, 0)),
    notes: count(notes),
    decisions: count(kinds.filter(kind => kind === "decision").length),
    recording: `${day(from)}, ${time(from)} to ${time(to)} UTC`,
    saved: day(new Date(snapshot.capturedAt)),
  };
}

/** Conduit's growth's own dates, for the words shown over its globe. */
export function growthCounts(growth: Pick<GrowthSnapshot, "window">): Record<string, string> {
  const from = new Date(growth.window.from), to = new Date(growth.window.to);
  return { conduitRecording: `${day(from)}, ${time(from)} to ${day(to)}, ${time(to)} UTC` };
}

/** Fill each {name} the counts know; an unknown name stays as written, so a gap shows instead of a guess. */
export const fill = (text: string, counts: Readonly<Record<string, string>>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => counts[name] ?? whole);
