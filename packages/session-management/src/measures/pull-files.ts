/**
 * Capability 20 · Lane measures: a pull request's changed files (contract 20.3), read from the checkout's own git
 * history with no network call. A pull request merged by GitHub leaves a merge commit, "Merge pull request #N from …",
 * on the main line; the files it changed are that commit's against its first parent.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MERGE = /^Merge pull request #(\d+) /;

async function git(folder: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", folder, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/**
 * A reader of the files each pull request changed, from `folder`'s history along `ref` (origin's main when the checkout
 * has it, else its own HEAD): undefined for a pull request whose merge is not there.
 */
export async function pullFiles(folder: string, ref?: string): Promise<(pr: number) => Promise<readonly string[] | undefined>> {
  const line = ref ?? await git(folder, ["rev-parse", "--verify", "--quiet", "origin/main"]).then(() => "origin/main", () => "HEAD");
  const merges = new Map<number, string>();
  for (const entry of (await git(folder, ["log", "--merges", "--first-parent", "--format=%H%x09%s", line])).split("\n")) {
    const [sha, subject] = entry.split("\t");
    const pr = MERGE.exec(subject ?? "")?.[1];
    if (sha !== undefined && pr !== undefined && !merges.has(Number(pr))) merges.set(Number(pr), sha);
  }
  return async (pr) => {
    const sha = merges.get(pr);
    if (sha === undefined) return undefined;
    return (await git(folder, ["diff", "--name-only", `${sha}^1`, sha])).split("\n").filter((file) => file !== "");
  };
}
