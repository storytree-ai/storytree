/**
 * Release on merge (ADR-0643 D3, the owner's M): a claim ends when a pull request from the branch
 * it was taken on merges. Storytree assumes the project is on GitHub, as its own is, and asks
 * GitHub through `gh`, which also sees squash merges that git alone cannot.
 *
 * - A claim records the branch its session's folder was on when it was taken (claims.ts). Only a
 *   pull request merged after that ends it, so a branch used again after an earlier merge keeps
 *   its new claim.
 * - The tool server looks at each tool call, and the hooks at each line they write, but each
 *   project is asked about at most once a minute (everyMs), since asking GitHub takes a moment: a
 *   stamp in the temporary folder, shared by every hook and tool server on the machine, says when
 *   it was last asked. A project whose held claims name no branch is never asked about.
 * - The "merged" line is written by whichever session saw the merge, naming the holder, so that it
 *   never makes an idle holder read as live.
 * - Nothing here ever fails a hook or a tool: `gh` missing, signed out or slow means no merge seen.
 */
import { statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ActivityLog, Line } from "../activity/index.js";
export { currentBranch } from "../activity/branch.js";
import { ask } from "../setup/machine.js";
import { claimsFrom, readClaims, type Claim } from "./claims.js";

/** A merged pull request, as GitHub reports it. */
export interface MergedPull {
  readonly number: number;
  /** When it merged, as an ISO 8601 timestamp. */
  readonly mergedAt: string;
}

/** The merged pull requests from `branch`, asked of GitHub from the project's `folder`. */
export type MergedPulls = (folder: string, branch: string) => Promise<MergedPull[]>;

/** How merges are watched for. */
export interface MergeWatch {
  /** How to ask GitHub. By default, through `gh`. */
  readonly mergedPulls?: MergedPulls;
  /** How often a project is asked about, at most. By default, once a minute. */
  readonly everyMs?: number;
}

/** Who is looking, and where. */
export interface MergeContext {
  readonly log: ActivityLog;
  readonly project: string;
  readonly folder: string;
  readonly session: string;
  readonly harness?: string;
  readonly source: "hook" | "tool";
}

/** How often a project is asked about, at most, by default. */
const EVERY_MS = 60_000;
/** How long `gh` may take to answer before no merge is taken as seen. */
const GH_TIMEOUT_MS = 3_000;

/** End every claim in `context.project` whose branch has a pull request merged since it was taken, each with a "merged" line. */
export async function endMergedClaims(context: MergeContext, watch: MergeWatch = {}): Promise<Line[]> {
  if (!due(context.project, watch.everyMs ?? EVERY_MS)) return [];
  const claims = (await readClaims(context.log, context.project)).filter((claim) => claim.branch !== undefined);
  if (claims.length === 0) return [];
  const ask = watch.mergedPulls ?? ghMergedPulls;
  const merged = new Map<string, MergedPull[]>();
  for (const branch of new Set(claims.map((claim) => claim.branch!))) merged.set(branch, await ask(context.folder, branch).catch(() => []));

  return context.log.locked(context.project, async (log) => {
    const written: Line[] = [];
    // Read again under the lock: a claim may have ended, or been taken again, since.
    for (const claim of claimsFrom(await log.lines())) {
      if (claim.branch === undefined) continue;
      const pull = (merged.get(claim.branch) ?? []).find((pull) => Date.parse(pull.mergedAt) > Date.parse(claim.since));
      if (pull === undefined) continue;
      written.push(
        await log.append({
          session: context.session,
          ...(context.harness === undefined ? {} : { harness: context.harness }),
          source: context.source,
          folder: context.folder,
          kind: "merged",
          ...(claim.increment === undefined ? { capability: claim.capability } : { increment: claim.increment }),
          holder: claim.session,
          branch: claim.branch,
          pr: pull.number,
        }),
      );
    }
    return written;
  });
}

/** The merged pull requests from `branch`, through `gh`, run in `folder` so it finds the project's repository. */
export const ghMergedPulls: MergedPulls = (folder, branch) => mergedPullsThrough("gh")(folder, branch);

/** The merged pull requests, asked of `command` with `prefix` before gh's own arguments. */
export const mergedPullsThrough = (command: string, prefix: readonly string[] = []): MergedPulls => async (folder, branch) => {
  // No shell: the branch is the user's, not a fixed word. gh itself is an .exe on Windows.
  const args = [...prefix, "pr", "list", "--state", "merged", "--head", branch, "--json", "number,mergedAt", "--limit", "20"];
  const answer = await ask(command, args, process.env, GH_TIMEOUT_MS, { cwd: folder, shell: false });
  if (!answer.answered || answer.code !== 0) return [];
  try {
    const pulls = JSON.parse(answer.out) as unknown;
    return Array.isArray(pulls) ? pulls.filter((pull): pull is MergedPull => typeof pull?.number === "number" && typeof pull?.mergedAt === "string") : [];
  } catch {
    return [];
  }
};

/** Whether `project` is due to be asked about again, and if so, mark it asked now. */
export function due(project: string, everyMs: number): boolean {
  if (everyMs <= 0) return true;
  const stamp = path.join(tmpdir(), `storytree-merges-${project}.stamp`);
  try {
    if (Date.now() - statSync(stamp).mtimeMs < everyMs) return false;
  } catch {
    // Never asked about on this machine.
  }
  try {
    writeFileSync(stamp, "");
  } catch {
    // Unable to mark it: it is asked about again next time, which is only slower.
  }
  return true;
}

/**
 * Who holds what, for a reader that shows it (the board): GitHub is asked first, whenever it is
 * read, not only in a minute no hook has taken, so a claim whose branch has merged is never shown.
 */
export async function boardClaims(context: MergeContext, watch: MergeWatch = {}): Promise<Claim[]> {
  await endMergedClaims(context, { ...watch, everyMs: 0 }).catch(() => []);
  return readClaims(context.log, context.project);
}
