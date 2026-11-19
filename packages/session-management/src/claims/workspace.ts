// Capability 5 · Claims
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { NO_REPOSITORY_COMMANDS } from "../activity/git.js";
import { claim, claimAll, claimRefusal, readClaim, readClaims, release, type Claim, type ClaimAllAnswer, type ClaimAnswer, type ClaimContext, type Held } from "./claims.js";
import { endIfMerged, ghAllOpenPulls, inMergeQueue, type MergeWatch } from "./merges.js";
import { setUpWorktree, wasSetUp, type SetupLimits, type WorktreeSetup } from "./worktree-setup.js";

type WorkspaceContext = ClaimContext & { readonly folder: string };

export interface WorkspaceAttachment {
  readonly folder: string;
  readonly ref?: string;
  readonly name?: string;
}

export type WorkspaceRefusal =
  | Exclude<ClaimAnswer, { ok: true }>
  | ListedHeld
  | { ok: false; refused: "yours"; claim: Claim }
  | { ok: false; refused: "no-workspace"; why: string; openPulls?: readonly OpenPullForWork[]; localBranches?: readonly LocalBranchForWork[] };

export type ListedHeld = Held & { listed: string };

export interface OpenPullForWork {
  readonly number: number;
  readonly branch: string;
}

export interface LocalBranchForWork {
  readonly branch: string;
  readonly ahead: number;
  readonly folder?: string;
}

export interface ClaimedWorkspace {
  ok: true;
  status: "ready";
  claim: Claim;
  folder: string;
  branch: string;
  base: string;
  takenOverFrom?: Claim;
  existing?: true;
  setup?: WorktreeSetup;
}

export type WorkspaceAnswer =
  | ClaimedWorkspace
  | { ok: true; status: "prepared"; ref: string; name: string; base: string }
  | WorkspaceRefusal;

export interface WorkspaceOptions {
  readonly despiteOpenPulls?: boolean;
  readonly despiteLocalBranches?: boolean;
  readonly setupLimits?: SetupLimits;
}

const FETCH_TIMEOUT_MS = 120_000;
const WORKTREE_ADD_TIMEOUT_MS = 600_000;
const NAME_PART_MAX = 32;

export async function makeWorkspace(context: WorkspaceContext, id: string, reason: string, watch: MergeWatch = {}, options: WorkspaceOptions = {}): Promise<WorkspaceAnswer> {
  const refused = await workspaceRefusal(context, id, reason, watch);
  if (refused !== undefined) return refused;
  const listed = await listedCapabilities(context, id, reason);
  if (!Array.isArray(listed)) return listed;
  const linked = linkedWorktree(context.folder);
  const capability = linked !== undefined && (await context.library.get(id))?.type === "capability";
  if (linked !== undefined && !capability) {
    const at = linked.branch ? `on branch ${linked.branch}` : "on a detached HEAD";
    return {
      ok: false,
      refused: "no-workspace",
      why: `you are in the linked worktree ${linked.folder}, ${at}: claim ${id} here with \`storytree workspace claim ${id} --reason …\` (the claim tool), or ask from the main checkout for a fresh workspace`,
    };
  }
  const here = capability ? await worktreeHoldingWork(context, linked) : undefined;
  if (here !== undefined) {
    const claimed = await claim({ ...context, ...here }, id, reason);
    if (!claimed.ok) return claimed;
    const base = run(here.folder, ["rev-parse", "HEAD"]).trim();
    return { ok: true, status: "ready", claim: claimed.claim, ...here, base, existing: true, ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }) };
  }
  const inFlight = options.despiteOpenPulls === true ? undefined : await openPullsRefusal(context, id, watch);
  if (inFlight !== undefined) return inFlight;
  const repository = repositoryOf(context.folder);
  if (typeof repository !== "string") return repository;
  const main = defaultBranch(repository);
  const fetched = fetchMain(repository, main);
  if (fetched !== undefined) return fetched;
  const base = `origin/${main}`;
  const unlanded = options.despiteLocalBranches === true ? undefined : localBranchesRefusal(repository, id, base);
  if (unlanded !== undefined) return unlanded;
  if (context.harness === "codex") {
    return { ok: true, status: "prepared", ref: run(repository, ["rev-parse", `refs/remotes/${base}`]).trim(), name: nameFor(id).replace(/-+/g, "-"), base };
  }

  const where = placeFor(repository, id);
  const before = await readClaim(context.log, context.project, id);
  const claimed = await claim({ ...context, folder: where.folder, branch: where.branch }, id, reason, { moveBranch: true });
  if (!claimed.ok) return claimed;
  const giveBack = async () => {
    if (before?.session === context.session && before.branch !== undefined) await claim({ ...context, branch: before.branch }, id, before.reason, { moveBranch: true });
    else await release(context, id);
  };
  const capabilities = await claimAll({ ...context, folder: where.folder, branch: where.branch }, listed, reason);
  if (!capabilities.ok) {
    await giveBack();
    return listedRefusal(capabilities);
  }
  try {
    mkdirSync(path.dirname(where.folder), { recursive: true });
    run(repository, ["worktree", "add", "-b", where.branch, where.folder, `refs/remotes/${base}`], WORKTREE_ADD_TIMEOUT_MS);
  } catch (error) {
    unmake(repository, where);
    await releaseTaken(context, capabilities);
    await giveBack();
    return { ok: false, refused: "no-workspace", why: `git could not make the worktree: ${failureOf(error)}` };
  }
  const setup = setUpWorktree(repository, where.folder, options.setupLimits);
  return {
    ok: true, status: "ready", claim: claimed.claim, ...where, base,
    ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }),
    ...(setup === undefined ? {} : { setup }),
  };
}

export async function attachWorkspace(context: WorkspaceContext, id: string, reason: string, attachment: WorkspaceAttachment, watch: MergeWatch = {}): Promise<ClaimedWorkspace | WorkspaceRefusal> {
  const checking = { ...context, ...attachedBranch(context.folder, attachment.folder) };
  const refused = await workspaceRefusal(checking, id, reason, watch);
  if (refused !== undefined) return refused;
  const listed = await listedCapabilities(checking, id, reason);
  if (!Array.isArray(listed)) return listed;
  const codex = context.harness === "codex";

  let folder: string;
  let existingBranch: string;
  let base: string;
  try {
    if (codex && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(attachment.ref ?? "")) throw new Error("ref must be the exact commit returned by make_workspace");
    if (codex && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attachment.name ?? "")) throw new Error("name must be the lowercase hyphenated name returned by make_workspace");
    folder = realpathSync(path.resolve(context.folder, attachment.folder));
    const common = (where: string) => realpathSync(run(where, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
    if (path.relative(common(context.folder), common(folder)) !== "") throw new Error("the returned directory belongs to another repository");
    const root = realpathSync(run(folder, ["rev-parse", "--show-toplevel"]).trim());
    const gitDir = realpathSync(run(folder, ["rev-parse", "--absolute-git-dir"]).trim());
    if (path.relative(root, folder) !== "" || path.relative(gitDir, common(folder)) === "") throw new Error("the returned directory must be the root of a linked worktree, not the main checkout or a subdirectory");
    base = run(folder, ["rev-parse", "HEAD"]).trim();
    if (codex && base !== attachment.ref) throw new Error(`the worktree HEAD is not the expected base ${attachment.ref}`);
    existingBranch = run(folder, ["branch", "--show-current"]).trim();
    if (!codex && !existingBranch) throw new Error("the worktree is not on a branch; switch to one so that its merge ends the claim");
  } catch (error) {
    return { ok: false, refused: "no-workspace", why: `cannot attach the app worktree: ${firstLine(error)}` };
  }

  const branch = existingBranch || `codex/${attachment.name}`;
  const before = await readClaim(context.log, context.project, id);
  const moving = before?.session === context.session && before.holder === "live";
  const claimed = await claim({ ...context, folder, branch }, id, reason, moving ? { moveBranch: true } : { keepBranch: true });
  if (!claimed.ok) return claimed;
  if (claimed.alreadyHeld) return { ok: false, refused: "yours", claim: claimed.claim };
  const capabilities = await claimAll({ ...context, folder, branch }, listed, reason);
  if (!capabilities.ok) {
    if (moving && before.branch !== undefined) await claim({ ...context, branch: before.branch }, id, before.reason, { moveBranch: true });
    else await release(context, id);
    return listedRefusal(capabilities);
  }
  try {
    if (run(folder, ["rev-parse", "HEAD"]).trim() !== base || run(folder, ["branch", "--show-current"]).trim() !== existingBranch) {
      throw new Error("the app worktree changed while its claim was being taken");
    }
    if (!existingBranch) run(folder, ["switch", "-c", branch]);
  } catch (error) {
    await releaseTaken(context, capabilities);
    if (moving && before.branch !== undefined) {
      await claim({ ...context, branch: before.branch }, id, before.reason, { moveBranch: true });
      return { ok: false, refused: "no-workspace", why: `could not attach the app worktree; the claim went back to ${before.branch}: ${firstLine(error)}` };
    }
    await release(context, id);
    return { ok: false, refused: "no-workspace", why: `could not attach the app worktree; the claim was released: ${firstLine(error)}` };
  }
  const repository = codex && !wasSetUp(folder) ? repositoryOf(context.folder) : undefined;
  const setup = typeof repository === "string" ? setUpWorktree(repository, folder) : undefined;
  return {
    ok: true, status: "ready", claim: claimed.claim, folder, branch, base,
    ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }),
    ...(setup === undefined ? {} : { setup }),
  };
}

function attachedBranch(from: string, folder: string): { branch?: string } {
  try {
    const branch = run(path.resolve(from, folder), ["branch", "--show-current"]).trim();
    return branch === "" ? {} : { branch };
  } catch {
    return {};
  }
}

async function workspaceRefusal(context: WorkspaceContext, id: string, reason: string, watch: MergeWatch): Promise<WorkspaceRefusal | undefined> {
  const mine = await readClaim(context.log, context.project, id);
  if (mine?.session === context.session && !(await endIfMerged({ ...context, source: "tool" }, mine, watch)) && !(await inMergeQueue(context.folder, mine, watch))
    && !(linkedWorktree(context.folder) === undefined && !linkedBranches(context.folder).has(mine.branch ?? ""))) {
    return { ok: false, refused: "yours", claim: mine };
  }
  return claimRefusal(context, id, reason);
}

async function listedCapabilities(context: WorkspaceContext, id: string, reason: string): Promise<string[] | ListedHeld> {
  const work = await context.library.get(id);
  if (work?.type !== "increment") return [];
  const listed = [...new Set((work.fields as { capabilities?: string[] }).capabilities ?? [])].sort();
  const free: string[] = [];
  for (const capability of listed) {
    const refused = await claimRefusal(context, capability, reason, id);
    if (refused?.refused === "held") return { ...refused, listed: capability };
    if (refused === undefined) free.push(capability);
  }
  return free;
}

function listedRefusal(answer: Extract<ClaimAllAnswer, { ok: false }>): WorkspaceRefusal {
  return answer.refusal.refused === "held" ? { ...answer.refusal, listed: answer.id } : answer.refusal;
}

async function releaseTaken(context: ClaimContext, answer: Extract<ClaimAllAnswer, { ok: true }>): Promise<void> {
  for (const taken of answer.claims) if (taken.alreadyHeld !== true) await release(context, taken.claim.capability!);
}

async function openPullsRefusal(context: WorkspaceContext, id: string, watch: MergeWatch): Promise<WorkspaceRefusal | undefined> {
  const pulls = await (watch.allOpenPulls ?? ghAllOpenPulls)(context.folder).catch(() => undefined);
  if (pulls === undefined) return undefined;
  const made = new RegExp(`(?:^|/)${stemFor(id)}-[a-z0-9]+$`);
  const ours = new Set((await readClaims(context.log, context.project)).filter((one) => one.session === context.session).map((one) => one.branch));
  const forId = [...pulls].filter(([branch]) => made.test(branch) && !ours.has(branch));
  if (forId.length === 0) return undefined;
  const named = forId.map(([branch, pull]) => `#${pull.number} on ${branch}`).join("; ");
  return {
    ok: false,
    refused: "no-workspace",
    why: `${id} already has open pull requests: ${named}. Carry one on (check its branch out into a worktree with git worktree add, then attach that folder) or close it, or make a workspace despite them`,
    openPulls: forId.map(([branch, pull]) => ({ number: pull.number, branch })),
  };
}

function localBranchesRefusal(repository: string, id: string, base: string): WorkspaceRefusal | undefined {
  const made = new RegExp(`(?:^|/)${stemFor(id)}-[a-z0-9]+$`);
  const folders = worktreeFolders(repository);
  const found: LocalBranchForWork[] = [];
  for (const branch of run(repository, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split(/\r?\n/)) {
    if (!made.test(branch)) continue;
    const ahead = Number(run(repository, ["rev-list", "--count", `refs/remotes/${base}..refs/heads/${branch}`]).trim());
    if (!(ahead > 0)) continue;
    const folder = folders.get(branch);
    found.push({ branch, ahead, ...(folder === undefined ? {} : { folder }) });
  }
  if (found.length === 0) return undefined;
  const named = found.map((one) => `${one.branch}, ${one.ahead} commit${one.ahead === 1 ? "" : "s"} ahead of ${base}${one.folder === undefined ? "" : `, checked out at ${one.folder}`}`).join("; ");
  return {
    ok: false,
    refused: "no-workspace",
    why: `${id} already has local work main does not: ${named}. Carry it on (claim ${id} from inside its worktree, or check the branch out into one with git worktree add and attach that folder) or delete the branch, or make a workspace despite it`,
    localBranches: found,
  };
}

function worktreeFolders(repository: string): Map<string, string> {
  const folders = new Map<string, string>();
  for (const entry of run(repository, ["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/)) {
    const lines = entry.split(/\r?\n/);
    const folder = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
    if (folder !== undefined && branch !== undefined) folders.set(branch, path.resolve(folder));
  }
  return folders;
}

function linkedWorktree(folder: string): { folder: string; branch: string } | undefined {
  try {
    const absolute = (flag: string) => realpathSync(run(folder, ["rev-parse", "--path-format=absolute", flag]).trim());
    if (absolute("--absolute-git-dir") === absolute("--git-common-dir")) return undefined;
    const root = absolute("--show-toplevel");
    return { folder: root, branch: run(root, ["branch", "--show-current"]).trim() };
  } catch {
    return undefined;
  }
}

function linkedBranches(folder: string): Set<string> {
  try {
    const entries = run(folder, ["worktree", "list", "--porcelain"]).split(/\r?\n\r?\n/).slice(1);
    return new Set(entries.flatMap((entry) => entry.split(/\r?\n/).filter((line) => line.startsWith("branch refs/heads/")).map((line) => line.slice("branch refs/heads/".length))));
  } catch {
    return new Set();
  }
}

async function worktreeHoldingWork(context: WorkspaceContext, linked: { folder: string; branch: string }): Promise<{ folder: string; branch: string } | undefined> {
  if (!linked.branch) return undefined;
  const held = (await readClaims(context.log, context.project)).some((one) => one.session === context.session && one.branch === linked.branch);
  return held ? linked : undefined;
}

function repositoryOf(folder: string): string | { ok: false; refused: "no-workspace"; why: string } {
  let common: string;
  try {
    common = path.resolve(run(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  } catch {
    return { ok: false, refused: "no-workspace", why: `${folder} is not in a git repository` };
  }
  const repository = path.basename(common) === ".git" ? path.dirname(common) : common;
  try {
    run(repository, ["remote", "get-url", "origin"]);
  } catch {
    return { ok: false, refused: "no-workspace", why: "the repository has no origin to fetch main from; add one with `git remote add origin <url>`" };
  }
  return repository;
}

function defaultBranch(repository: string): string {
  try {
    const named = run(repository, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).trim();
    return named.startsWith("origin/") && named.length > "origin/".length ? named.slice("origin/".length) : "main";
  } catch {
    return "main";
  }
}

function fetchMain(repository: string, main: string): { ok: false; refused: "no-workspace"; why: string } | undefined {
  try {
    run(repository, ["fetch", "--quiet", "origin", `+refs/heads/${main}:refs/remotes/origin/${main}`], FETCH_TIMEOUT_MS);
    return undefined;
  } catch (error) {
    return { ok: false, refused: "no-workspace", why: `could not fetch ${main} from origin, so there is no fresh main to cut from: ${firstLine(error)}` };
  }
}

function nameFor(id: string): string {
  return `${stemFor(id)}-${randomBytes(3).toString("hex")}`;
}

function stemFor(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, NAME_PART_MAX).replace(/^-+|(?<!-)-+$/g, "") || "work";
}

function placeFor(repository: string, id: string): { folder: string; branch: string } {
  for (;;) {
    const name = nameFor(id);
    const place = { folder: path.join(repository, ".claude", "worktrees", name), branch: `claude/${name}` };
    if (!existsSync(place.folder) && !branchExists(repository, place.branch)) return place;
  }
}

function branchExists(repository: string, branch: string): boolean {
  try {
    run(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function run(cwd: string, args: readonly string[], timeout = 30_000): string {
  return execFileSync("git", [...NO_REPOSITORY_COMMANDS, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true });
}

function unmake(repository: string, where: { folder: string; branch: string }): void {
  for (const args of [["worktree", "remove", "--force", "--force", where.folder], ["worktree", "prune"], ["branch", "-D", where.branch]]) {
    try {
      run(repository, args);
    } catch {
    }
  }
}

function failureOf(error: unknown): string {
  const ended = error as { status?: number | null; signal?: string | null; code?: string };
  if (ended.code === "ETIMEDOUT" || (ended.status === null && ended.signal)) return `git was stopped before it finished (${ended.signal ?? ended.code}), and what it had made was removed`;
  const said = (error as { stderr?: unknown }).stderr;
  const lines = (typeof said === "string" ? said : "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const own = lines.findLast((line) => /^(?:fatal|error):/.test(line)) ?? lines.at(-1);
  return own ?? firstLine(error);
}

function firstLine(error: unknown): string {
  const said = (error as { stderr?: unknown }).stderr;
  const text = typeof said === "string" && said.trim() !== "" ? said : error instanceof Error ? error.message : String(error);
  return text.trim().split(/\r?\n/)[0] ?? "";
}
