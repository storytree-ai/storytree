/**
 * Capability 4 · Updates: how an installed app follows its releases, apart from Electron. It checks at start and every
 * three minutes until it quits (contract 4.30); only a Linux AppImage refreshes the agent tools beside it (4.31); the
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
 * An installed Linux AppImage that replaced itself puts its own agent tools beside it, where the hooks run them; no other
 * app refreshes any. `refresh` copies this build's tools into a folder and says whether it changed them; a refresh that
 * fails is said, and the app starts all the same.
 */
export function refreshAgentTools({ platform, appImage, refresh, log }: {
  platform: NodeJS.Platform;
  appImage: string | undefined;
  refresh: (folder: string) => boolean;
  log: { log(line: string): void; error(line: string): void };
}): void {
  if (platform !== "linux" || appImage === undefined) return;
  try {
    if (refresh(path.dirname(appImage))) log.log("Agent tools updated to this build's");
  } catch (error) { log.error(`Agent tools could not be updated: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Whether the gear offers the update channel: only where releases install themselves, and not in a smoke check. */
export function channelOffered({ smoke, followsReleases }: { smoke: boolean; followsReleases: boolean }): boolean {
  return !smoke && followsReleases;
}
