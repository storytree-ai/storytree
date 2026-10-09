/**
 * Capability 4 · Sessions: whether each branch a session worked on still holds open work (ADR-0754
 * D4). A branch is resolved once a pull request from it has merged, once it has nothing ahead of
 * the main line, or once it has been deleted; otherwise its work is open, and a session holding
 * open work stays in the running-sessions list.
 *
 * - GitHub is asked about merges from any machine, in one call for every branch, so a backlog
 *   drains in one look: a merge is the same everywhere. In a second call, made alongside, it is
 *   asked for every open pull request (contract 4.24): an open branch's line carries its pull
 *   request, whether it is a draft, its checks and whether it waits in the merge queue, and is
 *   written again when any of those changes. GitHub not answering erases none of them. Whether a
 *   branch is ahead of the main line,
 *   or deleted, is asked of git on the machine its lines were written on, in the folder they name
 *   (or the nearest one still there: a cleaned-up worktree's repository).
 * - A branch worked on only on other machines is deleted once it exists nowhere this machine can
 *   see: not on `origin` and not a branch here. Its own machine opens it again if it is still there,
 *   and once that machine has found it ahead, no other machine guesses it away.
 * - A branch is looked at while no line has resolved it, or once its session has written on it
 *   since it resolved, so work added after a merge or a fresh start is seen as open again.
 * - A `branch-state` line is written only when the state changes, by whichever session saw it,
 *   never on the sessions that worked on the branch, so it makes none of them read as active.
 * - The same look reads, on this machine, each folder a session edited files in (or claimed an
 *   increment in) on the main line (ADR-0906, contract 4.27): whether its main holds uncommitted
 *   changes, and whether its repository has no commit yet, as a `main-state` line, written only
 *   when that changes. A folder found clean is looked at again only once someone works there again.
 * - It runs at most once a minute per project on each machine (the claims' stamp, under its own
 *   name), for at most a few seconds, least recently looked-at branches first, and never fails a
 *   hook: `gh` or git missing, slow or refusing means nothing is learned this time.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { thisMachine, type ActivityLog, type BranchFacts, type Line, type NewLine } from "../activity/index.js";
import { ask, type Answer } from "../setup/machine.js";
import { due, ghAllMergedPulls, projectTempFile, ghAllOpenPulls, type AllMergedPulls, type AllOpenPulls, type MergeContext, type MergedPull, type OpenPull } from "../claims/merges.js";

/** How branches are watched. */
export interface BranchWatch {
  /** How to ask GitHub for every merged pull request. By default, through `gh`. */
  readonly allMergedPulls?: AllMergedPulls;
  /** How to ask GitHub for every open pull request (contract 4.24). By default, through `gh`. */
  readonly allOpenPulls?: AllOpenPulls;
  /** How often a project is looked at, at most. By default, once a minute. */
  readonly everyMs?: number;
  /** The machine this runs on, as lines name it. By default, this one's host name. */
  readonly machine?: string;
  /** How long one look may take before the rest wait for the next. By default, 3 s. */
  readonly budgetMs?: number;
  /** How git is asked about a branch on this machine. By default, this machine's git. */
  readonly git?: GitRunner;
}

/** Runs git with `args` in `cwd`, giving up after `timeout`: an answer that says whether it answered in time. */
export type GitRunner = (cwd: string, timeout: number, args: readonly string[]) => Promise<Answer>;

/** This machine's git, run without blocking this process (the app runs the look on its main process, ADR-0836 D3). */
export const gitRunner: GitRunner = (cwd, timeout, args) => ask("git", args, process.env, timeout, { cwd, shell: false });

/** Branches that are a project's main line, never a session's own work. */
const MAIN_BRANCHES = new Set(["main", "master"]);
const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
const GIT_TIMEOUT_MS = 2_000;
const ORIGIN_TIMEOUT_MS = 5_000;

type BranchState = Extract<NewLine, { kind: "branch-state" }>;
/** What a look found of a folder on the main line. */
type MainFound = { of: string; dirty: boolean; unborn: boolean };
/** What a line says of a branch's pull request: the one that merged it, or its open one with that one's state. */
type Pull = Pick<BranchState, "pr" | "draft" | "checks" | "queued">;
/**
 * A branch's state as one look found it. `how` is unknown when only GitHub was asked (the line
 * keeps the one it had); `pull` is unknown when GitHub did not answer (the line keeps its own).
 */
interface Found {
  of: string;
  open: boolean;
  how?: BranchState["how"];
  pull?: Pull;
}

/** Look at the project's branches that may have changed state, and write a `branch-state` line for each that did. */
export async function resolveBranches(context: MergeContext, watch: BranchWatch = {}): Promise<Line[]> {
  if (!due(`${context.project}-branches`, watch.everyMs ?? EVERY_MS)) return [];
  const machine = watch.machine ?? thisMachine();
  // What the log knows of the branches and folders worth a look, worked out on the server (contract 2.7).
  const [facts, work] = await Promise.all([context.log.branchFacts(context.project, machine), context.log.mainWork(context.project, machine)]);
  const looked = lookedAt(context.project);
  const candidates = toLookAt(facts, machine, looked);
  const places = work.filter(({ folder }) => existsSync(folder)).map(({ folder }) => folder);
  if (candidates.size === 0 && places.length === 0) return [];
  const deadline = Date.now() + (watch.budgetMs ?? BUDGET_MS);
  const mainFound: MainFound[] = [];
  for (const folder of places) {
    if (Date.now() > deadline) break;
    const state = await mainState(folder);
    if (state !== undefined) mainFound.push({ of: folder, ...state });
  }
  const [merged, opened] = candidates.size === 0 ? [new Map<string, MergedPull[]>(), undefined] : await Promise.all([
    (watch.allMergedPulls ?? ghAllMergedPulls)(context.folder).catch(() => new Map<string, MergedPull[]>()),
    (watch.allOpenPulls ?? ghAllOpenPulls)(context.folder).catch(() => undefined),
  ]);
  const seen = [...candidates.values()].some((facts) => facts.folder === undefined && !facts.foundThere) ? await seenHere(context.folder) : undefined;
  const found: Found[] = [];
  for (const [branch, facts] of [...candidates].sort(([a], [b]) => (looked[a] ?? 0) - (looked[b] ?? 0))) {
    const pull = (merged.get(branch) ?? []).find((pull) => Date.parse(pull.mergedAt) >= Date.parse(facts.firstAt));
    if (pull !== undefined) {
      found.push({ of: branch, open: false, how: "merged", pull: { pr: pull.number } });
      continue;
    }
    const open = opened === undefined ? undefined : pullOf(opened.get(branch));
    const onGitHub = open === undefined ? [] : [{ of: branch, open: true, pull: open }];
    if (facts.folder === undefined) {
      if (seen !== undefined && !facts.foundThere && !seen.has(branch)) found.push({ of: branch, open: false, how: "deleted", pull: {} });
      else found.push(...onGitHub);
      continue;
    }
    if (Date.now() > deadline) {
      found.push(...onGitHub);
      continue;
    }
    looked[branch] = Date.now();
    const local = await gitState(facts.folder, branch, watch.git ?? gitRunner);
    if (local === undefined) found.push(...onGitHub);
    else found.push({ of: branch, open: local === "ahead", how: local, ...(local === "ahead" ? (open === undefined ? {} : { pull: open }) : { pull: {} }) });
  }
  remember(context.project, looked);
  if (found.length === 0 && mainFound.length === 0) return [];

  return context.log.locked(context.project, async (log) => {
    // Read again under the lock: another machine may have written a state since.
    const current = latestStates(found.length === 0 ? [] : await log.lines({ kinds: ["branch-state"], where: { of: found.map((state) => state.of) }, latestBy: ["of"] }));
    const written: Line[] = [];
    const by = {
      session: context.session,
      ...(context.harness === undefined ? {} : { harness: context.harness }),
      source: context.source,
      folder: context.folder,
      ...(machine === undefined ? {} : { machine }),
    };
    if (mainFound.length > 0) {
      const mains = latestMainStates(await log.lines({ kinds: ["main-state"], where: { of: mainFound.map((state) => state.of), machine: machine ?? null }, latestBy: ["of"] }), machine);
      for (const state of mainFound) {
        const now = mains.get(state.of);
        // No line yet reads as nothing on main: a clean folder needs none.
        if ((now?.dirty ?? false) === state.dirty && (now?.unborn ?? false) === state.unborn) continue;
        written.push(await log.append({ ...by, kind: "main-state", of: state.of, dirty: state.dirty, ...(state.unborn ? { unborn: true } : {}) }));
      }
    }
    for (const state of found) {
      const now = current.get(state.of);
      // A branch no line has resolved reads as open.
      const wasOpen = now?.open ?? true;
      // Only GitHub was asked: its pull request says nothing of a branch a line has resolved.
      if (state.how === undefined && !wasOpen) continue;
      if (wasOpen === state.open && (!state.open || state.pull === undefined || samePull(state.pull, now))) continue;
      const pull = state.pull ?? {};
      written.push(await log.append({
        ...by,
        kind: "branch-state",
        of: state.of,
        open: state.open,
        how: state.how ?? now?.how ?? "ahead",
        ...pull,
      }));
    }
    return written;
  });
}

/**
 * The app's own look at the project's branches, so its sessions list never waits on a hook: asked
 * from the latest folder on this machine that is still there (GitHub needs the project's
 * repository), and written under the app's name, `app:<machine>`, which lists as no session.
 * Nothing when this machine has no such folder. Once a minute at most, shared with the hooks' look.
 */
export async function lookAsApp(log: ActivityLog, project: string, watch: BranchWatch = {}): Promise<Line[]> {
  const machine = watch.machine ?? thisMachine();
  const folder = await projectFolder(log, project, machine);
  if (folder === undefined) return [];
  return resolveBranches({ log, project, folder, session: `app:${machine ?? "this machine"}`, source: "tool" }, watch);
}

/** The latest folder a session of `project` worked in on this machine that is still there; undefined when there is none. */
export async function projectFolder(log: ActivityLog, project: string, machine = thisMachine()): Promise<string | undefined> {
  const lines = await log.lines(project, { where: { machine: machine ?? null }, has: ["folder"], latestBy: ["folder"], newest: 200, omit: ["command", "files", "transcript"] });
  return lines.findLast((line) => line.folder !== undefined && existsSync(line.folder))?.folder;
}

/** What is known of a branch worth looking at: when it was first worked on, its latest folder on this machine, and whether its own machine has found it ahead. */
interface Facts {
  firstAt: string;
  folder?: string;
  foundThere?: boolean;
}

/** The branches no line has resolved, worked on since they resolved, or worked on here and taken for deleted by another machine since this one last looked. */
function toLookAt(worked: readonly BranchFacts[], machine: string | undefined, looked: Readonly<Record<string, number>>): Map<string, Facts> {
  const candidates = new Map<string, Facts>();
  for (const { branch, lastAt, state, ...known } of worked) {
    const facts: Facts = { firstAt: known.firstAt, ...(known.folder === undefined ? {} : { folder: known.folder }) };
    const guessedElsewhere = state?.how === "deleted" && facts.folder !== undefined && state.machine !== undefined && state.machine !== machine && (looked[branch] ?? 0) < Date.parse(state.at);
    if (state === undefined || state.open || guessedElsewhere || Date.parse(lastAt) > Date.parse(state.at)) candidates.set(branch, { ...facts, foundThere: state?.how === "ahead" });
  }
  return candidates;
}

/** What git says in `cwd`: its output, or a throw when it fails or takes longer than `timeout`. */
async function git(cwd: string, timeout: number, ...args: string[]): Promise<string> {
  return outOf(await gitRunner(cwd, timeout, args), args);
}

/** An answer's output, or a throw when git failed or did not answer in time. */
function outOf(answer: Answer, args: readonly string[]): string {
  if (!answer.answered || answer.code !== 0) throw new Error(`git ${args[0]} did not answer`);
  return answer.out;
}

/** The branches `origin` has and this clone has, seen from `folder`; undefined when git cannot say. */
async function seenHere(folder: string): Promise<Set<string> | undefined> {
  const run = (timeout: number, ...args: string[]) => git(folder, timeout, ...args);
  try {
    const remote = (await run(ORIGIN_TIMEOUT_MS, "ls-remote", "--heads", "origin")).split("\n").flatMap((line) => {
      const ref = line.split("\t")[1]?.trim();
      return ref?.startsWith("refs/heads/") ? [ref.slice("refs/heads/".length)] : [];
    });
    const local = (await run(GIT_TIMEOUT_MS, "for-each-ref", "--format=%(refname:short)", "refs/heads")).split("\n").map((name) => name.trim()).filter(Boolean);
    return new Set([...remote, ...local]);
  } catch {
    return undefined;
  }
}

/** What a line says of an open pull request, or of none. */
function pullOf(pull: OpenPull | undefined): Pull {
  if (pull === undefined) return {};
  return { pr: pull.number, ...(pull.draft ? { draft: true } : {}), ...(pull.checks === undefined ? {} : { checks: pull.checks }), ...(pull.queued ? { queued: true } : {}) };
}

/** Whether `line` already says `pull`. */
function samePull(pull: Pull, line: Pull | undefined): boolean {
  return pull.pr === line?.pr && pull.draft === line?.draft && pull.checks === line?.checks && pull.queued === line?.queued;
}

/** The latest `main-state` line for each folder on `machine`. */
function latestMainStates(lines: readonly Line[], machine: string | undefined): Map<string, Line & { kind: "main-state" }> {
  const states = new Map<string, Line & { kind: "main-state" }>();
  for (const line of lines) if (line.kind === "main-state" && line.machine === machine) states.set(line.of, line);
  return states;
}

/** What this machine's git says of `folder` on the main line; off the main line it holds nothing; undefined when git cannot say. */
async function mainState(folder: string): Promise<{ dirty: boolean; unborn: boolean } | undefined> {
  const run = async (...args: string[]) => (await git(folder, GIT_TIMEOUT_MS, ...args)).trim();
  try {
    const branch = await run("symbolic-ref", "--short", "-q", "HEAD").catch(() => "");
    if (!MAIN_BRANCHES.has(branch)) return { dirty: false, unborn: false };
    const unborn = await run("rev-parse", "--verify", "-q", "HEAD").then(() => false, () => true);
    return { dirty: (await run("status", "--porcelain")) !== "", unborn };
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
async function gitState(folder: string, branch: string, runner: GitRunner): Promise<"deleted" | "not-ahead" | "ahead" | undefined> {
  let cwd = folder;
  while (!existsSync(cwd)) {
    const parent = path.dirname(cwd);
    if (parent === cwd) return undefined;
    cwd = parent;
  }
  const run = async (...args: string[]) => outOf(await runner(cwd, GIT_TIMEOUT_MS, args), args).trim();
  try {
    await run("rev-parse", "--git-dir");
  } catch {
    return undefined;
  }
  const verify = ["rev-parse", "--verify", "-q", `refs/heads/${branch}`];
  const exists = await runner(cwd, GIT_TIMEOUT_MS, verify);
  // A git that did not answer in time says nothing: slowness is not absence.
  if (!exists.answered) return undefined;
  if (exists.code !== 0) {
    // A branch with no commit yet has no ref either: it is only just started, not deleted.
    const head = await runner(cwd, GIT_TIMEOUT_MS, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!head.answered) return undefined;
    return head.code === 0 && head.out.trim() === branch ? undefined : "deleted";
  }
  try {
    return Number(await run("rev-list", "--count", `${await mainLine(run)}..refs/heads/${branch}`)) === 0 ? "not-ahead" : "ahead";
  } catch {
    return undefined;
  }
}

/** The main line to compare with: what `origin` names as its default, as this clone last heard, else the local `main`. */
async function mainLine(run: (...args: string[]) => Promise<string>): Promise<string> {
  try {
    return await run("rev-parse", "--abbrev-ref", "origin/HEAD");
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
  return projectTempFile("storytree-branches-", project, ".json");
}
