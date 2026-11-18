// Capability 4 · Updates
import type { ReleaseChannel } from "./release-channel.js";

export type UpdateAction = "check" | "install" | "status";
export interface UpdateState {
  readonly phase: "idle" | "checking" | "up-to-date" | "ready" | "pending" | "restarting" | "failed" | "unavailable";
  readonly runningBuild: string;
  readonly nextBuild?: string;
  readonly reason?: string;
  readonly channel?: ReleaseChannel;
  readonly checkedAt?: string;
}

export function noUpdates(runningBuild: () => string) {
  return {
    request(action: unknown): UpdateState {
      if (action !== "check" && action !== "install" && action !== "status") throw new Error("Unknown update action");
      return { phase: "unavailable", runningBuild: runningBuild() };
    },
  };
}
