/** Capability 4 · Updates. Contract 4.15: channel identity belongs to the installation, outside replaceable app files; 4.24: the user may choose it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReleaseChannel = "stable" | "alpha";
/** The build stable offers, and the day it was published (4.34). */
export interface StableBuild { readonly version: string; readonly published: string }
/** Whether this app installs releases, so the channel means something here, the channel it follows, and stable's build when read. */
export interface ReleaseChannelState { readonly available: boolean; readonly channel: ReleaseChannel; readonly stable?: StableBuild }
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

/** Stable's build and its day, from the pin's latest.yml; nothing when the pin predates recording the day or cannot be read. */
export async function stableBuild(read: (url: string) => Promise<string> = fetchText): Promise<StableBuild | undefined> {
  try {
    const pin = JSON.parse(await read(`${STABLE_FEED}latest.yml`)) as { version?: unknown; releaseDate?: unknown };
    if (typeof pin.version !== "string" || typeof pin.releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(pin.releaseDate)) return undefined;
    return { version: pin.version, published: pin.releaseDate.slice(0, 10) };
  } catch (error) {
    console.error("app updates: the stable build could not be read", error);
    return undefined;
  }
}

/**
 * The gear's update channel (4.24): read as releaseChannel decides, so a first user reads stable, and kept by
 * rewriting release-channel.json, which the updater reads again on its next check. `marker` is the installer's.
 */
export function releaseChannelChoice(options: { available: boolean; home: string; marker: () => string; stable?: () => Promise<StableBuild | undefined> }) {
  const read = (): ReleaseChannelState => ({ available: options.available, channel: releaseChannel(options.home, options.marker()) });
  return {
    read,
    /** The channel with stable's build (4.34), read only where the channel is offered. */
    async describe(): Promise<ReleaseChannelState> {
      const state = read();
      const stable = state.available ? await options.stable?.() : undefined;
      return stable ? { ...state, stable } : state;
    },
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
