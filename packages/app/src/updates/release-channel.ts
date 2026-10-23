/** Capability 4 · Updates. Contract 4.15: channel identity belongs to the installation, outside replaceable app files; 4.24: the user may choose it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReleaseChannel = "stable" | "alpha";
/** Whether this app installs releases, so the channel means something here, and the channel it follows. */
export interface ReleaseChannelState { readonly available: boolean; readonly channel: ReleaseChannel }
export const STABLE_BRANCH = "release-channel-stable";
export const STABLE_FEED = `https://raw.githubusercontent.com/storytree-ai/storytree/${STABLE_BRANCH}/`;

/** Only the old NSIS marker denotes an existing alpha install; new installers say nsis-stable. A record written under
 * alpha's old name, development, is read as alpha (ADR-1121), so an owner install never drifts to stable. */
export function releaseChannel(home: string, marker: string): ReleaseChannel {
  const file = path.join(home, "release-channel.json");
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    if (record.schema !== 1 || !["stable", "alpha", "development"].includes(record.channel)) throw new Error("invalid record");
    return record.channel === "stable" ? "stable" : "alpha";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Cannot read the installation's release channel: ${error instanceof Error ? error.message : String(error)}`);
  }
  const channel = marker.trim() === "nsis" ? "alpha" : "stable";
  mkdirSync(home, { recursive: true });
  try { writeFileSync(file, JSON.stringify({ schema: 1, channel }) + "\n", { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return releaseChannel(home, marker);
    throw error;
  }
  return channel;
}

/**
 * The gear's update channel (4.24): read as releaseChannel decides, so a first user reads stable, and kept by
 * rewriting release-channel.json, which the updater reads again on its next check. `marker` is the installer's.
 */
export function releaseChannelChoice(options: { available: boolean; home: string; marker: () => string }) {
  const read = (): ReleaseChannelState => ({ available: options.available, channel: releaseChannel(options.home, options.marker()) });
  return {
    read,
    /** Refused unless the app installs releases here and the channel is one. */
    set(value: unknown): ReleaseChannelState {
      if (!options.available) throw new Error("Only the installed app follows an update channel.");
      if (value !== "alpha" && value !== "stable") throw new Error("Choose alpha or stable.");
      mkdirSync(options.home, { recursive: true });
      writeFileSync(path.join(options.home, "release-channel.json"), JSON.stringify({ schema: 1, channel: value }) + "\n");
      return read();
    },
  };
}
