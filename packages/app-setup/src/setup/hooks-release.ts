/**
 * Capability 8 · Setup check. Which release the registered hooks run, against the latest release (contract 8.18). The desktop
 * app installs the hooks and updates them only while it runs, so a machine where it stays closed
 * keeps running an old build with nothing saying so (friction_f42b5554bbad: the laptop's hooks ran
 * v0.3.309 while v0.3.333 was out, and a merged fix never reached them). A build states its release
 * in a `release.json` beside its scripts; GitHub is asked for the latest only when one does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { ask } from "./machine.js";

/** Where storytree's releases are published, as the app's updater reads them. */
const RELEASES = "storytree-ai/storytree";
const GH_WAIT_MS = 10_000;

/** The latest release's version (`0.3.333`), or undefined when it cannot be learned now. */
export type LatestRelease = () => Promise<string | undefined>;

export interface HooksRelease {
  /** The oldest release the registered hooks run, or undefined when no hook build states one. */
  readonly running: string | undefined;
  /** The latest release, or undefined when not asked or GitHub did not answer. */
  readonly latest: string | undefined;
}

/** The release each registered hook `scripts` runs, the oldest of them, and the latest release. */
export async function hooksRelease(scripts: readonly string[], latestRelease: LatestRelease = ghLatestRelease): Promise<HooksRelease> {
  const versions = scripts.flatMap((script) => {
    const version = statedRelease(path.dirname(script));
    return version === undefined ? [] : [version];
  });
  if (versions.length === 0) return { running: undefined, latest: undefined };
  const running = versions.reduce((oldest, version) => (compareVersions(version, oldest) < 0 ? version : oldest));
  return { running, latest: await latestRelease().catch(() => undefined) };
}

/** Whether release `a` is older (<0), the same (0) or newer (>0) than `b`, part by numeric part. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The latest release's version, through `gh`: undefined when gh is missing, signed out or slow. */
export const ghLatestRelease: LatestRelease = async () => {
  const answer = await ask("gh", ["release", "view", "--repo", RELEASES, "--json", "tagName", "--jq", ".tagName"], process.env, GH_WAIT_MS, { shell: false });
  if (!answer.answered || answer.code !== 0) return undefined;
  const tag = answer.out.trim().replace(/^v/, "");
  return tag === "" ? undefined : tag;
};

/** The release a build in `folder` states in its release.json, if it states one. */
function statedRelease(folder: string): string | undefined {
  try {
    const stated = JSON.parse(readFileSync(path.join(folder, "release.json"), "utf8")) as { version?: unknown };
    return typeof stated.version === "string" && stated.version !== "" ? stated.version : undefined;
  } catch {
    return undefined;
  }
}
