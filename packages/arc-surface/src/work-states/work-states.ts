/**
 * Capability 1 · Work states (stories/arc-surface.md), at part grain: every part shows exactly one
 * state, worked out by one rule from the records, so no two views can disagree. The forest reads
 * the same rule (ADR-0632 D3), so it and the overlay always agree on "landed".
 *
 * A part is planned until a line claims it. From its first claim it is in progress, and it stays in
 * progress until a landed report, even if its holder releases it or its window closes: in progress
 * means started and not landed (the owner's B1), and who is on it is the claim reading's business,
 * not this one's. A landed report makes it landed, and a new claim after that makes it in progress
 * again, since the part is being worked on once more. A story follows its parts.
 *
 * The increment and arc grains wait for the library's and the agent link's revised trees, which
 * store increments, questions and waits (ADR-0638 D4).
 *
 * It is a pure function of the agent activity log's lines, so the page can run it, and it is tested
 * without a database.
 */
import type { Line } from "@storytree/agent-link";

/** Where a part stands. */
export type PartState = "planned" | "in-progress" | "landed";

/** The one reading of where each part, and each story from its parts, stands. */
export interface WorkStates {
  /** Where the part (a capability, by its id in the library) stands. */
  part(id: string): PartState;
  /**
   * Where a story stands, from its parts' ids: planned while every part is planned or it has none,
   * landed once every part has landed, and in progress otherwise.
   */
  story(parts: readonly string[]): PartState;
}

/** The work states `lines` show: the project's agent activity log, oldest first, as linesSince hands it out. */
export function workStates(lines: readonly Line[]): WorkStates {
  const parts = new Map<string, PartState>();
  for (const line of lines) {
    if (line.kind === "claimed" && line.capability !== undefined) parts.set(line.capability, "in-progress");
    else if (line.kind === "landed") parts.set(line.capability, "landed");
  }
  const part = (id: string): PartState => parts.get(id) ?? "planned";
  return {
    part,
    story(ids) {
      const states = ids.map(part);
      if (states.every((state) => state === "planned")) return "planned";
      if (states.every((state) => state === "landed")) return "landed";
      return "in-progress";
    },
  };
}
