/**
 * Capability 4 · Sessions: whether each branch a session worked on still holds open work (ADR-0754
 * D4). A branch is resolved once a pull request from it has merged, once it has nothing ahead of
 * the main line, or once it has been deleted; otherwise its work is open, and a session holding
 * open work stays in the running-sessions list.
 *
 * - GitHub is asked about merges from any machine, in one call for every branch, so a backlog
 *   drains in one look: a merge is the same everywhere. Whether a branch is ahead of the main line,
 *   or deleted, is asked of git on the machine its lines were written on, in the folder they name
 *   (or the nearest one still there: a cleaned-up worktree's repository).
 * - A branch worked on only on other machines is deleted once it exists nowhere this machine can
 *   see: not on `origin` and not a branch here. Its own machine opens it again if it is still there,
 *   and once that machine has found it ahead, no other machine guesses it away.
 * - A branch is looked at while no line has resolved it, or once its session has written on it
 *   since it resolved, so work added after a merge or a fresh start is seen as open again.
 * - A `branch-state` line is written only when the state changes, by whichever session saw it,
 *   never on the sessions that worked on the branch, so it makes none of them read as active.
 * - It runs at most once a minute per project on each machine (the claims' stamp, under its own
 *   name), for at most a few seconds, least recently looked-at branches first, and never fails a
 *   hook: `gh` or git missing, slow or refusing means nothing is learned this time.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { currentBranch, thisMachine, type ActivityLog, type Line, type NewLine } from "../activity/index.js";
import { due, ghAllMergedPulls, type AllMergedPulls, type MergeContext, type MergedPull } from "../claims/merges.js";

/** How branches are watched. */
export interface BranchWatch {
  /** How to ask GitHub for every merged pull request. By default, through `gh`. */
  readonly allMergedPulls?: AllMergedPulls;
  /** How often a project is looked at, at most. By default, once a minute. */
  readonly everyMs?: number;
  /** The machine this runs on, as lines name it. By default, this one's host name. */
  readonly machine?: string;
  /** How long one look may take before the rest wait for the next. By default, 3 s. */
  readonly budgetMs?: number;
}

/** Branches that are a project's main line, never a session's own work. */
const MAIN_BRANCHES = new Set(["main", "master"]);
const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
const GIT_TIMEOUT_MS = 2_000;
const ORIGIN_TIMEOUT_MS = 5_000;

type BranchState = Extract<NewLine, { kind: "branch-state" }>;
type Found = Pick<BranchState, "of" | "open" | "how" | "pr">;

/** Look at the project's branches that may have changed state, and write a `branch-state` line for each that did. */
export async function resolveBranches(context: MergeContext, watch: BranchWatch = {}): Promise<Line[]> {
  if (!due(`${context.project}-branches`, watch.everyMs ?? EVERY_MS)) return [];
  const machine = watch.machine ?? thisMachine();
  const { lines } = await context.log.since(context.project, 0);
  const looked = lookedAt(context.project);
  const candidates = toLookAt(lines, machine, looked);
  if (candidates.size === 0) return [];
  const merged = await (watch.allMergedPulls ?? ghAllMergedPulls)(context.folder).catch(() => new Map<string, MergedPull[]>());
  const seen = [...candidates.values()].some((facts) => facts.folder === undefined && !facts.foundThere) ? seenHere(context.folder) : undefined;
  const deadline = Date.now() + (watch.budgetMs ?? BUDGET_MS);
  const found: Found[] = [];
  for (const [branch, facts] of [...candidates].sort(([a], [b]) => (looked[a] ?? 0) - (looked[b] ?? 0))) {
    const pull = (merged.get(branch) ?? []).find((pull) => Date.parse(pull.mergedAt) >= Date.parse(facts.firstAt));
    if (pull !== undefined) {
      found.push({ of: branch, open: false, how: "merged", pr: pull.number });
      continue;
    }
    if (facts.folder === undefined) {
      if (seen !== undefined && !facts.foundThere && !seen.has(branch)) found.push({ of: branch, open: false, how: "deleted" });
      continue;
    }
    if (Date.now() > deadline) continue;
    looked[branch] = Date.now();
    const local = gitState(facts.folder, branch);
    if (local !== undefined) found.push({ of: branch, open: local === "ahead", how: local });
  }
  remember(context.project, looked);
  if (found.length === 0) return [];

  return context.log.locked(context.project, async (log) => {
    // Read again under the lock: another machine may have written a state since.
    const current = latestStates(await log.lines(["branch-state"]));
    const written: Line[] = [];
    for (const state of found) {
      // A branch no line has resolved reads as open.
      if ((current.get(state.of)?.open ?? true) === state.open) continue;
      written.push(await log.append({
        session: context.session,
        ...(context.harness === undefined ? {} : { harness: context.harness }),
        source: context.source,
        folder: context.folder,
        ...(machine === undefined ? {} : { machine }),
        kind: "branch-state",
        of: state.of,
        open: state.open,
        how: state.how,
        ...(state.pr === undefined ? {} : { pr: state.pr }),
      }));
    }
    return written;
  });
}

export async function lookAsApp(_log: ActivityLog, _project: string, _watch: BranchWatch = {}): Promise<Line[]> {
  return [];
}

/** What is known of a branch worth looking at: when it was first worked on, its latest folder on this machine, and whether its own machine has found it ahead. */
interface Facts {
  firstAt: string;
  folder?: string;
  foundThere?: boolean;
}

/** The branches no line has resolved, worked on since they resolved, or worked on here and taken for deleted by another machine since this one last looked. */
function toLookAt(lines: readonly Line[], machine: string | undefined, looked: Readonly<Record<string, number>>): Map<string, Facts> {
  const states = latestStates(lines);
  const worked = new Map<string, Facts & { lastAt: string }>();
  for (const line of lines) {
    if (line.branch === undefined || line.kind === "merged" || MAIN_BRANCHES.has(line.branch)) continue;
    const facts = worked.get(line.branch) ?? { firstAt: line.at, lastAt: line.at };
    facts.lastAt = line.at;
    if (machine !== undefined && line.machine === machine && line.folder !== undefined) facts.folder = line.folder;
    worked.set(line.branch, facts);
  }
  const candidates = new Map<string, Facts>();
  for (const [branch, { lastAt, ...facts }] of worked) {
    const state = states.get(branch);
    const guessedElsewhere = state?.how === "deleted" && facts.folder !== undefined && state.machine !== undefined && state.machine !== machine && (looked[branch] ?? 0) < Date.parse(state.at);
    if (state === undefined || state.open || guessedElsewhere || Date.parse(lastAt) > Date.parse(state.at)) candidates.set(branch, { ...facts, foundThere: state?.how === "ahead" });
  }
  return candidates;
}

/** The branches `origin` has and this clone has, seen from `folder`; undefined when git cannot say. */
function seenHere(folder: string): Set<string> | undefined {
  const run = (timeout: number, ...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, windowsHide: true });
  try {
    const remote = run(ORIGIN_TIMEOUT_MS, "ls-remote", "--heads", "origin").split("\n").flatMap((line) => {
      const ref = line.split("\t")[1]?.trim();
      return ref?.startsWith("refs/heads/") ? [ref.slice("refs/heads/".length)] : [];
    });
    const local = run(GIT_TIMEOUT_MS, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").map((name) => name.trim()).filter(Boolean);
    return new Set([...remote, ...local]);
  } catch {
    return undefined;
  }
}

/** The latest `branch-state` line for each branch. */
function latestStates(lines: readonly Line[]): Map<string, Line & { kind: "branch-state" }> {
  const states = new Map<string, Line & { kind: "branch-state" }>();
  for (const line of lines) if (line.kind === "branch-state") states.set(line.of, line);
  return states;
}

/** What this machine's git says of `branch`, from `folder` or the nearest folder above it still there; undefined when git cannot say. */
function gitState(folder: string, branch: string): "deleted" | "not-ahead" | "ahead" | undefined {
  let cwd = folder;
  while (!existsSync(cwd)) {
    const parent = path.dirname(cwd);
    if (parent === cwd) return undefined;
    cwd = parent;
  }
  const run = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS, windowsHide: true }).trim();
  try {
    run("rev-parse", "--git-dir");
  } catch {
    return undefined;
  }
  try {
    run("rev-parse", "--verify", "-q", `refs/heads/${branch}`);
  } catch {
    // A branch with no commit yet has no ref either: it is only just started, not deleted.
    return currentBranch(cwd) === branch ? undefined : "deleted";
  }
  try {
    return Number(run("rev-list", "--count", `${mainLine(run)}..refs/heads/${branch}`)) === 0 ? "not-ahead" : "ahead";
  } catch {
    return undefined;
  }
}

/** The main line to compare with: what `origin` names as its default, as this clone last heard, else the local `main`. */
function mainLine(run: (...args: string[]) => string): string {
  try {
    return run("rev-parse", "--abbrev-ref", "origin/HEAD");
  } catch {
    return "main";
  }
}

/** When each of the project's branches was last looked at on this machine. */
function lookedAt(project: string): Record<string, number> {
  try {
    const stored = JSON.parse(readFileSync(lookedFile(project), "utf8")) as unknown;
    return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? (stored as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function remember(project: string, looked: Record<string, number>): void {
  try {
    writeFileSync(lookedFile(project), JSON.stringify(looked));
  } catch {
    // Unable to remember: the next look starts from the same branches, which is only slower.
  }
}

function lookedFile(project: string): string {
  return path.join(tmpdir(), `storytree-branches-${project}.json`);
}
