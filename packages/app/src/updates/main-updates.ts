/** Capability 4 · Updates: one check/build/restart flow for the gear and background timer. */
import { buildApp, updateToMain, type RunningBuild } from "./follow-main.js";

export const UPDATE_EVERY_MS = 3 * 60_000;

export type UpdateAction = "check" | "status";
export interface UpdateState {
  readonly phase: "idle" | "checking" | "up-to-date" | "building" | "ready" | "restarting" | "failed" | "unavailable";
  readonly runningBuild: string;
  readonly nextBuild?: string;
  readonly reason?: string;
}

interface MainUpdatesOptions {
  runtimeDir: string;
  running?: RunningBuild;
  runningBuild: string;
  /** Health refresh must finish before a check can restart the database beneath it. */
  prepare?: () => Promise<void>;
  canRestart(): Promise<boolean>;
  restart(build: RunningBuild): Promise<void>;
  update?: typeof updateToMain;
  log?: (message: string) => void;
}

export function mainUpdates(options: MainUpdatesOptions) {
  let state: UpdateState = { phase: options.running ? "idle" : "unavailable", runningBuild: options.runningBuild };
  let inFlight: Promise<UpdateState> | undefined;
  let prepared: Promise<void> | undefined;
  let ready: RunningBuild | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const set = (phase: UpdateState["phase"], detail: Partial<UpdateState> = {}) => {
    state = { phase, runningBuild: options.runningBuild, ...detail };
    options.log?.(`updates: ${phase}${state.nextBuild ? ` ${state.nextBuild}` : ""}${state.reason ? `: ${state.reason}` : ""}`);
  };
  const perform = async (): Promise<UpdateState> => {
    try {
      prepared ??= options.prepare?.() ?? Promise.resolve();
      await prepared;
      if (stopped) return state;
      ready ??= await (options.update ?? updateToMain)({
        runtimeDir: options.runtimeDir, running: options.running!, build: buildApp,
        onBuilding: sha => set("building", { nextBuild: `main ${sha.slice(0, 7)}` }),
      });
      if (stopped) return state;
      if (ready === undefined) { set("up-to-date"); return state; }
      const nextBuild = `main ${ready.sha.slice(0, 7)}`;
      set("ready", { nextBuild });
      if (!(await options.canRestart()) || stopped) return state;
      set("restarting", { nextBuild });
      // Let the gear's status reading paint before shutting down its window.
      await new Promise(resolve => setTimeout(resolve, 750));
      if (stopped) return state;
      // A seed may have started during the notice; the same guard applies to either entry point.
      if (!(await options.canRestart())) { set("ready", { nextBuild }); return state; }
      if (!stopped) await options.restart(ready);
    } catch (error) {
      set("failed", { reason: error instanceof Error ? error.message : String(error) });
    }
    return state;
  };
  const check = (): Promise<UpdateState> => {
    if (inFlight !== undefined) return inFlight;
    if (stopped || options.running === undefined || state.phase === "restarting") return Promise.resolve(state);
    if (ready === undefined) set("checking");
    inFlight = perform().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    check,
    /** One IPC call: asking starts work; subsequent status reads never start another build. */
    request(action: unknown): UpdateState {
      if (action !== "check" && action !== "status") throw new Error("Unknown update action");
      if (action === "check") void check();
      return state;
    },
    start(): void {
      if (timer !== undefined || stopped || options.running === undefined) return;
      timer = setInterval(() => void check(), UPDATE_EVERY_MS);
      timer.unref();
      void check();
    },
    stop(): void { stopped = true; clearInterval(timer); },
  };
}
