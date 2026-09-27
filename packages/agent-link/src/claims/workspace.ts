/**
 * A workspace already claimed (ADR-0653, the owner's K1): "make a workspace for this work" is one
 * step, so a workspace is never made and left unclaimed. Storytree 0.2's `worktree create --node`
 * (its ADR-0200 D3) is the behavioural reference.
 *
 * - The steps, each one's failure stopping the rest: the claim's own refusals (held, waiting,
 *   closed, unknown, and work the session already holds); fetch main from `origin`; claim, naming
 *   the new branch, so that its pull request merging ends the claim (ADR-0643 D3); then
 *   `git worktree add` on that branch from the main just fetched. No claim, no workspace: a refusal
 *   makes no folder, branch or line, and if git fails to make the worktree the claim is released.
 * - It wraps the harness's own worktree feature rather than replacing it: the folder is where that
 *   harness keeps its worktrees, so the harness can enter it as one of its own. Claude Code keeps
 *   them in `.claude/worktrees/<name>` of the main checkout on `claude/<name>` branches, and enters
 *   one with its `EnterWorktree` tool; Codex keeps them in `<CODEX_HOME>/worktrees/<name>/<repo>`.
 * - Installing the new folder's packages is not done here: that is the project's own session start,
 *   whatever its stack.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { claim, claimRefusal, readClaim, release, type Claim, type ClaimAnswer, type ClaimContext } from "./claims.js";

export interface WorkspaceOptions {
  /** Codex's home, where it keeps its worktrees. By default CODEX_HOME, else ~/.codex. */
  readonly codexHome?: string;
}

export type WorkspaceAnswer =
  | {
      ok: true;
      claim: Claim;
      /** The new workspace's folder. */
      folder: string;
      /** Its new branch, which the claim names. */
      branch: string;
      /** What it was cut from: `origin/<main>`, as just fetched. */
      base: string;
      takenOverFrom?: Claim;
    }
  | Exclude<ClaimAnswer, { ok: true }>
  | { ok: false; refused: "yours"; claim: Claim }
  | { ok: false; refused: "no-workspace"; why: string };

/** How long fetching main may take before it counts as not fetched. */
const FETCH_TIMEOUT_MS = 120_000;
/** How much of the work's id goes into the workspace's name. */
const NAME_PART_MAX = 32;

/**
 * Make a workspace for `id`, a capability or an increment, already claimed by the context's session
 * with `reason`: a fresh branch from `origin`'s main as just fetched, a git worktree for it where the
 * session's harness keeps its own, and the claim. `context.folder` is anywhere in the project's
 * repository.
 */
export async function makeWorkspace(context: ClaimContext & { readonly folder: string }, id: string, reason: string, options: WorkspaceOptions = {}): Promise<WorkspaceAnswer> {
  const mine = await readClaim(context.log, context.project, id);
  if (mine?.session === context.session) return { ok: false, refused: "yours", claim: mine };
  const refused = await claimRefusal(context, id);
  if (refused !== undefined) return refused;

  const repository = repositoryOf(context.folder);
  if (typeof repository !== "string") return repository;
  const main = defaultBranch(repository);
  const fetched = fetchMain(repository, main);
  if (fetched !== undefined) return fetched;
  const base = `origin/${main}`;

  const codex = context.harness === "codex";
  const where = placeFor(repository, id, codex ? (options.codexHome ?? codexHomeOf()) : undefined);
  const claimed = await claim({ ...context, branch: where.branch }, id, reason);
  if (!claimed.ok) return claimed;
  try {
    mkdirSync(path.dirname(where.folder), { recursive: true });
    run(repository, ["worktree", "add", "-b", where.branch, where.folder, `refs/remotes/${base}`]);
  } catch (error) {
    await release(context, id);
    return { ok: false, refused: "no-workspace", why: `git could not make the worktree: ${firstLine(error)}` };
  }
  return {
    ok: true,
    claim: claimed.claim,
    folder: where.folder,
    branch: where.branch,
    base,
    ...(claimed.takenOverFrom === undefined ? {} : { takenOverFrom: claimed.takenOverFrom }),
  };
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

/** Where the workspace goes and its branch: a name no folder or branch has yet, in the harness's place. */
function placeFor(repository: string, id: string, codexHome: string | undefined): { folder: string; branch: string } {
  const stem = id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, NAME_PART_MAX).replace(/^-+|-+$/g, "") || "work";
  for (;;) {
    const name = `${stem}-${randomBytes(3).toString("hex")}`;
    const place =
      codexHome === undefined
        ? { folder: path.join(repository, ".claude", "worktrees", name), branch: `claude/${name}` }
        : { folder: path.join(codexHome, "worktrees", name, path.basename(repository)), branch: `codex/${name}` };
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

function codexHomeOf(): string {
  return process.env.CODEX_HOME || path.join(homedir(), ".codex");
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
