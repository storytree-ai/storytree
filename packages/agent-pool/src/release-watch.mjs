// Capability 4 · The watcher also owns a stopped release (ADR-1032 D2). Every few minutes its look loop reads the
// latest published release, the "Release installed app" runs and main's own CI runs from GitHub, with no model. A
// release attempt or main's newest CI run that failed is rerun once (main's again, bounded, while only the runner
// failed it); if releases are still stopped after that, one fix session is started for the stop, and after the fix
// limit the owner is asked on the release arc.
//
// The retry lives here rather than in a workflow beside rerun-unrun.yml: the once-only retry and the alarm read the
// same runs and the same attempt numbers, so one reader decides both and its decisions are pure and tested (4.16),
// where a workflow's shell would be untested; and the watcher already reads GitHub every minute. A box that is down
// retries nothing, but then it starts no lanes either. rerun-unrun.yml still reruns a CI job no runner took; when it
// reruns main's newest run first, that run's next attempt is the retry here.
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** How long a commit green on main may wait for a published release before the alarm: 90th percentile gap 2.8 h, median 44 min (ADR-1032). */
export const RELEASE_LIMIT_MS = 2 * 3600_000;
/** How often the look loop reads release state; a release takes about 23 minutes. */
export const RELEASE_EVERY_MS = 5 * 60_000;
/** The arc that owns the release process, where a stop no session could move is put to the owner. */
export const RELEASE_ARC = "arc_312aa103bfca";

const RED = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);
const MAIN_RED = new Set(["failure", "timed_out", "startup_failure"]);

/** Whether a release run's jobs attempted a release: a job after `source` (which picks the commit, or nothing) ran. */
export const attempted = (jobs) => jobs.some((job) => !/^source\b/.test(job.name) && job.steps > 0);

/** The job to name for a red run: the first that ran and ended red. */
export const failedJob = (jobs) => jobs.find((job) => job.steps > 0 && RED.has(job.conclusion))?.name;

/**
 * Whether a check or job is a security check: CodeQL default setup's check runs and the secret check (4.41). Its
 * failure goes to the owner as a library question, never to a fix session, whose commits and pull request are public.
 */
export const isSecurityCheck = (name) => typeof name === "string" && (name.startsWith("CodeQL") || name.startsWith("Analyze (") || name === "secret-check");

/** The security checks among a run's jobs that ran and ended red, for an alarm's run (4.41). */
export const securityJobs = (jobs) => jobs.filter((job) => job.steps > 0 && RED.has(job.conclusion) && isSecurityCheck(job.name)).map((job) => job.name);

/**
 * How many attempts a CI run red only on the runner may reach before it is judged as any red is: run 39460677369 on
 * main needed three (a browser crash at launch, then a macOS job no runner took, then green), so three reruns.
 */
export const RUNNER_ATTEMPTS = 4;
/** ci.yml's jobs that only read the `platforms` jobs' result, so fail when one of those does, whatever failed it. */
export const FOLLOWERS = new Set(["verify", "automerge"]);

/**
 * Why a red run's failures are all the hosted runner's, from its jobs ({ name, conclusion, steps, runner }) and its
 * failed steps' log (`gh run view --log-failed`, each line led by its job's name and a tab), or null when any failure
 * may be the code's (4.29). The runner's are a job cancelled with no step run and no runner named (GitHub found no
 * runner for it, as rerun-unrun.yml reads it) and a job whose log says the browser died of SIGSEGV at launch, before
 * any of our code ran in it (apps/desktop/src/capture/launch.ts). A job that failed beside that crash for another
 * reason still reads as the runner's; the bound on attempts is what keeps that from rerunning forever.
 */
export function runnerFault(jobs, log = "") {
  const red = jobs.filter((job) => RED.has(job.conclusion) && !FOLLOWERS.has(job.name));
  if (!red.length) return null;
  const why = [];
  for (const job of red) {
    const said = log.split("\n").filter((line) => line.startsWith(`${job.name}\t`)).join("\n");
    if (job.conclusion === "cancelled" && !job.steps && !job.runner) why.push(`${job.name}: no runner took it`);
    else if (/browserType\.launch\b/.test(said) && /signal=SIGSEGV/.test(said)) why.push(`${job.name}: the browser crashed at launch`);
    else return null;
  }
  return why.join("; ");
}

/** A pull request's failed CI runs ({ id, attempt, status, jobs, log }) to rerun because only the runner failed each, below RUNNER_ATTEMPTS; null when any is the code's or spent (4.29). */
export function runnerReruns(runs) {
  if (!runs.length) return null;
  const why = [];
  for (const run of runs) {
    const fault = run.status === "completed" && run.attempt < RUNNER_ATTEMPTS && runnerFault(run.jobs, run.log);
    if (!fault) return null;
    why.push(fault);
  }
  return { runs, why: why.join("; ") };
}

/**
 * From the latest published release ({ tag, sha, at }), the release runs that attempted a release and main's push CI
 * runs (each newest first: { id, sha, created, updated, status, conclusion, attempt, url, job, fault }), decide what to rerun
 * and whether releases are stopped. Only attempts made since the latest release, and the run that published it, count:
 * an older one is no part of this stop, and rerunning it could publish an older build. While a rerun is running nothing
 * is alarmed.
 */
export function judgeReleases({ release, attempts, main, now, limitMs = RELEASE_LIMIT_MS }) {
  // The run that published the latest release counts too: it publishes without a platform whose job failed (4.6) and
  // ends red, and that platform's stop is this one. Its rerun proves the build and uploads nothing: the build comes
  // with the next version.
  const published = (run) => run.sha === release.sha;
  const since = attempts.filter((run) => Date.parse(run.created) > Date.parse(release.at) || published(run));
  const done = since.filter((run) => run.status === "completed");
  const head = main[0];
  const reruns = [];
  if (since[0]?.status === "completed" && RED.has(since[0].conclusion) && since[0].attempt === 1) {
    reruns.push({ what: "release", run: since[0], why: `release run ${since[0].id} ended ${since[0].conclusion}` });
  }
  // A red only the runner caused (its `fault`, from runnerFault) is rerun again, up to RUNNER_ATTEMPTS (4.29).
  if (head?.status === "completed" && MAIN_RED.has(head.conclusion) && (head.attempt === 1 || (head.fault && head.attempt < RUNNER_ATTEMPTS))) {
    reruns.push({ what: "main", run: head, why: `main's CI run ${head.id} on ${head.sha.slice(0, 8)} ended ${head.conclusion}${head.fault ? ` on the runner (${head.fault})` : ""}` });
  }
  const retrying = [since[0], head].some((run) => run && run.attempt > 1 && run.status !== "completed");
  if (reruns.length || retrying) return { reruns, alarm: null };
  const named = (run) => ({ id: run.id, url: run.url, job: run.job, ...(run.security?.length ? { security: run.security } : {}) });
  if (head?.status === "completed" && MAIN_RED.has(head.conclusion)) {
    return { reruns, alarm: { why: `main's CI is still red on ${head.sha.slice(0, 8)} after its rerun`, run: named(head) } };
  }
  // The last two attempts, so a fresh one still running holds this alarm until it ends.
  if (since.length >= 2 && since.slice(0, 2).every((run) => run.status === "completed" && RED.has(run.conclusion))) {
    return { reruns, alarm: { why: "the last two release attempts both ended failed or cancelled", run: named(since[0]) } };
  }
  if (since[0] && published(since[0]) && since[0].status === "completed" && RED.has(since[0].conclusion)) {
    return { reruns, alarm: { why: `${release.tag} published without one platform's new build, and its rerun ended ${since[0].conclusion} too`, run: named(since[0]) } };
  }
  const released = main.find((run) => run.sha === release.sha)?.created ?? release.at;
  const waiting = main.filter((run) => run.conclusion === "success" && Date.parse(run.created) > Date.parse(released)).at(-1);
  if (waiting && now - Date.parse(waiting.updated) > limitMs) {
    const red = done.find((run) => RED.has(run.conclusion));
    return { reruns, alarm: { why: `${waiting.sha.slice(0, 8)} has been green on main since ${waiting.updated} and is in no published release`,
      run: named(red ?? waiting) } };
  }
  return { reruns, alarm: null };
}

const statePath = (dir) => join(dir, "release.json");
const save = (dir, state) => writeFile(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
const load = async (dir) => { try { return JSON.parse(await readFile(statePath(dir), "utf8")); } catch { return null; } };
/** "Releases stopped since 2026-10-13 12:00Z": the fix session's row in the sessions list, 40 characters at most. */
export const stopName = (at) => `Releases stopped since ${new Date(at).toISOString().slice(0, 16).replace("T", " ")}Z`;

function fixBrief({ release, alarm, tail, n, limit, name }) {
  return `# Release fix session ${n} of ${limit}: releases are stopped

The Mint box's watcher started you: no release has published since ${release.tag} (${release.at}), and ${alarm.why}.
The failing run: ${alarm.run.url}${alarm.run.job ? `, job "${alarm.run.job}"` : ""}. Any failed release attempt and main's red CI run were
already rerun once.${tail ? `\nThe log's last lines:\n\n\`\`\`\n${tail}\n\`\`\`` : ""}

Your job is to get releases moving and nothing else. Work from ~/code/storytree03 and follow its AGENTS.md as the session-orchestrator.
- First name your row: \`pnpm storytree session name "${name}"\`.
- Read the failing log (\`gh run view ${alarm.run.id} --log-failed\`) and the arc ${RELEASE_ARC} (\`pnpm storytree arc show ${RELEASE_ARC}\`).
- A fix in the code: park an increment for it on ${RELEASE_ARC}, make its workspace (it claims it), build it to a green \`pnpm gate\`
  in the foreground, open a NON-DRAFT pull request and hand it over: \`node packages/agent-pool/src/watch.mjs hand <pr> <increment>\`.
  Then record it, so no second session starts while it lands: \`node packages/agent-pool/src/watch.mjs release-fix --pr <pr>\`.
  Never force-push, squash or \`gh pr merge\`.
- A stop no session can move (an outside party such as Apple, a secret only the owner sets): raise the question on ${RELEASE_ARC}
  (\`pnpm storytree question new --arc ${RELEASE_ARC} …\`), written so he can answer it cold, and record it:
  \`node packages/agent-pool/src/watch.mjs release-fix --question <question>\`. The alarm stays quiet until it is settled.
- You exit when you end a turn, so run \`pnpm gate\` in the foreground until its table prints; never end a turn to wait.
- Then \`pnpm storytree session close-out --safe yes --why "…"\`, and end.
`;
}

/**
 * One look at releases: forget a stop a new release ended, order the reruns, and on an alarm start one fix session
 * for the stop with an engine slot free. None starts while the last one lives, while the pull request it recorded is
 * still with the watcher, or while the question it (or the watcher) raised is open; a settled question lets the alarm
 * start sessions again. After `limit` sessions the watcher raises that question itself.
 */
export async function watchReleases({ dir, readReleases, rerun, tail, alive, room, questionOpen, raise, startFix, limit, storytree, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} releases: ${message}`);
  const { release, reruns, alarm } = await readReleases();
  let state = await load(dir);
  if (state && state.stop !== release.tag) {
    await rm(statePath(dir), { force: true });
    dated(`${release.tag} published: the stop after ${state.stop} ended`);
    state = null;
  }
  for (const { what, run, why } of reruns) {
    try { await rerun(run); dated(`${why}: rerun once`); }
    catch (error) { dated(`${why}: the rerun was refused (${error.message.split("\n")[0]})`); continue; }
    // GitHub names the owner as every rerun's actor, since the watcher signs in as him: its own record tells them apart (4.27).
    try { await storytree?.(["workspace", "rerun", String(run.id), "--repo", run.repo, "--attempt", String(run.attempt + 1), "--what", what]); }
    catch (error) { dated(`recording the rerun of ${run.id} failed (${error.message.split("\n")[0]})`); }
  }
  if (!alarm) return;
  state ??= { stop: release.tag, since: release.at, fixes: [], fixing: null, pr: null, question: null };
  if (state.fixing && await alive(state.fixing.pid)) return;
  if (state.fixing) { state.fixing = null; await save(dir, state); }
  if (state.pr && existsSync(join(dir, `${state.pr}.json`))) return;
  if (state.pr) { state.pr = null; await save(dir, state); }
  if (state.question) {
    if (await questionOpen(state.question)) return;
    dated(`${state.question} is settled: the alarm may start fix sessions again`);
    Object.assign(state, { question: null, fixes: [] });
    await save(dir, state);
  }
  const name = stopName(state.since);
  // A failed security check is the owner's, asked once with no log or alert text and no fix session (4.41).
  if (alarm.run.security?.length) {
    const checks = alarm.run.security.join(", ");
    state.question = await raise({
      title: `Releases stopped on a failed security check (${checks})`,
      stakes: "No release publishes until it passes, and the watcher starts no fix session for it, since a fix session's commits and pull request are public.",
      statement: `Run ${alarm.run.id} failed the security check ${checks}. What should be done about it?`,
      context: `The Mint watcher reads ${checks} as a security check (4.41): it puts no log or alert text anywhere and asks you instead. Read the run on GitHub, signed in.`,
      options: "A. Fix it yourself, privately. B. Judge it a false alarm and dismiss it on GitHub.",
    });
    await save(dir, state);
    dated(`run ${alarm.run.id} failed the security check ${checks}: asked the owner in ${state.question}, with no fix session`);
    return;
  }
  if (state.fixes.length >= limit) {
    state.question = await raise({
      title: `${name}, and ${limit} fix sessions could not move it`,
      stakes: "Every platform's development builds stay where they are, and no urgent fix can reach a stable install, until a release publishes again.",
      statement: `No release has published since ${release.tag} (${release.at}): ${alarm.why}. The failing run: ${alarm.run.url}${alarm.run.job ? ` (${alarm.run.job})` : ""}. What should move it?`,
      context: `The Mint watcher reran the failing runs once and started ${limit} fix sessions; their logs: ${state.fixes.map((fix) => fix.log).join(", ")}. It starts no other until this is settled (ADR-1032 D2).`,
      options: "A. Name what only you can do (a secret, a sign-in, an outside party) and do it. B. Say what a next fix session should try.",
    });
    await save(dir, state);
    dated(`${alarm.why}; ${limit} fix sessions ran: asked the owner in ${state.question}`);
    return;
  }
  if (!(await room())) return;
  const n = state.fixes.length + 1;
  const fix = await startFix({ n, brief: fixBrief({ release, alarm, tail: await tail(alarm.run).catch(() => ""), n, limit, name }) });
  state.fixing = { pid: fix.pid };
  state.fixes.push({ at: new Date(now()).toISOString(), run: alarm.run.id, pid: fix.pid, log: fix.log });
  await save(dir, state);
  dated(`${alarm.why}: fix session ${n} of ${limit} started, log ${fix.log}`);
}

/** Record what the fix session left behind: the pull request it handed over, or the question it raised. */
export async function recordFix({ dir, pr, question }) {
  const state = await load(dir);
  if (!state) return false;
  await save(dir, { ...state, ...(pr ? { pr } : {}), ...(question ? { question } : {}) });
  return true;
}
