// Capability 4 · Sessions
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { thisMachine, type ActivityLog, type BranchFacts } from "../activity/index.js";
import { NO_REPOSITORY_COMMANDS } from "../activity/git.js";
import type { Line, NewLine } from "@storytree/library";
import { findProject, storytreeHome } from "@storytree/project-and-caller";
import { learn, limitOf, type Step } from "../hooks/learned-limits.js";
import { ask, type Answer } from "./ask.js";
import { due, ghAllMergedPulls, projectTempFile, ghAllOpenPulls, type AllMergedPulls, type AllOpenPulls, type MergeContext, type MergedPull, type OpenPull } from "../claims/merges.js";

export interface BranchWatch {
  readonly allMergedPulls?: AllMergedPulls;
  readonly allOpenPulls?: AllOpenPulls;
  readonly everyMs?: number;
  readonly machine?: string;
  readonly budgetMs?: number;
  readonly git?: GitRunner;
  readonly home?: string;
}

export type GitRunner = (cwd: string, timeout: number, args: readonly string[]) => Promise<Answer>;

export const gitRunner: GitRunner = (cwd, timeout, args) => ask("git", [...NO_REPOSITORY_COMMANDS, ...args], process.env, timeout, { cwd, shell: false });

const EVERY_MS = 60_000;
const BUDGET_MS = 3_000;
export const BRANCH_GIT_STEP: Step = { name: "branch-git", floorMs: 2_000, ceilingMs: 5_000 };
const ORIGIN_TIMEOUT_MS = 5_000;

type BranchState = Extract<NewLine, { kind: "branch-state" }>;
type Pull = Pick<BranchState, "pr" | "draft" | "checks" | "queued" | "checksSince" | "queuedSince" | "queueWaiting">;
interface Found {
  of: string;
  open: boolean;
  how?: BranchState["how"];
  pull?: Pull;
}

export async function resolveBranches(context: MergeContext, watch: BranchWatch = {}): Promise<Line[]> {
  if (!due(`${context.project}-branches`, watch.everyMs ?? EVERY_MS)) return [];
  const machine = watch.machine ?? thisMachine();
  const facts = await context.log.branchFacts(context.project, machine);
  const looked = lookedAt(context.project);
  const candidates = toLookAt(facts, machine, looked);
  if (candidates.size === 0) return [];
  const budget = watch.budgetMs ?? BUDGET_MS;
  const home = watch.home ?? storytreeHome();
  const limit = limitOf(home, BRANCH_GIT_STEP);
  let slowest: number | undefined;
  const timed = (runner: GitRunner): GitRunner => async (cwd, timeout, args) => {
    const from = Date.now();
    const answer = await runner(cwd, timeout, args);
    slowest = Math.max(slowest ?? 0, answer.answered ? Date.now() - from : limit);
    return answer;
  };
  const machineGit = timed(gitRunner);
  const [merged, opened] = await Promise.all([
    (watch.allMergedPulls ?? ghAllMergedPulls)(context.folder).catch(() => new Map<string, MergedPull[]>()),
    (watch.allOpenPulls ?? ghAllOpenPulls)(context.folder).catch(() => undefined),
  ]);
  const seen = [...candidates.values()].some((facts) => facts.folder === undefined && !facts.foundThere) ? await seenHere(context.folder, machineGit, limit) : undefined;
  const deadline = Date.now() + budget;
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
    const local = await gitState(facts.folder, branch, timed(watch.git ?? gitRunner), limit);
    if (local === undefined) found.push(...onGitHub);
    else found.push({ of: branch, open: local === "ahead", how: local, ...(local === "ahead" ? (open === undefined ? {} : { pull: open }) : { pull: {} }) });
  }
  remember(context.project, looked);
  if (slowest !== undefined) learn(home, BRANCH_GIT_STEP, slowest);
  if (found.length === 0) return [];

  return context.log.locked(context.project, async (log) => {
    const current = latestStates(found.length === 0 ? [] : await log.lines({ kinds: ["branch-state"], where: { of: found.map((state) => state.of) }, latestBy: ["of"] }));
    const written: Line[] = [];
    const by = {
      session: context.session,
      ...(context.harness === undefined ? {} : { harness: context.harness }),
      source: context.source,
      folder: context.folder,
      ...(machine === undefined ? {} : { machine }),
    };
    for (const state of found) {
      const now = current.get(state.of);
      const wasOpen = now?.open ?? true;
      if (state.how === undefined && !wasOpen && state.pull?.pr === undefined) continue;
      if (wasOpen === state.open && (!state.open || state.pull === undefined || samePull(state.pull, now))) continue;
      const pull = state.pull ?? {};
      written.push(await log.append({
        ...by,
        kind: "branch-state",
        of: state.of,
        open: state.open,
        how: state.how ?? "ahead",
        ...pull,
      }));
    }
    return written;
  });
}

export async function lookAsApp(log: ActivityLog, project: string, watch: BranchWatch = {}): Promise<Line[]> {
  const machine = watch.machine ?? thisMachine();
  const folder = await projectFolder(log, project, machine);
  if (folder === undefined) return [];
  return resolveBranches({ log, project, folder, session: `app:${machine ?? "this machine"}`, source: "tool" }, watch);
}

export async function projectFolder(log: ActivityLog, project: string, machine = thisMachine()): Promise<string | undefined> {
  const lines = await log.lines(project, { where: { machine: machine ?? null }, has: ["folder"], latestBy: ["folder"], newest: 200, omit: ["command", "files", "transcript"] });
  const folder = lines.findLast((line) => line.folder !== undefined && existsSync(line.folder))?.folder;
  if (folder === undefined) return undefined;
  const found = findProject(folder);
  if (found.project !== project) return folder;
  let below: string;
  try {
    below = path.relative(found.folder, realpathSync.native(folder));
  } catch {
    return folder;
  }
  return below.startsWith("..") || path.isAbsolute(below) ? folder : found.folder;
}

interface Facts {
  firstAt: string;
  folder?: string;
  foundThere?: boolean;
}

function toLookAt(worked: readonly BranchFacts[], machine: string | undefined, looked: Readonly<Record<string, number>>): Map<string, Facts> {
  const candidates = new Map<string, Facts>();
  for (const { branch, lastAt, state, ...known } of worked) {
    const facts: Facts = { firstAt: known.firstAt, ...(known.folder === undefined ? {} : { folder: known.folder }) };
    const guessedElsewhere = state?.how === "deleted" && facts.folder !== undefined && state.machine !== undefined && state.machine !== machine && (looked[branch] ?? 0) < Date.parse(state.at);
    if (state === undefined || state.open || guessedElsewhere || Date.parse(lastAt) > Date.parse(state.at)) candidates.set(branch, { ...facts, foundThere: state?.how === "ahead" });
  }
  return candidates;
}

function outOf(answer: Answer, args: readonly string[]): string {
  if (!answer.answered || answer.code !== 0) throw new Error(`git ${args[0]} did not answer`);
  return answer.out;
}

async function seenHere(folder: string, runner: GitRunner, limit: number): Promise<Set<string> | undefined> {
  const run = async (timeout: number, ...args: string[]) => outOf(await (timeout === ORIGIN_TIMEOUT_MS ? gitRunner : runner)(folder, timeout, args), args);
  try {
    const remote = (await run(ORIGIN_TIMEOUT_MS, "ls-remote", "--heads", "origin")).split("\n").flatMap((line) => {
      const ref = line.split("\t")[1]?.trim();
      return ref?.startsWith("refs/heads/") ? [ref.slice("refs/heads/".length)] : [];
    });
    const local = (await run(limit, "for-each-ref", "--format=%(refname:short)", "refs/heads")).split("\n").map((name) => name.trim()).filter(Boolean);
    return new Set([...remote, ...local]);
  } catch {
    return undefined;
  }
}

function pullOf(pull: OpenPull | undefined): Pull {
  if (pull === undefined) return {};
  return { pr: pull.number, ...(pull.draft ? { draft: true } : {}), ...(pull.checks === undefined ? {} : { checks: pull.checks }), ...(pull.queued ? { queued: true } : {}),
    ...(pull.checksSince === undefined ? {} : { checksSince: pull.checksSince }), ...(pull.queuedSince === undefined ? {} : { queuedSince: pull.queuedSince }), ...(pull.queueWaiting ? { queueWaiting: true } : {}) };
}

function samePull(pull: Pull, line: Pull | undefined): boolean {
  return pull.pr === line?.pr && pull.draft === line?.draft && pull.checks === line?.checks && pull.queued === line?.queued
    && pull.checksSince === line?.checksSince && pull.queuedSince === line?.queuedSince && pull.queueWaiting === line?.queueWaiting;
}

function latestStates(lines: readonly Line[]): Map<string, Line & { kind: "branch-state" }> {
  const states = new Map<string, Line & { kind: "branch-state" }>();
  for (const line of lines) if (line.kind === "branch-state") states.set(line.of, line);
  return states;
}

async function gitState(folder: string, branch: string, runner: GitRunner, limit: number): Promise<"deleted" | "not-ahead" | "ahead" | undefined> {
  let cwd = folder;
  while (!existsSync(cwd)) {
    const parent = path.dirname(cwd);
    if (parent === cwd) return undefined;
    cwd = parent;
  }
  const run = async (...args: string[]) => outOf(await runner(cwd, limit, args), args).trim();
  try {
    await run("rev-parse", "--git-dir");
  } catch {
    return undefined;
  }
  const verify = ["rev-parse", "--verify", "-q", `refs/heads/${branch}`];
  const exists = await runner(cwd, limit, verify);
  if (!exists.answered) return undefined;
  if (exists.code !== 0) {
    const head = await runner(cwd, limit, ["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!head.answered) return undefined;
    return head.code === 0 && head.out.trim() === branch ? undefined : "deleted";
  }
  try {
    return Number(await run("rev-list", "--count", `${await mainLine(run)}..refs/heads/${branch}`)) === 0 ? "not-ahead" : "ahead";
  } catch {
    return undefined;
  }
}

async function mainLine(run: (...args: string[]) => Promise<string>): Promise<string> {
  try {
    return await run("rev-parse", "--abbrev-ref", "origin/HEAD");
  } catch {
    return "main";
  }
}

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
  }
}

function lookedFile(project: string): string {
  return projectTempFile("storytree-branches-", project, ".json");
}
