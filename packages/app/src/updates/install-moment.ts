/**
 * Capability 4 · Updates, contract 4.4: when a downloaded release may restart the installed app.
 * Installing stops the app and its database for a minute or two, so it waits for a quiet moment.
 */
import { insideHours, type InstallChoice } from "./install-choice.js";

/** How long after a launch the app is left alone: its user, or an agent, has just opened it. */
export const SETTLE_MS = 10 * 60_000;
/** How long the window and agents must have been idle before the app counts as unused. */
export const QUIET_MS = 10 * 60_000;

export interface InstallMoment {
  readonly now: number;
  readonly launchedAt: number;
  /** When someone last used the open window; undefined while no window is showing. */
  readonly windowActiveAt?: number;
  /** When an agent session that has not ended last wrote to the activity log; undefined if none. */
  readonly agentActiveAt?: number;
  /** The user asked for the update from the gear. */
  readonly asked?: boolean;
  /** When the user lets a release install itself (4.13); undefined reads as any quiet moment. */
  readonly choice?: InstallChoice;
  /** The local time of day, in minutes after midnight, for quiet hours. */
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
  /** The user's install choice (4.13), read at each check so a change in Settings applies at once. */
  readonly choice: () => InstallChoice;
  /** When someone last used the window; undefined while no window is showing. */
  readonly windowActiveAt: () => number | undefined;
  readonly agentActiveAt: () => Promise<number | undefined>;
}

/** Whether now is a moment to restart into an update unasked: one check, shared by releases and merged-main builds. */
export function quietMoment(options: QuietMomentOptions): () => Promise<boolean> {
  return async () => {
    const clock = options.now?.() ?? new Date();
    const windowActiveAt = options.windowActiveAt(), agentActiveAt = await options.agentActiveAt();
    return whenToInstall({
      now: clock.getTime(), launchedAt: options.launchedAt, choice: options.choice(),
      minuteOfDay: clock.getHours() * 60 + clock.getMinutes(),
      ...(windowActiveAt === undefined ? {} : { windowActiveAt }),
      ...(agentActiveAt === undefined ? {} : { agentActiveAt }),
    }) === "now";
  };
}
