/**
 * Capability 3 · Reading the project's CI (ADR-0902): the newest finished push run on a GitHub
 * project's default branch (or the merge queue's run of its commit), read through the Actions API, and its verdicts written to the library's
 * verified column.
 *
 * - Only a push run on the default branch is read: a pull request's run never marks the merged tree
 *   (ADR-0744 D3). The repository is the project folder's `origin`, reached with the user's own `gh`
 *   sign-in, so the user sets nothing up.
 * - The run's commit (`head_sha`) is the commit every verdict is for: the tests' titles are read from
 *   the files at that commit, in the project's own clone, and the commit is written in each note.
 * - A cancelled run is passed over: on a busy branch a newer push cancels the run before it, often before its slowest
 *   job (Windows) has run its tests, so the newest finished run that ran to its end is read. So is a run that concludes
 *   failure only because its test jobs were cancelled (an aggregate job failing on them): one with a cancelled job and
 *   no whole job holding test results.
 * - A branch that merges through GitHub's merge queue has each commit tested by the queue's `merge_group` run before the
 *   branch is moved to it, and the next merge usually cancels the push run of that commit. So the queue's finished run
 *   of a commit the default branch's push runs name is read in that push run's place, the push run first when it ran
 *   to its end. A queue run of a commit the branch never reached is not: its merge failed or was taken out.
 * - A skipped job is passed over; a cancelled job's log is read if available, passed over only on 404.
 * - Each job's results are its platform's, read from its runner labels or its name, so a test one platform skips
 *   for another is credited from the jobs of the platform it needs.
 * - Passing and failing are written by the project's CI; a skip writes not checked with its reason and kind;
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

/** How many of the newest finished push runs are looked through for one that was not cancelled. */
const RUNS_LOOKED_AT = 20;

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

/** The platform a job ran on, from its runner labels or else its name (`verify on Windows`), or undefined. */
export function platformOfJob(job: { name?: string; labels?: readonly string[] }): string | undefined {
  for (const text of [...(job.labels ?? []), job.name ?? ""]) {
    if (/windows/i.test(text)) return "win32";
    if (/mac/i.test(text)) return "darwin";
    if (/ubuntu|linux/i.test(text)) return "linux";
  }
  return undefined;
}

/** Each code file in a package at `commit` (its src, and test folders beside it), in repository coordinates. */
async function filesAt(git: Git, commit: string): Promise<{ path: string; text: string }[]> {
  const paths = (await git(["ls-tree", "-r", "--name-only", commit, "--", "packages"])).split("\n").filter((file) => /^packages\/[^/]+\/.+\.[cm]?[jt]sx?$/.test(file));
  return Promise.all(paths.map(async (file) => ({ path: file, text: await git(["show", `${commit}:${file}`]) })));
}

/** Each job a run did not skip, with its conclusion and the test results its log holds, as its platform's. */
async function jobResults(github: GitHub, repository: string, run: number): Promise<{ conclusion: string | undefined; results: ReturnType<typeof parseTestLog> }[]> {
  // A job the run skipped ran nothing and has no log: GitHub answers its log with 404.
  const jobs: { id: number; conclusion?: string; name?: string; labels?: string[] }[] = ((await github.json(`repos/${repository}/actions/runs/${run}/jobs`)).jobs ?? [])
    .filter((job: { conclusion?: string }) => job.conclusion !== "skipped");
  return Promise.all(jobs.map(async (job) => {
    const platform = platformOfJob(job);
    const onPlatform = (log: string) => parseTestLog(log).map((result) => (platform === undefined ? result : { ...result, platform }));
    try {
      return { conclusion: job.conclusion, results: onPlatform(await github.text(`repos/${repository}/actions/jobs/${job.id}/logs`)) };
    } catch (error) {
      // Cancellation can leave no log, but a job that started may still hold test evidence.
      const said = String((error as { stderr?: string })?.stderr ?? error);
      if (job.conclusion === "cancelled" && /\bHTTP 404\b/.test(said)) return { conclusion: job.conclusion, results: [] };
      throw error;
    }
  }));
}

/** Read the project's CI into its library's verified column. */
export async function readProjectCi({ library, git, github }: { library: Library; git: Git; github: GitHub }): Promise<CiReading> {
  const remote = await git(["remote", "get-url", "origin"]).catch(() => "");
  const repository = repositoryOf(remote);
  if (repository === undefined) return { written: false, why: "This project has no GitHub origin, so storytree has no CI results to read; its health stays not checked." };

  const branch: string = (await github.json(`repos/${repository}`)).default_branch;
  const query = new URLSearchParams({ branch, event: "push", status: "completed", per_page: String(RUNS_LOOKED_AT) });
  type Run = { id: number; conclusion?: string; head_sha: string; head_branch?: string; html_url: string };
  const finished: Run[] = (await github.json(`repos/${repository}/actions/runs?${query}`)).workflow_runs ?? [];
  if (finished.length === 0) return { written: false, why: `${repository} has no finished push run on ${branch}, so there are no CI results to read; its health stays not checked.` };
  const queued = new URLSearchParams({ event: "merge_group", status: "completed", per_page: String(RUNS_LOOKED_AT) });
  const queueRuns: Run[] = ((await github.json(`repos/${repository}/actions/runs?${queued}`)).workflow_runs ?? [])
    .filter((run: Run) => String(run.head_branch).startsWith(`gh-readonly-queue/${branch}/`));
  // Each commit the branch's push runs name, newest first: its push run, then the merge queue's runs of the same commit.
  const candidates = finished.flatMap((push) => [push, ...queueRuns.filter(({ head_sha }) => head_sha === push.head_sha)]);
  // A newer push cancels the run before it, often before its slowest job ran its tests: read the newest that ran to its end.
  // A run can conclude failure for that alone (an aggregate job failing on its cancelled ones), so it is judged by its jobs too.
  let read: { run: Run; results: ReturnType<typeof parseTestLog> } | undefined;
  for (const run of candidates.filter(({ conclusion }) => conclusion !== "cancelled")) {
    const jobs = await jobResults(github, repository, run.id);
    if (jobs.some(({ conclusion }) => conclusion === "cancelled") && !jobs.some(({ conclusion, results }) => conclusion !== "cancelled" && results.length > 0)) continue;
    read = { run, results: jobs.flatMap(({ results }) => results) };
    break;
  }
  if (read === undefined) return { written: false, why: `${repository}'s last ${finished.length} finished push runs on ${branch}, and the merge queue's runs of their commits, were all cancelled before they ran to their end, so there are no whole CI results to read; its health stands as it was.` };
  const { run, results } = read;

  const commit: string = run.head_sha;
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
      await library.recordVerified(id, "not-checked", { by: VERIFIED_BY_PROJECT_CI, note: `${verdict.note}, ${at}`, ...(verdict.skip === undefined ? {} : { skip: verdict.skip }) });
      counts.notChecked++;
      continue;
    }
    await library.recordVerified(id, verdict.state, { by: VERIFIED_BY_PROJECT_CI, note: `${verdict.note}, ${at}` });
    counts[verdict.state]++;
  }
  return { written: true, repository, run: run.html_url, commit, tests: results.length, unmatched: unmatched.length, ...counts };
}
