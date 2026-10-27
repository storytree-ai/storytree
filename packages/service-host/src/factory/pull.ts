/**
 * Capability 4 · Keeping the factory current, contracts 4.1 and 4.2 (ADR-1180 D3). The factory pull, ported from
 * `advance()` in the factory's plugins/voice/src/host.ts (voice's contract 4.11): it fast-forwards this machine's factory
 * clone to origin/main and reinstalls only when the lockfile changed; a failed install puts HEAD back where it was and
 * throws, so the services keep running on the code they started on. It updates only a clone on main with a clean
 * working tree, because the laptop's clone is where the factory is edited, and says why when it does not. It names the
 * plugins whose folders the move changed, which are the services the host restarts.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const LOCKFILE = "pnpm-lock.yaml";

/** What one pull did: nothing (with why), found the clone already at main, or moved it. */
export type Pulled =
  | { readonly updated: false; readonly reason: string }
  | { readonly updated: true; readonly moved: false; readonly head: string }
  | { readonly updated: true; readonly moved: true; readonly from: string; readonly to: string; readonly reinstalled: boolean; readonly plugins: readonly string[] };

/** How the pull installs the clone's packages from its lockfile; throws when the install fails. */
export type Install = (folder: string) => Promise<void>;

/** The real install: the clone's frozen-lockfile install. */
export const pnpmInstall: Install = async (folder) => {
  await run("pnpm", ["install", "--frozen-lockfile"], { cwd: folder });
};

/** Fast-forward the factory clone at `folder` to origin/main; a failed install puts HEAD back and throws. */
export async function pullFactory(folder: string, install: Install = pnpmInstall): Promise<Pulled> {
  const git = async (...args: string[]) => (await run("git", ["-C", folder, ...args], { encoding: "utf8" })).stdout.trim();
  if (!existsSync(path.join(folder, ".git"))) return { updated: false, reason: `${folder} is not a git clone` };
  const branch = await git("symbolic-ref", "-q", "--short", "HEAD").catch(() => "");
  if (branch !== "main") return { updated: false, reason: `the clone is on ${branch === "" ? "no branch" : branch}, not main` };
  const changes = await git("status", "--porcelain");
  if (changes !== "") return { updated: false, reason: `the clone has changes not committed (${changes.split("\n").length} path${changes.includes("\n") ? "s" : ""})` };
  await git("fetch", "-q", "origin", "main");
  const from = await git("rev-parse", "HEAD");
  if (from === await git("rev-parse", "FETCH_HEAD")) return { updated: true, moved: false, head: from };
  await git("merge", "-q", "--ff-only", "FETCH_HEAD");
  // A clone already holding main (ahead of it, with commits not yet pushed) fast-forwards nowhere.
  const to = await git("rev-parse", "HEAD");
  if (to === from) return { updated: true, moved: false, head: from };
  const changed = (await git("diff", "--name-only", from, to)).split("\n").filter((file) => file !== "");
  const reinstalled = changed.includes(LOCKFILE);
  if (reinstalled) {
    try {
      await install(folder);
    } catch (error) {
      await git("reset", "-q", "--hard", from);
      throw new Error(`the install for ${to.slice(0, 12)} failed, so the factory is back at ${from.slice(0, 12)}: ${(error as Error).message}`);
    }
  }
  const plugins = [...new Set(changed.map((file) => /^plugins\/([^/]+)\//.exec(file)?.[1]).filter((plugin) => plugin !== undefined))].sort();
  return { updated: true, moved: true, from, to, reinstalled, plugins };
}
