/**
 * Capability 3 · Reading the project's CI (ADR-0902): the newest finished push run on a GitHub
 * project's default branch, read through the Actions API, and its verdicts written to the library's
 * verified column.
 *
 * - Only a push run on the default branch is read: a pull request's run never marks the merged tree
 *   (ADR-0744 D3). The repository is the project folder's `origin`, reached with the user's own `gh`
 *   sign-in, so the user sets nothing up.
 * - The run's commit (`head_sha`) is the commit every verdict is for: the tests' titles are read from
 *   the files at that commit, in the project's own clone, and the commit is written in each note.
 * - Passing and failing are written by the project's CI; a skip writes not checked with its reason;
 *   a contract no test ran for is left as it stands. The agent's reported column is never written.
 * - A project with no GitHub origin, or no finished push run, writes nothing and says why.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Library } from "@storytree/library";
import { parseTestLog } from "../run-results/run-results.js";
import { judgeRun, proofsAt } from "../verdicts/verdicts.js";

/** The Actions API: a route's JSON, or its text (a job's log). */
export type GitHub = { json(route: string): Promise<any>; text(route: string): Promise<string> };

/** git, run in the project's folder: its output. */
export type Git = (args: string[]) => Promise<string>;

/** Who writes a verdict read from a user's CI. */
export const VERIFIED_BY_PROJECT_CI = "the project's CI";

export type CiReading =
  | { written: false; why: string }
  | { written: true; repository: string; run: string; commit: string; tests: number; unmatched: number; passing: number; failing: number; notChecked: number };

/** git in `folder`. */
export function gitIn(folder: string): Git {
  return async (args) => (await promisify(execFile)("git", ["-C", folder, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout;
}

/**
 * The Actions API through the user's `gh` sign-in (`command`, after `prefix`), asking again on GitHub's passing 5xx
 * answers. A job's log may hold terminal escape sequences, which gh from 2.10x prints only when allowed; older gh knows
 * no such flag, so it is passed only once gh asks for it.
 */
export function ghApi(command = "gh", prefix: readonly string[] = []): GitHub {
  const call = async (route: string): Promise<string> => {
    let allow: string[] = [];
    for (let attempt = 1; ; attempt++) {
      try {
        return (await promisify(execFile)(command, [...prefix, "api", route, ...allow], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout;
      } catch (error) {
        const said = String((error as { stderr?: string }).stderr ?? error);
        if (allow.length === 0 && said.includes("--allow-escape-sequences")) allow = ["--allow-escape-sequences"];
        else if (attempt >= 3 || !/HTTP 5\d\d/.test(said)) throw error;
      }
    }
  };
  return { json: async (route) => JSON.parse(await call(route)), text: call };
}

/** The GitHub repository (`owner/name`) a git remote URL names, or undefined. */
export function repositoryOf(remote: string): string | undefined {
  const match = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** Each code file under a package's src at `commit`, in repository coordinates. */
async function filesAt(git: Git, commit: string): Promise<{ path: string; text: string }[]> {
  const paths = (await git(["ls-tree", "-r", "--name-only", commit, "--", "packages"])).split("\n").filter((file) => /^packages\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/.test(file));
  return Promise.all(paths.map(async (file) => ({ path: file, text: await git(["show", `${commit}:${file}`]) })));
}

/** Read the project's CI into its library's verified column. */
export async function readProjectCi({ library, git, github }: { library: Library; git: Git; github: GitHub }): Promise<CiReading> {
  const remote = await git(["remote", "get-url", "origin"]).catch(() => "");
  const repository = repositoryOf(remote);
  if (repository === undefined) return { written: false, why: "This project has no GitHub origin, so storytree has no CI results to read; its health stays not checked." };

  const branch: string = (await github.json(`repos/${repository}`)).default_branch;
  const query = new URLSearchParams({ branch, event: "push", status: "completed", per_page: "1" });
  const [run] = (await github.json(`repos/${repository}/actions/runs?${query}`)).workflow_runs ?? [];
  if (run === undefined) return { written: false, why: `${repository} has no finished push run on ${branch}, so there are no CI results to read; its health stays not checked.` };

  const commit: string = run.head_sha;
  const jobs: { id: number }[] = (await github.json(`repos/${repository}/actions/runs/${run.id}/jobs`)).jobs ?? [];
  const results = (await Promise.all(jobs.map((job) => github.text(`repos/${repository}/actions/jobs/${job.id}/logs`)))).flatMap(parseTestLog);

  let files;
  try {
    files = await filesAt(git, commit);
  } catch {
    await git(["fetch", "--quiet", "origin", commit]).catch(() => "");
    files = await filesAt(git, commit).catch(() => undefined);
  }
  if (files === undefined) return { written: false, why: `Run ${run.html_url} tested commit ${commit}, which this clone does not have and could not fetch; pull, then read again.` };

  const { verdicts, unmatched } = judgeRun(proofsAt(await library.projectTree(), files), results);
  const counts = { passing: 0, failing: 0, notChecked: 0 };
  const at = `at commit ${commit.slice(0, 12)}, run ${run.html_url}`;
  for (const [id, verdict] of verdicts) {
    if (verdict.state === "not-checked") {
      if (verdict.skipped === 0) continue;
      await library.recordVerified(id, "not-checked", { by: VERIFIED_BY_PROJECT_CI, note: `${verdict.note}, ${at}` });
      counts.notChecked++;
      continue;
    }
    await library.recordVerified(id, verdict.state, { by: VERIFIED_BY_PROJECT_CI, note: `${verdict.note}, ${at}` });
    counts[verdict.state]++;
  }
  return { written: true, repository, run: run.html_url, commit, tests: results.length, unmatched: unmatched.length, ...counts };
}
