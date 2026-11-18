// Capability 5 · Claims
import { statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Library, Line } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";
export { currentBranch } from "../activity/branch.js";
import { ask } from "../sessions/ask.js";
import { claimsFrom, partOf } from "../readings.js";
import { readClaims, type Claim } from "./claims.js";
import { endClaim } from "./endings.js";

export interface MergedPull {
  readonly number: number;
  readonly mergedAt: string;
}

export type MergedPulls = (folder: string, branch: string) => Promise<MergedPull[]>;

export type AllMergedPulls = (folder: string) => Promise<Map<string, MergedPull[]>>;

export type QueuedPulls = (folder: string, branch: string) => Promise<number[]>;

export interface MergeWatch {
  readonly mergedPulls?: MergedPulls;
  readonly queuedPulls?: QueuedPulls;
  readonly allOpenPulls?: AllOpenPulls;
  readonly everyMs?: number;
}

export interface MergeContext {
  readonly log: ActivityLog;
  readonly project: string;
  readonly folder: string;
  readonly session: string;
  readonly harness?: string;
  readonly source: "hook" | "tool";
  readonly library?: Pick<Library, "applyPending"> | (() => Promise<Pick<Library, "applyPending">>);
}

const EVERY_MS = 60_000;
const GH_TIMEOUT_MS = 3_000;

export async function endMergedClaims(context: MergeContext, watch: MergeWatch = {}): Promise<Line[]> {
  if (!due(context.project, watch.everyMs ?? EVERY_MS)) return [];
  return endMergedOn(context, watch, () => true);
}

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

  if (![...merged.values()].some((pulls) => pulls.length > 0)) return [];

  return context.log.locked(context.project, async (log) => {
    const written: Line[] = [];
    for (const claim of claimsFrom(await log.standing())) {
      if (claim.branch === undefined) continue;
      const pull = (merged.get(claim.branch) ?? []).find((pull) => Date.parse(pull.mergedAt) > Date.parse(claim.since));
      if (pull === undefined) continue;
      if (claim.increment !== undefined && context.library !== undefined) {
        const increment = claim.increment;
        const reach = context.library;
        const actor = context.session.startsWith("person:") ? context.session : `session:${context.session}`;
        await Promise.resolve(typeof reach === "function" ? reach() : reach)
          .then((library) => library.applyPending(increment, `#${pull.number}`, { actor }))
          .catch(() => undefined);
      }
      const ender = { session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: context.source, folder: context.folder };
      written.push((await endClaim(log, ender, partOf(claim), { by: "merge", holder: claim.session, branch: claim.branch, pr: pull.number })).line);
    }
    return written;
  });
}

function ownHead(pull: { isCrossRepository?: unknown; headRepository?: { nameWithOwner?: unknown } | null }, repository?: unknown): boolean | undefined {
  if (typeof pull.isCrossRepository !== "boolean") return undefined;
  if (pull.isCrossRepository) return false;
  if (repository === undefined) return true;
  const head = pull.headRepository?.nameWithOwner;
  return typeof head === "string" && typeof repository === "string" ? head === repository : undefined;
}

function ownPulls<T extends object>(pulls: readonly T[], repository?: unknown): T[] | undefined {
  const own = pulls.map((pull) => ownHead(pull, repository));
  return own.includes(undefined) ? undefined : pulls.filter((_, at) => own[at]);
}

export const ghMergedPulls: MergedPulls = (folder, branch) => mergedPullsThrough("gh")(folder, branch);

export const mergedPullsThrough = (command: string, prefix: readonly string[] = []): MergedPulls => async (folder, branch) => {
  const args = [...prefix, "pr", "list", "--state", "merged", "--head", branch, "--json", "number,mergedAt,isCrossRepository", "--limit", "20"];
  const answer = await ask(command, args, process.env, GH_TIMEOUT_MS, { cwd: folder, shell: false });
  if (!answer.answered || answer.code !== 0) return [];
  try {
    const pulls = JSON.parse(answer.out) as unknown;
    const own = Array.isArray(pulls) ? ownPulls(pulls.filter((pull) => typeof pull === "object" && pull !== null)) : undefined;
    return (own ?? []).filter((pull): pull is MergedPull => typeof pull?.number === "number" && typeof pull?.mergedAt === "string")
      .map(({ number, mergedAt }) => ({ number, mergedAt }));
  } catch {
    return [];
  }
};

export const ghQueuedPulls: QueuedPulls = (folder, branch) => queuedPullsThrough("gh")(folder, branch);

export const queuedPullsThrough = (command: string, prefix: readonly string[] = []): QueuedPulls => async (folder, branch) => {
  const query = "query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){nameWithOwner pullRequests(headRefName:$branch,states:OPEN,first:10){nodes{number isInMergeQueue isCrossRepository headRepository{nameWithOwner}}}}}";
  const args = [...prefix, "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `branch=${branch}`, "-f", `query=${query}`];
  const answer = await ask(command, args, process.env, GH_TIMEOUT_MS, { cwd: folder, shell: false });
  if (!answer.answered || answer.code !== 0) return [];
  try {
    const repository = (JSON.parse(answer.out) as { data?: { repository?: { nameWithOwner?: unknown; pullRequests?: { nodes?: unknown } } } }).data?.repository;
    const nodes = repository?.pullRequests?.nodes;
    const own = Array.isArray(nodes) ? ownPulls(nodes.filter((pull) => typeof pull === "object" && pull !== null), repository?.nameWithOwner) : undefined;
    return (own ?? []).filter((pull) => pull?.isInMergeQueue === true && typeof pull.number === "number").map((pull) => pull.number as number);
  } catch {
    return [];
  }
};

export async function inMergeQueue(folder: string, claim: Claim, watch: MergeWatch = {}): Promise<boolean> {
  if (claim.branch === undefined) return false;
  return ((await (watch.queuedPulls ?? ghQueuedPulls)(folder, claim.branch).catch(() => [])).length > 0);
}

const ALL_LIMIT = 1_000;
const ALL_TIMEOUT_MS = 10_000;

export const ghAllMergedPulls: AllMergedPulls = (folder) => allMergedPullsThrough("gh")(folder);

export const allMergedPullsThrough = (command: string, prefix: readonly string[] = []): AllMergedPulls => async (folder) => {
  const args = [...prefix, "pr", "list", "--state", "merged", "--json", "number,mergedAt,headRefName,isCrossRepository", "--limit", String(ALL_LIMIT)];
  const answer = await ask(command, args, process.env, ALL_TIMEOUT_MS, { cwd: folder, shell: false });
  const byBranch = new Map<string, MergedPull[]>();
  if (!answer.answered || answer.code !== 0) return byBranch;
  try {
    const pulls = JSON.parse(answer.out) as unknown;
    for (const pull of (Array.isArray(pulls) ? ownPulls(pulls.filter((pull) => typeof pull === "object" && pull !== null)) : undefined) ?? []) {
      if (typeof pull?.number !== "number" || typeof pull?.mergedAt !== "string" || typeof pull?.headRefName !== "string") continue;
      byBranch.set(pull.headRefName, [...(byBranch.get(pull.headRefName) ?? []), { number: pull.number, mergedAt: pull.mergedAt }]);
    }
  } catch {
  }
  return byBranch;
};

export interface OpenPull {
  readonly number: number;
  readonly draft: boolean;
  readonly checks?: "pending" | "passing" | "failing";
  readonly queued: boolean;
  readonly checksSince?: string;
  readonly queuedSince?: string;
  readonly queueWaiting?: true;
}

export type AllOpenPulls = (folder: string) => Promise<Map<string, OpenPull> | undefined>;

const CHECKS: Readonly<Record<string, OpenPull["checks"]>> = { SUCCESS: "passing", PENDING: "pending", EXPECTED: "pending", FAILURE: "failing", ERROR: "failing" };

const OPEN_PAGES = 10;

export const ghAllOpenPulls: AllOpenPulls = (folder) => allOpenPullsThrough("gh")(folder);

export const allOpenPullsThrough = (command: string, prefix: readonly string[] = []): AllOpenPulls => async (folder) => {
  const query = "query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){nameWithOwner pullRequests(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number headRefName isDraft isInMergeQueue isCrossRepository headRepository{nameWithOwner} mergeQueueEntry{enqueuedAt state} commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){nodes{... on CheckRun{startedAt}}}}}}}}}}}";
  const byBranch = new Map<string, OpenPull>();
  let after: string | undefined;
  for (let page = 0; page < OPEN_PAGES; page++) {
    const args = [...prefix, "api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", ...(after === undefined ? [] : ["-f", `after=${after}`]), "-f", `query=${query}`];
    const answer = await ask(command, args, process.env, ALL_TIMEOUT_MS, { cwd: folder, shell: false });
    if (!answer.answered || answer.code !== 0) return undefined;
    try {
      type Page = { data?: { repository?: { nameWithOwner?: unknown; pullRequests?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown }; nodes?: unknown } } } };
      const repository = (JSON.parse(answer.out) as Page).data?.repository;
      const { nodes, pageInfo } = repository?.pullRequests ?? {};
      const own = Array.isArray(nodes) ? ownPulls(nodes.filter((pull) => typeof pull === "object" && pull !== null), repository?.nameWithOwner) : undefined;
      if (own === undefined || typeof pageInfo?.hasNextPage !== "boolean") return undefined;
      for (const pull of own) {
        if (typeof pull?.number !== "number" || typeof pull?.headRefName !== "string" || byBranch.has(pull.headRefName)) continue;
        const rollup = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup;
        const checks = CHECKS[rollup?.state ?? ""];
        byBranch.set(pull.headRefName, { number: pull.number, draft: pull.isDraft === true, ...(checks === undefined ? {} : { checks }), queued: pull.isInMergeQueue === true, ...ciTimes(rollup?.contexts?.nodes, pull.mergeQueueEntry) });
      }
      if (!pageInfo.hasNextPage) return byBranch;
      if (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor === "") return undefined;
      after = pageInfo.endCursor;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

function ciTimes(contexts: unknown, entry: { enqueuedAt?: unknown; state?: unknown } | null | undefined): Pick<OpenPull, "checksSince" | "queuedSince" | "queueWaiting"> {
  const started = (Array.isArray(contexts) ? contexts : []).flatMap((context: { startedAt?: unknown } | null) =>
    typeof context?.startedAt === "string" && !Number.isNaN(Date.parse(context.startedAt)) ? [context.startedAt] : []);
  const checksSince = started.sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const queuedSince = typeof entry?.enqueuedAt === "string" ? entry.enqueuedAt : undefined;
  return { ...(checksSince === undefined ? {} : { checksSince }), ...(queuedSince === undefined ? {} : { queuedSince }), ...(queuedSince !== undefined && entry?.state === "QUEUED" ? { queueWaiting: true } : {}) };
}

export function projectTempFile(prefix: string, project: string, suffix: string): string {
  const name = /^[A-Za-z0-9._-]+$/.test(project) ? project : encodeURIComponent(project).replaceAll("*", "%2A");
  return path.join(tmpdir(), `${prefix}${name}${suffix}`);
}

export function due(project: string, everyMs: number): boolean {
  if (everyMs <= 0) return true;
  const stamp = projectTempFile("storytree-merges-", project, ".stamp");
  try {
    if (Date.now() - statSync(stamp).mtimeMs < everyMs) return false;
  } catch {
  }
  try {
    writeFileSync(stamp, "");
  } catch {
  }
  return true;
}

export async function boardClaims(context: MergeContext, watch: MergeWatch = {}): Promise<Claim[]> {
  await endMergedClaims(context, { ...watch, everyMs: 0 }).catch(() => []);
  return readClaims(context.log, context.project);
}
