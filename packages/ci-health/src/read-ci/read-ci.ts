// Capability 3 · Reading the project's CI.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Library } from "@storytree/library";
import { parseTestLog, scopeOfLog } from "../run-results/run-results.js";
import { recordHealth, recordUnclaimed } from "./record.js";
import { judgeRun, proofsAt, unclaimedVerdicts, type PlanTree, type Uncredited, type Verdict } from "../verdicts/verdicts.js";

export type GitHub = { json(route: string): Promise<any>; text(route: string): Promise<string> };

export type Git = (args: string[]) => Promise<string>;

const RUNS_LOOKED_AT = 20;

export const VERIFIED_BY_PROJECT_CI = "the project's CI";

export type CiReading =
  | { written: false; why: string }
  | { written: true; repository: string; run: string; commit: string; tests: number; unmatched: number; uncredited: Uncredited[]; passing: number; failing: number; notChecked: number };

export function gitIn(folder: string): Git {
  return async (args) => (await promisify(execFile)("git", ["-C", folder, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout;
}

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

export function repositoryOf(remote: string): string | undefined {
  const match = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

export function platformOfJob(job: { name?: string; labels?: readonly string[] }): string | undefined {
  for (const text of [...(job.labels ?? []), job.name ?? ""]) {
    if (/windows/i.test(text)) return "win32";
    if (/mac/i.test(text)) return "darwin";
    if (/ubuntu|linux/i.test(text)) return "linux";
  }
  return undefined;
}

function mappedFolders(tree: PlanTree): string[] {
  return tree.stories.flatMap(({ mapped, folders }) => [...(mapped?.folders ?? []), ...(folders ?? [])].map((folder) => folder.replace(/^\.\/?|\/$/g, "")));
}

async function filesAt(git: Git, commit: string, mapped: readonly string[]): Promise<{ path: string; text: string }[]> {
  const inMapped = (file: string) => mapped.some((folder) => folder === "" || file.startsWith(`${folder}/`));
  const listed = (await git(["ls-tree", "-r", "--name-only", commit, ...(mapped.length === 0 ? ["--", "packages"] : [])])).split("\n");
  const paths = listed.filter((file) => /\.(?:[cm]?[jt]sx?|py)$/.test(file) && (/^packages\/[^/]+\/./.test(file) || inMapped(file)));
  return Promise.all(paths.map(async (file) => ({ path: file, text: await git(["show", `${commit}:${file}`]) })));
}

async function filesOf(git: Git, commit: string, mapped: readonly string[]): Promise<{ path: string; text: string }[] | undefined> {
  try {
    return await filesAt(git, commit, mapped);
  } catch {
    await git(["fetch", "--quiet", "origin", "--", commit]).catch(() => "");
    return filesAt(git, commit, mapped).catch(() => undefined);
  }
}

async function jobResults(github: GitHub, repository: string, run: number): Promise<{ conclusion: string | undefined; platform: string | undefined; results: ReturnType<typeof parseTestLog>; scope?: ReturnType<typeof scopeOfLog> }[]> {
  const jobs: { id: number; conclusion?: string; name?: string; labels?: string[] }[] = ((await github.json(`repos/${repository}/actions/runs/${run}/jobs`)).jobs ?? [])
    .filter((job: { conclusion?: string }) => job.conclusion !== "skipped");
  return Promise.all(jobs.map(async (job) => {
    const platform = platformOfJob(job);
    const onPlatform = (log: string) => parseTestLog(log).map((result) => (platform === undefined ? result : { ...result, platform }));
    try {
      const log = await github.text(`repos/${repository}/actions/jobs/${job.id}/logs`);
      return { conclusion: job.conclusion, platform, results: onPlatform(log), scope: scopeOfLog(log) };
    } catch (error) {
      const said = String((error as { stderr?: string })?.stderr ?? error);
      if (job.conclusion === "cancelled" && /\bHTTP 404\b/.test(said)) return { conclusion: job.conclusion, platform, results: [] };
      throw error;
    }
  }));
}

export async function readProjectCi({ library, git, github }: { library: Library; git: Git; github: GitHub }): Promise<CiReading> {
  const remote = await git(["remote", "get-url", "origin"]).catch(() => "");
  const repository = repositoryOf(remote);
  if (repository === undefined) return { written: false, why: "This project has no GitHub origin, so storytree has no CI results to read; its health stays not checked." };

  const branch: string = (await github.json(`repos/${repository}`)).default_branch;
  const query = new URLSearchParams({ branch, event: "push", status: "completed", per_page: String(RUNS_LOOKED_AT) });
  type Run = { id: number; workflow_id?: number; conclusion?: string; head_sha: string; head_branch?: string; html_url: string };
  const finished: Run[] = (await github.json(`repos/${repository}/actions/runs?${query}`)).workflow_runs ?? [];
  if (finished.length === 0) return { written: false, why: `${repository} has no finished push run on ${branch}, so there are no CI results to read; its health stays not checked.` };
  const queued = new URLSearchParams({ event: "merge_group", status: "completed", per_page: String(RUNS_LOOKED_AT) });
  const queueRuns: Run[] = ((await github.json(`repos/${repository}/actions/runs?${queued}`)).workflow_runs ?? [])
    .filter((run: Run) => String(run.head_branch).startsWith(`gh-readonly-queue/${branch}/`));
  const candidates = finished.flatMap((push) => [push, ...queueRuns.filter(({ head_sha, workflow_id }) => head_sha === push.head_sha && workflow_id === push.workflow_id)]);
  const tree = await library.projectTree();
  const byRun = new Map<number, { commit: string; run: string; platformsSeen: Set<string>; verdicts: Map<string, Verdict> }>();
  const done = new Set<string>();
  let newest: { run: Run; tests: number; unmatched: ReturnType<typeof judgeRun>["unmatched"]; uncredited: Uncredited[]; files: { path: string; text: string }[] } | undefined;
  for (const run of candidates.filter(({ conclusion }) => conclusion !== "cancelled")) {
    const jobs = await jobResults(github, repository, run.id);
    if (jobs.some(({ conclusion }) => conclusion === "cancelled") && !jobs.some(({ conclusion, results }) => conclusion !== "cancelled" && results.length > 0)) continue;
    const results = jobs.flatMap(({ results }) => results);
    const named = jobs.flatMap(({ scope }) => (scope === undefined ? [] : [scope]));
    if (results.length === 0 && named.length === 0) continue;
    const scoped = named.length === 0 || named.includes("everything") ? undefined : new Set(named.flat());
    const files = await filesOf(git, run.head_sha, mappedFolders(tree));
    if (files === undefined) {
      if (newest === undefined) return { written: false, why: `Run ${run.html_url} tested commit ${run.head_sha}, which this clone does not have and could not fetch; pull, then read again.` };
      continue;
    }
    const proofs = proofsAt(tree, files);
    const { verdicts, unmatched, uncredited } = judgeRun(proofs, results);
    newest ??= { run, tests: results.length, unmatched, uncredited, files };
    const platformsSeen = new Set(jobs.flatMap(({ conclusion, platform }) => (conclusion === "cancelled" || platform === undefined ? [] : [platform])));
    const fromRun = byRun.get(run.id) ?? { commit: run.head_sha.slice(0, 12), run: run.html_url, platformsSeen, verdicts: new Map<string, Verdict>() };
    byRun.set(run.id, fromRun);
    for (const story of proofs.filter(({ package: own, packages }) => !done.has(own) && (scoped === undefined || packages.every((name) => scoped.has(`packages/${name}`))))) {
      done.add(story.package);
      for (const id of story.contracts.values()) if (verdicts.has(id)) fromRun.verdicts.set(id, verdicts.get(id)!);
    }
    const held = new Set(files.map(({ path }) => path.split("/")[1]));
    if (scoped === undefined || proofs.every(({ package: own, packages }) => done.has(own) || !packages.some((name) => held.has(name)))) break;
  }
  if (newest === undefined) return { written: false, why: `${repository}'s last ${finished.length} finished push runs on ${branch}, and the merge queue's runs of their commits, were all cancelled before they ran to their end, so there are no whole CI results to read; its health stands as it was.` };
  const { run } = newest;
  const commit: string = run.head_sha;

  const counts = { passing: 0, failing: 0, notChecked: 0 };
  for (const { commit: seen, run: url, platformsSeen, verdicts } of byRun.values()) {
    const written = await recordHealth(library, new Map([...verdicts.keys()].map((id) => [id, id])), verdicts, { by: VERIFIED_BY_PROJECT_CI, source: "ci", commit: seen, run: url }, { platformsSeen });
    counts.passing += written.passing;
    counts.failing += written.failing;
    counts.notChecked += [...verdicts.values()].filter(({ state, skipped }) => state === "not-checked" && skipped > 0).length;
  }
  await recordUnclaimed(library, tree, await unclaimedVerdicts(tree, newest.files, newest.unmatched), { by: VERIFIED_BY_PROJECT_CI, source: "ci", commit: commit.slice(0, 12), run: run.html_url });
  return { written: true, repository, run: run.html_url, commit, tests: newest.tests, unmatched: newest.unmatched.length, uncredited: newest.uncredited, ...counts };
}
