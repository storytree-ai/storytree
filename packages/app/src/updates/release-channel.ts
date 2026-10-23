/** Capability 4 · Updates. Contract 4.15: channel identity belongs to the installation, outside replaceable app files. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReleaseChannel = "stable" | "alpha";
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
