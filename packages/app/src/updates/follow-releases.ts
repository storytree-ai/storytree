/**
 * Capability 4 · Updates: how an installed app follows its releases, apart from Electron. It checks at start and every
 * three minutes until it quits (contract 4.30); a Linux AppImage refreshes the agent tools beside it (4.31) and every installed app points the agents at its build's copy (4.42); the
 * gear's channel is offered only where releases install themselves, and never in a smoke check (4.32).
 */
import path from "node:path";

/** How often a following app checks for a release. */
export const RELEASE_CHECK_EVERY_MS = 3 * 60_000;

/**
 * Checks now and every `every` until stopped: a check that fails is logged and the next goes ahead, and one that finds
 * a release waiting for its moment logs `waiting()`'s line. Stopping ends the checks and the updater.
 */
export function keepCheckingReleases({ updater, log, waiting, every = RELEASE_CHECK_EVERY_MS }: {
  updater: { check(): Promise<string>; stop(): void };
  log: { info(line: string): void; error(error: unknown): void };
  waiting: () => string;
  every?: number;
}): { stop(): void } {
  const check = async (): Promise<void> => {
    try {
      if (await updater.check() === "waiting") log.info(waiting());
    } catch (error) { log.error(error); }
  };
  const timer = setInterval(() => void check(), every);
  timer.unref();
  void check();
  return { stop: () => { clearInterval(timer); updater.stop(); } };
}

/**
 * An installed Linux AppImage that replaced itself puts its own agent tools beside it (4.31); then every installed app
 * (Windows, a Mac, a Linux AppImage) points the agents at its own build's copy of the tools under the home, so none runs
 * from the installation the next update replaces, and a session still open keeps the copy it started (4.42).
 * `refresh` copies this build's tools into a folder, saying whether it changed anything, and `follow` re-points the
 * agents, saying which moved and which could not and why; one that fails is said, and the app starts all the same.
 */
export async function refreshAgentTools({ platform, appImage, refresh, follow, log }: {
  platform: NodeJS.Platform;
  appImage: string | undefined;
  refresh: (folder: string) => boolean;
  follow?: () => Promise<{ readonly moved: readonly string[]; readonly notMoved: readonly { readonly agent: string; readonly reason: string }[] } | undefined>;
  log: { log(line: string): void; error(line: string): void };
}): Promise<void> {
  if (platform === "linux") {
    if (appImage === undefined) return;
    try {
      if (refresh(path.dirname(appImage))) log.log("Agent tools updated to this build's");
    } catch (error) { log.error(`Agent tools could not be updated: ${error instanceof Error ? error.message : String(error)}`); }
  } else if (platform !== "win32" && platform !== "darwin") return;
  if (follow === undefined) return;
  try {
    const followed = await follow();
    if (followed !== undefined && followed.moved.length > 0) {
      const names = followed.moved.length === 1 ? followed.moved[0] : `${followed.moved.slice(0, -1).join(", ")} and ${followed.moved.at(-1)}`;
      log.log(`${names} now ${followed.moved.length === 1 ? "runs" : "run"} this build's copy of the agent tools`);
    }
    for (const { agent, reason } of followed?.notMoved ?? []) log.error(`${agent} still runs an older copy of the agent tools, tried again at the next start: ${reason}`);
  } catch (error) { log.error(`Agent tools could not be pointed at this build's: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Whether the gear offers the update channel: only where releases install themselves, and not in a smoke check. */
export function channelOffered({ smoke, followsReleases }: { smoke: boolean; followsReleases: boolean }): boolean {
  return !smoke && followsReleases;
}
