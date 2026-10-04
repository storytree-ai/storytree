/**
 * Capability 5.12–5.14 · Claimed workspaces (ADR-0653, owner A2/B1).
 * Claude Code keeps its original fetch/claim/create path. Codex preparation only checks and
 * fetches: the agent calls the desktop app's create_worktree, then attaches that returned folder.
 * Storytree never creates or removes a Codex folder. App creation does not change the agent's cwd.
 * A Claude Code session the Claude desktop app started in its own linked worktree attaches that
 * worktree the same way, on the branch it is on, rather than making a second one it never uses.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { claim, claimRefusal, reasonRefusal, readClaim, release, type Claim, type ClaimAnswer, type ClaimContext } from "./claims.js";
import { endIfMerged, inMergeQueue, type MergeWatch } from "./merges.js";

type WorkspaceContext = ClaimContext & { readonly folder: string };

export interface WorkspaceAttachment {
  /** The directory returned by the Codex app's create_worktree, or the Claude Code session's own linked worktree, used explicitly. */
  readonly folder: string;
  /** Codex: the exact commit returned by preparation and passed to create_worktree. */
  readonly ref?: string;
  /** Codex: the work-derived name returned by preparation. */
  readonly name?: string;
}

export type WorkspaceRefusal =
  | Exclude<ClaimAnswer, { ok: true }>
  | { ok: false; refused: "yours"; claim: Claim }
  | { ok: false; refused: "no-workspace"; why: string };

export interface ClaimedWorkspace {
  ok: true;
  status: "ready";
  claim: Claim;
  folder: string;
  branch: string;
  /** The fresh remote branch (Claude Code), or the pinned commit (Codex attachment). */
  base: string;
  takenOverFrom?: Claim;
}

export type WorkspaceAnswer =
  | ClaimedWorkspace
  | { ok: true; status: "prepared"; ref: string; name: string; base: string }
  | WorkspaceRefusal;

const FETCH_TIMEOUT_MS = 120_000;
const NAME_PART_MAX = 32;

/** Create and claim for Claude Code; for Codex return the app's creation arguments without a claim. */
export async function makeWorkspace(context: WorkspaceContext, id: string, reason: string, watch: MergeWatch = {}): Promise<WorkspaceAnswer> {
  const refused = reasonRefusal(reason) ?? await workspaceRefusal(context, id, reason, watch);
  if (refused !== undefined) return refused;
  const repository = repositoryOf(context.folder);
  if (typeof repository !== "string") return repository;
  const main = defaultBranch(repository);
  const fetched = fetchMain(repository, main);
  if (fetched !== undefined) return fetched;
  const base = `origin/${main}`;
  if (context.harness === "codex") {
    return { ok: true, status: "prepared", ref: run(repository, ["rev-parse", `refs/remotes/${base}`]).trim(), name: nameFor(id).replace(/-+/g, "-"), base };
  }

  const where = placeFor(repository, id);
  // A claim this session still holds is on a branch in the merge queue (workspaceRefusal): it moves to the new one.
  // Its line names the workspace's folder, where the branch lives, not the caller's (4.22).
  const claimed = await claim({ ...context, folder: where.folder, branch: where.branch }, id, reason, { moveBranch: true });
  if (!claimed.ok) return claimed;
  try {
    mkdirSync(path.dirname(where.folder), { recursive: true });
    run(repository, ["worktree", "add", "-b", where.branch, where.folder, `refs/remotes/${base}`]);
  } catch (error) {
    await release(context, id);
    return { ok: false, refused: "no-workspace", why: `git could not make the worktree: ${firstLine(error)}` };
  }
  return { ok: true, status: "ready", claim: claimed.claim, ...where, base, ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }) };
}

/** Attach an app-created worktree (Codex's, or the one a Claude Code session is already in) to this session's work, leaving its lifetime to the app. */
export async function attachWorkspace(context: WorkspaceContext, id: string, reason: string, attachment: WorkspaceAttachment, watch: MergeWatch = {}): Promise<ClaimedWorkspace | WorkspaceRefusal> {
  const refused = reasonRefusal(reason) ?? await workspaceRefusal(context, id, reason, watch);
  if (refused !== undefined) return refused;
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

  const branch = existingBranch || `codex/${attachment.name}`; // Only Codex's may be detached.
  const claimed = await claim({ ...context, folder, branch }, id, reason);
  if (!claimed.ok) return claimed; // Another session may have claimed since preparation.
  // A claim this session took elsewhere while checking must not be retargeted or released.
  if (claimed.alreadyHeld) return { ok: false, refused: "yours", claim: claimed.claim };
  try {
    if (run(folder, ["rev-parse", "HEAD"]).trim() !== base || run(folder, ["branch", "--show-current"]).trim() !== existingBranch) {
      throw new Error("the app worktree changed while its claim was being taken");
    }
    if (!existingBranch) run(folder, ["switch", "-c", branch]);
  } catch (error) {
    await release(context, id);
    return { ok: false, refused: "no-workspace", why: `could not attach the app worktree; the claim was released: ${firstLine(error)}` };
  }
  return { ok: true, status: "ready", claim: claimed.claim, folder, branch, base, ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }) };
}

/**
 * Why this session may not have a workspace for `id`. A claim it holds on a branch that has since
 * merged is ended first, and one on a branch waiting in the merge queue, which can take no more
 * commits, is not pointed back at either.
 */
async function workspaceRefusal(context: WorkspaceContext, id: string, reason: string, watch: MergeWatch): Promise<WorkspaceRefusal | undefined> {
  const mine = await readClaim(context.log, context.project, id);
  if (mine?.session === context.session && !(await endIfMerged({ ...context, source: "tool" }, mine, watch)) && !(await inMergeQueue(context.folder, mine, watch))) {
    return { ok: false, refused: "yours", claim: mine };
  }
  return claimRefusal(context, id, reason);
}

/** The main checkout of the repository `folder` is in, or why there is none to make a workspace from. */
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

/** The branch `origin` names as its default, as this clone last heard; `main` when it never said. */
function defaultBranch(repository: string): string {
  try {
    const named = run(repository, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).trim();
    return named.startsWith("origin/") && named.length > "origin/".length ? named.slice("origin/".length) : "main";
  } catch {
    return "main";
  }
}

/** Fetch `main` from `origin` into `origin/<main>`; undefined when it was fetched, else why not. */
function fetchMain(repository: string, main: string): { ok: false; refused: "no-workspace"; why: string } | undefined {
  try {
    run(repository, ["fetch", "--quiet", "origin", `+refs/heads/${main}:refs/remotes/origin/${main}`], FETCH_TIMEOUT_MS);
    return undefined;
  } catch (error) {
    return { ok: false, refused: "no-workspace", why: `could not fetch ${main} from origin, so there is no fresh main to cut from: ${firstLine(error)}` };
  }
}

/** A work-derived app-compatible name; the random suffix separates parallel preparations. */
function nameFor(id: string): string {
  const stem = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, NAME_PART_MAX).replace(/^-+|-+$/g, "") || "work";
  return `${stem}-${randomBytes(3).toString("hex")}`;
}

/** Claude Code's existing placement: a name no folder or branch has yet. */
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

/** Run git in `cwd`, and return what it printed; throws when it fails. */
function run(cwd: string, args: readonly string[], timeout = 30_000): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true });
}

/** The first line of what a failed git said. */
function firstLine(error: unknown): string {
  const said = (error as { stderr?: unknown }).stderr;
  const text = typeof said === "string" && said.trim() !== "" ? said : error instanceof Error ? error.message : String(error);
  return text.trim().split(/\r?\n/)[0] ?? "";
}
