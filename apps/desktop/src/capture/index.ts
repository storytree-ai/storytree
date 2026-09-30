/** Not yet built: the red half of the capture kit. */
import type { ActivityLog } from "@storytree/agent-link";
import type { PartState } from "@storytree/arc-surface";

import type { StorytreeBridge } from "../bridge.js";

export function fakeBridge(_answers: Partial<StorytreeBridge>): { call(method: string, args: readonly unknown[]): Promise<unknown>; readonly unanswered: Promise<never> } {
  return { call: async () => undefined, unanswered: new Promise<never>(() => {}) };
}

export function launchPlan(_machine: { env: Record<string, string | undefined>; platform: NodeJS.Platform }): { module: string; options: { executablePath?: string } } {
  return { module: "/home/mickh/code/Storytree/node_modules/playwright-core/index.mjs", options: { executablePath: "/home/mickh/.cache/ms-playwright/chrome" } };
}

export async function seedWorkStates(_log: Pick<ActivityLog, "append">, _project: string, _states: Readonly<Record<string, PartState>>): Promise<void> {}
