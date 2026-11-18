// Capability 4 · Updates
import { isUnreachable, outageSaidOnce } from "@storytree/library/connection-error";

import { insideHours, type InstallChoice } from "./install-choice.js";

export const SETTLE_MS = 10 * 60_000;
export const QUIET_MS = 10 * 60_000;

export interface InstallMoment {
  readonly now: number;
  readonly launchedAt: number;
  readonly windowActiveAt?: number;
  readonly agentActiveAt?: number;
  readonly asked?: boolean;
  readonly choice?: InstallChoice;
  readonly minuteOfDay?: number;
}

export function whenToInstall(moment: InstallMoment): "now" | "wait" {
  if (moment.asked === true) return "now";
  const { choice } = moment;
  if (choice?.mode === "manual") return "wait";
  if (choice?.mode === "hours" && (moment.minuteOfDay === undefined || !insideHours(choice, moment.minuteOfDay))) return "wait";
  const recent = (at: number | undefined, span: number) => at !== undefined && moment.now - at < span;
  if (recent(moment.launchedAt, SETTLE_MS) || recent(moment.windowActiveAt, QUIET_MS) || recent(moment.agentActiveAt, QUIET_MS)) return "wait";
  return "now";
}

export interface QuietMomentOptions {
  readonly launchedAt: number;
  readonly now?: () => Date;
  readonly choice: () => InstallChoice;
  readonly windowActiveAt: () => number | undefined;
  readonly agentActiveAt: () => Promise<number | undefined>;
  readonly log?: (line: string) => void;
}

export function quietMoment(options: QuietMomentOptions): () => Promise<boolean> {
  const outage = outageSaidOnce(line => options.log?.(`releases: ${line}`));
  return async () => {
    const clock = options.now?.() ?? new Date();
    const windowActiveAt = options.windowActiveAt();
    let agentActiveAt: number | undefined;
    try {
      agentActiveAt = await options.agentActiveAt();
      outage.answered();
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      outage.failed("whether an agent is at work could not be read", error);
      return false;
    }
    return whenToInstall({
      now: clock.getTime(), launchedAt: options.launchedAt, choice: options.choice(),
      minuteOfDay: clock.getHours() * 60 + clock.getMinutes(),
      ...(windowActiveAt === undefined ? {} : { windowActiveAt }),
      ...(agentActiveAt === undefined ? {} : { agentActiveAt }),
    }) === "now";
  };
}
