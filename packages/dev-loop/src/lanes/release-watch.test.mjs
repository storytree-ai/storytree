import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { attempted, judgeReleases, RELEASE_LIMIT_MS, watchReleases } from "./release-watch.mjs";

const at = Date.parse("2026-10-13T12:00:00Z");
const minutes = (n) => new Date(at + n * 60_000).toISOString();
const release = { tag: "v0.3.1355", sha: "c0", at: minutes(0) };
const mainRun = ({ id, sha, created, conclusion = "success", attempt = 1, status = "completed", job } = {}) =>
  ({ id, sha, created: minutes(created), updated: minutes(created + 15), status, conclusion, attempt, url: `https://ci/run/${id}`, job });
const attempt = ({ id, created, conclusion = "failure", attempt = 1, status = "completed", job = "package (macOS)" } = {}) =>
  ({ id, created: minutes(created), updated: minutes(created + 20), status, conclusion, attempt, url: `https://ci/run/${id}`, job });
const judge = ({ attempts = [], main = [], now = 30 } = {}) => judgeReleases({ release, attempts, main, now: at + now * 60_000 });

test("13.16 · a stopped release is rerun once, then judged an alarm; a quiet main is nothing", () => {
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

  // An attempt made before the latest release published is not this stop's, and is never rerun.
  assert.deepEqual(judge({ attempts: [attempt({ id: 30, created: -5 })], main: [mainRun({ id: 1, sha: "c0", created: -20 })] }).reruns, []);

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

async function box(t, { judged, release: latest = release } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lane-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
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

test("13.17 · a release alarm starts one fix session per stop, quiet while it or its pull request or question is open, then asks the owner", async (t) => {
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
