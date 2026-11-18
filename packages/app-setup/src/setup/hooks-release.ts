// Capability 8 · Setup check.
import { readFileSync } from "node:fs";
import path from "node:path";

import { ask } from "./machine.js";

const RELEASES = "storytree-ai/storytree";
const GH_WAIT_MS = 10_000;

export type LatestRelease = () => Promise<string | undefined>;

export interface HooksRelease {
  readonly running: string | undefined;
  readonly latest: string | undefined;
}

export async function hooksRelease(scripts: readonly string[], latestRelease: LatestRelease = ghLatestRelease): Promise<HooksRelease> {
  const versions = scripts.flatMap((script) => {
    const version = statedRelease(path.dirname(script));
    return version === undefined ? [] : [version];
  });
  if (versions.length === 0) return { running: undefined, latest: undefined };
  const running = versions.reduce((oldest, version) => (compareVersions(version, oldest) < 0 ? version : oldest));
  return { running, latest: await latestRelease().catch(() => undefined) };
}

export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const ghLatestRelease: LatestRelease = async () => {
  const answer = await ask("gh", ["release", "view", "--repo", RELEASES, "--json", "tagName", "--jq", ".tagName"], process.env, GH_WAIT_MS, { shell: false });
  if (!answer.answered || answer.code !== 0) return undefined;
  const tag = answer.out.trim().replace(/^v/, "");
  return tag === "" ? undefined : tag;
};

function statedRelease(folder: string): string | undefined {
  try {
    const stated = JSON.parse(readFileSync(path.join(folder, "release.json"), "utf8")) as { version?: unknown };
    return typeof stated.version === "string" && stated.version !== "" ? stated.version : undefined;
  } catch {
    return undefined;
  }
}
