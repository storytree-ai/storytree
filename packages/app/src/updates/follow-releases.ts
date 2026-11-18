// Capability 4 · Updates
import path from "node:path";

export const RELEASE_CHECK_EVERY_MS = 3 * 60_000;

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

export function installationFolder({ platform, execPath, appImage }: { platform: NodeJS.Platform; execPath: string; appImage: string | undefined }): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (platform === "linux" && appImage !== undefined) return paths.dirname(appImage);
  if (platform === "darwin") return paths.dirname(paths.dirname(paths.dirname(execPath)));
  return paths.dirname(execPath);
}

export function channelOffered({ smoke, followsReleases }: { smoke: boolean; followsReleases: boolean }): boolean {
  return !smoke && followsReleases;
}
