// Capability 4 · Keeping the factory current
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const LOCKFILE = "pnpm-lock.yaml";

export type Pulled =
  | { readonly updated: false; readonly reason: string }
  | { readonly updated: true; readonly moved: false; readonly head: string }
  | { readonly updated: true; readonly moved: true; readonly from: string; readonly to: string; readonly reinstalled: boolean; readonly plugins: readonly string[] };

export type Install = (folder: string) => Promise<void>;

export const pnpmInstall: Install = async (folder) => {
  await run("pnpm", ["install", "--frozen-lockfile"], { cwd: folder });
};

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
