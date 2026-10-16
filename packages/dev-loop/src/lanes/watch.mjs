// Capability 13 · A watcher lands a handed-over pull request (ADR-0955 D3). A Mint session ends once its pull request
// is open and its gate is green, and hands the pull request here; this script, not a model, watches CI and the merge
// queue: on MERGED it closes the increment and releases the session's claims, on a red it starts one fix session.
// node packages/dev-loop/src/lanes/watch.mjs hand <pr> <increment> [--session <id>] [--keep-open] [--refused [--holder <session>]]   (records it and starts the watcher)
// node packages/dev-loop/src/lanes/watch.mjs handover <pr> <increment> [--keep-open]               (from any machine: `hand` on the box, else over ssh)
// --keep-open: one of several pull requests for its increment, so on MERGED the watcher leaves the increment open (13.11).
// --refused: a fix session hands back untouched because a claim refused it, so it does not count against the limit (13.14);
// --holder names the session the refusal said holds the work, and the retry waits until that session holds no claim (13.14).
// node packages/dev-loop/src/lanes/watch.mjs run                                     (the watcher: one per box; keeps `watch` running)
// node packages/dev-loop/src/lanes/watch.mjs watch                                   (its look loop, which `run` starts; exits 3 on its own code change)
// node packages/dev-loop/src/lanes/watch.mjs status
// node packages/dev-loop/src/lanes/watch.mjs release-fix --pr <n> | --question <id>   (a release fix session records what it left; release-watch.mjs)
import { execFile, spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig } from "./pool-config.mjs";
import { codeVersion, countEngines, holdRunner } from "./queue.mjs";
import { attempted, failedJob, judgeReleases, recordFix, RELEASE_ARC, RELEASE_EVERY_MS, watchReleases } from "./release-watch.mjs";

/**
 * The code the watcher runs (13.10, ADR-0981 D3): what watch.mjs loads and what the fix sessions it starts load
 * (runner.mjs and its engine.mjs; their brief is written here). A change to one of these restarts the look loop; a
 * change anywhere else in the dev loop leaves it looking. When one of these files comes to import another file, name
 * that file here; the pool's configuration, read once at start, is here too.
 */
export const WATCH_CODE = [...["watch.mjs", "release-watch.mjs", "queue.mjs", "runner.mjs", "engine.mjs", "pool-config.mjs"]
  .map((name) => `packages/dev-loop/src/lanes/${name}`), "agent-pool.json"];

const run = promisify(execFile);
const RED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
// The queue's removals that the Requeue workflow puts back once; one it left out past its grace is red.
const EJECTED = new Set(["FAILED_CHECKS", "BRANCH_PROTECTION_FAILURE"]);
const MARKS = [/watch\.mjs run( |$)/];
const LOOP_MARKS = [/watch\.mjs watch( |$)/];
/** The look loop's exit when the dev loop's code in the shared checkout changed: `run` starts it again, on the new code. */
export const RESTART = 3;
/** How long a handed-over pull request holds its claims while open: then it is given up and its increment is back on its arc (ADR-1037 D3, 13.23). Its event wait checks back then too. */
const HELD_DAYS = 3;
const HELD_MS = HELD_DAYS * 86_400_000;

/**
 * A pull request, as GitHub's GraphQL returns it, read as merged, closed, red or pending. Red is a failed check on
 * its head, a conflict with main (no check fails on one, so it would otherwise wait out its check-back), or a removal
 * from the merge queue after `since` that the Requeue workflow has not undone in `graceMs`. A conflict is marked as
 * one whatever else failed: a conflict often fails the landing check too, and it still needs a merge (13.18).
 */
export function readPull(pull, { since, now, graceMs }) {
  const head = pull.headRefOid;
  if (pull.state === "MERGED") return { state: "merged", head };
  if (pull.state === "CLOSED") return { state: "closed", head };
  const checks = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const failed = checks.filter((check) => RED.has(check.conclusion ?? check.state));
  const why = failed.map((check) => `${check.name ?? check.context} failed`).join("; ");
  const logs = failed.map((check) => check.detailsUrl ?? check.targetUrl).filter(Boolean);
  const names = failed.map((check) => check.name ?? check.context).filter(Boolean);
  if (pull.mergeable === "CONFLICTING") {
    return { state: "red", head, why: `it conflicts with main: merge origin/main and resolve the conflicts${why ? `; also ${why}` : ""}`, logs,
      checks: names, conflict: true, branch: pull.headRefName };
  }
  if (failed.length) return { state: "red", head, why, logs, checks: names };
  const removal = pull.timelineItems?.nodes?.at(-1);
  const removedAt = Date.parse(removal?.createdAt);
  if (!pull.mergeQueueEntry && EJECTED.has(removal?.reason?.toUpperCase()) && removedAt > Date.parse(since) && now - removedAt > graceMs) {
    return { state: "red", head, why: `the merge queue removed it (${removal.reason}) and did not take it back`, logs: [], checks: [] };
  }
  return { state: "pending", head };
}

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state headRefOid headRefName mergeable mergeQueueEntry { state }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
  timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT], last: 1) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } }
} } }`;

/** One pull request from GitHub through `gh`, the box's signed-in GitHub command line. */
export async function lookOnGitHub(pr, { repo, since, now = Date.now, graceMs = 10 * 60_000 }) {
  const { stdout } = await run("gh", ["api", "graphql", "-f", "owner=storytree-ai", "-f", "name=storytree", "-F", `pr=${pr}`, "-f", `query=${QUERY}`],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  return readPull(JSON.parse(stdout).data.repository.pullRequest, { since, now: now(), graceMs });
}

const REPO = "repos/storytree-ai/storytree";
const ghJson = async (repo, path) => JSON.parse((await run("gh", ["api", path], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout);
const jobsSeen = new Map();
/** A run's jobs as { name, conclusion, steps }; a completed attempt's never change, so they are read once. */
async function jobsOf(repo, run) {
  const key = `${run.id}:${run.run_attempt}`;
  if (jobsSeen.has(key)) return jobsSeen.get(key);
  const jobs = (await ghJson(repo, `${REPO}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs
    .map((job) => ({ name: job.name, conclusion: job.conclusion, steps: job.steps?.length ?? 0 }));
  if (run.status === "completed") jobsSeen.set(key, jobs);
  return jobs;
}
const asRun = (run, jobs) => ({ id: run.id, sha: run.head_sha, created: run.created_at, updated: run.updated_at, status: run.status,
  conclusion: run.conclusion, attempt: run.run_attempt, url: run.html_url, job: jobs && failedJob(jobs) });

/** The latest published release, the release runs since it that attempted one, and main's push CI runs, judged (13.16). */
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
  return { release, ...judgeReleases({ release, attempts, main: main.map((run, i) => asRun(run, i === 0 ? head : undefined)), now: now() }) };
}

const recordPath = (dir, pr) => join(dir, `${pr}.json`);
/** The look loop's pid and the code version it started on, for `status` (13.21). */
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
 * refused, so it does not count against the limit, with the `holder` its refusal named, if any, and when (13.14).
 * An increment that already closed (on an earlier pull request of a stack) waits for nothing, so its refusal of the
 * wait is no refusal of the hand-off: the record is marked `closed`, and the watcher still watches and fixes it (13.13).
 * The handing session's claims are held for the pull request, on its `branch`, until it merges or closes (ADR-1037 D1,
 * 13.22): its close-out then releases nothing. With no session or branch to hold them by, `held` says why none are.
 * `project` is where the hand-off's own storytree project lives when it is not the watcher's (an experiment arm's
 * throwaway library: its folder and storytree home), so the reds it records land there (ADR-1064 D4, 13.25).
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
    : (await storytree(["workspace", "hold", String(pr), "--holder", session, "--branch", branch])
      .catch((error) => `its claims could not be held (${error.message.split("\n")[0]}), so its close-out releases them`)).trim();
  await save(dir, { fixes: [], fixing: null, ...old, pr, increment, session, keepOpen, closed, ...(project ? { project } : {}), handedAt: new Date(now()).toISOString() });
  await startWatcher();
  return { closed, held };
}

/**
 * Hand a pull request over from any machine, with the handing session's own id so the watcher releases its claims:
 * on the box it is `hand`; elsewhere it runs `hand` on the box through `remote` (ssh). When the box cannot be reached
 * it refuses with the reason, and the session lands the pull request itself.
 */
export async function handOver({ pr, increment, session, keepOpen = false, onBox, local, remote }) {
  const fallback = `Wait for the merge yourself: watch \`gh pr checks ${pr}\` for MERGED, then close ${increment} with --disposition landed --pr ${pr}.`;
  if (!session) return { code: 1, lines: ["no session id (CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID): the watcher could not release this session's claims, so it is not handed over.", fallback] };
  const args = ["hand", String(pr), increment, "--session", session, ...(keepOpen ? ["--keep-open"] : [])];
  if (onBox) { await local(args); return { code: 0, lines: [] }; }
  try {
    // The box's `hand` already says how to close out, so its words are relayed as they are.
    return { code: 0, lines: [(await remote(args)).trim()].filter(Boolean) };
  } catch (error) {
    return { code: 1, lines: [`could not reach the Mint box's watcher: ${error.message.trim().split("\n").at(-1)}`, fallback] };
  }
}

function fixBrief({ pr, increment, why, logs, n, limit, keepOpen, closed }) {
  const handBack = `${pr} ${increment}${keepOpen ? " --keep-open" : ""}`;
  return `# Fix session ${n} of ${limit}: pull request #${pr} (${increment}) is red

The Mint box's watcher started you: a session opened PR #${pr} for ${increment}, saw its gate green and handed it over,
and it has since gone red: ${why}.${logs.length ? `\nThe failing runs: ${logs.join(", ")}.` : ""}

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
- Hand it back: \`node packages/dev-loop/src/lanes/watch.mjs hand ${handBack}\`, then
  \`pnpm storytree session close-out --safe yes --why "PR #${pr} fixed and handed back to the watcher"\`, and end.
- If a claim you need is refused (another session holds the increment or a capability), leave the branch alone: hand it back
  with \`node packages/dev-loop/src/lanes/watch.mjs hand ${handBack} --refused --holder <session>\`, where <session> is the
  session id the refusal names ("held by … session <id>"), close out and end. A refused session does not count against
  the limit, and the watcher starts the next one once that session holds no claim.
- If it needs the owner (a decision, a sign-in, a spend), raise the question on the increment's arc${closed ? "" : " holding the increment"}, then close out and end.
`;
}

/**
 * One look at every hand-off. MERGED: clear the wait, close the increment landed (unless it was handed over to stay
 * open), let go of the claims held for it and forget it. CLOSED: clear the wait, let go of its claims and forget it.
 * Open past HELD_DAYS since it was handed over, it is given up: back on its arc as ready work, as a conflict past its
 * limit is, its claims let go (13.23). Every end of a watch lets go of its claims (ADR-1037 D3). Red: with no fix session running and an engine slot
 * free, clear the wait and start one; once `limit` have run, put the increment on an owner wait instead. A conflict
 * with main needs a session, not the owner's call, so it gets one more fix session (13.12), and past that it is never
 * an owner wait: the hand-off is dropped and the increment goes back on its arc as ready work, its body naming the
 * pull request and its branch (13.20). A fix session whose branch moved while it ran made progress, so it counts for
 * nothing when the next red is a conflict, since a newer main made that one (13.19); `cap` sessions on one pull
 * request, counted or not, end it as the limit does. A fix
 * session refused by another's claim counts for nothing (13.14). Its retry waits until the session its refusal named
 * holds no claim on the noticeboard; a refusal that named none waits `backoff` after it and for no other fix session to run (13.14).
 * Conflicts are merged one at a time, lowest pull request first: siblings that conflict on one file would refuse
 * each other's claims if their merge sessions ran together (13.15). A hand-off on an increment that had already
 * closed has no wait to clear and nothing to close, and past its limit is only said (13.13).
 */
export async function watchOnce({ dir, look, storytree, startFix, alive, room, limit, cap = 6, backoff = 15 * 60_000, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  // A step the library refuses (a wait already cleared, an increment closed by hand) is said, not retried forever.
  const tell = (args, project) => storytree(args, project).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${error.message.split("\n")[0]}`); return ""; });
  // The claims held for a pull request end with its watch (ADR-1037 D1, D3).
  const letGo = (pr, reason) => tell(["workspace", "let-go", String(pr), "--reason", reason]);
  // A pull request given up goes back on its arc as ready work, its body naming the pull request and its branch, never to the owner (13.20, 13.23).
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
  const all = await records(dir);
  // The fix sessions running at this look, by pull request, and whether each is merging a conflict with main.
  const running = new Map();
  for (const record of all) if (record.fixing && await alive(record.fixing.pid)) running.set(record.pr, record.fixes.at(-1)?.conflict ?? false);
  // The noticeboard, read once a look and only when a refusal named its holder.
  let board;
  const holds = async (session) => (board ??= await tell(["noticeboard"])).split("\n").some((line) => /^\s*- (?:increment|capability) /.test(line) && line.includes(` ${session} `));
  for (const record of all) {
    const { pr, increment } = record;
    let pull;
    try { pull = await look(pr, record); }
    catch (error) { dated(`PR #${pr}: could not read it (${error.message.split("\n")[0]}); looking again next time`); continue; }
    if (pull.state === "merged" || pull.state === "closed") {
      if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      if (pull.state === "merged") {
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
    if (record.fixing) { record.fixing = null; await save(dir, record); }
    if (now() - Date.parse(record.handedAt) > HELD_MS) {
      await backOnArc(record, pull, `has been open for ${HELD_DAYS} days since it was handed over`);
      dated(`PR #${pr} open past ${HELD_DAYS} days: its claims are released and ${increment} is back on its arc as ready work`);
      continue;
    }
    if (pull.state !== "red") continue;
    const allowed = pull.conflict ? limit + 1 : limit;
    const last = record.fixes.at(-1);
    if (pull.conflict && last && !last.refused && !last.moved && last.head && last.head !== pull.head) {
      last.moved = true;
      await save(dir, record);
    }
    const counted = record.fixes.filter((fix) => !fix.refused && !fix.moved).length;
    const spent = counted >= allowed || record.fixes.length >= cap;
    if (spent && record.closed) {
      await letGo(pr, `PR #${pr} still red after ${record.fixes.length} fix sessions; released by the watcher`);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red after ${record.fixes.length} fix sessions, and ${increment} had already closed, so nothing can wait on the owner: ${pull.why}`);
      continue;
    }
    if (spent && pull.conflict) {
      await backOnArc(record, pull, `still conflicts with main after ${record.fixes.length} fix sessions`);
      dated(`PR #${pr} still conflicts with main after ${record.fixes.length} fix sessions: ${increment} is back on its arc as ready work`);
      continue;
    }
    if (spent) {
      await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      await letGo(pr, `PR #${pr} still red after ${counted} fix sessions; released by the watcher`);
      await storytree(["arc", "increment", "wait", increment, "--for", "owner", "--note",
        `PR #${pr} is still red after ${counted} fix sessions: ${pull.why}.${pull.logs.length ? ` Failing runs: ${pull.logs.join(", ")}.` : ""}`
        + ` Fix sessions' logs: ${record.fixes.map((fix) => fix.log).join(", ")}.`]);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red after ${counted} fix sessions: ${increment} waits on the owner`);
      continue;
    }
    if (last?.refused && (last.holder ? await holds(last.holder)
      : running.size || now() < Date.parse(last.refusedAt ?? last.at) + backoff)) continue;
    if (pull.conflict && [...running.values()].some(Boolean)) continue;
    if (!(await room())) continue;
    // Each red it handles is a pr-red activity line in the hand-off's project, written as its fix session starts (ADR-1064 D4, 13.25).
    await tell(["workspace", "red", String(pr), "--increment", increment, ...(pull.conflict ? ["--conflict"] : []),
      ...(pull.checks ?? []).flatMap((check) => ["--check", check])], record.project);
    if (!record.closed) await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
    const n = record.fixes.length + 1;
    const fix = await startFix({ pr, increment, n, brief: fixBrief({ pr, increment, why: pull.why, logs: pull.logs, n: counted + 1, limit: allowed, keepOpen: record.keepOpen, closed: record.closed }) });
    record.fixing = { pid: fix.pid };
    record.fixes.push({ at: new Date(now()).toISOString(), head: pull.head, pid: fix.pid, log: fix.log, ...(pull.conflict ? { conflict: true } : {}) });
    running.set(pr, Boolean(pull.conflict));
    await save(dir, record);
    dated(`PR #${pr} red (${pull.why}): fix session ${counted + 1} of ${allowed} started, log ${fix.log}`);
  }
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
    `cd ${config.remoteCheckout} && node packages/dev-loop/src/lanes/watch.mjs ${args.join(" ")}`]];
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
 * The project a hand-off from `cwd` belongs to when it is not the watcher's own (13.25): the nearest marker's folder,
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
  const own = join(repo, "packages", "dev-loop", "src", "lanes", "watch.mjs");
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete free[name];
  const detached = (args, log, cwd) => {
    const out = openSync(log, "a");
    const child = spawnChild(process.execPath, args, { cwd, env: free, detached: true, stdio: ["ignore", out, out] });
    child.unref();
    return child.pid;
  };
  return {
    lanesDir, repo, dir, pidFile: join(dir, "watch.pid"), loopPidFile: join(dir, "watch-loop.pid"), status: join(lanesDir, "watch.status"), argsOf,
    limit: config.watcher.fixesPerRed, cap: config.watcher.fixesPerPullRequest, intervalMs: config.watcher.intervalMs, now: Date.now,
    session: env.CLAUDE_CODE_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim() || "",
    // The command line routes by its folder's marker: a hand-off's own project runs it there, under its own home (13.25).
    storytree: async (args, project) => (project
      ? await run(process.execPath, ["--import", import.meta.resolve("tsx"), join(repo, "packages", "cli", "src", "bins", "storytree.ts"), ...args],
        { cwd: project.folder, env: { ...env, STORYTREE_HOME: project.home }, maxBuffer: 16 * 1024 * 1024 })
      : await run("pnpm", ["-s", "storytree", ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout,
    project: () => projectOf({ cwd: process.cwd(), repo, home: env.STORYTREE_HOME || join(home, ".storytree", "0.3") }),
    look: (pr, record) => lookOnGitHub(pr, { repo, since: record.fixes.at(-1)?.at ?? record.handedAt }),
    branchOf: async (pr) => (await run("gh", ["pr", "view", String(pr), "--json", "headRefName", "-q", ".headRefName"], { cwd: repo })).stdout.trim(),
    alive: async (pid) => /lanes\/runner\.mjs run /.test(await argsOf(pid)),
    room: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout)
      < (Number((await readFile(join(lanesDir, "night-max-lanes"), "utf8").catch(() => "")).trim()) || config.sessions),
    startFix: async ({ pr, n, brief }) => {
      const base = join(dir, `fix-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached([join(script, "..", "runner.mjs"), "run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        ...config.addDirs], `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
    // Started from the shared checkout's copy, whichever worktree handed over, so it runs the code it watches for changes.
    startWatcher: () => detached([own, "run"], join(lanesDir, "watch.status"), repo),
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

/** `handover <pr> <increment> [--keep-open]`, `hand <pr> <increment> [--session <id>] [--keep-open]`, `run` or `status`; `box` overrides the box's home, paths and processes in tests. */
export async function main(args, box = {}) {
  const defaults = boxDefaults({ home: box.home, env: box.env });
  const b = { ...defaults, ...box };
  // The box's releases are its own folder's: a loop given another folder (a test on the box) would keep its stop
  // there, forget it each run and start the box a real fix session every time, unless it brings its own reader.
  if (!box.readReleases && b.dir !== defaults.dir) b.readReleases = undefined;
  const out = b.out ?? console.log;
  const keepOpen = args.includes("--keep-open"), refused = args.includes("--refused");
  if (args[0] === "handover" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const { code, lines } = await handOver({ pr: Number(args[1]), increment: args[2], session: b.session, keepOpen, onBox: b.onBox,
      local: (hand) => main(hand, box), remote: b.remote });
    for (const line of lines) out(line);
    return code;
  }
  await mkdir(b.dir, { recursive: true });
  if (args[0] === "hand" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const at = args.indexOf("--session");
    const session = at > 0 ? args[at + 1] ?? "" : b.session;
    const holder = args.includes("--holder") ? args[args.indexOf("--holder") + 1] : undefined;
    const branch = await b.branchOf(Number(args[1])).catch(() => "");
    const project = await b.project();
    const { closed, held } = await hand({ dir: b.dir, pr: Number(args[1]), increment: args[2], session, branch, keepOpen, refused, holder, project, storytree: b.storytree, now: b.now,
      startWatcher: () => ensureWatcher({ pidFile: b.pidFile, argsOf: b.argsOf, spawn: b.startWatcher }) });
    out(`PR #${args[1]} handed to the watcher (${join(b.dir, `${args[1]}.json`)}); `
      + (closed ? `${args[2]} had already closed, so the watcher watches and fixes it to its merge and closes nothing.`
        : `${args[2]} waits on it until it merges${keepOpen ? ", then stays open for its next pull request." : "."}`));
    if (held) out(held);
    out(`Close out with: pnpm storytree session close-out --safe yes --why "PR #${args[1]} open and green, handed to the watcher"`);
    return 0;
  }
  if (args[0] === "release-fix" && /^--(pr|question)$/.test(args[1] ?? "") && args[2]) {
    const recorded = await recordFix({ dir: b.dir, ...(args[1] === "--pr" ? { pr: Number(args[2]) } : { question: args[2] }) });
    out(recorded ? `Recorded ${args[2]} on the release stop: the watcher starts no other fix session while it is open.`
      : "No release stop is recorded: nothing to attach it to.");
    return recorded ? 0 : 1;
  }
  if (args[0] === "status") {
    const found = await records(b.dir);
    const pid = (await readFile(b.pidFile, "utf8").catch(() => "")).trim();
    const live = pid && MARKS[0].test(await b.argsOf(pid));
    out(`watcher: ${live ? `running (pid ${pid})` : "not running"}`);
    // 13.21: a look loop on code other than the checkout's shows, even one older than the version it records.
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
  if (args[0] !== "run" && args[0] !== "watch") { out("usage: watch.mjs handover <pr> <increment> [--keep-open] | hand <pr> <increment> [--session <id>] [--keep-open] [--refused [--holder <session>]] | release-fix --pr <n> | --question <id> | run | status"); return 2; }
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
  let releasesAt = 0;
  for (;;) {
    // Between looks, never in one: a fix session it started runs on, and its hand-off on disk keeps the count.
    const current = began && await version();
    if (current && current !== began) { dated(`dev loop code changed (${began} → ${current}): restarting`); return RESTART; }
    try { await watchOnce({ ...b, say }); }
    catch (error) { dated(`look failed: ${error.message.split("\n")[0]}`); }
    if (b.readReleases && b.now() - releasesAt >= RELEASE_EVERY_MS) {
      releasesAt = b.now();
      try { await watchReleases({ ...b, startFix: b.startReleaseFix, say }); }
      catch (error) { dated(`release look failed: ${error.message.split("\n")[0]}`); }
    }
    await b.sleep(b.intervalMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
