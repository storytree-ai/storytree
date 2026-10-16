import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { countEngines } from "./queue.mjs";
import { ensureWatcher, hand, handOver, main, projectOf, readPull, remoteCommand, RESTART, watchOnce } from "./watch.mjs";

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
    branchOf: async (pr) => `claude/pr-${pr}`,
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
const red = { state: "red", head: "h1", why: "verify on Windows failed", logs: ["https://ci/run/9"], checks: ["verify on Windows"] };
const handOff = (b, pr = 41, increment = "increment_one") => hand({ ...b.options, pr, increment, session: SESSION, startWatcher: async () => {} });
const saved = async (b, pr = 41) => JSON.parse(await readFile(join(b.dir, `${pr}.json`), "utf8"));

test("13.1 · a handed-over pull request that merges closes its increment, releases its session's claims and is forgotten", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.calls.length = 0;
  b.looks[41] = { state: "merged", head: "h1" };
  await watchOnce(b.options);
  assert.deepEqual(b.calls, [
    ["arc", "increment", "unwait", "increment_one", "--for", "event"],
    ["arc", "increment", "close", "increment_one", "--disposition", "landed", "--pr", "41"],
    ["workspace", "let-go", "41", "--reason", "PR #41 merged; released by the watcher"],
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
    { state: "red", head: "h1", why: "the merge queue removed it (failed_checks) and did not take it back", logs: [], checks: [] });
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
  assert.match(readPull(pull({ checks: [passed, failed], mergeable: "CONFLICTING" }), options).why, /verify on Windows failed/, "a failed check still says which");

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

test("13.12 · a pull request that conflicts with main past the fix limit gets one more fix session, and no owner wait", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  for (let round = 0; round < 2; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 2);
  const conflict = readPull(pull({ checks: [passed], mergeable: "CONFLICTING" }), { since: minutes(-60), now: at, graceMs: 0 });
  b.looks[41] = conflict;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 3, "a merge needs a session, not the owner");
  assert.match(b.fixes[2].brief, /conflicts with main/);
  assert.deepEqual(b.calls.at(-1), ["arc", "increment", "unwait", "increment_one", "--for", "event"], "the merge session may claim it");
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"));
  b.live.clear();
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 3, "and only one more");
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"), "a merge never waits on the owner (13.20)");
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
  const ok = async (args) => { sshed.push(args); return "PR #41 handed to the watcher\nClose out with: pnpm storytree session close-out --safe yes --why \"PR #41 open and green, handed to the watcher\"\n"; };
  assert.equal((await handOver({ pr: 41, increment: "increment_one", session: SESSION, onBox: true, local, remote: ok })).code, 0);
  assert.deepEqual(handed, [["hand", "41", "increment_one", "--session", SESSION]]);
  assert.equal(sshed.length, 0, "the box hands over without ssh");

  const away = await handOver({ pr: 41, increment: "increment_one", session: SESSION, onBox: false, local, remote: ok });
  assert.equal(away.code, 0);
  assert.deepEqual(sshed, [["hand", "41", "increment_one", "--session", SESSION]], "the laptop's own session id travels, so the watcher releases its claims");
  assert.equal(away.lines.join("\n").match(/close-out --safe yes/g)?.length, 1, "the box's own words are relayed, with the close-out line said once");

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

test("13.11 · a pull request handed over to keep its increment open is watched and fixed, and on MERGED leaves the increment open", async (t) => {
  const b = await box(t);
  await hand({ ...b.options, pr: 41, increment: "increment_one", session: SESSION, keepOpen: true, startWatcher: async () => {} });
  assert.doesNotMatch(b.calls[0][7], /closes this/, "its wait does not promise to close the increment");
  b.looks[41] = red;
  await watchOnce(b.options);
  assert.match(b.fixes[0].brief, /watch\.mjs hand 41 increment_one --keep-open/, "the fix session hands it back keeping it open");
  b.live.clear();
  b.calls.length = 0;
  b.looks[41] = { state: "merged", head: "h2" };
  await watchOnce(b.options);
  assert.deepEqual(b.calls, [
    ["arc", "increment", "unwait", "increment_one", "--for", "event"],
    ["workspace", "let-go", "41", "--reason", "PR #41 merged; released by the watcher"],
  ], "no close");
  assert.match(b.lines.at(-1), /PR #41 merged: increment_one stays open/);
  assert.deepEqual(await readdir(b.dir), []);

  const handed = [];
  await handOver({ pr: 43, increment: "increment_one", session: SESSION, keepOpen: true, onBox: false, local: async () => {},
    remote: async (args) => { handed.push(args); return ""; } });
  assert.deepEqual(handed, [["hand", "43", "increment_one", "--session", SESSION, "--keep-open"]], "the flag travels over ssh");
  const outs = [];
  await main(["hand", "44", "increment_one", "--keep-open", "--session", SESSION], { ...b.options, dir: b.dir, out: (line) => outs.push(line),
    pidFile: join(b.dir, "watch.pid"), argsOf: async () => "", startWatcher: async () => 1 });
  const record = await saved(b, 44);
  assert.equal(record.keepOpen, true); assert.equal(record.session, SESSION);
  assert.match(outs[0], /stays open/);
});

test("13.14 · a fix session refused by another session's claim hands back without counting, and is retried once the holder's session ends", async (t) => {
  const b = await box(t);
  await handOff(b, 41, "increment_one");
  await handOff(b, 42, "increment_two");
  b.looks[41] = red;
  b.looks[42] = red;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2);
  assert.match(b.fixes[1].brief, /watch\.mjs hand 42 increment_two --refused/, "the brief says how to hand back a refusal");
  // #42's session is refused (#41's session holds what it needs), hands back with --refused, and ends.
  await hand({ ...b.options, pr: 42, increment: "increment_two", session: SESSION, refused: true, startWatcher: async () => {} });
  b.live.delete(1002);
  for (let round = 0; round < 3; round++) await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "no retry while the holder's fix session runs");
  b.live.clear();
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41, 42, 41], "#41's next session starts; #42 waits while it runs");
  b.live.clear();
  b.tick(15 * 60_000);
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41, 42, 41, 42], "retried once no other fix session runs and the back-off has passed");
  assert.match(b.fixes[3].brief, /Fix session 1 of 2/, "the refusal is not counted");
  b.live.clear();
  await watchOnce(b.options);
  assert.ok(b.calls.some(([, , verb, inc, , waitFor]) => verb === "wait" && inc === "increment_one" && waitFor === "owner"), "#41 used its two");
  assert.ok(!b.calls.some(([, , verb, inc, , waitFor]) => verb === "wait" && inc === "increment_two" && waitFor === "owner"),
    "#42's refusal leaves it one more");
  assert.equal(b.fixes.filter((fix) => fix.pr === 42).length, 3);
});

test("13.14 · a refused fix session is not started again while the session its refusal names still holds a claim, and is once that claim clears", async (t) => {
  const holding = `  - capability capability_shared  Claude Code bbbb-other (live, on claude/y), since 2026-10-10T11:00:00Z: other`;
  const b = await box(t, { board: `1 claim now:\n${holding}` });
  await handOff(b, 42, "increment_two");
  b.looks[42] = red;
  await watchOnce(b.options);
  assert.match(b.fixes[0].brief, /--refused --holder <session>/, "the brief says how to name the holder");
  await main(["hand", "42", "increment_two", "--refused", "--holder", "bbbb-other"], { dir: b.dir, now: b.options.now, out: () => {},
    storytree: b.options.storytree, branchOf: b.options.branchOf, pidFile: join(b.dir, "pid"), argsOf: async () => "", startWatcher: async () => 1 });
  assert.equal((await saved(b, 42)).fixes.at(-1).holder, "bbbb-other");
  b.live.clear();
  for (let round = 0; round < 3; round++) { b.tick(60 * 60_000); await watchOnce(b.options); }
  assert.equal(b.fixes.length, 1, "no other fix session runs, but the holder still holds its claim");
  b.options.storytree = async (args) => { b.calls.push(args); return args[0] === "noticeboard" ? "No claims now." : ""; };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "retried once the holder's claim clears");
  assert.match(b.fixes[1].brief, /Fix session 1 of 2/, "the refusal is not counted");
});

test("13.14 · a refusal that names no holder is retried only after a back-off, not at the next look", async (t) => {
  const b = await box(t);
  await handOff(b, 42, "increment_two");
  b.looks[42] = red;
  await watchOnce(b.options);
  await hand({ ...b.options, pr: 42, increment: "increment_two", session: SESSION, refused: true, startWatcher: async () => {} });
  b.live.clear();
  for (let round = 0; round < 5; round++) { b.tick(60_000); await watchOnce(b.options); }
  assert.equal(b.fixes.length, 1, "five looks a minute apart start nothing");
  b.tick(15 * 60_000);
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "retried once the back-off has passed");
});

test("13.15 · pull requests that conflict with main are merged one at a time, lowest first, and none waits on the owner for it", async (t) => {
  const b = await box(t);
  const conflict = readPull(pull({ checks: [passed], mergeable: "CONFLICTING" }), { since: minutes(-60), now: at, graceMs: 0 });
  for (const pr of [43, 41, 42]) { await handOff(b, pr, `increment_${pr}`); b.looks[pr] = conflict; }
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41], "one merge session at a time");
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41]);
  b.live.clear();
  b.looks[41] = { state: "merged", head: "h2" };
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41, 42], "the next sibling once the first is done");
  b.looks[42] = { state: "pending", head: "h2" };
  b.live.clear();
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41, 42, 43]);
  b.looks[44] = red;
  await handOff(b, 44, "increment_44");
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41, 42, 43, 44], "a red that is no conflict does not wait for the merge");
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"));
});

test("13.13 · a pull request handed over after its increment closed on an earlier one is watched, fixed and released, with no wait or close", async (t) => {
  const b = await box(t);
  const storytree = b.options.storytree;
  b.options.storytree = async (args) => {
    if (args[2] === "wait" || args[2] === "unwait" || args[2] === "close") throw new Error(`increment "increment_one" is closed, and waits for nothing`);
    return storytree(args);
  };
  await hand({ ...b.options, pr: 42, increment: "increment_one", session: SESSION, startWatcher: async () => {} });
  assert.equal((await saved(b, 42)).closed, true, "the hand-off stands, marked as on a closed increment");
  b.looks[42] = { ...red, head: "h1" };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1, "its red gets a fix session");
  assert.match(b.fixes[0].brief, /already closed/, "told not to claim the closed increment");
  assert.match(b.fixes[0].brief, /watch\.mjs hand 42 increment_one/);
  b.live.clear();
  b.calls.length = 0;
  b.looks[42] = { state: "merged", head: "h2" };
  await watchOnce(b.options);
  assert.deepEqual(b.calls, [
    ["workspace", "let-go", "42", "--reason", "PR #42 merged; released by the watcher"],
  ], "no wait cleared and no close tried");
  assert.match(b.lines.at(-1), /PR #42 merged: increment_one had already closed/);
  assert.ok(!b.lines.some((line) => line.includes("refused")), "nothing refused along the way");
  assert.deepEqual(await readdir(b.dir), []);

  await assert.rejects(hand({ ...b.options, storytree: async () => { throw new Error("increment_nope is not a live increment"); },
    pr: 43, increment: "increment_nope", session: SESSION, startWatcher: async () => {} }), /not a live increment/, "any other refusal still stops the hand-off");
});

const conflictOn = (head, checks = [passed]) => readPull(pull({ head, checks, mergeable: "CONFLICTING" }), { since: minutes(-60), now: at, graceMs: 0 });

test("13.18 · a pull request that conflicts with main reads as a conflict even when a check failed too, so its merges run one at a time", async (t) => {
  const both = conflictOn("h1", [passed, failed]);
  assert.equal(both.state, "red");
  assert.equal(both.conflict, true, "the conflict is not hidden by the failed check");
  assert.match(both.why, /conflicts with main/);
  assert.match(both.why, /verify on Windows failed/);

  const b = await box(t);
  for (const pr of [41, 42]) { await handOff(b, pr, `increment_${pr}`); b.looks[pr] = both; }
  await watchOnce(b.options);
  assert.deepEqual(b.fixes.map((fix) => fix.pr), [41], "the second conflict waits for the first merge session");
});

test("13.19 · a fix session that pushed is not counted when a newer main conflicts its branch again, and a cap on all sessions stops a loop", async (t) => {
  const b = await box(t);
  await handOff(b);
  let head = 0;
  // Each fix session merges main and pushes; the next sibling's landing conflicts the branch again.
  for (let round = 0; round < 4; round++) { b.looks[41] = conflictOn(`h${++head}`); await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 4, "every fix that moved the branch is free");
  assert.match(b.fixes[3].brief, /Fix session 1 of 3/);
  b.looks[41] = conflictOn(`h${head}`);
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 5, "a fix that did not push counts");
  assert.match(b.fixes[4].brief, /Fix session 2 of 3/);

  const capped = await box(t);
  capped.options.cap = 3;
  await handOff(capped);
  for (let round = 0; round < 5; round++) { capped.looks[41] = conflictOn(`h${round}`); await watchOnce(capped.options); capped.live.clear(); }
  assert.equal(capped.fixes.length, 3, "no fourth session past the cap");
  assert.deepEqual(await readdir(capped.dir), [], "the hand-off is dropped");

  const plain = await box(t);
  await handOff(plain);
  for (let round = 0; round < 3; round++) { plain.looks[41] = { ...red, head: `h${round}` }; await watchOnce(plain.options); plain.live.clear(); }
  assert.equal(plain.fixes.length, 2, "a red that is no conflict counts every fix");
});

test("13.20 · a conflict past the limit goes back on its arc as ready work, naming its pull request and branch, never to the owner", async (t) => {
  const b = await box(t);
  b.options.storytree = async (args) => {
    b.calls.push(args);
    if (args[0] === "library" && args[1] === "read") return "The increment's own breakdown.";
    if (args[2] === "edit") b.calls.at(-1).push(await readFile(args.at(-1).slice(1), "utf8"));
    return "";
  };
  await handOff(b);
  b.looks[41] = { ...conflictOn("h1"), branch: "claude/increment-one" };
  for (let round = 0; round < 4; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 3, "the limit and the conflict's one more");
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"), "no owner wait");
  const edit = b.calls.find(([, , verb]) => verb === "edit");
  assert.deepEqual(edit.slice(0, 5), ["arc", "increment", "edit", "increment_one", "--body"]);
  const body = edit.at(-1);
  assert.match(body, /^The increment's own breakdown\./, "the body keeps what it said");
  assert.match(body, /PR #41/); assert.match(body, /claude\/increment-one/); assert.match(body, /merge origin\/main/);
  assert.deepEqual(b.calls.slice(-2), [["arc", "increment", "unwait", "increment_one", "--for", "event"],
    ["workspace", "let-go", "41", "--reason", "PR #41 still conflicts with main after 3 fix sessions; released by the watcher"]], "the pool may take it again");
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is dropped");
  assert.match(b.lines.at(-1), /PR #41.*back on its arc/);
});

test("13.22 · a hand-over holds the session's claims for its pull request on its branch until it merges or closes, says when it could not, and a pull request closed unmerged lets them go", async (t) => {
  const b = await box(t);
  const outs = [];
  await main(["hand", "41", "increment_one", "--session", SESSION], { ...b.options, dir: b.dir, out: (line) => outs.push(line),
    pidFile: join(b.dir, "watch.pid"), argsOf: async () => "", startWatcher: async () => 1 });
  assert.deepEqual(b.calls.at(-1), ["workspace", "hold", "41", "--holder", SESSION, "--branch", "claude/pr-41"], "held on the pull request's own branch");

  const said = await hand({ ...b.options, pr: 42, increment: "increment_two", session: "", branch: "claude/pr-42", startWatcher: async () => {} });
  assert.match(said.held, /no session id/);
  const unread = await hand({ ...b.options, pr: 43, increment: "increment_three", session: SESSION, branch: "", startWatcher: async () => {} });
  assert.match(unread.held, /branch could not be read/);
  assert.ok(!b.calls.some(([family, verb, pr]) => family === "workspace" && verb === "hold" && pr !== "41"), "nothing to hold them by, none held");
  const failing = { ...b.options, storytree: async (args) => { if (args[1] === "hold") throw new Error("the library is out of reach"); return ""; } };
  const refused = await hand({ ...failing, pr: 44, increment: "increment_four", session: SESSION, branch: "claude/pr-44", startWatcher: async () => {} });
  assert.match(refused.held, /could not be held \(the library is out of reach\)/);
  assert.equal((await saved(b, 44)).pr, 44, "the hand-off stands, and the close-out releases the claims as before");

  b.calls.length = 0;
  b.looks[41] = { state: "closed", head: "h1" };
  for (const pr of [42, 43, 44]) b.looks[pr] = { state: "pending", head: "h1" };
  await watchOnce(b.options);
  assert.deepEqual(b.calls.filter(([, verb]) => verb === "let-go"), [["workspace", "let-go", "41", "--reason", "PR #41 closed without merging; released by the watcher"]]);
});

test("13.23 · a pull request open past three days since it was handed over gives its claims up and goes back on its arc as ready work; a red past its limit lets them go too", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = { state: "pending", head: "h1", branch: "claude/increment-one" };
  b.tick(3 * 86_400_000 - 60_000);
  await watchOnce(b.options);
  assert.ok(!b.calls.some(([, verb]) => verb === "let-go"), "within three days it holds them");
  b.tick(120_000);
  await watchOnce(b.options);
  assert.deepEqual(b.calls.slice(-3).map((call) => call.slice(0, 3)), [["arc", "increment", "edit"], ["arc", "increment", "unwait"], ["workspace", "let-go", "41"]]);
  assert.match(b.calls.at(-1)[4], /open for 3 days/);
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is dropped");
  assert.match(b.lines.at(-1), /PR #41 open past 3 days.*back on its arc/);

  const spent = await box(t);
  await handOff(spent);
  spent.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(spent.options); spent.live.clear(); }
  assert.deepEqual(spent.calls.at(-2), ["workspace", "let-go", "41", "--reason", "PR #41 still red after 2 fix sessions; released by the watcher"], "released before its owner wait");
  assert.deepEqual(spent.calls.at(-1).slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "owner"]);
});

test("13.21 · the watcher's status says when its look loop runs code other than the checkout's", async (t) => {
  const b = await box(t);
  const procs = { 7: "node /repo/packages/dev-loop/src/lanes/watch.mjs run", 8: "node /repo/packages/dev-loop/src/lanes/watch.mjs watch" };
  let checkout = "tree-a";
  const status = async (extra = {}) => {
    const outs = [];
    await main(["status"], { ...b.options, out: (line) => outs.push(line), pidFile: join(b.dir, "watch.pid"), loopPidFile: join(b.dir, "watch-loop.pid"),
      argsOf: async (pid) => procs[pid] ?? "", codeVersion: async () => checkout, ...extra });
    return outs.join("\n");
  };
  await writeFile(join(b.dir, "watch.pid"), "7\n");
  await writeFile(join(b.dir, "watch-loop.pid"), "8\n");
  assert.match(await status(), /look loop: running \(pid 8\).*unknown/, "a loop that recorded no version predates the check");

  // A look loop records the version it started on.
  const looping = { ...b.options, loopPidFile: join(b.dir, "watch-loop.pid"), pid: 8, argsOf: async (pid) => procs[pid] ?? "",
    codeVersion: async () => checkout, sleep: async () => { checkout = "tree-b"; } };
  b.looks = {};
  assert.equal(await main(["watch"], looping), RESTART);
  await writeFile(join(b.dir, "watch-loop.pid"), "8\n");
  checkout = "tree-a";
  assert.match(await status(), /look loop: running \(pid 8\) on the checkout's code \(tree-a\)/);
  checkout = "tree-b";
  assert.match(await status(), /look loop: running \(pid 8\) on stale code: tree-a, while the checkout has tree-b/);
  delete procs[8];
  assert.match(await status(), /look loop: not running/);
});

test("13.17 · a watch loop on a folder other than the box's own reads no releases, so it starts no release fix session", async (t) => {
  const b = await box(t);
  // A home with the lane runner is the box's; the loop is given another folder, as a test on the box gives it.
  const home = await mkdtemp(join(tmpdir(), "lane-watch-box-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "storytree-lanes"), { recursive: true });
  await writeFile(join(home, "storytree-lanes", "run-lane.sh"), "");
  let version = "tree-a";
  assert.equal(await main(["watch"], { ...b.options, home, loopPidFile: join(b.dir, "watch-loop.pid"), pid: 7, argsOf: async () => "",
    codeVersion: async () => version, sleep: async () => { version = "tree-b"; } }), RESTART);
  assert.doesNotMatch(b.lines.join("\n"), /release/);
});

test("13.24 · a hand-over from another machine runs on the configured machine, in its checkout as written there; with none configured it is refused", async (t) => {
  assert.deepEqual(remoteCommand({ machine: "box", remoteCheckout: "~/src/shop" }, ["hand", "41", "increment_one", "--session", SESSION]),
    ["ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "box", `cd ~/src/shop && node packages/dev-loop/src/lanes/watch.mjs hand 41 increment_one --session ${SESSION}`]]);

  const home = await mkdtemp(join(tmpdir(), "lane-watch-nobox-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "agent-pool.json"), JSON.stringify({ lanes: join(home, "lanes") }));
  const lines = [];
  assert.equal(await main(["handover", "41", "increment_one"], { home, env: { AGENT_POOL_CONFIG: join(home, "agent-pool.json") }, onBox: false, session: SESSION,
    out: (line) => lines.push(line) }), 1);
  assert.match(lines.join("\n"), /names no machine to hand over to/);
});

test("13.25 · each red the watcher handles writes one pr-red line as its fix session starts, with its conflict and failed checks, in the hand-off's own project", async (t) => {
  const b = await box(t);
  const where = [];
  b.options.storytree = async (args, project) => { b.calls.push(args); where.push(project); return ""; };
  const arm = { folder: "/arms/a", home: "/arms/a/.home" };
  await hand({ ...b.options, pr: 41, increment: "increment_one", session: SESSION, project: arm, startWatcher: async () => {} });
  await handOff(b, 42, "increment_two");
  b.looks[41] = red;
  b.looks[42] = readPull(pull({ checks: [passed], mergeable: "CONFLICTING" }), { since: minutes(-60), now: at, graceMs: 0 });
  await watchOnce(b.options);
  await watchOnce(b.options);
  const reds = b.calls.map((args, i) => [args, where[i]]).filter(([[family, verb]]) => family === "workspace" && verb === "red");
  assert.deepEqual(reds, [
    [["workspace", "red", "41", "--increment", "increment_one", "--check", "verify on Windows"], arm],
    [["workspace", "red", "42", "--increment", "increment_two", "--conflict"], undefined],
  ], "one line per fix session started, none while it runs");
  assert.equal(b.fixes.length, 2);

  const top = await mkdtemp(join(tmpdir(), "lane-watch-project-"));
  t.after(() => rm(top, { recursive: true, force: true }));
  for (const [folder, name] of [["repo", "storytree"], ["arm", "arm-a"]]) {
    await mkdir(join(top, folder, "deep"), { recursive: true });
    await writeFile(join(top, folder, ".storytree.json"), JSON.stringify({ project: name }));
  }
  assert.deepEqual(await projectOf({ cwd: join(top, "arm", "deep"), repo: join(top, "repo"), home: "/h" }), { folder: join(top, "arm"), home: "/h" });
  assert.equal(await projectOf({ cwd: join(top, "repo", "deep"), repo: join(top, "repo"), home: "/h" }), undefined, "the watcher's own project needs no routing");
});
