// Capability 4 · Updates
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ReleaseChannel = "stable" | "alpha";
export interface StableBuild { readonly version: string; readonly published: string }
export interface ReleaseChannelState { readonly available: boolean; readonly channel: ReleaseChannel; readonly stable?: StableBuild }
export const STABLE_BRANCH = "release-channel-stable";
export const STABLE_FEED = `https://raw.githubusercontent.com/storytree-ai/storytree/${STABLE_BRANCH}/`;

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

export function releaseChannelChoice(options: { available: boolean; home: string; marker: () => string; stable?: () => Promise<StableBuild | undefined> }) {
  const read = (): ReleaseChannelState => ({ available: options.available, channel: releaseChannel(options.home, options.marker()) });
  return {
    read,
    async describe(): Promise<ReleaseChannelState> {
      const state = read();
      const stable = state.available ? await options.stable?.() : undefined;
      return stable ? { ...state, stable } : state;
    },
    set(value: unknown): ReleaseChannelState {
      if (!options.available) throw new Error("Only the installed app follows an update channel.");
      if (value !== "alpha" && value !== "stable") throw new Error("Choose alpha or stable.");
      mkdirSync(options.home, { recursive: true });
      writeFileSync(path.join(options.home, "release-channel.json"), JSON.stringify({ schema: 1, channel: value }) + "\n");
      return read();
    },
  };
}
