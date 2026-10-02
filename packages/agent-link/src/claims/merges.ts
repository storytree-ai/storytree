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

/** Every merged pull request of the project's repository, by the branch it came from, asked of GitHub from the project's `folder`. */
export type AllMergedPulls = (folder: string) => Promise<Map<string, MergedPull[]>>;

/** The open pull requests from `branch` that wait in the merge queue, by number, asked of GitHub from the project's `folder`. */
export type QueuedPulls = (folder: string, branch: string) => Promise<number[]>;

/** How merges are watched for. */
export interface MergeWatch {
  /** How to ask GitHub. By default, through `gh`. */
  readonly mergedPulls?: MergedPulls;
  /** How to ask GitHub which pull requests wait in the merge queue (ADR-0796). By default, through `gh`. */
  readonly queuedPulls?: QueuedPulls;
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
  return endMergedOn(context, watch, () => true);
}

/**
 * End the claim `claim` if a pull request from its branch has merged since it was taken, asked now
 * rather than on the watch's next look: a session re-claiming work right after its merge must not
 * be sent back to the merged branch. Only that branch is asked about. Whether it ended.
 */
export async function endIfMerged(context: MergeContext, claim: Claim, watch: MergeWatch = {}): Promise<boolean> {
  if (claim.branch === undefined) return false;
  await endMergedOn(context, watch, (branch) => branch === claim.branch);
  const same = (held: Claim) => held.session === claim.session && held.since === claim.since && held.increment === claim.increment && held.capability === claim.capability;
  return !(await readClaims(context.log, context.project)).some(same);
}

async function endMergedOn(context: MergeContext, watch: MergeWatch, asked: (branch: string) => boolean): Promise<Line[]> {
  const claims = (await readClaims(context.log, context.project)).filter((claim) => claim.branch !== undefined && asked(claim.branch));
  if (claims.length === 0) return [];
  const ask = watch.mergedPulls ?? ghMergedPulls;
  const merged = new Map<string, MergedPull[]>();
  for (const branch of new Set(claims.map((claim) => claim.branch!))) merged.set(branch, await ask(context.folder, branch).catch(() => []));

  // With no merge observed, nothing can be released: do not make readers queue behind writers.
  if (![...merged.values()].some((pulls) => pulls.length > 0)) return [];

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

/**
 * The pull requests from `branch` waiting in the merge queue, through `gh`'s GraphQL (its `pr` commands
 * do not say): nothing when `gh` is missing, signed out or slow. A push to a queued branch takes its
 * pull request out of the queue, so such a branch can take no more commits.
 */
export const ghQueuedPulls: QueuedPulls = async (folder, branch) => {
  const query = "query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){pullRequests(headRefName:$branch,states:OPEN,first:10){nodes{number isInMergeQueue}}}}";
  const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `branch=${branch}`, "-f", `query=${query}`];
  const answer = await ask("gh", args, process.env, GH_TIMEOUT_MS, { cwd: folder, shell: false });
  if (!answer.answered || answer.code !== 0) return [];
  try {
    const nodes = (JSON.parse(answer.out) as { data?: { repository?: { pullRequests?: { nodes?: unknown } } } }).data?.repository?.pullRequests?.nodes;
    return Array.isArray(nodes) ? nodes.filter((pull) => pull?.isInMergeQueue === true && typeof pull.number === "number").map((pull) => pull.number as number) : [];
  } catch {
    return [];
  }
};

/** Whether `claim`'s branch has a pull request waiting in the merge queue. */
export async function inMergeQueue(folder: string, claim: Claim, watch: MergeWatch = {}): Promise<boolean> {
  if (claim.branch === undefined) return false;
  return ((await (watch.queuedPulls ?? ghQueuedPulls)(folder, claim.branch).catch(() => [])).length > 0);
}

/** How many merged pull requests one look reads, newest first, and how long `gh` may take to list them. */
const ALL_LIMIT = 1_000;
const ALL_TIMEOUT_MS = 10_000;

/** Every merged pull request, by its branch, in one call to `gh`: nothing when `gh` is missing, signed out or slow. */
export const ghAllMergedPulls: AllMergedPulls = async (folder) => {
  const args = ["pr", "list", "--state", "merged", "--json", "number,mergedAt,headRefName", "--limit", String(ALL_LIMIT)];
  const answer = await ask("gh", args, process.env, ALL_TIMEOUT_MS, { cwd: folder, shell: false });
  const byBranch = new Map<string, MergedPull[]>();
  if (!answer.answered || answer.code !== 0) return byBranch;
  try {
    const pulls = JSON.parse(answer.out) as unknown;
    for (const pull of Array.isArray(pulls) ? pulls : []) {
      if (typeof pull?.number !== "number" || typeof pull?.mergedAt !== "string" || typeof pull?.headRefName !== "string") continue;
      byBranch.set(pull.headRefName, [...(byBranch.get(pull.headRefName) ?? []), { number: pull.number, mergedAt: pull.mergedAt }]);
    }
  } catch {
    // Not what gh prints: no merge seen.
  }
  return byBranch;
};

/** An open pull request, as GitHub reports it (contract 4.24). */
export interface OpenPull {
  readonly number: number;
  readonly draft: boolean;
  /** Its head commit's checks, taken together; none when it has no checks. */
  readonly checks?: "pending" | "passing" | "failing";
  /** Whether it waits in the merge queue (ADR-0796). */
  readonly queued: boolean;
}

/** Every open pull request of the project's repository, by the branch it comes from; undefined when GitHub could not say. */
export type AllOpenPulls = (folder: string) => Promise<Map<string, OpenPull> | undefined>;

/** How GitHub sums up a commit's checks, as one of three. */
const CHECKS: Readonly<Record<string, OpenPull["checks"]>> = { SUCCESS: "passing", PENDING: "pending", EXPECTED: "pending", FAILURE: "failing", ERROR: "failing" };

/**
 * Every open pull request, by its branch, in one call to `gh`: its GraphQL, since `gh pr list` does
 * not say which wait in the merge queue. Undefined when `gh` is missing, signed out or slow.
 */
export const ghAllOpenPulls: AllOpenPulls = async (folder) => {
  const query = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number headRefName isDraft isInMergeQueue commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}";
  const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${query}`];
  const answer = await ask("gh", args, process.env, ALL_TIMEOUT_MS, { cwd: folder, shell: false });
  if (!answer.answered || answer.code !== 0) return undefined;
  try {
    const nodes = (JSON.parse(answer.out) as { data?: { repository?: { pullRequests?: { nodes?: unknown } } } }).data?.repository?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) return undefined;
    const byBranch = new Map<string, OpenPull>();
    for (const pull of nodes) {
      if (typeof pull?.number !== "number" || typeof pull?.headRefName !== "string" || byBranch.has(pull.headRefName)) continue;
      const checks = CHECKS[pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ""];
      byBranch.set(pull.headRefName, { number: pull.number, draft: pull.isDraft === true, ...(checks === undefined ? {} : { checks }), queued: pull.isInMergeQueue === true });
    }
    return byBranch;
  } catch {
    return undefined;
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
