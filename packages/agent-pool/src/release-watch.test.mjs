import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { attempted, judgeReleases, RELEASE_LIMIT_MS, RUNNER_ATTEMPTS, runnerFault, runnerReruns, watchReleases } from "./release-watch.mjs";

const at = Date.parse("2026-10-13T12:00:00Z");
const minutes = (n) => new Date(at + n * 60_000).toISOString();
const release = { tag: "v0.3.1355", sha: "c0", at: minutes(0) };
const mainRun = ({ id, sha, created, conclusion = "success", attempt = 1, status = "completed", job } = {}) =>
  ({ id, sha, created: minutes(created), updated: minutes(created + 15), status, conclusion, attempt, url: `https://ci/run/${id}`, job });
const attempt = ({ id, created, conclusion = "failure", attempt = 1, status = "completed", job = "package (macOS)" } = {}) =>
  ({ id, created: minutes(created), updated: minutes(created + 20), status, conclusion, attempt, url: `https://ci/run/${id}`, job });
const judge = ({ attempts = [], main = [], now = 30 } = {}) => judgeReleases({ release, attempts, main, now: at + now * 60_000 });

test("4.16 · a stopped release is rerun once, then judged an alarm; a quiet main is nothing", () => {
  // Only a run in which a job after `source` ran attempted a release.
  assert.equal(attempted([{ name: "source", conclusion: "success", steps: 7 }, { name: "verify", conclusion: "skipped", steps: 0 }]), false);
  assert.equal(attempted([]), false);
  assert.equal(attempted([{ name: "source", conclusion: "success", steps: 7 }, { name: "verify (macos-latest)", conclusion: "failure", steps: 9 }]), true);

  // A quiet night: main's newest commit is the released one.
  assert.deepEqual(judge({ main: [mainRun({ id: 1, sha: "c0", created: -20 })], now: 600 }), { reruns: [], alarm: null });

  // One failed attempt is rerun once; nothing is alarmed while it reruns.
  const main = [mainRun({ id: 2, sha: "c1", created: 5 }), mainRun({ id: 1, sha: "c0", created: -20 })];
  const once = judge({ attempts: [attempt({ id: 50, created: 25 })], main, now: 50 });
  assert.deepEqual(once.reruns.map((rerun) => rerun.run.id), [50]);
  assert.equal(once.alarm, null);
  assert.equal(judge({ attempts: [attempt({ id: 50, created: 25, attempt: 2, status: "in_progress", conclusion: null })], main, now: 200 }).alarm, null);

  // The rerun failing too, after an earlier failed attempt: an alarm naming the newest, and no second rerun.
  const twice = judge({ attempts: [attempt({ id: 50, created: 25, attempt: 2 }), attempt({ id: 40, created: 10, attempt: 2, conclusion: "cancelled" })], main, now: 60 });
  assert.deepEqual(twice.reruns, []);
  assert.equal(twice.alarm.run.id, 50);
  assert.equal(twice.alarm.run.job, "package (macOS)");
  assert.match(twice.alarm.why, /two release attempts/);
  const fresh = attempt({ id: 60, created: 55, status: "in_progress", conclusion: null });
  assert.equal(judge({ attempts: [fresh, attempt({ id: 50, created: 25, attempt: 2 }), attempt({ id: 40, created: 10, attempt: 2 })], main, now: 60 }).alarm, null);

  // An attempt made before the latest release published is not this stop's, and is never rerun.
  assert.deepEqual(judge({ attempts: [attempt({ id: 30, created: -5 })], main: [mainRun({ id: 1, sha: "c0", created: -20 })] }).reruns, []);

  // The run that published the latest release without the Mac's new build ended red (4.6): it is rerun once, and red
  // after its rerun it is an alarm naming the Mac's job, though the release published and main has nothing newer.
  const quiet = [mainRun({ id: 1, sha: "c0", created: -20 })];
  const partial = (n, conclusion = "failure") => ({ ...attempt({ id: 31, created: -5, attempt: n, conclusion }), sha: "c0" });
  assert.deepEqual(judge({ attempts: [partial(1)], main: quiet }).reruns.map((rerun) => rerun.run.id), [31]);
  const behind = judge({ attempts: [partial(2)], main: quiet, now: 300 });
  assert.equal(behind.alarm.run.id, 31);
  assert.equal(behind.alarm.run.job, "package (macOS)");
  assert.match(behind.alarm.why, /v0\.3\.1355 published without one platform's new build/);
  // Its rerun proving the Mac's build clears it; that build comes with the next version.
  assert.deepEqual(judge({ attempts: [partial(2, "success")], main: quiet, now: 300 }), { reruns: [], alarm: null });

  // Main's own CI red once: rerun once on the same commit. Red after its rerun: an alarm naming it.
  const red = (n) => [mainRun({ id: 3, sha: "c2", created: 10, conclusion: "failure", attempt: n, job: "test-unit (macOS)" }), mainRun({ id: 1, sha: "c0", created: -20 })];
  assert.deepEqual(judge({ main: red(1) }).reruns.map((rerun) => [rerun.what, rerun.run.id]), [["main", 3]]);
  const still = judge({ main: red(2) });
  assert.deepEqual(still.reruns, []);
  assert.equal(still.alarm.run.id, 3);
  assert.match(still.alarm.why, /main's CI/);

  // A green commit unreleased past the limit, and not before it.
  const green = [mainRun({ id: 2, sha: "c1", created: 5 }), mainRun({ id: 1, sha: "c0", created: -20 })];
  const limit = RELEASE_LIMIT_MS / 60_000;
  assert.equal(judge({ main: green, now: 5 + 15 + limit - 1 }).alarm, null);
  const late = judge({ main: green, now: 5 + 15 + limit + 1 });
  assert.equal(late.alarm.run.id, 2);
  assert.match(late.alarm.why, /green on main .* in no published release/);
});

test("4.29 · a red only the runner caused (no runner took a job, the browser crashed at launch) is told apart from a code red and rerun, bounded", () => {
  const ran = (name, conclusion = "success") => ({ name, conclusion, steps: 9, runner: "GitHub Actions 7" });
  const unrun = { name: "verify on macOS", conclusion: "cancelled", steps: 0, runner: "" };
  const crashed = ran("verify on macOS", "failure");
  const follower = ran("verify", "failure");
  const crash = "verify on macOS\ttest\t2026-10-20T10:00:00Z browserType.launch: Target page, context or browser has been closed\n"
    + "verify on macOS\ttest\t2026-10-20T10:00:00Z <process did exit: exitCode=null, signal=SIGSEGV>";
  // run 39460677369's two attempts: each is the runner's, and `verify`, which only reads the platforms, follows them.
  assert.match(runnerFault([ran("verify on Linux"), unrun, follower]), /verify on macOS: no runner took it/);
  assert.match(runnerFault([ran("verify on Linux"), crashed, follower], crash), /verify on macOS: the browser crashed at launch/);
  // A job that ran and failed for any other reason is the code's, even beside a runner's failure.
  assert.equal(runnerFault([ran("verify on Linux"), crashed, follower], "verify on macOS\ttest\tAssertionError: 3.55 expected 2"), null);
  assert.equal(runnerFault([ran("verify on Windows", "failure"), unrun, follower], crash), null);
  assert.equal(runnerFault([{ ...unrun, steps: 4, runner: "GitHub Actions 3" }]), null, "a job the time limit cancelled ran");
  // The crash said by another job does not excuse this one.
  assert.equal(runnerFault([crashed], crash.replaceAll("verify on macOS", "verify on Linux")), null);
  assert.equal(runnerFault([ran("verify on Linux")]), null, "nothing red");

  // A pull request's red runs are rerun while each is the runner's and below the bound; one code red or a spent bound reruns none.
  const run = (id, attempt, jobs, log = "") => ({ id, attempt, status: "completed", jobs, log });
  assert.deepEqual(runnerReruns([run(5, 2, [unrun, follower])])?.runs.map((one) => one.id), [5]);
  assert.equal(runnerReruns([run(5, RUNNER_ATTEMPTS, [unrun, follower])]), null);
  assert.equal(runnerReruns([run(5, 1, [unrun]), run(6, 1, [ran("lint", "failure")])]), null);
  assert.equal(runnerReruns([]), null);

  // Main's CI red on the runner is rerun past its once-only retry, up to the bound; a code red is not.
  const head = (attempt, fault) => [{ ...mainRun({ id: 3, sha: "c2", created: 10, conclusion: "failure", attempt, job: "verify on macOS" }), fault },
    mainRun({ id: 1, sha: "c0", created: -20 })];
  const again = judge({ main: head(2, "verify on macOS: no runner took it") });
  assert.deepEqual(again.reruns.map((rerun) => [rerun.what, rerun.run.id]), [["main", 3]]);
  assert.match(again.reruns[0].why, /no runner took it/);
  assert.equal(again.alarm, null);
  assert.deepEqual(judge({ main: head(2) }).reruns, []);
  const spent = judge({ main: head(RUNNER_ATTEMPTS, "verify on macOS: no runner took it") });
  assert.deepEqual(spent.reruns, []);
  assert.match(spent.alarm.why, /main's CI/);
});

async function box(t, { judged, release: latest = release } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lane-release-"));
  t.after(() => removeTemp(dir));
  const fixes = [], reruns = [], questions = [], lines = [], live = new Set(), open = new Set();
  let room = true, outcome = judged;
  const options = {
    dir, limit: 2, now: () => at, say: (line) => lines.push(line),
    readReleases: async () => ({ release: latest, ...outcome }),
    rerun: async (run) => { reruns.push(run.id); },
    tail: async () => "Error: notarisation timed out",
    alive: async (pid) => live.has(pid),
    room: async () => room,
    questionOpen: async (id) => open.has(id),
    raise: async (brief) => { questions.push(brief); open.add("question_r"); return "question_r"; },
    startFix: async (fix) => { fixes.push(fix); const pid = 2000 + fixes.length; live.add(pid); return { pid, log: `/lanes/release-fix-${fix.n}.log` }; },
  };
  return { dir, fixes, reruns, questions, lines, live, open, options, set: (next) => { outcome = next; }, noRoom: () => { room = false; } };
}

const alarm = { why: "the last two release attempts both ended failed or cancelled", run: { id: 50, url: "https://ci/run/50", job: "package (macOS)" } };

test("4.17 · a release alarm starts one fix session per stop, quiet while it or its pull request or question is open, then asks the owner", async (t) => {
  const b = await box(t, { judged: { reruns: [{ what: "release", run: { id: 50 } }], alarm: null } });
  await watchReleases(b.options);
  assert.deepEqual(b.reruns, [50]);
  assert.equal(b.fixes.length, 0);

  b.set({ reruns: [], alarm });
  b.noRoom();
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 0, "no engine slot, no fix session");
  b.options.room = async () => true;
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 1);
  assert.match(b.fixes[0].brief, /https:\/\/ci\/run\/50/);
  assert.match(b.fixes[0].brief, /package \(macOS\)/);
  assert.match(b.fixes[0].brief, /notarisation timed out/);
  const name = /session name "(Releases stopped since [^"]+)"/.exec(b.fixes[0].brief)[1];
  assert.ok(name.length <= 40, name);

  // One per stop: none while the session lives, none while the pull request it recorded is with the watcher.
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 1);
  b.live.clear();
  const state = JSON.parse(await readFile(join(b.dir, "release.json"), "utf8"));
  await writeFile(join(b.dir, "release.json"), JSON.stringify({ ...state, pr: 77 }));
  await writeFile(join(b.dir, "77.json"), JSON.stringify({ pr: 77, increment: "increment_fix" }));
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 1);

  // The pull request merged and releases are still stopped: a second session, then the owner is asked once.
  await rm(join(b.dir, "77.json"));
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 2);
  b.live.clear();
  await watchReleases(b.options);
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 2);
  assert.equal(b.questions.length, 1);
  assert.match(b.questions[0].statement, /https:\/\/ci\/run\/50/);

  // Settled, the alarm may start a session again; a new release ends the stop and forgets it.
  b.open.clear();
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 3);
  const next = await box(t, { judged: { reruns: [], alarm: null }, release: { ...release, tag: "v0.3.1356" } });
  await writeFile(join(next.dir, "release.json"), JSON.stringify({ stop: "v0.3.1355", fixes: [{ pid: 1 }], fixing: null }));
  await watchReleases(next.options);
  await assert.rejects(readFile(join(next.dir, "release.json"), "utf8"), { code: "ENOENT" });
});

test("4.27 · each rerun the watcher starts is recorded as a ci-rerun line naming the repository, the run and the attempt it starts; a refused one is not", async (t) => {
  const run = (id, what) => ({ what, run: { id, attempt: 1, repo: "storytree-ai/storytree" }, why: `${what} run ${id} ended failure` });
  const b = await box(t, { judged: { reruns: [run(50, "release"), run(51, "main")], alarm: null } });
  const told = [];
  b.options.storytree = async (args) => { told.push(args); return ""; };
  await watchReleases(b.options);
  assert.deepEqual(told, [
    ["workspace", "rerun", "50", "--repo", "storytree-ai/storytree", "--attempt", "2", "--what", "release"],
    ["workspace", "rerun", "51", "--repo", "storytree-ai/storytree", "--attempt", "2", "--what", "main"],
  ]);

  told.length = 0;
  b.options.rerun = async () => { throw new Error("HTTP 403"); };
  await watchReleases(b.options);
  assert.deepEqual(told, [], "a rerun GitHub refused started nothing to record");
  assert.match(b.lines.at(-1), /the rerun was refused \(HTTP 403\)/);

  // The library refusing the line costs the rerun nothing: it is said, and the look goes on.
  b.options.rerun = async () => {};
  b.options.storytree = async () => { throw new Error("library unreachable"); };
  await watchReleases(b.options);
  assert.ok(b.lines.some((line) => /run 51 .*rerun once/.test(line)));
  assert.ok(b.lines.some((line) => /recording the rerun of 51 failed \(library unreachable\)/.test(line)));
});

test("4.41 · a release stop on a failed code-scanning or secret check asks the owner once, naming only the run and the check, and starts no fix session", async (t) => {
  const run = ({ ...mainRun({ id: 3, sha: "c2", created: 10, conclusion: "failure", attempt: 2, job: "secret-check" }), security: ["secret-check"] });
  const judged = judge({ main: [run, mainRun({ id: 1, sha: "c0", created: -20 })] });
  assert.deepEqual(judged.alarm.run.security, ["secret-check"]);

  const b = await box(t, { judged: { reruns: [], alarm: { why: "main's CI is still red", run: { id: 3, url: "https://ci/run/3", job: "secret-check", security: ["secret-check"] } } } });
  b.options.tail = async () => { throw new Error("no log is read for a security stop"); };
  await watchReleases(b.options);
  await watchReleases(b.options);
  assert.equal(b.fixes.length, 0);
  assert.equal(b.questions.length, 1);
  const text = Object.values(b.questions[0]).join(" ");
  assert.match(text, /secret-check/);
  assert.match(text, /\b3\b/);
  assert.doesNotMatch(text, /https?:/);
});
