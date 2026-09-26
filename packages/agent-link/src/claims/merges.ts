/**
 * Release on merge (ADR-0643 D3, the owner's M): a claim ends when a pull request from the branch
 * it was taken on merges. Storytree assumes the project is on GitHub, as its own is, and asks
 * GitHub through `gh`, which also sees squash merges that git alone cannot.
 */
import type { ActivityLog, Line } from "../activity/index.js";

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
  /** How often a project is asked about, at most. */
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

/** End every claim in `context.project` whose branch has a pull request merged since it was taken, each with a "merged" line. */
export async function endMergedClaims(_context: MergeContext, _watch: MergeWatch = {}): Promise<Line[]> {
  return [];
}

/** The branch `folder` is on, or undefined when it is not on one (not a git folder, or a detached head). */
export function currentBranch(_folder: string): string | undefined {
  return undefined;
}
