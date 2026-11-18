import type { ActivityLog } from "@storytree/session-management";
import type { NewLine } from "@storytree/library";
import type { PartState } from "@storytree/arc-surface";

const SEEDER = { source: "tool", session: "capture-seed" } as const;

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
