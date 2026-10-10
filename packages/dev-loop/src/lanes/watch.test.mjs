import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { countEngines } from "./queue.mjs";
import { ensureWatcher, hand, handOver, main, readPull, RESTART, watchOnce } from "./watch.mjs";

const at = Date.parse("2026-10-10T12:00:00Z");
const minutes = (n) => new Date(at + n * 60_000).toISOString();
const SESSION = "aaaa-session";

async function box(t, { looks = {}, board = "" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lane-watch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [], fixes = [], lines = [], live = new Set();
  let clock = at, room = true;
  const options = {
    dir, limit: 2, say: (line) => lines.push(line), now: () => clock,
    look: async (pr) => looks[pr],
    storytree: async (args) => { calls.push(args); return args[0] === "noticeboard" ? board : ""; },
    alive: async (pid) => live.has(pid),
    room: async () => room,
    startFix: async (fix) => { fixes.push(fix); const pid = 1000 + fixes.length; live.add(pid); return { pid, log: `/lanes/fix-${fix.pr}-${fix.n}.log` }; },
  };
  return { dir, calls, fixes, lines, live, looks, options, tick: (ms) => { clock += ms; }, noRoom: () => { room = false; } };
}

const pull = ({ state = "OPEN", head = "h1", checks = [], removed = [], queued = false, mergeable = "MERGEABLE" } = {}) => ({
  state, headRefOid: head, mergeable, mergeQueueEntry: queued ? { state: "QUEUED" } : null,
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  timelineItems: { nodes: removed },
});
const failed = { __typename: "CheckRun", name: "verify on Windows", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci/run/9" };
const passed = { __typename: "CheckRun", name: "verify", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/run/8" };
const red = { state: "red", head: "h1", why: "verify on Windows failed", logs: ["https://ci/run/9"] };
const handOff = (b, pr = 41, increment = "increment_one") => hand({ ...b.options, pr, increment, session: SESSION, startWatcher: async () => {} });
const saved = async (b, pr = 41) => JSON.parse(await readFile(join(b.dir, `${pr}.json`), "utf8"));

test("13.1 · a handed-over pull request that merges closes its increment, releases its session's claims and is forgotten", async (t) => {
  const b = await box(t, { board: [
    "3 claims now:",
    `  - capability capability_left  Claude Code ${SESSION} (live, on claude/x), since 2026-10-10T11:00:00Z: work`,
    "  - capability capability_theirs  Claude Code bbbb-other (live, on claude/y), since 2026-10-10T11:00:00Z: other",
  ].join("\n") });
  await handOff(b);
  b.calls.length = 0;
  b.looks[41] = { state: "merged", head: "h1" };
  await watchOnce(b.options);
  assert.deepEqual(b.calls, [
    ["arc", "increment", "unwait", "increment_one", "--for", "event"],
    ["arc", "increment", "close", "increment_one", "--disposition", "landed", "--pr", "41"],
    ["noticeboard"],
    ["workspace", "release", "capability_left", "--holder", SESSION, "--reason", "PR #41 merged; released by the watcher"],
  ]);
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is forgotten");
  assert.equal(b.fixes.length, 0);

  await handOff(b, 42, "increment_two");
  b.looks[42] = { state: "merged", head: "h1" };
  b.options.storytree = async (args) => { if (args[2] === "close") throw new Error("increment_two is already closed"); return ""; };
  await watchOnce(b.options);
  assert.deepEqual(await readdir(b.dir), [], "a close the library refuses is said once, not retried forever");
  assert.ok(b.lines.some((line) => line.includes("refused: increment_two is already closed")));
});

test("13.2 · a red check, or the queue's ejection the requeue left out, is red; a pending, queued or older ejection is not", () => {
  const options = { since: minutes(-60), now: at, graceMs: 10 * 60_000 };
  assert.deepEqual(readPull(pull({ state: "MERGED" }), options), { state: "merged", head: "h1" });
  assert.deepEqual(readPull(pull({ state: "CLOSED" }), options), { state: "closed", head: "h1" });
  assert.deepEqual(readPull(pull({ checks: [passed, failed] }), options), red);
  assert.equal(readPull(pull({ checks: [passed, { ...failed, status: "IN_PROGRESS", conclusion: null }] }), options).state, "pending");
  const ejected = { createdAt: minutes(-20), reason: "failed_checks" };
  assert.deepEqual(readPull(pull({ checks: [passed], removed: [ejected] }), options),
    { state: "red", head: "h1", why: "the merge queue removed it (failed_checks) and did not take it back", logs: [] });
  assert.equal(readPull(pull({ checks: [passed], removed: [ejected], queued: true }), options).state, "pending", "requeued");
  assert.equal(readPull(pull({ checks: [passed], removed: [{ ...ejected, createdAt: minutes(-5) }] }), options).state, "pending", "the requeue's grace");
  assert.equal(readPull(pull({ checks: [passed], removed: [{ ...ejected, createdAt: minutes(-90) }] }), options).state, "pending", "before the hand-off");
  assert.equal(readPull(pull({ checks: [passed], removed: [{ ...ejected, reason: "merged" }] }), options).state, "pending");
});

test("13.2 · a red pull request starts exactly one fix session at a time, and only with an engine slot free", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  b.noRoom();
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 0, "no slot, no fix");
  assert.equal(b.calls.filter(([, , verb]) => verb === "unwait").length, 0, "and the increment stays parked");
  b.options.room = async () => true;
  await watchOnce(b.options);
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1, "one fix session while it runs");
  assert.deepEqual(b.calls.at(-1), ["arc", "increment", "unwait", "increment_one", "--for", "event"], "the fix session may claim it");
  const [fix] = b.fixes;
  assert.equal(fix.pr, 41); assert.equal(fix.increment, "increment_one"); assert.equal(fix.n, 1);
  assert.match(fix.brief, /verify on Windows failed/); assert.match(fix.brief, /https:\/\/ci\/run\/9/);
  assert.match(fix.brief, /stale branch/); assert.match(fix.brief, /watch\.mjs hand 41 increment_one/);
  b.live.clear();
  b.looks[41] = { state: "pending", head: "h2" };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1, "a fix that pushed is judged on its new head");
  b.looks[41] = { ...red, head: "h2" };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2);
});

test("13.8 · a pull request that conflicts with main is red with every check green, and its fix session is told to merge main", async (t) => {
  const options = { since: minutes(-60), now: at, graceMs: 10 * 60_000 };
  const conflicting = readPull(pull({ checks: [passed], mergeable: "CONFLICTING" }), options);
  assert.equal(conflicting.state, "red");
  assert.match(conflicting.why, /conflicts with main/);
  assert.equal(readPull(pull({ checks: [passed], mergeable: "UNKNOWN" }), options).state, "pending", "not yet computed");
  assert.equal(readPull(pull({ checks: [passed, failed], mergeable: "CONFLICTING" }), options).why, "verify on Windows failed", "a failed check still says which");

  const b = await box(t);
  await handOff(b);
  b.looks[41] = conflicting;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1);
  assert.match(b.fixes[0].brief, /conflicts with main/);
  assert.match(b.fixes[0].brief, /merge\s+origin\/main/);
});

test("13.3 · after its fix limit the watcher writes an owner wait with the PR and the logs", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 2, "two fix sessions, then no third");
  const wait = b.calls.at(-1);
  assert.deepEqual(wait.slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "owner"]);
  assert.equal(wait[6], "--note");
  for (const piece of ["PR #41", "verify on Windows failed", "https://ci/run/9", "/lanes/fix-41-1.log", "/lanes/fix-41-2.log"]) assert.ok(wait[7].includes(piece), piece);
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is forgotten once the owner has it");
});

test("13.4 · a hand-off on disk survives a watcher restart, and handing back keeps its fix count", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1);
  // A new watcher process: nothing in memory, the same folder, and the fix session's process still running.
  await watchOnce({ ...b.options });
  assert.equal(b.fixes.length, 1, "the running fix session is still counted");
  await handOff(b);
  assert.equal((await saved(b)).fixes.length, 1, "handed back, its fix count stands");
  b.live.clear();
  await watchOnce({ ...b.options });
  assert.equal(b.fixes.length, 2);
  assert.equal(b.fixes[1].n, 2);
});

test("13.5 · a hand-off parks the increment on an event wait and starts the watcher only when none runs; the watcher is no engine", async (t) => {
  const b = await box(t);
  let started = 0;
  await hand({ ...b.options, pr: 41, increment: "increment_one", session: SESSION, startWatcher: async () => { started++; } });
  assert.equal(b.calls.length, 1);
  assert.deepEqual(b.calls[0].slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "event"]);
  assert.match(b.calls[0][7], /PR #41/);
  assert.deepEqual(b.calls[0].slice(8), ["--check-back", minutes(3 * 24 * 60).slice(0, 10)], "an event wait needs its check-back day");
  assert.equal(started, 1);
  const record = await saved(b);
  assert.equal(record.pr, 41); assert.equal(record.increment, "increment_one"); assert.equal(record.session, SESSION);
  assert.equal(record.handedAt, minutes(0));

  const pidFile = join(b.dir, "watch.pid"), spawned = [];
  const procs = { 7: "node /repo/packages/dev-loop/src/lanes/watch.mjs run", 8: "vim notes" };
  const start = (pid) => ensureWatcher({ pidFile, argsOf: async (p) => procs[p] ?? "", spawn: async () => { spawned.push(pid); return pid; } });
  await writeFile(pidFile, "7\n");
  assert.equal(await start(9), false, "a live watcher holds the pid file");
  await writeFile(pidFile, "8\n");
  assert.equal(await start(9), true, "a reused pid does not");
  assert.deepEqual(spawned, [9]);
  assert.equal(countEngines(`  7     1 ${procs[7]}`), 0, "it takes no engine slot");
});

test("13.7 · a session on any machine hands over: on the box directly, elsewhere over ssh with its own session id, refusing plainly when the box is out of reach", async () => {
  const handed = [], sshed = [];
  const local = async (args) => { handed.push(args); };
  const ok = async (args) => { sshed.push(args); return "PR #41 handed to the watcher"; };
  assert.equal((await handOver({ pr: 41, increment: "increment_one", session: SESSION, onBox: true, local, remote: ok })).code, 0);
  assert.deepEqual(handed, [["hand", "41", "increment_one", "--session", SESSION]]);
  assert.equal(sshed.length, 0, "the box hands over without ssh");

  const away = await handOver({ pr: 41, increment: "increment_one", session: SESSION, onBox: false, local, remote: ok });
  assert.equal(away.code, 0);
  assert.deepEqual(sshed, [["hand", "41", "increment_one", "--session", SESSION]], "the laptop's own session id travels, so the watcher releases its claims");
  assert.match(away.lines.join("\n"), /close-out --safe yes/);

  const down = await handOver({ pr: 41, increment: "increment_one", session: SESSION, onBox: false, local,
    remote: async () => { throw new Error("ssh: connect to host mint port 22: Connection timed out"); } });
  assert.equal(down.code, 1);
  assert.match(down.lines.join("\n"), /could not reach the Mint box.*Connection timed out/s);
  assert.match(down.lines.join("\n"), /wait for the merge yourself/i, "the session falls back to landing it itself");

  const nobody = await handOver({ pr: 41, increment: "increment_one", session: "", onBox: false, local, remote: ok });
  assert.equal(nobody.code, 1, "with no session id the watcher could not release the session's claims");
  assert.equal(sshed.length, 1);
});

test("13.10 · a watcher whose code changes between two looks ends with the restart code, starting no fix session, and its keeper starts it again", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = { state: "pending", head: "h1" };
  let version = "tree-a", looks = 0;
  const watching = { ...b.options, loopPidFile: join(b.dir, "watch-loop.pid"), pid: 7, argsOf: async () => "",
    codeVersion: async () => version,
    look: async (pr) => { looks++; return b.looks[pr]; },
    // The checkout moves on, and the pull request goes red, while the watcher sleeps between looks.
    sleep: async () => { version = "tree-b"; b.looks[41] = red; } };
  assert.equal(await main(["watch"], watching), RESTART);
  assert.equal(looks, 1, "it looked once, on the code it started with");
  assert.equal(b.fixes.length, 0, "no fix session is started after the change");
  assert.match(b.lines.join("\n"), /tree-a → tree-b/);

  // `run` keeps it running: a restart starts the loop again (on the new code), anything else after a pause, until another holds it.
  const ends = [RESTART, 0, 1], slept = [];
  const kept = await main(["run"], { ...watching, pidFile: join(b.dir, "watch.pid"), sleep: async (ms) => { slept.push(ms); },
    intervalMs: 60_000, loop: async () => ends.shift() });
  assert.equal(kept, 1);
  assert.deepEqual(ends, [], "the loop ran three times");
  assert.deepEqual(slept, [60_000], "only an unexpected end waits before starting again");

  // Its version is its own code's: a merge touching only other dev loop code leaves it looking, its own file restarts it.
  const home = await mkdtemp(join(tmpdir(), "lane-watch-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, "code", "storytree03");
  const git = (...args) => promisify(execFile)("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
  const commit = async (path, text) => {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
    await git("add", "-A");
    await git("commit", "-qm", path);
  };
  await mkdir(repo, { recursive: true });
  await git("init", "-q");
  await commit("packages/dev-loop/src/lanes/watch.mjs", "watcher v1");
  await commit("packages/dev-loop/src/test-runner.mjs", "tests v1");
  const merges = [() => commit("packages/dev-loop/src/test-runner.mjs", "tests v2"),
    () => commit("packages/dev-loop/src/lanes/watch.mjs", "watcher v2")];
  looks = 0;
  b.looks[41] = { state: "pending", head: "h1" };
  const { codeVersion: _, ...unpinned } = watching;
  assert.equal(await main(["watch"], { ...unpinned, home,
    sleep: async () => { assert.ok(merges.length, "it restarts once its own code changes"); await merges.shift()(); } }), RESTART);
  assert.equal(looks, 2, "the test runner changed: it looked again; then its own code changed: it restarted");
});
