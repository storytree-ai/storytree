// Capability 1 · Work states.
import type { Line } from "@storytree/library";

export type PartState = "planned" | "in-progress" | "landed";

export interface WorkStates {
  part(id: string): PartState;
  story(parts: readonly string[]): PartState;
}

export function workStates(lines: readonly Line[]): WorkStates {
  const kept = keptWorkStates();
  kept.add(lines);
  return kept;
}

export function keptWorkStates(): WorkStates & { add(lines: readonly Line[]): void } {
  const parts = new Map<string, PartState>();
  const part = (id: string): PartState => parts.get(id) ?? "planned";
  return {
    add(lines) {
      for (const line of lines) {
        if (line.kind === "claimed" && line.capability !== undefined) parts.set(line.capability, "in-progress");
        else if (line.kind === "landed") parts.set(line.capability, "landed");
      }
    },
    part,
    story(ids) {
      const states = ids.map(part);
      if (states.every((state) => state === "planned")) return "planned";
      if (states.every((state) => state === "landed")) return "landed";
      return "in-progress";
    },
  };
}
