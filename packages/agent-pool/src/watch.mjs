// Capability 4 · A watcher lands a handed-over pull request (ADR-0955 D3). A Mint session ends once its pull request
// is open and its gate is green, and hands the pull request here; this script, not a model, watches CI and the merge
// queue: on MERGED it closes the increment and releases the session's claims, on a red it starts one fix session.
// node packages/agent-pool/src/watch.mjs hand <pr> <increment> [--session <id>] [--keep-open] [--refused [--holder <session>]]   (records it and starts the watcher)
// node packages/agent-pool/src/watch.mjs handover <pr> <increment> [--keep-open]               (from any machine: `hand` on the box, else over ssh, else through the library)
// --keep-open: one of several pull requests for its increment, so on MERGED the watcher leaves the increment open (4.11).
// --refused: a fix session hands back untouched because a claim refused it, so it does not count against the limit (4.14);
// --holder names the session the refusal said holds the work, and the retry waits until that session holds no claim (4.14).
// node packages/agent-pool/src/watch.mjs run                                     (the watcher: one per box; keeps `watch` running)
// node packages/agent-pool/src/watch.mjs watch                                   (its look loop, which `run` starts; exits 3 on its own code change)
// node packages/agent-pool/src/watch.mjs status
// node packages/agent-pool/src/watch.mjs release-fix --pr <n> | --question <id>   (a release fix session records what it left; release-watch.mjs)
// node packages/agent-pool/src/watch.mjs forget                                  (at a cut-over to a new repository: sets every hand-off aside, since its pull request numbers start again, 4.40)
// node packages/agent-pool/src/watch.mjs verdict <pr> flake|elsewhere|fix|owner --summary <text> [--parked <increment>] [--question <id>]   (a review session's one verdict, 4.37)
import { execFile, spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig, readCap } from "./pool-config.mjs";
import { codeVersion, countEngines, holdRunner } from "./queue.mjs";
import { EXEMPTIONS_EVERY_MS, exemptionChanges, watchExemptions } from "./exemptions-watch.mjs";
import { attempted, failedJob, FOLLOWERS, isSecurityCheck, judgeReleases, recordFix, RELEASE_ARC, RELEASE_EVERY_MS, RUNNER_ATTEMPTS, runnerFault, runnerReruns, securityJobs, watchReleases } from "./release-watch.mjs";

/**
 * The code the watcher runs (4.10, ADR-0981 D3): what watch.mjs loads and what the fix sessions it starts load
 * (runner.mjs and its engine.mjs; their brief is written here). A change to one of these restarts the look loop; a
 * change anywhere else in the dev loop leaves it looking. When one of these files comes to import another file, name
 * that file here; the pool's configuration, read once at start, is here too.
 */
export const WATCH_CODE = [...["watch.mjs", "release-watch.mjs", "exemptions-watch.mjs", "queue.mjs", "runner.mjs", "engine.mjs", "pool-config.mjs"]
  .map((name) => `packages/agent-pool/src/${name}`), "agent-pool.json"];

const run = promisify(execFile);
const RED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
// The queue's removals that the Requeue workflow puts back once; one it left out past its grace is red.
const EJECTED = new Set(["FAILED_CHECKS", "BRANCH_PROTECTION_FAILURE"]);
const MARKS = [/watch\.mjs run( |$)/];
const LOOP_MARKS = [/watch\.mjs watch( |$)/];

/** Whether a process's command line is a fix session's runner (4.26). */
export const isFixSession = (args) => /agent-pool\/src\/runner\.mjs run /.test(args);
/** The look loop's exit when the dev loop's code in the shared checkout changed: `run` starts it again, on the new code. */
export const RESTART = 3;
/** How long a handed-over pull request holds its claims while open: then it is given up and its increment is back on its arc (ADR-1037 D3, 4.23). Its event wait checks back then too. */
const HELD_DAYS = 3;
const HELD_MS = HELD_DAYS * 86_400_000;
/** How many refused enqueues of one head the watcher tries before it leaves a stranded pull request as it is (4.31). */
const ENQUEUE_TRIES = 3;

/**
 * A pull request, as GitHub's GraphQL returns it, read as merged, closed, red or pending. Red is a failed check on
 * its head, a conflict with main (no check fails on one, so it would otherwise wait out its check-back), or a removal
 * from the merge queue after `since` that the Requeue workflow has not undone in `graceMs`. A conflict is marked as
 * one whatever else failed: a conflict often fails the landing check too, and it still needs a merge (4.18).
 * A pending one is `stranded` (its node id) when nothing will land it: open, not a draft, no `hold` label, out of the
 * merge queue and not removed from it within `graceMs` (the Requeue workflow's), every check finished, `verify` passed;
 * a re-run of failed jobs only ends that way with automerge skipped (4.31).
 * A failed security check (isSecurityCheck) makes it `security` instead of red, whatever else failed, naming only those
 * checks, so no fix session and no log or alert text follow it (4.41).
 */
export function readPull(pull, { since, now, graceMs }) {
  const head = pull.headRefOid;
  if (!ownPull(pull)) return { state: "foreign", head };
  if (pull.state === "MERGED") return { state: "merged", head };
  if (pull.state === "CLOSED") return { state: "closed", head };
  const checks = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const failed = checks.filter((check) => RED.has(check.conclusion ?? check.state));
  const why = failed.map((check) => `${check.name ?? check.context} failed`).join("; ");
  const logs = failed.map((check) => check.detailsUrl ?? check.targetUrl).filter(Boolean);
  const names = failed.map((check) => check.name ?? check.context).filter(Boolean);
  const security = names.filter(isSecurityCheck);
  if (security.length) return { state: "security", head, checks: security };
  if (pull.mergeable === "CONFLICTING") {
    return { state: "red", head, why: `it conflicts with main: merge origin/main and resolve the conflicts${why ? `; also ${why}` : ""}`, logs,
      checks: names, conflict: true, branch: pull.headRefName };
  }
  // The Actions runs its failed checks belong to, when every one names one, so the watcher can ask whether only the runner failed them (4.29).
  const runs = failed.map((check) => /\/actions\/runs\/(\d+)\//.exec(check.detailsUrl ?? "")?.[1]);
  if (failed.length) return { state: "red", head, why, logs, checks: names, ...(runs.every(Boolean) ? { runs: [...new Set(runs.map(Number))] } : {}) };
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

/** The repository the watcher watches: a pull request whose head is elsewhere (a fork's) is never its to land or fix. */
export const HOME = "storytree-ai/storytree";

/** Whether `pull`, as GitHub's GraphQL gives it, has its head on HOME: a fork's is not, nor one whose head GitHub does not say. */
export const ownPull = (pull) => pull?.isCrossRepository === false && pull.headRepository?.nameWithOwner === HOME;

/**
 * The branch of pull request `pr`, from `gh pr view`'s `view` of it, when its head is on HOME; otherwise it throws, so a
 * fork's pull request, or one GitHub does not say the head of, is never handed over or adopted.
 */
export function ownBranch(pr, view) {
  const own = view?.isCrossRepository === false && `${view.headRepositoryOwner?.login}/${view.headRepository?.name}` === HOME;
  if (own && typeof view.headRefName === "string" && view.headRefName) return view.headRefName;
  throw new Error(`not handed over: PR #${pr}'s head is not on ${HOME}, or GitHub did not say where it is; the watcher takes only this repository's pull requests`);
}

/** What `gh pr view` is asked, for ownBranch. */
const VIEW = ["--json", "headRefName,isCrossRepository,headRepository,headRepositoryOwner"];

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  id state isDraft headRefOid headRefName isCrossRepository headRepository { nameWithOwner } mergeable mergeQueueEntry { state } labels(first: 100) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
  timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT], last: 1) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } }
} } }`;

/** One pull request from GitHub through `gh`, the box's signed-in GitHub command line. */
export async function lookOnGitHub(pr, { repo, since, now = Date.now, graceMs = 10 * 60_000 }) {
  const { stdout } = await run("gh", ["api", "graphql", "-f", "owner=storytree-ai", "-f", "name=storytree", "-F", `pr=${pr}`, "-f", `query=${QUERY}`],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  const pull = readPull(JSON.parse(stdout).data.repository.pullRequest, { since, now: now(), graceMs });
  if (pull.state !== "red" || pull.conflict || !pull.runs) return pull;
  const runs = [];
  for (const id of pull.runs) {
    const one = await ghJson(repo, `${REPO}/actions/runs/${id}`);
    const jobs = await jobsOf(repo, one);
    runs.push({ id, attempt: one.run_attempt, status: one.status, repo: one.repository?.full_name ?? REPO.replace(/^repos\//, ""), jobs,
      log: one.run_attempt < RUNNER_ATTEMPTS ? await failedLog(repo, one, jobs) : "" });
  }
  // What failed, from each red job's own log, read at every attempt, and the packages the pull request changes (4.34).
  let failures;
  try {
    const reach = reachOf(await filesOf(repo, pr, pull.head));
    for (const one of runs) one.jobs = await Promise.all(one.jobs.map(async (job) => ({ ...job, log: redJob(job) ? await jobLog(repo, job.id) : "" })));
    failures = readFailures(runs, reach);
  } catch { /* unread, so the red counts as any red does */ }
  return { ...pull, runner: runnerReruns(runs), ...(failures ? { failures } : {}) };
}

/** A job that ended red itself, not one that only reads the others' result. */
const redJob = (job) => job.steps > 0 && (job.conclusion === "failure" || job.conclusion === "timed_out") && !FOLLOWERS.has(job.name);

/** The packages and apps that own a file in `files`, the paths a pull request changes: its reach, for readFailures (4.34). */
export function reachOf(files) {
  return new Set(files.map((file) => /^((?:packages|apps)\/[^/]+)\//.exec(file)?.[1]).filter(Boolean));
}

/**
 * What a red pull request's failed CI runs ({ id, attempt, repo, jobs: [{ name, conclusion, steps, log }] }) say failed
 * (4.34): the units in their results tables' FAIL rows and the tests their `✖ <name> (<n>ms)` lines name, and whether it
 * is `outside` `reach`, every failing unit a package or app the pull request changes no file of. A red job with no FAIL
 * row failed on no test (an install, a typecheck), and a unit outside packages/ and apps/ is no package: neither is outside.
 * The reach is only what the pull request changes, not its dependents: a red it caused in a dependent fails again on a
 * rerun, and that repeat counts (4.35, ADR-1147).
 */
export function readFailures(runs, reach) {
  const units = new Set(), tests = new Set();
  let outside = true;
  for (const job of runs.flatMap((one) => one.jobs).filter(redJob)) {
    let rows = 0;
    for (const line of (job.log ?? "").split("\n")) {
      const unit = /\sFAIL {4}(\S+)/.exec(line)?.[1];
      if (unit) {
        rows++;
        units.add(unit);
        if (!/^(?:packages|apps)\/[^/]+$/.test(unit) || reach.has(unit)) outside = false;
      }
      const test = /✖ (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(line)?.[1];
      if (test) tests.add(test);
    }
    if (!rows) outside = false;
  }
  if (!units.size) outside = false;
  return { outside, units: [...units], tests: [...tests], runs: runs.map(({ id, attempt, repo }) => ({ id, attempt, repo })),
    key: runs.map((one) => `${one.id}:${one.attempt}`).join(",") };
}

const filesSeen = new Map();
/** The paths pull request `pr` changes at `head`, read once a head. */
async function filesOf(repo, pr, head) {
  const key = `${pr}:${head}`;
  if (!filesSeen.has(key)) {
    const { stdout } = await run("gh", ["api", "--paginate", `${REPO}/pulls/${pr}/files?per_page=100`, "--jq", ".[].filename"], { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
    filesSeen.set(key, stdout.split("\n").filter(Boolean));
  }
  return filesSeen.get(key);
}
const jobLogs = new Map();
/** A finished job's own log, read once; readable before the rest of its run ends, unlike `gh run view --log-failed`. */
async function jobLog(repo, id) {
  if (!jobLogs.has(id)) jobLogs.set(id, (await run("gh", ["api", `${REPO}/actions/jobs/${id}/logs`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })).stdout);
  return jobLogs.get(id);
}

const REPO = "repos/storytree-ai/storytree";
const ghJson = async (repo, path) => JSON.parse((await run("gh", ["api", path], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout);
const jobsSeen = new Map();
/** A run's jobs as { name, conclusion, steps }; a completed attempt's never change, so they are read once. */
async function jobsOf(repo, run) {
  const key = `${run.id}:${run.run_attempt}`;
  if (jobsSeen.has(key)) return jobsSeen.get(key);
  const jobs = (await ghJson(repo, `${REPO}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs
    .map((job) => ({ id: job.id, name: job.name, conclusion: job.conclusion, steps: job.steps?.length ?? 0, runner: job.runner_name ?? "" }));
  if (run.status === "completed") jobsSeen.set(key, jobs);
  return jobs;
}
const logsSeen = new Map();
/** A completed attempt's failed steps' log, read once and only when a job that ran ended red (runnerFault reads it). */
async function failedLog(repo, one, jobs) {
  const key = `${one.id}:${one.run_attempt}`;
  if (logsSeen.has(key)) return logsSeen.get(key);
  if (one.status !== "completed" || !jobs.some((job) => job.steps > 0 && job.conclusion === "failure")) return "";
  const log = (await run("gh", ["run", "view", String(one.id), "--log-failed"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).catch(() => ({ stdout: "" }))).stdout;
  logsSeen.set(key, log);
  return log;
}
/** A workflow run as judgeReleases reads it, with its first red job and its red security checks when `jobs` are read. */
export const asRun = (run, jobs) => ({ id: run.id, sha: run.head_sha, created: run.created_at, updated: run.updated_at, status: run.status,
  conclusion: run.conclusion, attempt: run.run_attempt, url: run.html_url, repo: run.repository?.full_name ?? REPO.replace(/^repos\//, ""), job: jobs && failedJob(jobs),
  ...(jobs && securityJobs(jobs).length ? { security: securityJobs(jobs) } : {}) });

/** The latest published release, the release runs since it that attempted one, and main's push CI runs, judged (4.16). */
export async function releasesOnGitHub({ repo, now = Date.now }) {
  const latest = await ghJson(repo, `${REPO}/releases/latest`);
  const release = { tag: latest.tag_name, sha: latest.target_commitish, at: latest.published_at };
  const attempts = [];
  for (const run of (await ghJson(repo, `${REPO}/actions/workflows/release.yml/runs?per_page=30`)).workflow_runs) {
    // The run that published the latest release is read too: it may have published it without a platform (4.6).
    if (Date.parse(run.created_at) <= Date.parse(release.at) && run.head_sha !== release.sha) break;
    const jobs = await jobsOf(repo, run);
    if (attempted(jobs)) attempts.push(asRun(run, jobs));
  }
  const main = (await ghJson(repo, `${REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&per_page=30`)).workflow_runs;
  const head = main[0] && main[0].status === "completed" && main[0].conclusion !== "success" ? await jobsOf(repo, main[0]) : undefined;
  // Whether only the runner failed main's red head, read while it may still earn a rerun for that (4.29).
  const fault = head && main[0].run_attempt < RUNNER_ATTEMPTS ? runnerFault(head, await failedLog(repo, main[0], head)) : null;
  return { release, ...judgeReleases({ release, attempts, main: main.map((run, i) => i === 0 ? { ...asRun(run, head), fault } : asRun(run)), now: now() }) };
}

const recordPath = (dir, pr) => join(dir, `${pr}.json`);
/** The look loop's pid and the code version it started on, for `status` (4.21). */
const versionPath = (dir) => join(dir, "watch-loop.version");
const save = (dir, record) => writeFile(recordPath(dir, record.pr), `${JSON.stringify(record, null, 2)}\n`);

async function records(dir) {
  const names = await readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const found = [];
  for (const name of names.filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b))) {
    try { found.push(JSON.parse(await readFile(join(dir, name), "utf8"))); } catch { /* a half-written hand-off is read next time */ }
  }
  return found;
}

/**
 * Set every pull request's record in `dir` aside, into a `before-<time>` folder beside them, at a cut-over to a new
 * repository, whose pull request numbers start again at #1, so no old record is read for a new pull request (4.40).
 * Nothing is deleted. Returns the pull requests set aside and the folder they went to (none when there were none).
 */
export async function forget({ dir, now = Date.now }) {
  const names = (await readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; }))
    .filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b));
  if (!names.length) return { prs: [] };
  const to = join(dir, `before-${new Date(now()).toISOString().replace(/[-:]|\.\d{3}/g, "")}`);
  await mkdir(to, { recursive: true });
  for (const name of names) await rename(join(dir, name), join(to, name));
  return { prs: names.map((name) => parseInt(name)), to };
}

/**
 * The increments handed to the watcher in `dir`, each with why the pool leaves it alone: its pull request is landing,
 * or a fix session works it. The watcher clears the event wait before a fix session claims the increment, so this,
 * not the wait, keeps the dispatcher from starting a second session in between.
 */
export async function handedOff(dir) {
  return (await records(dir)).map((record) => ({ increment: record.increment,
    note: `PR #${record.pr} is with the Mint box's watcher${record.fixing ? ", and a fix session works it" : ""}` }));
}

/**
 * Hand a pull request to the watcher: park the increment on an event wait so no session claims it while it lands
 * (checking back in three days, after which the pool may take it again: an event wait needs that day), record the hand-off (one per pull request; handing back keeps its fix sessions), and start the watcher.
 * `keepOpen` marks one of several pull requests for the increment: its merge releases the session's claims but closes nothing.
 * `refused` is a fix session handing back untouched because another session's claim refused it: its fix is marked
 * refused, so it does not count against the limit, with the `holder` its refusal named, if any, and when (4.14).
 * An increment that already closed (on an earlier pull request of a stack) waits for nothing, so its refusal of the
 * wait is no refusal of the hand-off: the record is marked `closed`, and the watcher still watches and fixes it (4.13).
 * The handing session's claims are held for the pull request, on its `branch`, until it merges or closes (ADR-1037 D1,
 * 4.22): its close-out then releases nothing. With no session or branch to hold them by, `held` says why none are.
 * `project` is where the hand-off's own storytree project lives when it is not the watcher's (an experiment arm's
 * throwaway library: its folder and storytree home), so the reds it records land there (ADR-1064 D4, 4.25).
 */
export async function hand({ dir, pr, increment, session, branch, keepOpen = false, refused = false, holder, project, storytree, startWatcher, now = Date.now }) {
  await mkdir(dir, { recursive: true });
  const old = (await records(dir)).find((record) => record.pr === pr);
  let closed = false;
  await storytree(["arc", "increment", "wait", increment, "--for", "event", "--note",
    `PR #${pr} is open and green and handed to the Mint box's watcher, which ${keepOpen ? "leaves this open (more pull requests are to come) on its merge" : "closes this on its merge"} or starts a fix session on a red.`,
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

/**
 * Hand a pull request over from any machine, with the handing session's own id so the watcher releases its claims:
 * on the box it is `hand`; elsewhere it runs `hand` on the box through `remote` (ssh), and when ssh cannot reach the
 * box (a cloud container has neither ssh nor the tailnet) it writes the request through `library` (4.30). When neither
 * reaches the watcher it refuses with the reasons, and the session lands the pull request itself.
 */
export async function handOver({ pr, increment, session, keepOpen = false, onBox, local, remote, library }) {
  const fallback = `Wait for the merge yourself: watch \`gh pr checks ${pr}\` for MERGED, then close ${increment} with --disposition landed --pr ${pr}.`;
  if (!session) return { code: 1, lines: ["no session id (CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID): the watcher could not release this session's claims, so it is not handed over.", fallback] };
  const args = ["hand", String(pr), increment, "--session", session, ...(keepOpen ? ["--keep-open"] : [])];
  if (onBox) { await local(args); return { code: 0, lines: [] }; }
  const last = (error) => error.message.trim().split("\n").at(-1);
  let unreached;
  try {
    // The box's `hand` already says how to close out, so its words are relayed as they are.
    return { code: 0, lines: [(await remote(args)).trim()].filter(Boolean) };
  } catch (error) {
    // The box refused it (a fork's pull request): no other way in takes it either.
    const refusal = `${error.stdout ?? ""}\n${error.message}`.split("\n").find((line) => line.startsWith("not handed over: "));
    if (refusal) return { code: 1, lines: [refusal] };
    unreached = `could not reach the Mint box's watcher over ssh: ${last(error)}`;
  }
  if (!library) return { code: 1, lines: [unreached, fallback] };
  try {
    return { code: 0, lines: [`${unreached}; handed over through the library instead.`, ...await library({ pr, increment, session, keepOpen })] };
  } catch (error) {
    return { code: 1, lines: [unreached, `could not hand it over through the library either: ${last(error)}`, fallback] };
  }
}

/** The event wait a hand-over through the library writes is its request: it names the pull request, the session and whether to keep the increment open (4.30). */
const requestNote = ({ pr, session, keepOpen }) => `PR #${pr} is open and green and handed to the Mint box's watcher through the library by session ${session}${keepOpen ? ", to keep this open" : ""},`
  + ` which ${keepOpen ? "leaves this open (more pull requests are to come) on its merge" : "closes this on its merge"} or starts a fix session on a red.`;
const REQUEST = /^\s*- event\s+PR #(\d+) is open and green and handed to the Mint box's watcher through the library by session ([^\s,]+)(, to keep this open)?, .* — (increment_\w+)\s/;

/**
 * Hand a pull request over through the library, from wherever it is reachable (4.30): the event wait `hand` would
 * write, carrying the request the box's watcher adopts at its next look, and the session's claims held for the pull
 * request on its `branch` now, since the session closes out before that look. A wait the library refuses throws.
 */
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

/**
 * The box's watcher takes each hand-over written through the library that it has no record of yet, as `hand` would record it (4.30),
 * once `viewOf` shows its head is on HOME: one GitHub cannot be asked about is left for a later look, and a fork's, or one whose head
 * GitHub does not say, is refused, its wait and held claims let go (4.32).
 */
export async function adoptRequests({ dir, storytree, viewOf, now = Date.now, say = () => {} }) {
  const known = new Set((await records(dir)).map((record) => record.pr));
  for (const line of (await storytree(["arc", "waits"])).split("\n")) {
    const found = REQUEST.exec(line);
    if (!found || known.has(Number(found[1]))) continue;
    const [, pr, session, keepOpen, increment] = found;
    const view = await viewOf(Number(pr)).catch(() => undefined);
    if (view === undefined) continue;
    try { ownBranch(pr, view); } catch (error) {
      await storytree(["arc", "increment", "unwait", increment, "--for", "event"]).catch(() => "");
      await storytree(["workspace", "let-go", pr, "--reason", `PR #${pr}'s head is not on ${HOME}; released by the watcher`]).catch(() => "");
      known.add(Number(pr));
      say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} PR #${pr}: ${error.message}; ${increment} no longer waits on it`);
      continue;
    }
    await save(dir, { fixes: [], fixing: null, pr: Number(pr), increment, session, keepOpen: Boolean(keepOpen), closed: false, handedAt: new Date(now()).toISOString() });
    known.add(Number(pr));
    say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} PR #${pr}: handed over through the library by session ${session}; watching it for ${increment}`);
  }
}

/** How far a branch is behind main, said as a warning in its fix brief (4.38): the count and the newest ten subjects it lacks. */
function lagLine(lag) {
  if (!(lag?.count > 0)) return "";
  const newest = lag.subjects.slice(-10).reverse();
  const rest = lag.count - newest.length;
  return `\nIts branch is ${lag.count} commit${lag.count === 1 ? "" : "s"} behind main, lacking (newest first): ${newest.map((one) => `"${one}"`).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

function fixBrief({ pr, increment, why, logs, n, limit, keepOpen, closed, review, lag }) {
  const handBack = `${pr} ${increment}${keepOpen ? " --keep-open" : ""}`;
  return `# Fix session ${review ? `${n}, after an independent review` : `${n} of ${limit}`}: pull request #${pr} (${increment}) is red

The Mint box's watcher started you: a session opened PR #${pr} for ${increment}, saw its gate green and handed it over,
and it has since gone red: ${why}.${logs.length ? `\nThe failing runs: ${logs.join(", ")}.` : ""}${lagLine(lag)}${review
    ? `\nAfter ${limit} fix sessions an independent review session read it and judged it a bug in the pull request that a session can fix: ${review}`
    : ""}

Your job is that pull request and nothing else. Work from ~/code/storytree03 and follow its AGENTS.md as the session-orchestrator.
- Find the PR's branch (\`gh pr view ${pr} --json headRefName\`) and a worktree on it (\`git worktree list\`), or add one for it
  under .claude/worktrees, and ${closed
    ? `work there without claiming the increment: ${increment} already closed on an earlier pull request, so claim only the capabilities you edit.`
    : `claim the increment there: \`pnpm storytree workspace attach ${increment} --folder <worktree> --reason "fix PR #${pr}"\`.`}
  The claims are held for PR #${pr} until it merges; working on its branch, you take them over (ADR-1037 D2).
- Read the failing log (\`gh run view <run> --log-failed\`, or \`gh pr checks ${pr}\`). Suspect a stale branch first: merge
  origin/main, run \`pnpm install\`, and \`pnpm gate\`. Then fix what is really broken, see \`pnpm gate\` green and push.
  Never force-push, squash or \`gh pr merge\`.
- You exit when you end a turn: a session that ends its turn to wait exits at once, and its uncommitted work is stranded.
  So run \`pnpm gate\` and \`pnpm test\` in the foreground and stay in the turn until the PASS / FAIL / NOT RUN table prints,
  however long the run queues behind another lane's; this overrides the general guidance to run them in the background.
  A run already in the background is polled inside the same turn, never waited for by ending the turn.
- Hand it back: \`node packages/agent-pool/src/watch.mjs hand ${handBack}\`, then
  \`pnpm storytree session close-out --safe yes --why "PR #${pr} fixed and handed back to the watcher"\`, and end.
- If a claim you need is refused (another session holds the increment or a capability), leave the branch alone: hand it back
  with \`node packages/agent-pool/src/watch.mjs hand ${handBack} --refused --holder <session>\`, where <session> is the
  session id the refusal names ("held by … session <id>"), close out and end. A refused session does not count against
  the limit, and the watcher starts the next one once that session holds no claim.
- If it needs the owner (a decision, a sign-in, a spend), raise the question on the increment's arc${closed ? "" : " holding the increment"}, then close out and end.
`;
}

/** The verdicts a review session may return (4.37): retry, retry after parking the flaky test's fix, fix again, or the owner's question. */
export const VERDICTS = ["flake", "elsewhere", "fix", "owner"];
/** The arc a review session parks a slow or flaky test's fix on (4.37). */
export const FLAKES_ARC = "arc_1a42179de853";

function reviewBrief({ pr, increment, why, logs, fixLogs, n, cap, closed }) {
  const verdict = `node packages/agent-pool/src/watch.mjs verdict ${pr}`;
  return `# Review session (session ${n} of at most ${cap}): pull request #${pr} (${increment}) is still red after its fix sessions

The Mint box's watcher started you. PR #${pr} for ${increment} has gone red again after its fix sessions: ${why}.
${logs.length ? `The failing runs: ${logs.join(", ")}.\n` : ""}The fix sessions' logs: ${fixLogs.join(", ") || "none"}.

You are an independent reviewer, not a fixer: you did not write this pull request or its fixes, and you do not change its
branch. Work from ~/code/storytree03. Read the failing runs (\`gh run view <run> --log-failed\`, \`gh pr checks ${pr}\`),
the fix sessions' logs and the pull request's diff (\`gh pr diff ${pr}\`), and decide exactly ONE verdict:
- flake: the failure is random, and another try may pass. \`${verdict} flake --summary "<why>"\`
- elsewhere: a slow or flaky test the pull request does not own fails it. Park that test's fix as its own increment on
  ${FLAKES_ARC} (\`pnpm storytree arc increment new --arc ${FLAKES_ARC} …\`, capabilities list empty), never loosening it
  inside this pull request, then \`${verdict} elsewhere --summary "<why>" --parked <increment>\`
- fix: a bug in the pull request that a session can fix. \`${verdict} fix --summary "<what is broken and where>"\`; your
  summary is the next fix session's brief.
- owner: only the owner can unblock it (a decision, access, a spend). Raise the question on ${increment}'s arc${closed ? "" : `, holding it
  (\`pnpm storytree question new --arc <arc> … --hold ${increment}\`)`}, written so he can answer it cold, then
  \`${verdict} owner --summary "<why>" --question <question>\`
The watcher acts on the verdict you record; record it once, then \`pnpm storytree session close-out --safe yes --why "verdict on PR #${pr} recorded"\` and end.
`;
}

/**
 * Record a review session's verdict on pull request `pr`'s hand-off in `dir` (4.37): `kind` is one of VERDICTS, with its
 * `summary`, the increment it `parked` (elsewhere) or the `question` it raised (owner). It throws when the hand-off's
 * last session is no review, or already has a verdict.
 */
export async function recordVerdict({ dir, pr, kind, summary, parked, question }) {
  if (!VERDICTS.includes(kind)) throw new Error(`a verdict is one of ${VERDICTS.join(", ")}`);
  if (kind === "owner" && !question) throw new Error("an owner verdict names the question it raised (--question <id>)");
  const record = JSON.parse(await readFile(recordPath(dir, pr), "utf8").catch(() => "null"));
  const last = record?.fixes.at(-1);
  if (!last?.review || last.verdict) throw new Error(`PR #${pr} has no review session waiting for its verdict`);
  last.verdict = { kind, summary: summary ?? "", ...(parked ? { parked } : {}), ...(question ? { question } : {}) };
  await save(dir, record);
}

/** Whether a red's failing tests, or its units when it names no test, failed before on this pull request: a repeat is not random (4.35). */
function repeats(fixes, failures) {
  if (failures.tests.length) return failures.tests.some((test) => fixes.some((fix) => fix.tests?.includes(test)));
  return failures.units.some((unit) => fixes.some((fix) => !fix.tests?.length && fix.units?.includes(unit)));
}
const named = (failures) => (failures.tests.length ? failures.tests : failures.units).join("; ");

/**
 * One look at every hand-off. MERGED: clear the wait, close the increment landed (unless it was handed over to stay
 * open), let go of the claims held for it and forget it. CLOSED: clear the wait, let go of its claims and forget it.
 * Open past HELD_DAYS since it was handed over, it is given up: back on its arc as ready work, as a conflict past its
 * limit is, its claims let go (4.23). Every end of a watch lets go of its claims (ADR-1037 D3). Red: with no fix session running and an engine slot
 * free, clear the wait and start one; once `limit` have run, put the increment on an owner wait instead. A conflict
 * with main needs a session, not the owner's call, so it gets one more fix session (4.12), and past that it is never
 * an owner wait: the hand-off is dropped and the increment goes back on its arc as ready work, its body naming the
 * pull request and its branch (4.20). A fix session whose branch moved while it ran made progress, so it counts for
 * nothing when the next red is a conflict, since a newer main made that one (4.19); `cap` sessions on one pull
 * request, counted or not, end it: past the limit as the limit does, and below it, the cap spent on reds the owner cannot
 * judge, to the owner with a friction naming any flaky tests (4.36). Past the limit, a red is no owner wait: an independent
review session (`startReview`) reads it, and its one verdict decides the next red: retried as a flake is, a fix session
that counts toward the cap, or the question it raised, which the hand-off is dropped for; a review that recorded none is
reviewed again (4.37). At the cap the increment waits on the owner with the last review's summary (4.3). A red whose failing tests all lie
 * outside what the pull request changes (`pull.failures`, from readFailures) is a flake: refreshed or rerun, never fixed,
 * and not counted, unless a test of it failed before on the pull request (4.34, 4.35). A fix
 * session refused by another's claim counts for nothing (4.14). Its retry waits until the session its refusal named
 * holds no claim on the noticeboard; a refusal that named none waits `backoff` after it and for no other fix session to run (4.14).
 * Conflicts are merged one at a time, lowest pull request first: siblings that conflict on one file would refuse
 * each other's claims if their merge sessions ran together (4.15). A hand-off on an increment that had already
 * closed has no wait to clear and nothing to close, and past its limit is only said (4.13). A red only the runner
 * caused (`pull.runner`, from runnerReruns) is rerun instead of fixed, bounded by its runs' attempts (4.29). A stranded
 * one (green and unheld, out of the merge queue) is enqueued at its head, as automerge would, once a head and a refusal
 * tried at most ENQUEUE_TRIES times (4.31). A look that saw any merge reads every story's risk reading again, once, from
 * main (`readRisks`), and says the readings that changed since the last (4.33). A hand-off made before its project's
 * repository cut-over (`cutover`, its time) is the old repository's pull request, whose number now names another: it is
 * never looked up, only forgotten, its wait cleared and its claims let go (4.39).
 */
export async function watchOnce({ dir, look, storytree, cutover = async () => undefined, startFix, startReview, rerun, refresh, behind, enqueue, alive, room, readRisks, limit, cap = 6, backoff = 15 * 60_000, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  // A step the library refuses (a wait already cleared, an increment closed by hand) is said, not retried forever.
  const tell = (args, project) => storytree(args, project).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${error.message.split("\n")[0]}`); return ""; });
  // The claims held for a pull request end with its watch (ADR-1037 D1, D3).
  const letGo = (pr, reason) => tell(["workspace", "let-go", String(pr), "--reason", reason]);
  // A pull request given up goes back on its arc as ready work, its body naming the pull request and its branch, never to the owner (4.20, 4.23).
  const backOnArc = async (record, pull, why) => {
    const { pr, increment } = record;
    if (!record.closed) {
      const body = (await tell(["library", "read", increment, "--field", "body"])).trimEnd();
      const residue = join(dir, `${pr}-residue.md`);
      await writeFile(residue, `${body ? `${body}\n\n` : ""}**Back from the watcher, ${new Date(now()).toISOString().slice(0, 10)}.** PR #${pr}`
        + ` (branch \`${pull.branch ?? "unknown"}\`) ${why}${record.fixes.length ? ` (fix sessions' logs: ${record.fixes.map((fix) => fix.log).join(", ")})` : ""}.`
        + ` Take that branch, merge origin/main, resolve what is in the way,`
        + ` see \`pnpm gate\` green, push, and hand PR #${pr} to the watcher again.\n`);
      await tell(["arc", "increment", "edit", increment, "--body", `@${residue}`]);
      await rm(residue, { force: true });
      await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
    }
    await letGo(pr, `PR #${pr} ${why}; released by the watcher`);
    await rm(recordPath(dir, pr), { force: true });
  };
  // A red retried with no model session: main merged into its branch when main has moved, else its failed runs rerun,
  // recorded as a flake that counts nothing against the limit (4.34); false, said, when neither was taken.
  const retry = async (record, pull) => {
    const { pr } = record, failures = pull.failures;
    let by;
    try {
      if (!refresh) throw new Error("no refresh");
      await refresh(pr, pull.head);
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
    record.fixes.push({ at: new Date(now()).toISOString(), head: pull.head, flake: true, by, units: failures?.units ?? [], tests: failures?.tests ?? [], runs: failures?.key });
    await save(dir, record);
    return true;
  };
  const all = await records(dir);
  // The sessions running at this look, by pull request, and whether each is merging a conflict with main or reviewing.
  const running = new Map();
  for (const record of all) if (record.fixing && await alive(record.fixing.pid)) running.set(record.pr, { conflict: record.fixes.at(-1)?.conflict ?? false, review: record.fixes.at(-1)?.review ?? false });
  // A review session claims nothing, so it never holds back a refused fix session's retry (4.14).
  const fixing = () => [...running.values()].some((one) => !one.review);
  // The noticeboard, read once a look and only when a refusal named its holder.
  let board;
  const holds = async (session) => (board ??= await tell(["noticeboard"])).split("\n").some((line) => /^\s*- (?:increment|capability) /.test(line) && line.includes(` ${session} `));
  let merged = false;
  // Each project's repository cut-over, read once a look and only when a hand-off is watched.
  const cutovers = new Map();
  const cutoverOf = async (project) => {
    if (!cutovers.has(project?.folder)) cutovers.set(project?.folder, Date.parse(await cutover(project).catch(() => undefined) ?? ""));
    return cutovers.get(project?.folder);
  };
  for (const record of all) {
    const { pr, increment } = record;
    if (Date.parse(record.handedAt) < await cutoverOf(record.project)) {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"], record.project);
      await letGo(pr, `PR #${pr} was handed over before the repository cut-over; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr}: handed over before the repository cut-over, so its number is the old repository's: no longer watched, and ${increment} no longer waits on it`);
      continue;
    }
    let pull;
    try { pull = await look(pr, record); }
    catch (error) { dated(`PR #${pr}: could not read it (${error.message.split("\n")[0]}); looking again next time`); continue; }
    if (pull.state === "foreign") {
      // A fork's pull request, or one GitHub no longer says the head of, is never landed, closed on or fixed (4.32).
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      await letGo(pr, `PR #${pr}'s head is not on ${HOME}; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr}: its head is not on ${HOME}, or GitHub did not say where it is: no longer watched, and ${increment} no longer waits on it`);
      continue;
    }
    if (pull.state === "merged" || pull.state === "closed") {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      if (pull.state === "merged") {
        merged = true;
        if (!record.keepOpen && !record.closed) await tell(["arc", "increment", "close", increment, "--disposition", "landed", "--pr", String(pr)]);
        await letGo(pr, `PR #${pr} merged; released by the watcher`);
        dated(record.closed ? `PR #${pr} merged: ${increment} had already closed`
          : record.keepOpen ? `PR #${pr} merged: ${increment} stays open for its next pull request` : `PR #${pr} merged: closed ${increment}`);
      } else {
        await letGo(pr, `PR #${pr} closed without merging; released by the watcher`);
        dated(`PR #${pr} closed without merging: ${increment} no longer waits on it`);
      }
      await rm(recordPath(dir, pr), { force: true });
      continue;
    }
    if (running.has(pr)) continue;
    if (pull.state === "security") {
      // A failed security check is the owner's: one question on the increment's arc naming only the pull request and
      // the check, holding the increment while it is open, and no fix session, log or alert text (4.41).
      const checks = pull.checks.join(", ");
      const arc = (await tell(["library", "read", increment, "--field", "arc"], record.project)).trim() || RELEASE_ARC;
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"], record.project);
      await tell(["question", "new", "--arc", arc, "--title", `PR #${pr} failed a security check (${checks})`,
        "--stakes", `PR #${pr} cannot land until it passes, and the watcher starts no fix session for it, since a fix session's commits and pull request are public.`,
        "--statement", `PR #${pr} (${increment}) failed the security check ${checks}. What should be done about it?`,
        "--context", `The Mint watcher reads ${checks} as a security check (4.41): it puts no log or alert text anywhere and asks you instead. Read the check on GitHub, signed in.`,
        "--options", "A. Fix it yourself, privately, then hand the pull request to the watcher again. B. Judge it a false alarm, dismiss it on GitHub and hand it over again. C. Close the pull request.",
        ...(record.closed ? [] : ["--hold", increment])], record.project);
      await letGo(pr, `PR #${pr} failed a security check, which is the owner's; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} failed the security check ${checks}: asked the owner on ${arc}, with no fix session`);
      continue;
    }
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
    // A red only the runner caused is rerun with no model session while its runs are below RUNNER_ATTEMPTS (4.29). A
    // refused rerun is looked at again first, since rerun-unrun.yml may have rerun it; refused twice on one attempt, it goes on as any red.
    if (pull.runner && rerun) {
      const key = pull.runner.runs.map((one) => `${one.id}:${one.attempt}`).join(",");
      if (record.rerunRefused !== key) {
        try {
          for (const one of pull.runner.runs) {
            await rerun(one);
            // Recorded as its reruns of main and release runs are, since GitHub names the owner as every rerun's actor (4.27).
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
    // A red whose failing tests all lie outside what the pull request changes, none of them failed before on it, is a
    // flake: main is merged into its branch when main has moved, else its failed runs are rerun, with no model session
    // and nothing counted against the limit; until that refresh's run starts, a look sees the same runs and waits (4.34, 4.35).
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
      await letGo(pr, `PR #${pr} still red after ${record.fixes.length} sessions; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red after ${record.fixes.length} sessions, and ${increment} had already closed, so nothing can wait on the owner: ${pull.why}`);
      continue;
    }
    if (spent && pull.conflict) {
      await backOnArc(record, pull, `still conflicts with main after ${record.fixes.length} fix sessions`);
      dated(`PR #${pr} still conflicts with main after ${record.fixes.length} fix sessions: ${increment} is back on its arc as ready work`);
      continue;
    }
    if (record.fixes.length >= cap) {
      // The cap on all sessions, fix and review together, is spent: the owner gets it with the last review's summary,
      // never the arc, whose pool would start it over with a fresh count (4.3, 4.36).
      const flaky = [...new Set(record.fixes.filter((fix) => fix.flake).flatMap((fix) => fix.tests?.length ? fix.tests : fix.units ?? []))];
      const review = record.fixes.findLast((fix) => fix.review && fix.verdict)?.verdict;
      if (flaky.length) {
        await tell(["friction", "new", "--title", `Flaky tests kept PR #${pr} red past the watcher's cap`,
          "--description", `The watcher retried PR #${pr} ${record.fixes.filter((fix) => fix.flake).length} times for reds it judged random, and gave it to the owner at its cap.`,
          "--statement", "Tests outside a pull request's reach failed it at random, so it could not land.",
          "--evidence", `PR #${pr} (${increment}) failed on: ${flaky.join("; ")}.`,
          "--impact", `PR #${pr} waits on the owner instead of landing; the Windows-flakes arc can take these tests.`]);
      }
      await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      await letGo(pr, `PR #${pr} still red after ${record.fixes.length} sessions; released by the watcher`);
      await storytree(["arc", "increment", "wait", increment, "--for", "owner", "--note",
        `PR #${pr} is still red after ${record.fixes.length} sessions, the most the watcher starts for one pull request (${counted} fix sessions counted): ${pull.why}.`
        + `${pull.logs.length ? ` Failing runs: ${pull.logs.join(", ")}.` : ""}`
        + ` Sessions' logs: ${record.fixes.filter((fix) => fix.log).map((fix) => fix.log).join(", ") || "none"}.`
        + (review ? ` The last review judged it "${review.kind}": ${review.summary}` : " No review ran.")
        + `${flaky.length ? ` Flaky outside it: ${flaky.join("; ")}.` : ""} Retry it (hand PR #${pr} to the watcher again), fix it yourself, or withdraw it.`]);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red after ${record.fixes.length} sessions: ${increment} waits on the owner`);
      continue;
    }
    // Past the limit, the last review's verdict decides this red; with none, a review session is started (4.37).
    const verdict = spent && last?.review ? last.verdict : undefined;
    if (verdict?.kind === "owner") {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      await letGo(pr, `PR #${pr} waits on the owner's answer to ${verdict.question}; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red: its review put it to the owner in ${verdict.question} (${verdict.summary})`);
      continue;
    }
    if (verdict?.kind === "flake" || verdict?.kind === "elsewhere") {
      if (await retry(record, pull)) dated(`PR #${pr} red, which its review judged ${verdict.kind === "flake" ? "random" : `a test elsewhere${verdict.parked ? ` (parked as ${verdict.parked})` : ""}`}: ${record.fixes.at(-1).by}`);
      continue;
    }
    const reviewing = spent && verdict?.kind !== "fix";
    if (last?.refused && (last.holder ? await holds(last.holder)
      : fixing() || now() < Date.parse(last.refusedAt ?? last.at) + backoff)) continue;
    if (pull.conflict && [...running.values()].some((one) => one.conflict)) continue;
    if (!(await room())) continue;
    // Each red it handles is a pr-red activity line in the hand-off's project, written as its fix session starts (ADR-1064 D4, 4.25).
    await tell(["workspace", "red", String(pr), "--increment", increment, ...(pull.conflict ? ["--conflict"] : []),
      ...(pull.checks ?? []).flatMap((check) => ["--check", check])], record.project);
    if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
    const n = record.fixes.length + 1;
    const fixLogs = record.fixes.filter((one) => one.log && !one.review).map((one) => one.log);
    // How far its branch is behind main, read at the head judged red; a reading that fails says nothing and stops nothing (4.38).
    const lag = !reviewing && behind ? await behind(pull.head).catch(() => undefined) : undefined;
    const session = reviewing
      ? await startReview({ pr, increment, n, brief: reviewBrief({ pr, increment, why: pull.why, logs: pull.logs, fixLogs, n, cap, closed: record.closed }) })
      : await startFix({ pr, increment, n, brief: fixBrief({ pr, increment, why: pull.why, logs: pull.logs, n: counted + 1, limit: allowed, keepOpen: record.keepOpen, closed: record.closed,
        review: verdict?.summary, lag }) });
    record.fixing = { pid: session.pid };
    record.fixes.push({ at: new Date(now()).toISOString(), head: pull.head, pid: session.pid, log: session.log, ...(reviewing ? { review: true } : {}),
      ...(pull.conflict ? { conflict: true } : {}), ...(failures && !reviewing ? { units: failures.units, tests: failures.tests } : {}) });
    running.set(pr, { conflict: Boolean(pull.conflict), review: reviewing });
    await save(dir, record);
    dated(reviewing ? `PR #${pr} red (${pull.why}) past its ${allowed} fix sessions: review session started, log ${session.log}`
      : `PR #${pr} red (${pull.why}): fix session ${counted + 1}${verdict ? ", after its review," : ` of ${allowed}`} started, log ${session.log}`);
  }
  if (merged && readRisks) await refreshRisks({ dir, readRisks, dated });
}

/**
 * Every story's standing risk reading, read again from main after a merge (4.33): `readRisks` runs `quality
 * story-risks` there and returns what it printed, one line a story. The lines that differ from the last reading's,
 * kept in `dir`, are said; a reading that fails is said and tried again at the next merge.
 */
async function refreshRisks({ dir, readRisks, dated }) {
  const lines = (text) => new Map(text.split("\n").filter((line) => /^\s+story_\w+\s/.test(line)).map((line) => [line.trim().split(/\s/)[0], line.trim()]));
  let text;
  try { text = await readRisks(); }
  catch (error) { dated(`story risk readings: reading main failed (${error.message.split("\n")[0]}); reading again at the next merge`); return; }
  const kept = join(dir, "story-risks.txt");
  const last = lines(await readFile(kept, "utf8").catch(() => ""));
  const changed = [...lines(text)].filter(([id, line]) => last.get(id) !== line).map(([, line]) => line);
  await writeFile(kept, text);
  dated(changed.length ? `story risk readings read from main; ${changed.length} changed:\n  ${changed.join("\n  ")}` : "story risk readings read from main; none changed");
}

/** Start the watcher unless a live one holds its pid file; `spawn` starts it and returns its pid, written at once. */
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

/** The ssh command that runs the watcher's `args` on the pool's machine, in its checkout as configured there. */
export function remoteCommand(config, args) {
  return ["ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", config.machine,
    `cd ${config.remoteCheckout} && node packages/agent-pool/src/watch.mjs ${args.join(" ")}`]];
}

/** The nearest storytree marker at or above `folder`: its folder and the project it names, or nothing. */
async function markerAt(folder) {
  for (let at = resolve(folder); ; at = dirname(at)) {
    const text = await readFile(join(at, ".storytree.json"), "utf8").catch(() => undefined);
    if (text !== undefined) { try { return { folder: at, name: JSON.parse(text).project }; } catch { return undefined; } }
    if (dirname(at) === at) return undefined;
  }
}

/**
 * The project a hand-off from `cwd` belongs to when it is not the watcher's own (4.25): the nearest marker's folder,
 * and the storytree `home` it ran under, so an experiment arm's reds land in its throwaway library. The repository's own project is nothing.
 */
export async function projectOf({ cwd, repo, home }) {
  const here = await markerAt(cwd);
  if (!here?.name || here.name === (await markerAt(repo))?.name) return undefined;
  return { folder: here.folder, home };
}

/** The box's paths, limits and processes, from the pool's configuration (pool-config.mjs). */
function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const config = poolConfig({ home, env });
  const { lanesDir, checkout: repo } = config;
  const dir = join(lanesDir, "watch");
  const script = fileURLToPath(import.meta.url);
  // The watcher and its fix sessions belong to no agent session: they outlive the one that handed over.
  const free = { ...env };
  const onBox = existsSync(join(lanesDir, "run-lane.sh"));
  const own = join(repo, "packages", "agent-pool", "src", "watch.mjs");
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete free[name];
  const detached = (args, log, cwd) => {
    const out = openSync(log, "a");
    const child = spawnChild(process.execPath, args, { cwd, env: free, detached: true, stdio: ["ignore", out, out] });
    child.unref();
    return child.pid;
  };
  // The command line routes by its folder's marker: a hand-off's own project runs it there, under its own home (4.25).
  const storytree = async (args, project) => (project
    ? await run(process.execPath, ["--import", import.meta.resolve("tsx"), join(repo, "packages", "cli", "src", "bins", "storytree.ts"), ...args],
      { cwd: project.folder, env: { ...env, STORYTREE_HOME: project.home }, maxBuffer: 16 * 1024 * 1024 })
    : await run("pnpm", ["-s", "storytree", ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout;
  return {
    lanesDir, repo, dir, pidFile: join(dir, "watch.pid"), loopPidFile: join(dir, "watch-loop.pid"), argsOf,
    // The one log every start of the watcher writes, whether a hand-over starts it or the box's owner does (4.28).
    log: join(lanesDir, "watch.runner.log"),
    limit: config.watcher.fixesPerRed, cap: config.watcher.fixesPerPullRequest, intervalMs: config.watcher.intervalMs, now: Date.now,
    session: env.CLAUDE_CODE_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim() || "",
    storytree,
    project: () => projectOf({ cwd: process.cwd(), repo, home: env.STORYTREE_HOME || join(home, ".storytree", "0.3") }),
    // The time of a project's repository cut-over, or nothing while it has none (the read refuses).
    cutover: async (project) => (await storytree(["library", "read", "pr-cutover", "--field", "at"], project)).trim(),
    look: (pr, record) => lookOnGitHub(pr, { repo, since: record.fixes.at(-1)?.at ?? record.handedAt }),
    // From a checkout of freshly fetched origin/main kept in the watch folder, locked so no reaper takes it, never a merged branch's worktree (4.33).
    readRisks: async () => {
      const main = join(dir, "main");
      await run("git", ["fetch", "--quiet", "origin", "main"], { cwd: repo });
      if (existsSync(main)) await run("git", ["checkout", "--quiet", "--force", "--detach", "origin/main"], { cwd: main });
      else {
        await run("git", ["worktree", "prune"], { cwd: repo });
        await run("git", ["worktree", "add", "--quiet", "--lock", "--detach", main, "origin/main"], { cwd: repo });
      }
      return (await run(process.execPath, ["--import", import.meta.resolve("tsx"), join(repo, "packages", "cli", "src", "bins", "storytree.ts"), "quality", "story-risks"],
        { cwd: main, env: free, maxBuffer: 16 * 1024 * 1024 })).stdout;
    },
    viewOf: async (pr) => JSON.parse((await run("gh", ["pr", "view", String(pr), ...VIEW], { cwd: repo })).stdout),
    // Off the box, where the shared checkout may not exist (a cloud container), the hand-over's library writes and its
    // branch are read from the folder it runs in: the pull request's branch from GitHub, else the folder's own (4.30).
    here: async (args) => (await run("pnpm", ["-s", "storytree", ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout,
    ownViewOf: async (pr) => JSON.parse((await run("gh", ["pr", "view", String(pr), ...VIEW])).stdout),
    ownBranchOf: async () => (await run("git", ["branch", "--show-current"])).stdout.trim().replace(/^(main|master)$/, ""),
    alive: async (pid) => isFixSession(await argsOf(pid)),
    room: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout)
      < await readCap({ lanesDir, sessions: config.sessions }),
    startFix: async ({ pr, n, brief }) => {
      const base = join(dir, `fix-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached([join(script, "..", "runner.mjs"), "run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs], `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
    startReview: async ({ pr, n, brief }) => {
      const base = join(dir, `review-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached([join(script, "..", "runner.mjs"), "run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs], `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
    // Started from the shared checkout's copy, whichever worktree handed over, so it runs the code it watches for changes.
    startWatcher: (log) => detached([own, "run"], log, repo),
    codeVersion: () => codeVersion({ repo, paths: WATCH_CODE }),
    loop: () => new Promise((ended) => {
      const child = spawnChild(process.execPath, [own, "watch"], { cwd: repo, env: free, stdio: "inherit" });
      child.once("error", () => ended(1));
      child.once("exit", (code) => ended(code ?? 1));
    }),
    // The box is the machine whose lanes folder has the lane runner; any other reaches it over ssh as the configured machine.
    onBox,
    remote: async (args) => {
      if (!config.machine) throw new Error("the agent pool's configuration names no machine to hand over to");
      return (await run(...remoteCommand(config, args), { timeout: 120_000 })).stdout;
    },
    sleep: (ms) => wait(ms),
    // Only the box's watcher reads releases; a watcher a test starts under another home never reruns or alarms.
    readReleases: onBox ? () => releasesOnGitHub({ repo }) : undefined,
    // Main's changes to the owner's secret-check exemptions list, each told as an FYI once (4.42).
    readExemptions: onBox ? () => exemptionChanges({ repo,
      openerOf: async (pr) => (await run("gh", ["pr", "view", pr, "--json", "author", "--jq", ".author.login"], { cwd: repo })).stdout.trim() }) : undefined,
    exemptionRecorded: async (about) => !/^No fyi records match/.test(await storytree(["library", "list", "fyi", "--where", `about=${about}`])),
    recordExemption: (fyi) => storytree(["fyi", "new", "--by", "watcher", ...Object.entries(fyi).flatMap(([field, text]) => [`--${field}`, text])]),
    // At the head it read as green, as land.yml enqueues, with the box's signed-in token, so the queue's own run starts (4.31).
    enqueue: (id, head) => run("gh", ["api", "graphql", "-f", `id=${id}`, "-f", `sha=${head}`, "-f",
      "query=mutation($id: ID!, $sha: GitObjectID!) { enqueuePullRequest(input: {pullRequestId: $id, expectedHeadOid: $sha}) { mergeQueueEntry { position } } }"], { cwd: repo }),
    // Main merged into a flaky pull request's branch at the head it read, as GitHub's update-branch does, only when main has moved past it (4.34).
    refresh: async (pr, head) => {
      const behind = Number((await run("gh", ["api", `${REPO}/compare/main...${head}`, "--jq", ".behind_by"], { cwd: repo })).stdout.trim());
      if (!(behind > 0)) throw new Error("its branch is up to date with main");
      await run("gh", ["api", "-X", "PUT", `${REPO}/pulls/${pr}/update-branch`, "-f", `expected_head_sha=${head}`], { cwd: repo });
    },
    // The commits main has that the head lacks, oldest first as GitHub lists them (4.38).
    behind: async (head) => JSON.parse((await run("gh", ["api", `${REPO}/compare/${head}...main`, "--jq", "{count: .ahead_by, subjects: [.commits[].commit.message | split(\"\\n\")[0]]}"], { cwd: repo })).stdout),
    // Its failed and cancelled jobs; a run with nothing left to rerun that way is rerun whole.
    rerun: (one) => run("gh", ["run", "rerun", String(one.id), "--failed"], { cwd: repo })
      .catch(() => run("gh", ["run", "rerun", String(one.id)], { cwd: repo })),
    tail: async (one) => (await run("gh", ["run", "view", String(one.id), "--log-failed"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }))
      .stdout.trimEnd().split("\n").slice(-30).join("\n"),
    questionOpen: async (id) => !/, (settled|retired)\b/.test((await run("pnpm", ["-s", "storytree", "question", "show", id], { cwd: repo })).stdout.split("\n")[1] ?? ""),
    raise: async (question) => {
      const { stdout } = await run("pnpm", ["-s", "storytree", "question", "new", "--arc", RELEASE_ARC,
        ...Object.entries(question).flatMap(([field, text]) => [`--${field}`, text])], { cwd: repo });
      return /question_\w+/.exec(stdout)?.[0] ?? "a question";
    },
    startReleaseFix: async ({ n, brief }) => {
      const base = join(dir, `release-fix-${Date.now()}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached([join(script, "..", "runner.mjs"), "run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs], `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
  };
}

/** `handover <pr> <increment> [--keep-open]`, `hand <pr> <increment> [--session <id>] [--keep-open]`, `forget`, `run` or `status`; `box` overrides the box's home, paths and processes in tests. */
export async function main(args, box = {}) {
  const defaults = boxDefaults({ home: box.home, env: box.env });
  const b = { ...defaults, ...box };
  // The box's releases are its own folder's: a loop given another folder (a test on the box) would keep its stop
  // there, forget it each run and start the box a real fix session every time, unless it brings its own reader.
  if (!box.readReleases && b.dir !== defaults.dir) b.readReleases = undefined;
  // Likewise its FYIs: a loop given another folder would tell the real library about main's changes.
  if (!box.readExemptions && b.dir !== defaults.dir) b.readExemptions = undefined;
  const out = b.out ?? console.log;
  const keepOpen = args.includes("--keep-open"), refused = args.includes("--refused");
  if (args[0] === "handover" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    // A fork's pull request is refused here (4.32); one GitHub cannot be asked about from here is checked by the box, which refuses it too.
    const view = await b.ownViewOf(Number(args[1])).catch(() => undefined);
    let branch;
    if (view !== undefined) {
      try { branch = ownBranch(args[1], view); } catch (error) { out(error.message); return 1; }
    }
    const { code, lines } = await handOver({ pr: Number(args[1]), increment: args[2], session: b.session, keepOpen, onBox: b.onBox,
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
    let branch;
    try { branch = ownBranch(args[1], await b.viewOf(Number(args[1])).catch(() => undefined)); } catch (error) { out(error.message); return 1; }
    const project = await b.project();
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
  if (args[0] === "release-fix" && /^--(pr|question)$/.test(args[1] ?? "") && args[2]) {
    const recorded = await recordFix({ dir: b.dir, ...(args[1] === "--pr" ? { pr: Number(args[2]) } : { question: args[2] }) });
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
    // 4.21: a look loop on code other than the checkout's shows, even one older than the version it records.
    const loopPid = (await readFile(b.loopPidFile, "utf8").catch(() => "")).trim();
    if (loopPid && LOOP_MARKS[0].test(await b.argsOf(loopPid))) {
      const [by, began] = (await readFile(versionPath(b.dir), "utf8").catch(() => "")).trim().split(" ");
      const current = await Promise.resolve().then(b.codeVersion).catch(() => undefined);
      out(`look loop: running (pid ${loopPid}) ${by !== loopPid || !began ? "on code of unknown version (it records none): restart the watcher"
        : began === current ? `on the checkout's code (${began})` : `on stale code: ${began}, while the checkout has ${current ?? "an unreadable version"}`}`);
    } else out("look loop: not running");
    for (const record of found) out(`PR #${record.pr} ${record.increment}: handed ${record.handedAt}, ${record.fixes.length} fix sessions${record.fixing ? `, one running (pid ${record.fixing.pid})` : ""}`);
    if (!found.length) out("no hand-offs");
    return 0;
  }
  if (args[0] !== "run" && args[0] !== "watch") { out(`usage: watch.mjs handover <pr> <increment> [--keep-open] | hand <pr> <increment> [--session <id>] [--keep-open] [--refused [--holder <session>]] | verdict <pr> ${VERDICTS.join("|")} --summary <text> | release-fix --pr <n> | --question <id> | forget | run | status`); return 2; }
  const say = b.say ?? ((line) => out(line));
  const dated = (message) => say(`${new Date(b.now()).toISOString()} ${message}`);
  if (args[0] === "run") {
    // The keeper: it holds the watcher's pid file and starts the look loop again whenever it ends, at once on a restart.
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
  for (;;) {
    // Between looks, never in one: a fix session it started runs on, and its hand-off on disk keeps the count.
    const current = began && await version();
    if (current && current !== began) { dated(`dev loop code changed (${began} → ${current}): restarting`); return RESTART; }
    try { await adoptRequests({ ...b, say }); }
    catch (error) { dated(`reading the library's hand-overs failed: ${error.message.split("\n")[0]}`); }
    try { await watchOnce({ ...b, say }); }
    catch (error) { dated(`look failed: ${error.message.split("\n")[0]}`); }
    if (b.readReleases && b.now() - releasesAt >= RELEASE_EVERY_MS) {
      releasesAt = b.now();
      try { await watchReleases({ ...b, startFix: b.startReleaseFix, say }); }
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
