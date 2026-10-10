/** Capability 2 · The forest on the site. */
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

/** Storytree's own growth's days and the shop's day, for the words shown over their globes; and the decisions the shop's agents
 * had written by the survey the map chapter ends on (the stage `until`), which the knowledge chapter opens on. */
export function growthCounts(own: Pick<GrowthSnapshot, "window">, shop: Pick<GrowthSnapshot, "window" | "changes" | "stages">, until = "pr7-building"): Record<string, string> {
  const end = shop.stages.find(stage => stage.id === until)?.at ?? shop.window.to;
  const decisions = new Set((shop.changes ?? []).filter(change => change.type === "decision" && change.record.createdAt <= end).map(change => change.recordId));
  return { ownRecording: `${day(new Date(own.window.from))} to ${day(new Date(own.window.to))}`, shopDay: day(new Date(shop.window.to)), shopDecisions: String(decisions.size) };
}

/** Fill each {name} the counts know; an unknown name stays as written, so a gap shows instead of a guess. */
export const fill = (text: string, counts: Readonly<Record<string, string>>) => text.replace(/\{(\w+)\}/g, (whole, name: string) => counts[name] ?? whole);
