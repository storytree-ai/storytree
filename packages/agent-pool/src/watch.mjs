// Capability 4 · A watcher lands a handed-over pull request (ADR-0955 D3).
import { execFile, spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig, readCap } from "./pool-config.mjs";
import { LANE_RUN, storytreeCommand } from "./runner.mjs";
import { readBoxPace } from "./pace.mjs";
import { codeVersion, countEngines, holdRunner, localBrief, processTable, WINDOWS_PROCESSES } from "./queue.mjs";
import { EXEMPTIONS_EVERY_MS, exemptionChanges, watchExemptions } from "./exemptions-watch.mjs";
import { attempted, failedJob, FOLLOWERS, isSecurityCheck, judgeReleases, raisedSince, readWait, recordFix, RELEASE_ARC, RELEASE_EVERY_MS, RUNNER_ATTEMPTS, runnerFault, runnerReruns, securityJobs, watchReleases, writeWhole } from "./release-watch.mjs";

export const WATCH_CODE = ["watch.mjs", "release-watch.mjs", "exemptions-watch.mjs", "queue.mjs", "pace.mjs", "runner.mjs", "engine.mjs", "pool-config.mjs"]
  .map((name) => `packages/agent-pool/src/${name}`);

const run = promisify(execFile);
const RED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
const SUPERSEDED = /^Canceling since a higher priority waiting request for .+ exists/;
const EJECTED = new Set(["FAILED_CHECKS", "BRANCH_PROTECTION_FAILURE"]);
export const MARKS = [/watch\.mjs run( |$)/];
const LOOP_MARKS = [/watch\.mjs watch( |$)/];

export const isFixSession = (args) => /agent-pool[\\/]src[\\/]runner\.mjs run /.test(args);
export const runnerStart = (runner, args) => ["--import", import.meta.resolve("tsx"), runner, ...args];
export const RESTART = 3;
const HELD_DAYS = 3;
const HELD_MS = HELD_DAYS * 86_400_000;
const UNREADABLE_MS = 60 * 60_000;
const ENQUEUE_TRIES = 3;

export function readPull(pull, { since, now, graceMs, home = HOME }) {
  const head = pull.headRefOid;
  if (!ownPull(pull, home)) return { state: "foreign", head };
  if (pull.state === "MERGED") return { state: "merged", head };
  if (pull.state === "CLOSED") return { state: "closed", head };
  const checks = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const runOf = (check) => /\/actions\/runs\/(\d+)\//.exec(check.detailsUrl ?? "")?.[1];
  const superseded = new Set(checks.filter((check) => check.annotations?.nodes?.some((one) => SUPERSEDED.test(one?.message ?? ""))).map(runOf).filter(Boolean));
  const failed = checks.filter((check) => RED.has(check.conclusion ?? check.state) && !(check.conclusion === "CANCELLED" && superseded.has(runOf(check))));
  const why = failed.map((check) => `${check.name ?? check.context} failed`).join("; ");
  const logs = failed.map((check) => check.detailsUrl ?? check.targetUrl).filter(Boolean);
  const names = failed.map((check) => check.name ?? check.context).filter(Boolean);
  const runsOf = (checks) => {
    const ids = checks.map(runOf);
    return ids.length && ids.every(Boolean) ? { runs: [...new Set(ids.map(Number))] } : {};
  };
  const security = names.filter(isSecurityCheck);
  if (security.length) {
    return { state: "red", head, why: `${security.join(", ")} failed`, logs: [], checks: security, security,
      ...runsOf(failed.filter((check) => isSecurityCheck(check.name ?? check.context))) };
  }
  if (pull.mergeable === "CONFLICTING") {
    return { state: "red", head, why: `it conflicts with main: merge origin/main and resolve the conflicts${why ? `; also ${why}` : ""}`, logs,
      checks: names, conflict: true, branch: pull.headRefName };
  }
  if (failed.length) return { state: "red", head, why, logs, checks: names, ...runsOf(failed) };
  const removal = pull.timelineItems?.nodes?.at(-1);
  const removedAt = Date.parse(removal?.createdAt);
  if (!pull.mergeQueueEntry && EJECTED.has(removal?.reason?.toUpperCase()) && removedAt > Date.parse(since) && now - removedAt > graceMs) {
    return { state: "red", head, why: `the merge queue removed it (${removal.reason}) and did not take it back`, logs: [], checks: [] };
  }
  const finished = checks.every((check) => check.__typename === "StatusContext" ? check.state !== "PENDING" && check.state !== "EXPECTED" : check.status === "COMPLETED");
  const verified = checks.some((check) => check.name === "verify" && check.conclusion === "SUCCESS");
  const held = pull.isDraft || pull.labels?.nodes?.some((label) => label.name === "hold");
  if (!pull.mergeQueueEntry && !held && finished && verified && pull.mergeable !== "UNKNOWN" && !(now - removedAt <= graceMs) && pull.id) {
    return { state: "pending", head, stranded: pull.id };
  }
  return { state: "pending", head };
}

export const SETUP_ATTEMPTS = 3;
const SETUP_STEP = /^(Set up job|Initialize CodeQL|Checkout|Run actions\/checkout)/i;
const isCodeScan = (name) => isSecurityCheck(name) && name !== "secret-check";

export function scanSetup(pull, runs, alerts) {
  if (!pull.security?.every(isCodeScan) || !runs.length || alerts > 0) return pull;
  const jobs = runs.flatMap((one) => one.jobs.filter((job) => job.steps > 0 && job.conclusion === "failure" && isCodeScan(job.name)));
  const steps = [...new Set(jobs.map((job) => job.failed))];
  const why = alerts === 0 ? "no open alert on its merge ref"
    : jobs.length && steps.every((step) => SETUP_STEP.test(step ?? "")) ? `it failed at ${steps.join(", ")}` : undefined;
  if (!why) return pull;
  if (runs.some((one) => one.status !== "completed")) return { state: "pending", head: pull.head };
  const said = `${pull.checks.join(", ")} failed before analysing (${why})`;
  const { security, ...plain } = pull;
  if (runs.every((one) => one.attempt < SETUP_ATTEMPTS)) return { ...plain, why: said, runner: { runs, why: said } };
  return { ...plain, why: `${said} on ${SETUP_ATTEMPTS} attempts: an infrastructure red`,
    logs: runs.map((one) => `https://github.com/${one.repo}/actions/runs/${one.id}`) };
}

export async function readScan(pull, pr, { json, jobs, api = REPO, home = HOME }) {
  if (!pull.runs || !pull.security.every(isCodeScan)) return pull;
  const runs = [];
  for (const id of pull.runs) {
    const one = await json(`${api}/actions/runs/${id}`);
    runs.push({ id, attempt: one.run_attempt, status: one.status, repo: one.repository?.full_name ?? home, jobs: await jobs(one) });
  }
  const alerts = await json(`${api}/code-scanning/alerts?ref=refs/pull/${pr}/merge&state=open&per_page=1`).then((open) => open.length, () => undefined);
  return scanSetup(pull, runs, alerts);
}

export const HOME = "storytree-ai/storytree";

export const ownPull = (pull, home = HOME) => pull?.isCrossRepository === false && pull.headRepository?.nameWithOwner === home;

export function ownBranch(pr, view, home = HOME) {
  const own = view?.isCrossRepository === false && `${view.headRepositoryOwner?.login}/${view.headRepository?.name}` === home;
  if (!own || typeof view.headRefName !== "string" || !view.headRefName) {
    throw new Error(`not handed over: PR #${pr}'s head is not on ${home}, or GitHub did not say where it is; the watcher takes only this repository's pull requests`);
  }
  if (view.state && view.state !== "OPEN") {
    throw new Error(`not handed over: PR #${pr} on ${home} is ${view.state.toLowerCase()}, not open; a pull request on another repository is handed over with --repo <owner/name>, from an increment in that repository's library`);
  }
  return view.headRefName;
}

export function wrongRepo({ pr, increment, named, owner, ours }) {
  const home = owner?.repo ?? HOME;
  if (!named || named === home || (!owner && !ours)) return undefined;
  return `not handed over: ${increment} is in ${owner?.name ?? "storytree"}'s library, whose pull requests are on ${home}, and PR #${pr} is on ${named};`
    + ` the watcher would read PR #${pr} as ${home}'s. Plan the increment in the library of the repository its pull request is on, and hand that one over.`;
}

const VIEW = ["--json", "headRefName,isCrossRepository,headRepository,headRepositoryOwner,state"];

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  id state isDraft headRefOid headRefName isCrossRepository headRepository { nameWithOwner } mergeable mergeQueueEntry { state } labels(first: 100) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name status conclusion detailsUrl annotations(first: 5) { nodes { message } } } ... on StatusContext { context state targetUrl } } } } } } }
  timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT], last: 20) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason
    beforeCommit { oid parents(first: 2) { nodes { oid } } } } } }
} } }`;

export const queueRemovals = (pull, seen = new Set()) => (pull?.timelineItems?.nodes ?? [])
  .filter((removal) => removal?.reason?.toUpperCase() === "FAILED_CHECKS" && removal.createdAt && removal.beforeCommit?.oid && !seen.has(removal.createdAt))
  .map((removal) => ({ at: removal.createdAt, commit: removal.beforeCommit.oid, parents: (removal.beforeCommit.parents?.nodes ?? []).map((one) => one.oid) }));

export function queueOutcome(red, { merged, head, reached }) {
  if (reached === false) return "ahead";
  if (!merged || reached !== true || !red.parents?.[1]) return "unknown";
  return red.parents[1] === head ? "flake" : "real";
}

export function failedOnQueue(checkRuns) {
  const failed = checkRuns.filter((check) => RED.has(check.conclusion?.toUpperCase()));
  return { checks: [...new Set(failed.map((check) => check.name))],
    runs: [...new Set(failed.map((check) => /\/actions\/runs\/(\d+)\//.exec(check.details_url ?? "")?.[1]).filter(Boolean).map(Number))] };
}

export function onMain(status) {
  if (status === "behind" || status === "identical") return true;
  if (status === "diverged" || status === "ahead") return false;
  throw new Error(`GitHub's compare with main read ${status || "nothing"}`);
}

async function queueFailures(repo, commit, home = HOME, gh = ghRun) {
  const api = `repos/${home}`;
  const { checks, runs: ids } = failedOnQueue((await ghJson(repo, `${api}/commits/${commit}/check-runs?per_page=100`, gh)).check_runs);
  const runs = [];
  for (const id of ids) {
    const one = await ghJson(repo, `${api}/actions/runs/${id}`, gh);
    const jobs = await Promise.all((await jobsOf(repo, one, api, gh)).map(async (job) => ({ ...job, log: redJob(job) ? await jobLog(repo, job.id, api, gh) : "" })));
    runs.push({ id, attempt: one.run_attempt, repo: home, jobs });
  }
  return { checks, tests: readFailures(runs, new Set()).tests };
}

export async function lookOnGitHub(pr, { repo, since, now = Date.now, graceMs = 10 * 60_000, home = HOME, seen = new Set(), gh = ghRun }) {
  const [owner, name] = home.split("/"), api = `repos/${home}`;
  const { stdout } = await gh(["api", "graphql", "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `pr=${pr}`, "-f", `query=${QUERY}`],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  const found = JSON.parse(stdout).data.repository.pullRequest;
  const queueReds = [];
  for (const red of queueRemovals(found, seen)) {
    queueReds.push({ ...red, ...await queueFailures(repo, red.commit, home, gh).catch(() => ({ checks: [], tests: [] })) });
  }
  const pull = { ...readPull(found, { since, now: now(), graceMs, home }), ...(queueReds.length ? { queueReds } : {}) };
  if (pull.security) return readScan(pull, pr, { json: (path) => ghJson(repo, path, gh), jobs: (one) => jobsOf(repo, one, api, gh), api, home });
  if (pull.state !== "red" || pull.conflict || !pull.runs) return pull;
  const runs = [];
  for (const id of pull.runs) {
    const one = await ghJson(repo, `${api}/actions/runs/${id}`, gh);
    const jobs = await jobsOf(repo, one, api, gh);
    runs.push({ id, attempt: one.run_attempt, status: one.status, repo: one.repository?.full_name ?? home, jobs,
      log: one.run_attempt < RUNNER_ATTEMPTS ? await failedLog(repo, one, jobs, home, gh) : "" });
  }
  let failures;
  try {
    const reach = reachOf(await filesOf(repo, pr, pull.head, api, gh));
    for (const one of runs) one.jobs = await Promise.all(one.jobs.map(async (job) => ({ ...job, log: redJob(job) ? await jobLog(repo, job.id, api, gh) : "" })));
    failures = readFailures(runs, reach);
  } catch {}
  return { ...pull, runner: runnerReruns(runs), ...(failures ? { failures } : {}) };
}

const redJob = (job) => job.steps > 0 && (job.conclusion === "failure" || job.conclusion === "timed_out") && !FOLLOWERS.has(job.name);

export function reachOf(files) {
  return new Set(files.map((file) => /^((?:packages|apps)\/[^/]+)\//.exec(file)?.[1]).filter(Boolean));
}

export function readFailures(runs, reach) {
  const units = new Set(), tests = new Set(), where = {};
  let outside = true;
  for (const job of runs.flatMap((one) => one.jobs).filter(redJob)) {
    const failed = new Set(), unplaced = new Set();
    let heading;
    for (const line of (job.log ?? "").split("\n")) {
      heading = /\s=== ((?:packages|apps)\/[^/\s]+) ===\s*$/.exec(line)?.[1] ?? heading;
      const unit = /\sFAIL {4}(\S+)/.exec(line)?.[1];
      if (unit) {
        failed.add(unit);
        units.add(unit);
        if (!/^(?:packages|apps)\/[^/]+$/.test(unit) || reach.has(unit)) outside = false;
      }
      const test = failedTest(line);
      if (test) {
        tests.add(test);
        if (heading) where[test] ??= heading;
        else unplaced.add(test);
      }
    }
    if (!failed.size) outside = false;
    if (failed.size === 1) for (const test of unplaced) where[test] ??= [...failed][0];
  }
  if (!units.size) outside = false;
  return { outside, units: [...units], tests: [...tests], where, runs: runs.map(({ id, attempt, repo }) => ({ id, attempt, repo })),
    key: runs.map((one) => `${one.id}:${one.attempt}`).join(",") };
}

function failedTest(line) {
  const mark = line.indexOf("✖ ");
  if (mark < 0) return undefined;
  const rest = line.slice(mark + 2).trimEnd();
  const open = rest.lastIndexOf(" (");
  if (open < 1 || !rest.endsWith("ms)") || !/^\d+(?:\.\d+)?$/.test(rest.slice(open + 2, -3))) return undefined;
  return rest.slice(0, open);
}

const filesSeen = new Map();
async function filesOf(repo, pr, head, api = REPO, gh = ghRun) {
  const key = `${api}:${pr}:${head}`;
  if (!filesSeen.has(key)) {
    const { stdout } = await gh(["api", "--paginate", `${api}/pulls/${pr}/files?per_page=100`, "--jq", ".[].filename"], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
    filesSeen.set(key, stdout.split("\n").filter(Boolean));
  }
  return filesSeen.get(key);
}
const jobLogs = new Map();
const GONE = /\bHTTP 4(?:04|10)\b/;
const goneAsEmpty = (error) => {
  if (GONE.test(`${error?.stderr ?? ""} ${error?.message ?? error}`)) return { stdout: "" };
  throw error;
};
async function jobLog(repo, id, api = REPO, gh = ghRun) {
  if (!jobLogs.has(id)) jobLogs.set(id, (await gh(["api", `${api}/actions/jobs/${id}/logs`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).catch(goneAsEmpty)).stdout);
  return jobLogs.get(id);
}

const REPO = "repos/storytree-ai/storytree";
const ghRun = (args, options) => run("gh", args, options);
const ghJson = async (repo, path, gh = ghRun) => JSON.parse((await gh(["api", path], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout);
export const jobFields = (job) => ({ id: job.id, name: job.name, conclusion: job.conclusion, steps: job.steps?.length ?? 0, runner: job.runner_name ?? "",
  failed: job.steps?.find((step) => step.conclusion === "failure")?.name });
const jobsSeen = new Map();
async function jobsOf(repo, run, api = REPO, gh = ghRun) {
  const key = `${run.id}:${run.run_attempt}`;
  if (jobsSeen.has(key)) return jobsSeen.get(key);
  const jobs = (await ghJson(repo, `${api}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, gh)).jobs.map(jobFields);
  if (run.status === "completed") jobsSeen.set(key, jobs);
  return jobs;
}
const logsSeen = new Map();
async function failedLog(repo, one, jobs, home = HOME, gh = ghRun) {
  const key = `${one.id}:${one.run_attempt}`;
  if (logsSeen.has(key)) return logsSeen.get(key);
  if (one.status !== "completed" || !jobs.some((job) => job.steps > 0 && job.conclusion === "failure")) return "";
  const log = (await gh(["run", "view", String(one.id), "--log-failed", "-R", home], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).catch(() => ({ stdout: "" }))).stdout;
  logsSeen.set(key, log);
  return log;
}
export const asRun = (run, jobs) => ({ id: run.id, sha: run.head_sha, created: run.created_at, updated: run.updated_at, status: run.status,
  conclusion: run.conclusion, attempt: run.run_attempt, url: run.html_url, repo: run.repository?.full_name ?? REPO.replace(/^repos\//, ""), job: jobs && failedJob(jobs),
  ...(jobs && securityJobs(jobs).length ? { security: securityJobs(jobs) } : {}) });

export async function releasesOnGitHub({ repo, now = Date.now }) {
  const latest = await ghJson(repo, `${REPO}/releases/latest`);
  const release = { tag: latest.tag_name, sha: latest.target_commitish, at: latest.published_at };
  const attempts = [];
  for (const run of (await ghJson(repo, `${REPO}/actions/workflows/release.yml/runs?per_page=30`)).workflow_runs) {
    if (Date.parse(run.created_at) <= Date.parse(release.at) && run.head_sha !== release.sha) break;
    const jobs = await jobsOf(repo, run);
    if (attempted(jobs)) attempts.push(asRun(run, jobs));
  }
  const main = (await ghJson(repo, `${REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=30`)).workflow_runs;
  const head = main[0] && main[0].status === "completed" && main[0].conclusion !== "success" ? await jobsOf(repo, main[0]) : undefined;
  const fault = head && main[0].run_attempt < RUNNER_ATTEMPTS ? runnerFault(head, await failedLog(repo, main[0], head)) : null;
  return { release, ...judgeReleases({ release, attempts, main: main.map((run, i) => i === 0 ? { ...asRun(run, head), fault } : asRun(run)), now: now() }) };
}

const recordPath = (dir, pr) => join(dir, `${pr}.json`);
const versionPath = (dir) => join(dir, "watch-loop.version");
const save = (dir, record) => writeWhole(recordPath(dir, record.pr), `${JSON.stringify(record, null, 2)}\n`);

async function records(dir) {
  const names = await readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const found = [];
  for (const name of names.filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b))) {
    try { found.push(JSON.parse(await readFile(join(dir, name), "utf8"))); } catch {}
  }
  return found;
}

export async function forget({ dir, now = Date.now }) {
  const names = (await readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; }))
    .filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b));
  if (!names.length) return { prs: [] };
  const to = join(dir, `before-${new Date(now()).toISOString().replace(/[-:]|\.\d{3}/g, "")}`);
  await mkdir(to, { recursive: true });
  for (const name of names) await rename(join(dir, name), join(to, name));
  return { prs: names.map((name) => parseInt(name)), to };
}

export async function handedOff(dir) {
  return (await records(dir)).map((record) => ({ increment: record.increment,
    note: `PR #${record.pr} is with the pool's watcher${record.fixing ? ", and a fix session works it" : ""}` }));
}

export async function hand({ dir, pr, increment, session, branch, keepOpen = false, refused = false, holder, project, storytree: everywhere, startWatcher, now = Date.now }) {
  await mkdir(dir, { recursive: true });
  const storytree = (args) => everywhere(args, libraryOf({ project }));
  const old = (await records(dir)).find((record) => record.pr === pr);
  let closed = false;
  await storytree(["arc", "increment", "wait", increment, "--for", "event", "--note",
    `PR #${pr} is open and green and handed to the pool's watcher, which ${keepOpen ? "leaves this open (more pull requests are to come) on its merge" : "closes this on its merge"} or starts a fix session on a red.`,
    "--check-back", new Date(now() + HELD_MS).toISOString().slice(0, 10)])
    .catch((error) => { if (/ is closed, and waits for nothing/.test(error.message)) closed = true; else throw error; });
  const last = old?.fixes?.at(-1);
  if (refused && last) Object.assign(last, { refused: true, refusedAt: new Date(now()).toISOString() }, holder ? { holder } : {});
  const held = !session ? "no session id, so no claims are held for it"
    : !branch ? "its branch could not be read, so no claims are held for it"
    : (await storytree(["workspace", "hold", String(pr), "--holder", session, "--branch", branch, "--increment", increment])
      .catch((error) => `its claims could not be held (${error.message.split("\n")[0]}), so its close-out releases them`)).trim();
  await save(dir, { fixes: [], fixing: null, ...old, pr, increment, session, keepOpen, closed, ...(project ? { project } : {}), handedAt: new Date(now()).toISOString() });
  await startWatcher();
  return { closed, held };
}

export async function handOver({ pr, increment, session, keepOpen = false, repo, onBox, local, remote, library }) {
  const fallback = `Wait for the merge yourself: watch \`gh pr checks ${pr}\` for MERGED, then close ${increment} with --disposition landed --pr ${pr}.`;
  if (!session) return { code: 1, lines: ["no session id (CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID): the watcher could not release this session's claims, so it is not handed over.", fallback] };
  const args = ["hand", String(pr), increment, "--session", session, ...(keepOpen ? ["--keep-open"] : []), ...(repo ? ["--repo", repo] : [])];
  if (onBox) return { code: await local(args) ?? 0, lines: [] };
  const last = (error) => error.message.trim().split("\n").at(-1);
  let unreached;
  try {
    return { code: 0, lines: [(await remote(args)).trim()].filter(Boolean) };
  } catch (error) {
    const refusal = `${error.stdout ?? ""}\n${error.message}`.split("\n").find((line) => line.startsWith("not handed over: "));
    if (refusal) return { code: 1, lines: [refusal] };
    unreached = `could not reach the pool's watcher over ssh: ${last(error)}`;
  }
  if (!library) return { code: 1, lines: [unreached, fallback] };
  try {
    return { code: 0, lines: [`${unreached}; handed over through the library instead.`, ...await library({ pr, increment, session, keepOpen })] };
  } catch (error) {
    return { code: 1, lines: [unreached, `could not hand it over through the library either: ${last(error)}`, fallback] };
  }
}

const requestNote = ({ pr, session, keepOpen }) => `PR #${pr} is open and green and handed to the pool's watcher through the library by session ${session}${keepOpen ? ", to keep this open" : ""},`
  + ` which ${keepOpen ? "leaves this open (more pull requests are to come) on its merge" : "closes this on its merge"} or starts a fix session on a red.`;
const REQUEST = /^\s*- event\s+PR #(\d+) is open and green and handed to the [^,]*?watcher through the library by session ([^\s,]+)(, to keep this open)?, .* — (increment_\w+)\s/;

export async function handThroughLibrary({ pr, increment, session, branch, keepOpen = false, storytree, now = Date.now }) {
  await storytree(["arc", "increment", "wait", increment, "--for", "event", "--note", requestNote({ pr, session, keepOpen }),
    "--check-back", new Date(now() + HELD_MS).toISOString().slice(0, 10)]);
  const held = !branch ? "its branch could not be read, so no claims are held for it, and its close-out releases them"
    : (await storytree(["workspace", "hold", String(pr), "--holder", session, "--branch", branch, "--increment", increment])
      .catch((error) => `its claims could not be held (${error.message.split("\n")[0]}), so its close-out releases them`)).trim();
  return [`PR #${pr}: ${increment} waits on it until it merges${keepOpen ? ", then stays open for its next pull request" : ""}; the box's watcher takes it at its next look.`,
    ...(held ? [held] : []),
    `Close out with: pnpm storytree session close-out --safe yes --why "PR #${pr} open and green, handed to the watcher"`];
}

export async function adoptRequests({ dir, storytree, viewOf, now = Date.now, say = () => {} }) {
  const known = new Map((await records(dir)).map((record) => [record.pr, record]));
  for (const line of (await storytree(["arc", "waits"])).split("\n")) {
    const found = REQUEST.exec(line);
    if (!found) continue;
    const [, pr, session, keepOpen, increment] = found;
    if (known.has(Number(pr))) {
      const old = known.get(Number(pr));
      if (!old || (old.session === session && Boolean(old.keepOpen) === Boolean(keepOpen))) continue;
      await save(dir, { ...old, session, keepOpen: Boolean(keepOpen), handedAt: new Date(now()).toISOString() });
      known.set(Number(pr), { ...old, session, keepOpen: Boolean(keepOpen) });
      say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} PR #${pr}: handed over again through the library by session ${session}${keepOpen ? `, to keep ${increment} open` : ""}`);
      continue;
    }
    const view = await viewOf(Number(pr)).catch(() => undefined);
    if (view === undefined) continue;
    try { ownBranch(pr, view); } catch (error) {
      await storytree(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} is not watched (${error.message.replace(/^not handed over: /, "").split(";")[0]})`]).catch(() => "");
      await storytree(["workspace", "let-go", pr, "--reason", `PR #${pr} is not watched (${error.message.replace(/^not handed over: /, "").split(";")[0]}); released by the watcher`]).catch(() => "");
      known.set(Number(pr), null);
      say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} PR #${pr}: ${error.message}; ${increment} no longer waits on it`);
      continue;
    }
    await save(dir, { fixes: [], fixing: null, pr: Number(pr), increment, session, keepOpen: Boolean(keepOpen), closed: false, handedAt: new Date(now()).toISOString() });
    known.set(Number(pr), null);
    say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} PR #${pr}: handed over through the library by session ${session}; watching it for ${increment}`);
  }
}

function lagLine(lag) {
  if (!(lag?.count > 0)) return "";
  const newest = lag.subjects.slice(-10).reverse();
  const rest = lag.count - newest.length;
  return `\nIts branch is ${lag.count} commit${lag.count === 1 ? "" : "s"} behind main, lacking (newest first): ${newest.map((one) => `"${one}"`).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

function commandsOf(project) {
  if (!project) return { follow: "its AGENTS.md as the session-orchestrator", storytree: "pnpm storytree", watch: "node packages/agent-pool/src/watch.mjs",
    stale: "merge\n  origin/main, run `pnpm install`, and `pnpm gate`", gate: "`pnpm gate`", tests: "`pnpm gate` and `pnpm test`",
    until: "the PASS / FAIL / NOT RUN table prints" };
  const checks = project.checks?.length ? project.checks.map((check) => `\`${check}\``).join(", ") : "the checks its CI runs, as its CI runs them";
  return { follow: "its own AGENTS.md or CLAUDE.md where it has one", storytree: "storytree", watch: "node {pool}/packages/agent-pool/src/watch.mjs",
    stale: `merge\n  origin/main and run ${project.name}'s checks, in order: ${checks}`, gate: `${project.name}'s checks`, tests: `${project.name}'s checks`, until: "each one ends" };
}

function securitySteps({ pr, increment, checks, closed, project, use }) {
  const scans = checks.filter((check) => check !== "secret-check");
  return `- This red is a security check (${checks.join(", ")}). A fix session's commits and pull request are public, so no alert text,
  flagged line or matched value goes into any commit message, pull request text or comment, or anything else that leaves the box:
  say only that a security check's finding was fixed. Suspect a stale branch first: ${use.stale}.${scans.length ? `
- Code scanning (${scans.join(", ")}): read its open alerts signed in,
  \`gh api "repos/${project?.repo ?? HOME}/code-scanning/alerts?ref=refs/pull/${pr}/merge&state=open"\`, and fix the code each one flags
  so the pattern is gone; never dismiss an alert. See ${use.gate} green and push.` : ""}${checks.includes("secret-check") ? `
- Secret check: run \`pnpm check:secrets\` in the worktree, which names only the file and the kind of each hit, and judge each by them.
  A plain test fixture or made-up sample: reshape it so it no longer matches (build it from parts, or give it another shape),
  never by editing .github/secret-check-exemptions.txt; see ${use.gate} green and push.
  One that may be a real credential: change nothing and push nothing. Raise one question on ${increment}'s arc${closed ? "" : ` holding ${increment}`},
  naming only PR #${pr} and the check secret-check, so the owner rotates the key; record it with
  \`${use.watch} verdict ${pr} owner --summary "a secret-check hit may be a real credential" --question <question>\`, close out and end.` : ""}
- Once you have fixed it, before handing back, leave the owner a retro: file a friction report (\`${use.storytree} friction new --increment ${increment}\`)
  on the mistake behind it; park the local check for the pattern (one that fails before a push, a rule in ESLint's local plugin)
  as an increment on the linter arc arc_7605fd815da9 (\`${use.storytree} arc increment new --arc arc_7605fd815da9 ...\`), adding
  \`--waits-on increment_131b79872a3f --wait-reason "the local plugin lands there"\` if that increment has not landed; and leave
  him an FYI (\`${use.storytree} fyi new --increment ${increment} --about "PR #${pr}" --title ... --what ...\`): what the alert was,
  what leaked (or that nothing did), the mistake behind it, and the increment you parked. Raise no question for it.
  The library is private, so these may name the alert.`;
}

function fixBrief({ pr, increment, why, logs, n, limit, keepOpen, closed, review, lag, project, security }) {
  const handBack = `${pr} ${increment}${keepOpen ? " --keep-open" : ""}`;
  const use = commandsOf(project);
  return `# Fix session ${review ? `${n}, after an independent review` : `${n} of ${limit}`}: pull request #${pr} (${increment}) is red

The pool's watcher started you: a session opened PR #${pr} for ${increment}, saw its gate green and handed it over,
and it has since gone red: ${why}.${logs.length ? `\nThe failing runs: ${logs.join(", ")}.` : ""}${lagLine(lag)}${review
    ? `\nAfter ${limit} fix sessions an independent review session read it and judged it a bug in the pull request that a session can fix: ${review}`
    : ""}

Your job is that pull request and nothing else. Work from {checkout} and follow ${use.follow}.
- Find the PR's branch (\`gh pr view ${pr} --json headRefName\`) and a worktree on it (\`git worktree list\`), or add one for it
  under .claude/worktrees, and ${closed
    ? `work there without claiming the increment: ${increment} already closed on an earlier pull request, so claim only the capabilities you edit.`
    : `claim the increment there: \`${use.storytree} workspace attach ${increment} --folder <worktree> --reason "fix PR #${pr}"\`.`}
  The claims are held for PR #${pr} until it merges; working on its branch, you take them over (ADR-1037 D2).
${security ? securitySteps({ pr, increment, checks: security, closed, project, use })
    : `- Read the failing log (\`gh run view <run> --log-failed\`, or \`gh pr checks ${pr}\`). Suspect a stale branch first: ${use.stale}. Then fix what is really broken, see ${use.gate} green and push.`}
  Never force-push, squash or \`gh pr merge\`. Before every push, read \`gh pr view ${pr} --json state\`: once it is not OPEN
  (merged through the queue, or closed), push nothing, close out and end, since a push would re-create its deleted branch.
- You exit when you end a turn: a session that ends its turn to wait exits at once, and its uncommitted work is stranded.
  So run ${use.tests} in the foreground and stay in the turn until ${use.until},
  however long the run queues behind another lane's; this overrides the general guidance to run them in the background.
  A run already in the background is polled inside the same turn, never waited for by ending the turn.
- Hand it back: \`${use.watch} hand ${handBack}\`, then
  \`${use.storytree} session close-out --safe yes --why "PR #${pr} fixed and handed back to the watcher"\`, and end.
- If a claim you need is refused (another session holds the increment or a capability), leave the branch alone: hand it back
  with \`${use.watch} hand ${handBack} --refused --holder <session>\`, where <session> is the
  session id the refusal names ("held by … session <id>"), close out and end. A refused session does not count against
  the limit, and the watcher starts the next one once that session holds no claim.
- If it needs the owner (a decision, a sign-in, a spend), raise the question on the increment's arc${closed ? "" : " holding the increment"}, then close out and end.
`;
}

export const VERDICTS = ["flake", "elsewhere", "fix", "owner"];

function reviewBrief({ pr, increment, why, logs, fixLogs, n, cap, closed, project }) {
  const use = commandsOf(project);
  const verdict = `${use.watch} verdict ${pr}`;
  return `# Review session (session ${n} of at most ${cap}): pull request #${pr} (${increment}) is still red after its fix sessions

The pool's watcher started you. PR #${pr} for ${increment} has gone red again after its fix sessions: ${why}.
${logs.length ? `The failing runs: ${logs.join(", ")}.\n` : ""}The fix sessions' logs: ${fixLogs.join(", ") || "none"}.

You are an independent reviewer, not a fixer: you did not write this pull request or its fixes, and you do not change its
branch. Work from {checkout}. Read the failing runs (\`gh run view <run> --log-failed\`, \`gh pr checks ${pr}\`),
the fix sessions' logs and the pull request's diff (\`gh pr diff ${pr}\`), and decide exactly ONE verdict:
- flake: the failure is random, and another try may pass. \`${verdict} flake --summary "<why>"\`
- elsewhere: a slow or flaky test the pull request does not own fails it. Park that test's one investigation, or add this
  flake to the open one (ADR-1352), never loosening the test inside this pull request:
  \`${use.storytree} health investigate --test "<title>" --unit <packages/x> --seen "PR #${pr} at <head>" --evidence "<what failed, with the run>" --found "<how this review found it>" --increment ${increment}\`,
  then \`${verdict} elsewhere --summary "<why>" --parked <the investigation it names>\`
- fix: a bug in the pull request that a session can fix. \`${verdict} fix --summary "<what is broken and where>"\`; your
  summary is the next fix session's brief.
- owner: only the owner can unblock it (a decision, access, a spend). Raise the question on ${increment}'s arc${closed ? "" : `, holding it
  (\`${use.storytree} question new --arc <arc> … --hold ${increment}\`)`}, written so he can answer it cold, then
  \`${verdict} owner --summary "<why>" --question <question>\`
The watcher acts on the verdict you record; record it once, then \`${use.storytree} session close-out --safe yes --why "verdict on PR #${pr} recorded"\` and end.
`;
}

export async function recordVerdict({ dir, pr, kind, summary, parked, question }) {
  if (!VERDICTS.includes(kind)) throw new Error(`a verdict is one of ${VERDICTS.join(", ")}`);
  if (kind === "owner" && !question) throw new Error("an owner verdict names the question it raised (--question <id>)");
  const record = JSON.parse(await readFile(recordPath(dir, pr), "utf8").catch(() => "null"));
  const last = record?.fixes.at(-1);
  if (!(last?.review || (last?.security && kind === "owner")) || last.verdict) throw new Error(`PR #${pr} has no review session waiting for its verdict`);
  last.verdict = { kind, summary: summary ?? "", ...(parked ? { parked } : {}), ...(question ? { question } : {}) };
  await save(dir, record);
}

function repeats(fixes, failures) {
  if (failures.tests.length) return failures.tests.some((test) => fixes.some((fix) => fix.tests?.includes(test)));
  return failures.units.some((unit) => fixes.some((fix) => !fix.tests?.length && fix.units?.includes(unit)));
}
const named = (failures) => (failures.tests.length ? failures.tests : failures.units).join("; ");

export async function watchOnce({ dir, look, stateOf, storytree, cutover = async () => undefined, startFix, startReview, startedAs = async () => undefined, rerun, refresh, behind, enqueue, reached, alive, room, limit, cap = 6, backoff = 15 * 60_000, folders = {}, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const tell = (args, project) => storytree(args, project).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${error.message.split("\n")[0]}`); return ""; });
  const letGo = (record, reason, merged = false) => tell(["workspace", "let-go", String(record.pr), "--reason", reason, ...(merged ? ["--merged"] : [])], libraryOf(record));
  const ended = async (record, pull) => {
    for (const red of record.queueReds ?? []) {
      const base = red.parents?.[0];
      const onMain = pull && reached && base ? await reached(base, repoOf(record)).catch(() => undefined) : undefined;
      await tell(["workspace", "queue-red", String(record.pr), "--increment", record.increment, "--removed-at", red.at, "--commit", red.commit,
        ...(red.checks ?? []).flatMap((check) => ["--check", check]), ...(red.tests ?? []).flatMap((one) => ["--test", one]),
        "--outcome", queueOutcome(red, { merged: pull?.state === "merged", head: pull?.head, reached: onMain })], record.project);
    }
    await rm(recordPath(dir, record.pr), { force: true });
  };
  const backOnArc = async (record, pull, why) => {
    const { pr, increment } = record, at = libraryOf(record);
    if (!record.closed) {
      const body = (await tell(["library", "read", increment, "--field", "body"], at)).trimEnd();
      const residue = join(dir, `${pr}-residue.md`);
      await writeFile(residue, `${body ? `${body}\n\n` : ""}**Back from the watcher, ${new Date(now()).toISOString().slice(0, 10)}.** PR #${pr}`
        + ` (branch \`${pull.branch ?? "unknown"}\`) ${why}${record.fixes.length ? ` (fix sessions' logs: ${record.fixes.map((fix) => fix.log).join(", ")})` : ""}.`
        + ` Take that branch, merge origin/main, resolve what is in the way,`
        + ` see \`pnpm gate\` green, push, and hand PR #${pr} to the watcher again.\n`);
      await tell(["arc", "increment", "edit", increment, "--body", `@${residue}`], at);
      await rm(residue, { force: true });
      await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} went back on its arc: it ${why}`], at);
    }
    await letGo(record, `PR #${pr} ${why}; released by the watcher`);
    await ended(record, pull);
  };
  const retry = async (record, pull) => {
    const { pr } = record, failures = pull.failures;
    let by;
    try {
      if (!refresh) throw new Error("no refresh");
      await refresh(pr, pull.head, repoOf(record));
      by = "main merged into its branch";
    } catch {
      try {
        if (!rerun || !failures) throw new Error("no rerun");
        for (const one of failures.runs) {
          await rerun(one);
          await tell(["workspace", "rerun", String(one.id), "--repo", one.repo, "--attempt", String(one.attempt + 1), "--what", "pr"], record.project);
        }
        by = "its failed runs rerun";
      } catch (error) {
        dated(`PR #${pr} red, to be retried, but neither a merge of main nor a rerun was taken (${error.message.split("\n")[0]}); looking again next time`);
        return false;
      }
    }
    record.fixes.push({ at: new Date(now()).toISOString(), head: pull.head, flake: true, by, units: failures?.units ?? [], tests: failures?.tests ?? [], where: failures?.where ?? {}, runs: failures?.key });
    await save(dir, record);
    return true;
  };
  const all = await records(dir);
  for (const record of all) {
    if (!record.starting) continue;
    const { kind, n, entry } = record.starting;
    const found = await startedAs({ name: `${kind}-${record.pr}-${n}`, since: entry.at });
    if (found) {
      record.fixing = found.pid ? { pid: found.pid } : null;
      record.fixes.push({ ...entry, ...(found.pid ? { pid: found.pid } : {}), log: found.log });
    }
    delete record.starting;
    await save(dir, record);
    dated(`PR #${record.pr}: ${kind} session ${n} ${found ? `had started before the watcher stopped, and is counted${found.pid ? " and watched" : ""}` : "never started before the watcher stopped"}`);
  }
  const running = new Map();
  for (const record of all) if (record.fixing && await alive(record.fixing.pid)) running.set(record.pr, { conflict: record.fixes.at(-1)?.conflict ?? false, review: record.fixes.at(-1)?.review ?? false });
  const fixing = () => [...running.values()].some((one) => !one.review);
  const boards = new Map();
  const holds = async (session, at) => {
    if (!boards.has(at?.folder)) boards.set(at?.folder, await tell(["noticeboard"], at));
    return boards.get(at?.folder).split("\n").some((line) => /^\s*- (?:increment|capability) /.test(line) && line.includes(` ${session} `));
  };
  const cutovers = new Map();
  const cutoverOf = async (project) => {
    if (!cutovers.has(project?.folder)) cutovers.set(project?.folder, Date.parse(await cutover(project).catch(() => undefined) ?? ""));
    return cutovers.get(project?.folder);
  };
  for (const record of all) {
    const { pr, increment } = record, at = libraryOf(record);
    if (Date.parse(record.handedAt) < await cutoverOf(record.project)) {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} was handed over before the repository cut-over`], record.project);
      await letGo(record, `PR #${pr} was handed over before the repository cut-over; released by the watcher`);
      await ended(record);
      dated(`PR #${pr}: handed over before the repository cut-over, so its number is the old repository's: no longer watched, and ${increment} no longer waits on it`);
      continue;
    }
    let pull;
    try { pull = await look(pr, record); }
    catch (error) {
      const why = error.message.split("\n")[0];
      dated(`PR #${pr}: could not read it (${why}); looking again next time`);
      record.unreadable = { since: record.unreadable?.since ?? new Date(now()).toISOString(), why, ...(record.unreadable?.waited ? { waited: true } : {}) };
      if (!record.closed && !record.unreadable.waited && now() - Date.parse(record.unreadable.since) >= UNREADABLE_MS) {
        await tell(["arc", "increment", "wait", increment, "--for", "owner",
          "--note", `The watcher could not read PR #${pr} on ${repoOf(record)} for an hour (${why}). Give the box's gh read access to ${repoOf(record)}, or close ${increment} by hand if its pull request merged.`,
          "--why", `until the watcher can read PR #${pr}, ${increment} stays held from the pool`], at);
        record.unreadable.waited = true;
        dated(`PR #${pr}: unreadable for an hour: ${increment} waits on the owner`);
      }
      await save(dir, record);
      continue;
    }
    if (record.unreadable) {
      if (record.unreadable.waited) {
        await tell(["arc", "increment", "unwait", increment, "--for", "owner", "--reason", `the watcher reads PR #${pr} on ${repoOf(record)} again`], at);
        dated(`PR #${pr}: readable again: ${increment} no longer waits on the owner`);
      }
      delete record.unreadable;
      await save(dir, record);
    }
    const fresh = (pull.queueReds ?? []).filter((red) => !(record.queueReds ?? []).some((kept) => kept.at === red.at));
    if (fresh.length) {
      record.queueReds = [...(record.queueReds ?? []), ...fresh];
      await save(dir, record);
    }
    if (pull.state === "foreign") {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr}'s head is not on ${repoOf(record)}`], at);
      await letGo(record, `PR #${pr}'s head is not on ${repoOf(record)}; released by the watcher`);
      await ended(record, pull);
      dated(`PR #${pr}: its head is not on ${repoOf(record)}, or GitHub did not say where it is: no longer watched, and ${increment} no longer waits on it`);
      continue;
    }
    if (pull.state === "merged" || pull.state === "closed") {
      const marked = pull.state === "merged" && record.keepOpen ? ["--merged", String(pr)]
        : ["--reason", pull.state === "merged" ? `PR #${pr} merged` : `PR #${pr} closed without merging`];
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event", ...marked], at);
      if (pull.state === "merged") {
        if (!record.keepOpen && !record.closed) await tell(["arc", "increment", "close", increment, "--disposition", "landed", "--pr", String(pr)], at);
        await letGo(record, `PR #${pr} merged; released by the watcher`, true);
        dated(record.closed ? `PR #${pr} merged: ${increment} had already closed`
          : record.keepOpen ? `PR #${pr} merged: ${increment} stays open for its next pull request` : `PR #${pr} merged: closed ${increment}`);
      } else {
        await letGo(record, `PR #${pr} closed without merging; released by the watcher`);
        dated(`PR #${pr} closed without merging: ${increment} no longer waits on it`);
      }
      await ended(record, pull);
      continue;
    }
    if (running.has(pr)) continue;
    if (record.fixing) { record.fixing = null; await save(dir, record); }
    if (now() - Date.parse(record.handedAt) > HELD_MS) {
      await backOnArc(record, pull, `has been open for ${HELD_DAYS} days since it was handed over`);
      dated(`PR #${pr} open past ${HELD_DAYS} days: its claims are released and ${increment} is back on its arc as ready work`);
      continue;
    }
    if (pull.stranded && enqueue && record.enqueued?.head !== pull.head) {
      try {
        await enqueue(pull.stranded, pull.head);
        record.enqueued = { head: pull.head };
        dated(`PR #${pr} green and unheld but outside the merge queue: enqueued at ${pull.head}`);
      } catch (error) {
        const tries = record.enqueueRefused?.head === pull.head ? record.enqueueRefused.tries + 1 : 1;
        record.enqueueRefused = { head: pull.head, tries };
        if (tries >= ENQUEUE_TRIES) record.enqueued = { head: pull.head, refused: true };
        dated(`PR #${pr} green and unheld but outside the merge queue: the enqueue was refused (${error.message.split("\n")[0]})`
          + (tries >= ENQUEUE_TRIES ? `, ${tries} times on this head: left as it is` : "; trying again next time"));
      }
      await save(dir, record);
      continue;
    }
    if (pull.state !== "red") continue;
    if (pull.runner && rerun) {
      const key = pull.runner.runs.map((one) => `${one.id}:${one.attempt}`).join(",");
      if (record.rerunRefused !== key) {
        try {
          for (const one of pull.runner.runs) {
            await rerun(one);
            await tell(["workspace", "rerun", String(one.id), "--repo", one.repo, "--attempt", String(one.attempt + 1), "--what", "pr"], record.project);
          }
          dated(`PR #${pr} red on the runner only (${pull.runner.why}): rerun, with no fix session`);
        } catch (error) {
          record.rerunRefused = key;
          await save(dir, record);
          dated(`PR #${pr} red on the runner only (${pull.runner.why}): the rerun was refused (${error.message.split("\n")[0]}); looking again next time`);
        }
        continue;
      }
    }
    const last = record.fixes.at(-1);
    const failures = pull.failures;
    if (last?.flake && (failures ? last.runs === failures.key : last.head === pull.head)) continue;
    const flake = failures?.outside && !repeats(record.fixes, failures);
    if (flake && record.fixes.length < cap && (refresh || rerun)) {
      if (await retry(record, pull)) dated(`PR #${pr} red only on tests outside what it changes (${named(failures)}): ${record.fixes.at(-1).by}, not counted against its fix limit`);
      continue;
    }
    const allowed = pull.conflict ? limit + 1 : limit;
    if (pull.conflict && last && !last.refused && !last.moved && last.head && last.head !== pull.head) {
      last.moved = true;
      await save(dir, record);
    }
    const counted = record.fixes.filter((fix) => !fix.refused && !fix.moved && !fix.flake && !fix.review).length;
    const spent = counted >= allowed || record.fixes.length >= cap;
    if (spent && record.closed) {
      await letGo(record, `PR #${pr} still red after ${record.fixes.length} sessions; released by the watcher`);
      await ended(record, pull);
      dated(`PR #${pr} still red after ${record.fixes.length} sessions, and ${increment} had already closed, so nothing can wait on the owner: ${pull.why}`);
      continue;
    }
    if (spent && pull.conflict) {
      await backOnArc(record, pull, `still conflicts with main after ${record.fixes.length} fix sessions`);
      dated(`PR #${pr} still conflicts with main after ${record.fixes.length} fix sessions: ${increment} is back on its arc as ready work`);
      continue;
    }
    if (record.fixes.length >= cap) {
      const review = record.fixes.findLast((fix) => fix.review && fix.verdict)?.verdict;
      const flakes = new Map();
      for (const fix of record.fixes.filter((one) => one.flake)) {
        for (const test of fix.tests?.length ? fix.tests : fix.units ?? []) {
          const unit = fix.tests?.length ? fix.where?.[test] ?? (fix.units?.length === 1 ? fix.units[0] : undefined) : test;
          const seen = flakes.get(test) ?? { unit, heads: [] };
          seen.unit ??= unit;
          seen.heads.push(fix.head);
          flakes.set(test, seen);
        }
      }
      const flaky = [];
      for (const [test, { unit, heads }] of flakes) {
        const said = await tell(["health", "investigate", "--test", test, ...(unit ? ["--unit", unit] : []), "--seen", `PR #${pr} at ${heads.at(-1)}`,
          "--evidence", `PR #${pr} at ${heads.at(-1)} (${increment}): the watcher retried it ${heads.length} ${heads.length === 1 ? "time" : "times"} for a red only on tests outside what it changes, failing on this one${unit && unit !== test ? ` in ${unit}` : ""}, and gave it to the owner at its cap of ${cap} sessions.`,
          "--found", `The Mint box's watcher retried pull request #${pr} for it, a red only on tests outside what the pull request changes`,
          "--by", "the Mint box's watcher", "--increment", increment], at);
        const investigation = /investigated by (increment_[0-9a-f]{12})/.exec(said)?.[1];
        flaky.push(investigation ? `${test} (investigated by ${investigation})` : test);
      }
      await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} is still red after ${record.fixes.length} sessions: it goes to the owner`], at);
      await letGo(record, `PR #${pr} still red after ${record.fixes.length} sessions; released by the watcher`);
      await storytree(["arc", "increment", "wait", increment, "--for", "owner", "--note",
        `PR #${pr} is still red after ${record.fixes.length} sessions, the most the watcher starts for one pull request (${counted} fix sessions counted): ${pull.why}.`
        + `${pull.logs.length ? ` Failing runs: ${pull.logs.join(", ")}.` : ""}`
        + ` Sessions' logs: ${record.fixes.filter((fix) => fix.log).map((fix) => fix.log).join(", ") || "none"}.`
        + (review ? ` The last review judged it "${review.kind}": ${review.summary}` : " No review ran.")
        + `${flaky.length ? ` Flaky outside it: ${flaky.join("; ")}.` : ""} Retry it (hand PR #${pr} to the watcher again), fix it yourself, or withdraw it.`], at);
      await ended(record, pull);
      dated(`PR #${pr} still red after ${record.fixes.length} sessions: ${increment} waits on the owner`);
      continue;
    }
    const verdict = (spent && last?.review) || last?.security ? last.verdict : undefined;
    if (verdict?.kind === "owner") {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} waits on the owner's answer to ${verdict.question}`], at);
      await letGo(record, `PR #${pr} waits on the owner's answer to ${verdict.question}; released by the watcher`);
      await ended(record, pull);
      dated(`PR #${pr} still red: its review put it to the owner in ${verdict.question} (${verdict.summary})`);
      continue;
    }
    if (verdict?.kind === "flake" || verdict?.kind === "elsewhere") {
      if (await retry(record, pull)) dated(`PR #${pr} red, which its review judged ${verdict.kind === "flake" ? "random" : `a test elsewhere${verdict.parked ? ` (parked as ${verdict.parked})` : ""}`}: ${record.fixes.at(-1).by}`);
      continue;
    }
    const reviewing = spent && verdict?.kind !== "fix";
    if (last?.refused && (last.holder ? await holds(last.holder, at)
      : fixing() || now() < Date.parse(last.refusedAt ?? last.at) + backoff)) continue;
    if (pull.conflict && [...running.values()].some((one) => one.conflict)) continue;
    if (!(await room())) continue;
    if (stateOf) {
      const state = await stateOf(pr, record).catch((error) => `unread (${error.message.split("\n")[0]})`);
      if (state !== "OPEN") {
        dated(`PR #${pr} red (${pull.why}), but it reads ${state} now: no ${reviewing ? "review" : "fix"} session, looking again next time`);
        continue;
      }
    }
    await tell(["workspace", "red", String(pr), "--increment", increment, ...(pull.conflict ? ["--conflict"] : []),
      ...(pull.checks ?? []).flatMap((check) => ["--check", check])], record.project);
    if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event", "--reason", `PR #${pr} went red: ${reviewing ? "a review" : "a fix"} session starts on it`], at);
    const n = record.fixes.length + 1;
    const fixLogs = record.fixes.filter((one) => one.log && !one.review).map((one) => one.log);
    const lag = !reviewing && behind ? await behind(pull.head, repoOf(record)).catch(() => undefined) : undefined;
    const where = at ? { ...folders, checkout: at.folder, pool: folders.checkout } : folders;
    const entry = { at: new Date(now()).toISOString(), head: pull.head, ...(reviewing ? { review: true } : pull.security ? { security: true } : {}),
      ...(pull.conflict ? { conflict: true } : {}), ...(failures && !reviewing ? { units: failures.units, tests: failures.tests } : {}) };
    record.starting = { kind: reviewing ? "review" : "fix", n, entry };
    await save(dir, record);
    const session = reviewing
      ? await startReview({ pr, increment, n, ...(at ? { project: at } : {}), brief: localBrief(reviewBrief({ pr, increment, why: pull.why, logs: pull.logs, fixLogs, n, cap, closed: record.closed, project: at }), where) })
      : await startFix({ pr, increment, n, ...(at ? { project: at } : {}), brief: localBrief(fixBrief({ pr, increment, why: pull.why, logs: pull.logs, n: counted + 1, limit: allowed, keepOpen: record.keepOpen, closed: record.closed,
        review: verdict?.summary, lag, project: at, security: pull.security }), where) });
    record.fixing = { pid: session.pid };
    record.fixes.push({ ...entry, pid: session.pid, log: session.log });
    delete record.starting;
    running.set(pr, { conflict: Boolean(pull.conflict), review: reviewing });
    await save(dir, record);
    dated(reviewing ? `PR #${pr} red (${pull.why}) past its ${allowed} fix sessions: review session started, log ${session.log}`
      : `PR #${pr} red (${pull.why}): fix session ${counted + 1}${verdict ? ", after its review," : ` of ${allowed}`} started, log ${session.log}`);
  }
}

export async function ensureWatcher({ pidFile, argsOf, spawn }) {
  const old = (await readFile(pidFile, "utf8").catch(() => "")).trim();
  const args = old ? await argsOf(old) : "";
  if (MARKS.some((mark) => mark.test(args))) return false;
  await writeFile(pidFile, `${await spawn()}\n`);
  return true;
}

async function argsOf(pid) {
  return (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();
}

export function remoteCommand(config, args) {
  return ["ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", config.machine,
    `cd ${config.remoteCheckout} && node packages/agent-pool/src/watch.mjs ${args.join(" ")}`]];
}

async function markerAt(folder) {
  for (let at = resolve(folder); ; at = dirname(at)) {
    const text = await readFile(join(at, ".storytree", "project.json"), "utf8")
      .catch(() => readFile(join(at, ".storytree.json"), "utf8")).catch(() => undefined);
    if (text !== undefined) { try { return { folder: at, name: JSON.parse(text).project }; } catch { return undefined; } }
    if (dirname(at) === at) return undefined;
  }
}

export async function projectOf({ cwd, repo, home }) {
  const here = await markerAt(cwd);
  if (!here?.name || here.name === (await markerAt(repo))?.name) return undefined;
  return { folder: here.folder, home };
}

export async function ownerOf({ increment, projects, home, has, repoOf }) {
  const others = projects.filter((one) => one.name !== "storytree" && one.checkout);
  if (!others.length || await has(increment)) return undefined;
  for (const one of others) {
    const project = { folder: one.checkout, home };
    if (!(await has(increment, project))) continue;
    return { ...project, name: one.name, repo: await repoOf(one.checkout), ...(one.checks ? { checks: one.checks } : {}), ...(one.review ? { review: one.review } : {}) };
  }
  return undefined;
}

export const homeOf = ({ env, home }) => env.STORYTREE_HOME || join(home, ".storytree", "0.3");

export const libraryOf = (record) => (record.project?.repo ? record.project : undefined);
export const repoOf = (record) => record.project?.repo ?? HOME;

export function freeOf(env) {
  const free = { ...env };
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", LANE_RUN]) delete free[name];
  return free;
}

export function boxDefaults({ home = homedir(), env = process.env, platform = process.platform, exec = run, spawn = spawnChild } = {}) {
  const config = poolConfig({ home, env });
  const { lanesDir, checkout: repo } = config;
  const dir = join(lanesDir, "watch");
  const script = fileURLToPath(import.meta.url);
  const free = freeOf(env);
  const storytreeHome = homeOf({ env, home });
  const onBox = existsSync(join(lanesDir, "run-lane.sh"));
  const own = join(repo, "packages", "agent-pool", "src", "watch.mjs");
  const detached = (args, log, cwd) => {
    const out = openSync(log, "a");
    const child = spawn(process.execPath, args, { cwd, env: free, detached: true, stdio: ["ignore", out, out] });
    child.unref();
    return child.pid;
  };
  const storytree = async (args, project) => (project
    ? await run(process.execPath, ["--import", import.meta.resolve("tsx"), join(repo, "packages", "cli", "src", "bins", "storytree.ts"), ...args],
      { cwd: project.folder, env: { ...env, STORYTREE_HOME: project.home }, maxBuffer: 16 * 1024 * 1024 })
    : await exec(...storytreeCommand(args, platform), { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout;
  return {
    lanesDir, repo, dir, pidFile: join(dir, "watch.pid"), loopPidFile: join(dir, "watch-loop.pid"), argsOf,
    folders: { checkout: repo, lanes: lanesDir },
    log: join(lanesDir, "watch.runner.log"),
    limit: config.watcher.fixesPerRed, cap: config.watcher.fixesPerPullRequest, intervalMs: config.watcher.intervalMs, now: Date.now,
    session: env.CLAUDE_CODE_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim() || "",
    storytree,
    project: () => projectOf({ cwd: process.cwd(), repo, home: storytreeHome }),
    holds: (increment) => storytree(["library", "read", increment, "--field", "title"]).then(() => true, () => false),
    ownerOf: (increment) => ownerOf({ increment, projects: config.projects, home: storytreeHome,
      has: (one, project) => storytree(["library", "read", one, "--field", "title"], project).then(() => true, () => false),
      repoOf: async (folder) => (await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: folder })).stdout.trim() }),
    cutover: async (project) => (await storytree(["library", "read", "pr-cutover", "--field", "at"], project)).trim(),
    stateOf: async (pr, record) => (await run("gh", ["pr", "view", String(pr), "-R", repoOf(record), "--json", "state", "--jq", ".state"], { cwd: repo })).stdout.trim(),
    look: (pr, record) => lookOnGitHub(pr, { repo, since: record.fixes.at(-1)?.at ?? record.handedAt, home: repoOf(record),
      seen: new Set((record.queueReds ?? []).map((red) => red.at)) }),
    reached: async (sha, on = HOME) => onMain((await run("gh", ["api", `repos/${on}/compare/main...${sha}`, "--jq", ".status"], { cwd: repo })).stdout.trim()),
    viewOf: async (pr, on = HOME) => {
      if (!existsSync(repo)) throw new Error(`the shared checkout ${repo} is not on this machine; off the box, hand over with \`watch.mjs handover\``);
      return JSON.parse((await run("gh", ["pr", "view", String(pr), "-R", on, ...VIEW], { cwd: repo })).stdout);
    },
    here: async (args) => (await exec(...storytreeCommand(args, platform), { maxBuffer: 16 * 1024 * 1024 })).stdout,
    ownViewOf: async (pr, on) => JSON.parse((await run("gh", ["pr", "view", String(pr), ...(on ? ["-R", on] : []), ...VIEW])).stdout),
    ownBranchOf: async () => (await run("git", ["branch", "--show-current"])).stdout.trim().replace(/^(main|master)$/, ""),
    alive: async (pid) => isFixSession(await argsOf(pid)),
    // eslint-disable-next-line storytree/posix-commands -- room is read only by the watcher's look loop, which the Mint box's service host runs.
    room: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout)
      < await readCap({ lanesDir, sessions: config.sessions }),
    startFix: async ({ pr, n, brief, project }) => {
      const base = join(dir, `fix-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached(runnerStart(join(script, "..", "runner.mjs"), ["run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs]), `${base}.runner.log`, project?.folder ?? repo);
      return { pid, log: `${base}.log` };
    },
    startedAs: async ({ name, since }) => {
      const base = join(dir, name);
      const log = await stat(`${base}.runner.log`).catch(() => undefined);
      if (!log || log.mtimeMs < Date.parse(since)) return undefined;
      const stdout = platform === "win32" ? processTable((await run(...WINDOWS_PROCESSES, { maxBuffer: 64 * 1024 * 1024 })).stdout)
        : (await run("ps", ["-eo", "pid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout;
      const line = stdout.split("\n").find((one) => isFixSession(one) && one.includes(`${base}-brief.md`));
      return { ...(line ? { pid: Number(line.trim().split(/\s+/)[0]) } : {}), log: `${base}.log` };
    },
    startReview: async ({ pr, n, brief, project }) => {
      const base = join(dir, `review-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached(runnerStart(join(script, "..", "runner.mjs"), ["run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs]), `${base}.runner.log`, project?.folder ?? repo);
      return { pid, log: `${base}.log` };
    },
    startWatcher: (log) => detached([own, "run"], log, repo),
    codeVersion: () => codeVersion({ repo, paths: WATCH_CODE, config: config.file }),
    loop: () => new Promise((ended) => {
      const child = spawnChild(process.execPath, [own, "watch"], { cwd: repo, env: free, stdio: "inherit" });
      child.once("error", () => ended(1));
      child.once("exit", (code) => ended(code ?? 1));
    }),
    onBox,
    remote: async (args) => {
      if (!config.machine) throw new Error(`the agent pool's configuration names no machine to hand over to (set "machine" and "machineCheckout" in ${config.file})`);
      return (await run(...remoteCommand(config, args), { timeout: 120_000 })).stdout;
    },
    sleep: (ms) => wait(ms),
    readReleases: onBox ? () => releasesOnGitHub({ repo }) : undefined,
    readExemptions: onBox ? () => exemptionChanges({ repo,
      openerOf: async (pr) => (await run("gh", ["pr", "view", pr, "--json", "author", "--jq", ".author.login"], { cwd: repo })).stdout.trim() }) : undefined,
    exemptionRecorded: async (about) => !/^No fyi records match/.test(await storytree(["library", "list", "fyi", "--where", `about=${about}`])),
    recordExemption: (fyi) => storytree(["fyi", "new", "--by", "watcher", "--project", "storytree", ...Object.entries(fyi).flatMap(([field, text]) => [`--${field}`, text])]),
    enqueue: (id, head) => run("gh", ["api", "graphql", "-f", `id=${id}`, "-f", `sha=${head}`, "-f",
      "query=mutation($id: ID!, $sha: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $sha}) { mergeQueueEntry { position } } }"], { cwd: repo }),
    refresh: async (pr, head, on = HOME) => {
      const behind = Number((await run("gh", ["api", `repos/${on}/compare/main...${head}`, "--jq", ".behind_by"], { cwd: repo })).stdout.trim());
      if (!(behind > 0)) throw new Error("its branch is up to date with main");
      await run("gh", ["api", "-X", "PUT", `repos/${on}/pulls/${pr}/update-branch`, "-f", `expected_head_sha=${head}`], { cwd: repo });
    },
    behind: async (head, on = HOME) => JSON.parse((await run("gh", ["api", `repos/${on}/compare/${head}...main`, "--jq", "{count: .ahead_by, subjects: [.commits[].commit.message | split(\"\\n\")[0]]}"], { cwd: repo })).stdout),
    rerun: (one) => run("gh", ["run", "rerun", String(one.id), "--failed", "-R", one.repo ?? HOME], { cwd: repo })
      .catch(() => run("gh", ["run", "rerun", String(one.id), "-R", one.repo ?? HOME], { cwd: repo })),
    tail: async (one) => (await run("gh", ["run", "view", String(one.id), "--log-failed"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }))
      .stdout.trimEnd().split("\n").slice(-30).join("\n"),
    waitHolds: (id) => readWait(storytree, id, new Date().toISOString().slice(0, 10)),
    questionOpen: async (id) => !/, (settled|retired)\b/.test((await run("pnpm", ["-s", "storytree", "question", "show", id], { cwd: repo })).stdout.split("\n")[1] ?? ""),
    raise: async (question) => {
      const { stdout } = await run("pnpm", ["-s", "storytree", "question", "new", "--arc", RELEASE_ARC,
        ...Object.entries(question).flatMap(([field, text]) => [`--${field}`, text])], { cwd: repo });
      return /question_\w+/.exec(stdout)?.[0] ?? "a question";
    },
    raised: (asking) => raisedSince(storytree, asking),
    startReleaseFix: async ({ n, stamp = Date.now(), brief }) => {
      const base = join(dir, `release-fix-${stamp}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached(runnerStart(join(script, "..", "runner.mjs"), ["run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs]), `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
  };
}

export function boxRoom({ engines, pace = readBoxPace, say }) {
  let said = "clear";
  return async () => {
    if (!(await engines())) return false;
    let held, key, line;
    try { held = await pace(); }
    catch (error) { key = "unread"; line = `box readings unread (${String(error.message).split("\n")[0]}): starting fix sessions as usual`; }
    if (held) { key = `${held.hold} ${held.windows}`; line = `holding back fix sessions: ${held.reason}`; }
    else if (!key) { key = "clear"; line = "box clear: starting fix sessions up to the cap"; }
    if (key !== said) { said = key; say(line); }
    return !held;
  };
}

export async function main(args, box = {}) {
  const defaults = boxDefaults({ home: box.home, env: box.env, platform: box.platform, exec: box.exec });
  const b = { ...defaults, ...box };
  if (!box.readReleases && b.dir !== defaults.dir) b.readReleases = undefined;
  if (!box.readExemptions && b.dir !== defaults.dir) b.readExemptions = undefined;
  if (!box.ownerOf && b.dir !== defaults.dir) b.ownerOf = async () => undefined;
  if (!box.holds && b.dir !== defaults.dir) b.holds = async () => false;
  const out = b.out ?? console.log;
  const keepOpen = args.includes("--keep-open"), refused = args.includes("--refused");
  const named = args.includes("--repo") ? args[args.indexOf("--repo") + 1] ?? "" : undefined;
  if (named !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(named)) { out(`--repo takes a repository as <owner/name>, not "${named}"`); return 2; }
  if (args[0] === "handover" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const owner = await Promise.resolve().then(() => b.ownerOf(args[2])).catch(() => undefined);
    const wrong = named && wrongRepo({ pr: args[1], increment: args[2], named, owner, ours: !owner && await Promise.resolve().then(() => b.holds(args[2])).catch(() => false) });
    if (wrong) { out(wrong); return 1; }
    const on = named ?? owner?.repo;
    const view = await b.ownViewOf(Number(args[1]), on).catch(() => undefined);
    let branch;
    if (view !== undefined) {
      try { branch = ownBranch(args[1], view, on); } catch (error) { out(error.message); return 1; }
    }
    const { code, lines } = await handOver({ pr: Number(args[1]), increment: args[2], session: b.session, keepOpen, repo: named, onBox: b.onBox,
      local: (hand) => main(hand, box), remote: b.remote,
      library: async (request) => handThroughLibrary({ ...request, branch: branch ?? await b.ownBranchOf().catch(() => ""), storytree: b.here, now: b.now }) });
    for (const line of lines) out(line);
    return code;
  }
  await mkdir(b.dir, { recursive: true });
  if (args[0] === "hand" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const at = args.indexOf("--session");
    const session = at > 0 ? args[at + 1] ?? "" : b.session;
    const holder = args.includes("--holder") ? args[args.indexOf("--holder") + 1] : undefined;
    let view, branch;
    const project = await b.ownerOf(args[2]) ?? await b.project();
    const wrong = wrongRepo({ pr: args[1], increment: args[2], named, owner: project?.repo ? project : undefined, ours: true });
    if (wrong) { out(wrong); return 1; }
    try { view = await b.viewOf(Number(args[1]), project?.repo ?? HOME); } catch (error) {
      out(`not handed over: GitHub could not be asked about PR #${args[1]}: ${(error.stderr?.trim() || error.message).split("\n").join("; ")}`);
      return 1;
    }
    try { branch = ownBranch(args[1], view, project?.repo); } catch (error) { out(error.message); return 1; }
    const { closed, held } = await hand({ dir: b.dir, pr: Number(args[1]), increment: args[2], session, branch, keepOpen, refused, holder, project, storytree: b.storytree, now: b.now,
      startWatcher: () => ensureWatcher({ pidFile: b.pidFile, argsOf: b.argsOf, spawn: () => b.startWatcher(b.log) }) });
    out(`PR #${args[1]} handed to the watcher (${join(b.dir, `${args[1]}.json`)}); `
      + (closed ? `${args[2]} had already closed, so the watcher watches and fixes it to its merge and closes nothing.`
        : `${args[2]} waits on it until it merges${keepOpen ? ", then stays open for its next pull request." : "."}`));
    if (held) out(held);
    out(`Close out with: pnpm storytree session close-out --safe yes --why "PR #${args[1]} open and green, handed to the watcher"`);
    return 0;
  }
  if (args[0] === "verdict" && /^\d+$/.test(args[1] ?? "")) {
    const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
    if (!VERDICTS.includes(args[2])) { out(`usage: watch.mjs verdict <pr> ${VERDICTS.join("|")} --summary <text> [--parked <increment>] [--question <id>]`); return 2; }
    try { await recordVerdict({ dir: b.dir, pr: Number(args[1]), kind: args[2], summary: flag("--summary"), parked: flag("--parked"), question: flag("--question") }); }
    catch (error) { out(error.message); return 1; }
    out(`PR #${args[1]}: verdict "${args[2]}" recorded; the watcher acts on it at its next look.`);
    return 0;
  }
  if (args[0] === "release-fix" && /^--(pr|wait|question)$/.test(args[1] ?? "") && args[2]) {
    const recorded = await recordFix({ dir: b.dir, ...(args[1] === "--pr" ? { pr: Number(args[2]) } : { [args[1].slice(2)]: args[2] }) });
    out(recorded ? `Recorded ${args[2]} on the release stop: the watcher starts no other fix session while it is open.`
      : "No release stop is recorded: nothing to attach it to.");
    return recorded ? 0 : 1;
  }
  if (args[0] === "forget") {
    const { prs, to } = await forget({ dir: b.dir, now: b.now });
    out(prs.length ? `set aside ${prs.length} hand-off${prs.length === 1 ? "" : "s"} (${prs.map((pr) => `#${pr}`).join(", ")}) into ${to}` : "no hand-offs to set aside");
    return 0;
  }
  if (args[0] === "status") {
    const found = await records(b.dir);
    const pid = (await readFile(b.pidFile, "utf8").catch(() => "")).trim();
    const live = pid && MARKS[0].test(await b.argsOf(pid));
    out(`watcher: ${live ? `running (pid ${pid})` : "not running"}`);
    out(`log: ${b.log}`);
    const loopPid = (await readFile(b.loopPidFile, "utf8").catch(() => "")).trim();
    if (loopPid && LOOP_MARKS[0].test(await b.argsOf(loopPid))) {
      const [by, began] = (await readFile(versionPath(b.dir), "utf8").catch(() => "")).trim().split(" ");
      const current = await Promise.resolve().then(b.codeVersion).catch(() => undefined);
      out(`look loop: running (pid ${loopPid}) ${by !== loopPid || !began ? "on code of unknown version (it records none): restart the watcher"
        : began === current ? `on the checkout's code (${began})` : `on stale code: ${began}, while the checkout has ${current ?? "an unreadable version"}`}`);
    } else out("look loop: not running");
    for (const record of found) out(`PR #${record.pr}${record.project?.repo ? ` on ${record.project.repo}` : ""} ${record.increment}: handed ${record.handedAt}, ${record.fixes.length} fix sessions${record.fixing ? `, one running (pid ${record.fixing.pid})` : ""}`);
    if (!found.length) out("no hand-offs");
    return 0;
  }
  if (args[0] !== "run" && args[0] !== "watch") { out(`usage: watch.mjs handover <pr> <increment> [--keep-open] [--repo <owner/name>] | hand <pr> <increment> [--session <id>] [--keep-open] [--repo <owner/name>] [--refused [--holder <session>]] | verdict <pr> ${VERDICTS.join("|")} --summary <text> | release-fix --pr <n> | --wait <increment> | --question <id> | forget | run | status`); return 2; }
  const say = b.say ?? ((line) => out(line));
  const dated = (message) => say(`${new Date(b.now()).toISOString()} ${message}`);
  if (args[0] === "run") {
    const runner = await holdRunner({ pidFile: b.pidFile, pid: b.pid ?? process.pid, marks: MARKS, argsOf: b.argsOf });
    if (!runner.held) { say(`watcher ${runner.by} is running: not starting`); return 1; }
    for (;;) {
      const code = await b.loop();
      if (code === 1) { dated("watcher look loop would not start (another holds it): stopping"); return 1; }
      if (code === RESTART) continue;
      dated(`watcher look loop ended ${code}: starting it again in ${Math.round(b.intervalMs / 1000)} s`);
      await b.sleep(b.intervalMs);
    }
  }
  const loop = await holdRunner({ pidFile: b.loopPidFile, pid: b.pid ?? process.pid, marks: LOOP_MARKS, argsOf: b.argsOf });
  if (!loop.held) { say(`watcher look loop ${loop.by} is running: not starting`); return 1; }
  const version = () => Promise.resolve().then(b.codeVersion).catch(() => undefined);
  const began = await version();
  if (began) await writeFile(versionPath(b.dir), `${b.pid ?? process.pid} ${began}\n`);
  let releasesAt = 0, exemptionsAt = 0;
  const room = boxRoom({ engines: b.room, pace: b.pace, say: dated });
  for (;;) {
    const current = began && await version();
    if (current && current !== began) { dated(`dev loop code changed (${began} → ${current}): restarting`); return RESTART; }
    try { await adoptRequests({ ...b, say }); }
    catch (error) { dated(`reading the library's hand-overs failed: ${error.message.split("\n")[0]}`); }
    try { await watchOnce({ ...b, room, say }); }
    catch (error) { dated(`look failed: ${error.message.split("\n")[0]}`); }
    if (b.readReleases && b.now() - releasesAt >= RELEASE_EVERY_MS) {
      releasesAt = b.now();
      try { await watchReleases({ ...b, room, startFix: b.startReleaseFix, say }); }
      catch (error) { dated(`release look failed: ${error.message.split("\n")[0]}`); }
    }
    if (b.readExemptions && b.now() - exemptionsAt >= EXEMPTIONS_EVERY_MS) {
      exemptionsAt = b.now();
      try { await watchExemptions({ readExemptions: b.readExemptions, recorded: b.exemptionRecorded, record: b.recordExemption, say: dated }); }
      catch (error) { dated(`exemptions look failed: ${error.message.split("\n")[0]}`); }
    }
    await b.sleep(b.intervalMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
