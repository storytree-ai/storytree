/**
 * Test support: work states for a capture over a restored snapshot. A snapshot holds the library, not the agent
 * activity log the arc surface and the forest read work states from, so every part reads planned;
 * this writes the lines that make each named part read as stated. A part named planned gets no line.
 */
import type { ActivityLog, NewLine } from "@storytree/agent-link";
import type { PartState } from "@storytree/arc-surface";

const SEEDER = { source: "tool", session: "capture-seed" } as const;

/** Write into `project`'s log the lines that give each capability in `states` its state; each claim is released at once, so no live session shows. */
export async function seedWorkStates(log: Pick<ActivityLog, "append">, project: string, states: Readonly<Record<string, PartState>>): Promise<void> {
  for (const [capability, state] of Object.entries(states)) {
    if (state === "planned") continue;
    const lines: NewLine[] = [
      { ...SEEDER, kind: "claimed", capability, reason: "seeded for a capture" },
      { ...SEEDER, kind: "released", capability },
    ];
    if (state === "landed") lines.push({ ...SEEDER, kind: "landed", capability });
    for (const line of lines) await log.append(project, line);
  }
}
