// Capability 4 · The watcher also owns a stopped release (ADR-1032 D2).
import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { localBrief } from "./queue.mjs";

export const RELEASE_LIMIT_MS = 2 * 3600_000;
export const RELEASE_EVERY_MS = 5 * 60_000;
export const RELEASE_ARC = "arc_312aa103bfca";

const RED = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);
const MAIN_RED = new Set(["failure", "timed_out", "startup_failure"]);

export const attempted = (jobs) => jobs.some((job) => !/^source\b/.test(job.name) && job.steps > 0);

export const failedJob = (jobs) => jobs.find((job) => job.steps > 0 && RED.has(job.conclusion))?.name;

export const isSecurityCheck = (name) => typeof name === "string" && (name.startsWith("CodeQL") || name.startsWith("Analyze (") || name === "secret-check");

export const securityJobs = (jobs) => jobs.filter((job) => job.steps > 0 && RED.has(job.conclusion) && isSecurityCheck(job.name)).map((job) => job.name);

export const RUNNER_ATTEMPTS = 4;
export const FOLLOWERS = new Set(["verify", "automerge"]);

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

export function judgeReleases({ release, attempts, main, now, limitMs = RELEASE_LIMIT_MS }) {
  const published = (run) => run.sha === release.sha;
  const since = attempts.filter((run) => Date.parse(run.created) > Date.parse(release.at) || published(run));
  const done = since.filter((run) => run.status === "completed");
  const head = main[0];
  const reruns = [];
  if (since[0]?.status === "completed" && RED.has(since[0].conclusion) && since[0].attempt === 1) {
    reruns.push({ what: "release", run: since[0], why: `release run ${since[0].id} ended ${since[0].conclusion}` });
  }
  if (head?.status === "completed" && MAIN_RED.has(head.conclusion) && (head.attempt === 1 || (head.fault && head.attempt < RUNNER_ATTEMPTS))) {
    reruns.push({ what: "main", run: head, why: `main's CI run ${head.id} on ${head.sha.slice(0, 8)} ended ${head.conclusion}${head.fault ? ` on the runner (${head.fault})` : ""}` });
  }
  const retrying = [since[0], head].some((run) => run && run.attempt > 1 && run.status !== "completed");
  if (reruns.length || retrying) return { reruns, alarm: null };
  const named = (run) => ({ id: run.id, url: run.url, job: run.job, ...(run.security?.length ? { security: run.security } : {}) });
  if (head?.status === "completed" && MAIN_RED.has(head.conclusion)) {
    return { reruns, alarm: { why: `main's CI is still red on ${head.sha.slice(0, 8)} after its rerun`, run: named(head) } };
  }
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
export async function writeWhole(path, text) {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}
const save = (dir, state) => writeWhole(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
const load = async (dir) => { try { return JSON.parse(await readFile(statePath(dir), "utf8")); } catch { return null; } };
export const stopName = (at) => `Releases stopped since ${new Date(at).toISOString().slice(0, 16).replace("T", " ")}Z`;

function fixBrief({ release, alarm, tail, n, limit, name }) {
  return `# Release fix session ${n} of ${limit}: releases are stopped

The pool's watcher started you: no release has published since ${release.tag} (${release.at}), and ${alarm.why}.
The failing run: ${alarm.run.url}${alarm.run.job ? `, job "${alarm.run.job}"` : ""}. Any failed release attempt and main's red CI run were
already rerun once.${tail ? `\nThe log's last lines:\n\n\`\`\`\n${tail}\n\`\`\`` : ""}

Your job is to get releases moving and nothing else. Work from {checkout} and follow its AGENTS.md as the session-orchestrator.
- First name your row: \`pnpm storytree session name "${name}"\`.
- Read the failing log (\`gh run view ${alarm.run.id} --log-failed\`) and the arc ${RELEASE_ARC} (\`pnpm storytree arc show ${RELEASE_ARC}\`).
- A fix in the code: park an increment for it on ${RELEASE_ARC}, make its workspace (it claims it), build it to a green \`pnpm gate\`
  in the foreground, open a NON-DRAFT pull request and hand it over: \`node packages/agent-pool/src/watch.mjs hand <pr> <increment>\`.
  Then record it, so no second session starts while it lands: \`node packages/agent-pool/src/watch.mjs release-fix --pr <pr>\`.
  Never force-push, squash or \`gh pr merge\`.
- A stop no session can move and no one chooses about (an outside outage, such as GitHub Actions or Apple down): park an
  increment for it on ${RELEASE_ARC} and set an event wait on it, not an owner question (ADR-0938 D1):
  \`pnpm storytree arc increment wait <increment> --for event --note "<what it waits on>" --check-back <day>\`. An act only the
  owner can take with no choice in it (a secret only he sets, a sign-in) is an owner wait on it instead (\`--for owner --note … --why …\`).
  Record it: \`node packages/agent-pool/src/watch.mjs release-fix --wait <increment>\`. The alarm stays quiet while the wait holds,
  and the next release closes that increment.
- A stop that needs the owner's choice: raise the question on ${RELEASE_ARC} (\`pnpm storytree question new --arc ${RELEASE_ARC} …\`),
  written so he can answer it cold, and record it: \`node packages/agent-pool/src/watch.mjs release-fix --question <question>\`.
  The alarm stays quiet until it is settled.
- You exit when you end a turn, so run \`pnpm gate\` in the foreground until its table prints; never end a turn to wait.
- Then \`pnpm storytree session close-out --safe yes --why "…"\`, and end.
`;
}

export const waitHolding = ({ status, waitsFor = [] }, today) => status !== "closed"
  && waitsFor.some(({ releaser, checkBack }) => releaser === "owner" || (releaser === "event" && today < checkBack));

export async function readWait(storytree, id, today) {
  const read = (field) => storytree(["library", "read", id, "--field", field]).then((text) => text.trim(), () => "");
  const [status, waits] = await Promise.all([read("status"), read("waitsFor")]);
  return Boolean(status) && waitHolding({ status, waitsFor: waits ? JSON.parse(waits) : [] }, today);
}

export async function raisedSince(storytree, { title, since }) {
  const listed = await storytree(["library", "list", "question", "--where", `arc=${RELEASE_ARC}`, "--where", `title=${title}`]);
  for (const id of listed.match(/question_\w+/g) ?? []) {
    const created = /^Created: (\S+)/m.exec(await storytree(["library", "read", id]))?.[1];
    if (created && Date.parse(created) >= Date.parse(since)) return id;
  }
  return undefined;
}

export async function watchReleases({ dir, readReleases, rerun, tail, alive, room, questionOpen, waitHolds, raise, raised = async () => undefined, startFix, startedAs = async () => undefined, limit, storytree, folders = {}, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} releases: ${message}`);
  const { release, reruns, alarm } = await readReleases();
  let state = await load(dir);
  if (state?.starting) {
    const { stamp, n, entry } = state.starting;
    const found = await startedAs({ name: `release-fix-${stamp}-${n}`, since: entry.at });
    if (found) {
      state.fixing = found.pid ? { pid: found.pid } : null;
      state.fixes.push({ ...entry, ...(found.pid ? { pid: found.pid } : {}), log: found.log });
    }
    delete state.starting;
    await save(dir, state);
    dated(`fix session ${n} ${found ? "had started before the watcher stopped, and is counted" : "never started before the watcher stopped"}`);
  }
  if (state && state.stop !== release.tag) {
    if (state.wait) {
      try { await storytree?.(["arc", "increment", "close", state.wait, "--disposition", "withdrawn", "--note", `${release.tag} published: the outside stop it waited out is over`]); }
      catch (error) { dated(`closing ${state.wait} failed (${error.message.split("\n")[0]})`); }
    }
    await rm(statePath(dir), { force: true });
    dated(`${release.tag} published: the stop after ${state.stop} ended`);
    state = null;
  }
  for (const { what, run, why } of reruns) {
    try { await rerun(run); dated(`${why}: rerun once`); }
    catch (error) { dated(`${why}: the rerun was refused (${error.message.split("\n")[0]})`); continue; }
    try { await storytree?.(["workspace", "rerun", String(run.id), "--repo", run.repo, "--attempt", String(run.attempt + 1), "--what", what]); }
    catch (error) { dated(`recording the rerun of ${run.id} failed (${error.message.split("\n")[0]})`); }
  }
  if (!alarm) return;
  state ??= { stop: release.tag, since: release.at, fixes: [], fixing: null, pr: null, wait: null, question: null };
  if (state.fixing && await alive(state.fixing.pid)) return;
  if (state.fixing) { state.fixing = null; await save(dir, state); }
  if (state.pr && existsSync(join(dir, `${state.pr}.json`))) return;
  if (state.pr) { state.pr = null; await save(dir, state); }
  if (state.wait) {
    if (await waitHolds(state.wait)) return;
    dated(`${state.wait}'s wait no longer holds: the alarm may start fix sessions again`);
    Object.assign(state, { wait: null, fixes: [] });
    await save(dir, state);
  }
  if (state.asking) {
    const { title, since } = state.asking;
    const found = state.question ?? await raised({ title, since });
    if (found) state.question = found;
    delete state.asking;
    await save(dir, state);
    dated(found ? `${found} had been raised before the watcher stopped, and is adopted` : `"${title}" was never raised before the watcher stopped`);
  }
  if (state.question) {
    if (await questionOpen(state.question)) return;
    dated(`${state.question} is settled: the alarm may start fix sessions again`);
    Object.assign(state, { question: null, fixes: [] });
    await save(dir, state);
  }
  const name = stopName(state.since);
  const ask = async (question) => {
    state.asking = { title: question.title, since: new Date(now()).toISOString() };
    await save(dir, state);
    state.question = await raise(question);
    delete state.asking;
    await save(dir, state);
  };
  if (alarm.run.security?.length) {
    const checks = alarm.run.security.join(", ");
    await ask({
      title: `Releases stopped on a failed security check (${checks})`,
      stakes: "No release publishes until it passes, and the watcher starts no fix session for it, since a fix session's commits and pull request are public.",
      statement: `Run ${alarm.run.id} failed the security check ${checks}. What should be done about it?`,
      context: `The pool's watcher reads ${checks} as a security check (4.41): it puts no log or alert text anywhere and asks you instead. Read the run on GitHub, signed in.`,
      options: "A. Fix it yourself, privately. B. Judge it a false alarm and dismiss it on GitHub.",
    });
    dated(`run ${alarm.run.id} failed the security check ${checks}: asked the owner in ${state.question}, with no fix session`);
    return;
  }
  if (state.fixes.length >= limit) {
    await ask({
      title: `${name}, and ${limit} fix sessions could not move it`,
      stakes: "Every platform's development builds stay where they are, and no urgent fix can reach a stable install, until a release publishes again.",
      statement: `No release has published since ${release.tag} (${release.at}): ${alarm.why}. The failing run: ${alarm.run.url}${alarm.run.job ? ` (${alarm.run.job})` : ""}. What should move it?`,
      context: `The pool's watcher reran the failing runs once and started ${limit} fix sessions; their logs: ${state.fixes.map((fix) => fix.log).join(", ")}. It starts no other until this is settled (ADR-1032 D2).`,
      options: "A. Name what only you can do (a secret, a sign-in, an outside party) and do it. B. Say what a next fix session should try.",
    });
    dated(`${alarm.why}; ${limit} fix sessions ran: asked the owner in ${state.question}`);
    return;
  }
  if (!(await room())) return;
  const n = state.fixes.length + 1;
  const brief = localBrief(fixBrief({ release, alarm, tail: await tail(alarm.run).catch(() => ""), n, limit, name }), folders);
  const entry = { at: new Date(now()).toISOString(), run: alarm.run.id };
  state.starting = { stamp: now(), n, entry };
  await save(dir, state);
  const fix = await startFix({ n, stamp: state.starting.stamp, brief });
  state.fixing = { pid: fix.pid };
  state.fixes.push({ ...entry, pid: fix.pid, log: fix.log });
  delete state.starting;
  await save(dir, state);
  dated(`${alarm.why}: fix session ${n} of ${limit} started, log ${fix.log}`);
}

export async function recordFix({ dir, pr, wait, question }) {
  const state = await load(dir);
  if (!state) return false;
  await save(dir, { ...state, ...(pr ? { pr } : {}), ...(wait ? { wait } : {}), ...(question ? { question } : {}) });
  return true;
}
