/**
 * Capability 4 · Updates: what the gear's Updates panel asks and is told. An app that installs releases answers with
 * its ReleaseUpdater; any other copy (a development checkout, a portable build) answers that it does not update itself
 * (contract 4.10).
 */
import type { ReleaseChannel } from "./release-channel.js";

/** "install" asks for a downloaded release at once, past the install choice (never past a seed). */
export type UpdateAction = "check" | "install" | "status";
export interface UpdateState {
  readonly phase: "idle" | "checking" | "up-to-date" | "ready" | "pending" | "restarting" | "failed" | "unavailable";
  readonly runningBuild: string;
  readonly nextBuild?: string;
  readonly reason?: string;
  /** Up to date: the channel the check followed, where the app follows one, and when it checked (an ISO time). */
  readonly channel?: ReleaseChannel;
  readonly checkedAt?: string;
}

/** The Updates panel's answer in a copy that does not install releases: every request reads unavailable, and nothing is fetched or restarted. */
export function noUpdates(runningBuild: () => string) {
  return {
    request(action: unknown): UpdateState {
      if (action !== "check" && action !== "install" && action !== "status") throw new Error("Unknown update action");
      return { phase: "unavailable", runningBuild: runningBuild() };
    },
  };
}
