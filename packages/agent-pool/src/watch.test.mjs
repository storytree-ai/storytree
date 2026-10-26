import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";

import { countEngines } from "./queue.mjs";
import { adoptRequests, asRun, ensureWatcher, forget, hand, handedOff, handOver, handThroughLibrary, isFixSession, main, projectOf, readFailures, readPull, reachOf, recordVerdict, remoteCommand, RESTART, watchOnce } from "./watch.mjs";

const at = Date.parse("2026-10-10T12:00:00Z");
const minutes = (n) => new Date(at + n * 60_000).toISOString();
const SESSION = "aaaa-session";

async function box(t, { looks = {}, board = "" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "lane-watch-"));
  t.after(() => removeTemp(dir));
  const calls = [], fixes = [], reviews = [], lines = [], live = new Set();
  let clock = at, room = true;
  const options = {
    dir, limit: 2, say: (line) => lines.push(line), now: () => clock,
    look: async (pr) => looks[pr],
    storytree: async (args) => { calls.push(args); return args[0] === "noticeboard" ? board : ""; },
    viewOf: async (pr) => view(pr),
    alive: async (pid) => live.has(pid),
    room: async () => room,
    startFix: async (fix) => { fixes.push(fix); const pid = 1000 + fixes.length; live.add(pid); return { pid, log: `/lanes/fix-${fix.pr}-${fix.n}.log` }; },
    startReview: async (review) => { reviews.push(review); const pid = 2000 + reviews.length; live.add(pid); return { pid, log: `/lanes/review-${review.pr}-${review.n}.log` }; },
  };
  return { dir, calls, fixes, reviews, lines, live, looks, options, tick: (ms) => { clock += ms; }, noRoom: () => { room = false; } };
}

const pull = ({ state = "OPEN", head = "h1", checks = [], removed = [], queued = false, mergeable = "MERGEABLE", draft = false, labels = [], cross = false, from = "storytree-ai/storytree" } = {}) => ({
  id: "PR_41", state, headRefOid: head, mergeable, ...(cross === null ? {} : { isCrossRepository: cross }), headRepository: from === null ? null : { nameWithOwner: from }, isDraft: draft, labels: { nodes: labels.map((name) => ({ name })) }, mergeQueueEntry: queued ? { state: "QUEUED" } : null,
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: checks } } } }] },
  timelineItems: { nodes: removed },
});
/** Pull request `pr` as `gh pr view` describes its head: on this repository unless `cross` and `owner` say otherwise. */
const view = (pr, { cross = false, owner = "storytree-ai" } = {}) => ({ headRefName: `claude/pr-${pr}`, isCrossRepository: cross, headRepository: { name: "storytree" }, headRepositoryOwner: { login: owner } });
const failed = { __typename: "CheckRun", name: "verify on Windows", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci/run/9" };
const passed = { __typename: "CheckRun", name: "verify", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/run/8" };
const red = { state: "red", head: "h1", why: "verify on Windows failed", logs: ["https://ci/run/9"], checks: ["verify on Windows"] };
const handOff = (b, pr = 41, increment = "increment_one") => hand({ ...b.options, pr, increment, session: SESSION, startWatcher: async () => {} });
const saved = async (b, pr = 41) => JSON.parse(await readFile(join(b.dir, `${pr}.json`), "utf8"));

test("4.1 · a handed-over pull request that merges closes its increment, releases its session's claims and is forgotten", async (t) => {
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

test("4.2 · a red check, or the queue's ejection the requeue left out, is red; a pending, queued or older ejection is not", () => {
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

test("4.2 · a red pull request starts exactly one fix session at a time, and only with an engine slot free", async (t) => {
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

test("4.8 · a pull request that conflicts with main is red with every check green, and its fix session is told to merge main", async (t) => {
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

test("4.3 · past its fix limit the watcher starts a review session, never a third fix, and at its cap writes an owner wait with the PR, the logs and the last review's summary", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 2, "two fix sessions, then no third");
  assert.equal(b.reviews.length, 1, "an independent review instead");
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"), "no owner wait below the cap");
  for (const piece of ["#41", "increment_one", "https://ci/run/9", "/lanes/fix-41-1.log", "/lanes/fix-41-2.log", "watch.mjs verdict 41"]) assert.ok(b.reviews[0].brief.includes(piece), piece);
  // Each review sends it back to a fix session, until six sessions are spent.
  for (let round = 0; round < 3; round++) {
    if ((await saved(b)).fixes.at(-1).review) await recordVerdict({ dir: b.dir, pr: 41, kind: "fix", summary: `the cache test reads a stale key (${round})` });
    await watchOnce(b.options); b.live.clear();
  }
  await watchOnce(b.options);
  assert.deepEqual([b.fixes.length, b.reviews.length], [4, 2], "fix, fix, review, fix, review, fix: six sessions");
  const wait = b.calls.at(-1);
  assert.deepEqual(wait.slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "owner"]);
  assert.equal(wait[6], "--note");
  for (const piece of ["PR #41", "verify on Windows failed", "https://ci/run/9", "/lanes/fix-41-1.log", "/lanes/review-41-5.log", "the cache test reads a stale key"]) assert.ok(wait[7].includes(piece), piece);
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is forgotten once the owner has it");
});

test("4.37 · a review session's one verdict decides the red: retried, retried after parking the flaky test's fix, fixed again, or put to the owner by its question", async (t) => {
  const retried = async (kind) => {
    const b = await box(t);
    const reruns = [];
    b.options.rerun = async (one) => { reruns.push(one.id); };
    await handOff(b);
    b.looks[41] = flaky({ outside: false });
    for (let round = 0; round < 3; round++) { await watchOnce(b.options); b.live.clear(); }
    assert.equal(b.reviews.length, 1);
    await recordVerdict({ dir: b.dir, pr: 41, kind, summary: "random timing on a loaded runner" });
    await watchOnce(b.options);
    assert.deepEqual(reruns, [5], `${kind}: its failed runs are rerun`);
    assert.deepEqual([b.fixes.length, b.reviews.length], [2, 1], `${kind}: no model session for the retry`);
    await watchOnce(b.options);
    assert.deepEqual(reruns, [5], "a look before the rerun's run has started does nothing again");
    b.looks[41] = flaky({ outside: false, run: 6 });
    await watchOnce(b.options);
    assert.equal(b.reviews.length, 2, "red again after the retry: reviewed again");
  };
  await retried("flake");
  await retried("elsewhere");

  const fixed = await box(t);
  await handOff(fixed);
  fixed.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(fixed.options); fixed.live.clear(); }
  await recordVerdict({ dir: fixed.dir, pr: 41, kind: "fix", summary: "the PR's own parser drops the last line" });
  await watchOnce(fixed.options);
  assert.equal(fixed.fixes.length, 3, "a fix the review judged a session can make");
  assert.match(fixed.fixes[2].brief, /the PR's own parser drops the last line/);

  const asked = await box(t);
  await handOff(asked);
  asked.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(asked.options); asked.live.clear(); }
  await recordVerdict({ dir: asked.dir, pr: 41, kind: "owner", summary: "it needs a paid runner", question: "question_abc" });
  asked.noRoom();
  await watchOnce(asked.options);
  assert.equal(asked.fixes.length, 2, "no session after the owner's question");
  assert.ok(!asked.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"), "the review's question holds it, not an owner wait");
  assert.deepEqual(asked.calls.at(-1), ["workspace", "let-go", "41", "--reason", "PR #41 waits on the owner's answer to question_abc; released by the watcher"]);
  assert.deepEqual(await readdir(asked.dir), [], "the hand-off is dropped");

  const silent = await box(t);
  await handOff(silent);
  silent.looks[41] = red;
  for (let round = 0; round < 4; round++) { await watchOnce(silent.options); silent.live.clear(); }
  assert.deepEqual([silent.fixes.length, silent.reviews.length], [2, 2], "a review that ended with no verdict is reviewed again");

  const outs = [];
  const b = await box(t);
  await handOff(b);
  const at = (args) => main(args, { ...b.options, out: (line) => outs.push(line) });
  assert.equal(await at(["verdict", "41", "fix", "--summary", "early"]), 1, "no review to record a verdict on");
  b.looks[41] = red;
  for (let round = 0; round < 3; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(await at(["verdict", "41", "maybe", "--summary", "unsure"]), 2, "one of the four verdicts only");
  assert.equal(await at(["verdict", "41", "owner", "--summary", "needs him"]), 1, "an owner verdict names its question");
  assert.equal(await at(["verdict", "41", "elsewhere", "--summary", "3.19 is slow on Windows", "--parked", "increment_slow"]), 0);
  assert.deepEqual((await saved(b)).fixes.at(-1).verdict, { kind: "elsewhere", summary: "3.19 is slow on Windows", parked: "increment_slow" });
});

test("4.12 · a pull request that conflicts with main past the fix limit gets one more fix session, and no owner wait", async (t) => {
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
  assert.ok(!b.calls.some(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner"), "a merge never waits on the owner (4.20)");
});

test("4.4 · a hand-off on disk survives a watcher restart, and handing back keeps its fix count", async (t) => {
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

test("4.5 · a hand-off parks the increment on an event wait and starts the watcher only when none runs; the watcher is no engine", async (t) => {
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
  const procs = { 7: "node /repo/packages/agent-pool/src/watch.mjs run", 8: "vim notes" };
  const start = (pid) => ensureWatcher({ pidFile, argsOf: async (p) => procs[p] ?? "", spawn: async () => { spawned.push(pid); return pid; } });
  await writeFile(pidFile, "7\n");
  assert.equal(await start(9), false, "a live watcher holds the pid file");
  await writeFile(pidFile, "8\n");
  assert.equal(await start(9), true, "a reused pid does not");
  assert.deepEqual(spawned, [9]);
  assert.equal(countEngines(`  7     1 ${procs[7]}`), 0, "it takes no engine slot");
});

test("4.7 · a session on any machine hands over: on the box directly, elsewhere over ssh with its own session id, refusing plainly when the watcher is out of reach", async () => {
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

test("4.30 · a session ssh cannot reach the box from hands over through the library, and the box's watcher takes it once", async (t) => {
  const written = [];
  const library = async (args) => { written.push(args); return args[1] === "hold" ? "Held for PR #41 until it merges or closes: increment_one." : ""; };
  const noSsh = async () => { throw new Error("spawn ssh ENOENT"); };
  const away = await handOver({ pr: 41, increment: "increment_one", session: SESSION, keepOpen: true, onBox: false, local: async () => {}, remote: noSsh,
    library: (request) => handThroughLibrary({ ...request, branch: "claude/pr-41", storytree: library, now: () => at }) });
  assert.equal(away.code, 0, "a cloud session with no ssh still hands over");
  assert.match(away.lines.join("\n"), /through the library/);
  assert.match(away.lines.join("\n"), /close-out --safe yes/);
  assert.deepEqual(written[0].slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "event"]);
  assert.deepEqual(written[0].slice(8), ["--check-back", minutes(3 * 24 * 60).slice(0, 10)]);
  assert.deepEqual(written[1], ["workspace", "hold", "41", "--holder", SESSION, "--branch", "claude/pr-41", "--increment", "increment_one"],
    "its claims are held for the pull request before the session closes out");

  const b = await box(t);
  const waits = ["2 waits for you or an outside event:",
    `  - event  ${written[0][7]} — increment_one  The one, on arc_a  An arc; check back 2026-10-13`,
    "  - event  PR #40 is open and green and handed to the Mint box's watcher, which closes this on its merge or starts a fix session on a red. — increment_zero  The zero, on arc_a  An arc; check back 2026-10-13",
    ""].join("\n");
  b.options.storytree = async (args) => { b.calls.push(args); return args[1] === "waits" ? waits : ""; };
  await adoptRequests(b.options);
  const record = await saved(b);
  assert.equal(record.increment, "increment_one"); assert.equal(record.session, SESSION); assert.equal(record.keepOpen, true);
  assert.deepEqual(await readdir(b.dir), ["41.json"], "a wait the box's own hand-over wrote is not a request");
  b.tick(60_000);
  await adoptRequests(b.options);
  assert.equal((await saved(b)).handedAt, minutes(0), "a request already taken is not taken again");

  b.looks[41] = { state: "merged", head: "h1" };
  b.calls.length = 0;
  await watchOnce(b.options);
  assert.ok(!b.calls.some(([, , verb]) => verb === "close"), "kept open, as the session asked");
  assert.ok(b.calls.some(([, verb, pr]) => verb === "let-go" && pr === "41"));

  const closed = await handOver({ pr: 42, increment: "increment_two", session: SESSION, onBox: false, local: async () => {}, remote: noSsh,
    library: (request) => handThroughLibrary({ ...request, branch: "claude/pr-42", now: () => at,
      storytree: async () => { throw new Error("increment_two is closed, and waits for nothing"); } }) });
  assert.equal(closed.code, 1);
  assert.match(closed.lines.join("\n"), /waits for nothing.*wait for the merge yourself/is, "a request the library refuses falls back to landing it yourself");
});

test("4.10 · a watcher whose code changes between two looks ends with the restart code, starting no fix session, and its keeper starts it again", async (t) => {
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
  t.after(() => removeTemp(home));
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
  await commit("packages/agent-pool/src/watch.mjs", "watcher v1");
  await commit("packages/dev-loop/src/test-runner.mjs", "tests v1");
  const merges = [() => commit("packages/dev-loop/src/test-runner.mjs", "tests v2"),
    () => commit("packages/agent-pool/src/watch.mjs", "watcher v2")];
  looks = 0;
  b.looks[41] = { state: "pending", head: "h1" };
  const { codeVersion: _, ...unpinned } = watching;
  assert.equal(await main(["watch"], { ...unpinned, home,
    sleep: async () => { assert.ok(merges.length, "it restarts once its own code changes"); await merges.shift()(); } }), RESTART);
  assert.equal(looks, 2, "the test runner changed: it looked again; then its own code changed: it restarted");
});

test("4.11 · a pull request handed over to keep its increment open is watched and fixed, and on MERGED leaves the increment open", async (t) => {
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

test("4.14 · a fix session refused by another session's claim hands back without counting, and is retried once the holder's session ends", async (t) => {
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
  assert.deepEqual(b.reviews.map((review) => review.pr), [41, 41], "#41 used its two, so it is reviewed, and reviewed again when its review recorded no verdict");
  assert.ok(!b.calls.some(([, , verb, inc, , waitFor]) => verb === "wait" && inc === "increment_two" && waitFor === "owner"),
    "#42's refusal leaves it one more");
  assert.equal(b.fixes.filter((fix) => fix.pr === 42).length, 3);
});

test("4.14 · a refused fix session is not started again while the session its refusal names still holds a claim, and is once that claim clears", async (t) => {
  const holding = `  - capability capability_shared  Claude Code bbbb-other (live, on claude/y), since 2026-10-10T11:00:00Z: other`;
  const b = await box(t, { board: `1 claim now:\n${holding}` });
  await handOff(b, 42, "increment_two");
  b.looks[42] = red;
  await watchOnce(b.options);
  assert.match(b.fixes[0].brief, /--refused --holder <session>/, "the brief says how to name the holder");
  await main(["hand", "42", "increment_two", "--refused", "--holder", "bbbb-other"], { dir: b.dir, now: b.options.now, out: () => {},
    storytree: b.options.storytree, viewOf: b.options.viewOf, pidFile: join(b.dir, "pid"), argsOf: async () => "", startWatcher: async () => 1 });
  assert.equal((await saved(b, 42)).fixes.at(-1).holder, "bbbb-other");
  b.live.clear();
  for (let round = 0; round < 3; round++) { b.tick(60 * 60_000); await watchOnce(b.options); }
  assert.equal(b.fixes.length, 1, "no other fix session runs, but the holder still holds its claim");
  b.options.storytree = async (args) => { b.calls.push(args); return args[0] === "noticeboard" ? "No claims now." : ""; };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "retried once the holder's claim clears");
  assert.match(b.fixes[1].brief, /Fix session 1 of 2/, "the refusal is not counted");
});

test("4.14 · a refusal that names no holder is retried only after a back-off, not at the next look", async (t) => {
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

test("4.15 · pull requests that conflict with main are merged one at a time, lowest first, and none waits on the owner for it", async (t) => {
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

test("4.13 · a pull request handed over after its increment closed on an earlier one is watched, fixed and released, with no wait or close", async (t) => {
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

test("4.18 · a pull request that conflicts with main reads as a conflict even when a check failed too, so its merges run one at a time", async (t) => {
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

test("4.19 · a fix session that pushed is not counted when a newer main conflicts its branch again, and a cap on all sessions stops a loop", async (t) => {
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

test("4.20 · a conflict past the limit goes back on its arc as ready work, naming its pull request and branch, never to the owner", async (t) => {
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

test("4.22 · a hand-over holds the session's claims for its pull request on its branch, and those for its increment on none, until it merges or closes, says when it could not, and a pull request closed unmerged lets them go", async (t) => {
  const b = await box(t);
  const outs = [];
  await main(["hand", "41", "increment_one", "--session", SESSION], { ...b.options, dir: b.dir, out: (line) => outs.push(line),
    pidFile: join(b.dir, "watch.pid"), argsOf: async () => "", startWatcher: async () => 1 });
  assert.deepEqual(b.calls.at(-1), ["workspace", "hold", "41", "--holder", SESSION, "--branch", "claude/pr-41", "--increment", "increment_one"], "held on the pull request's own branch, with the claims taken on no branch for its increment");

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

test("4.23 · a pull request open past three days since it was handed over gives its claims up and goes back on its arc as ready work; a red at its session cap lets them go too", async (t) => {
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
  spent.options.cap = 3;
  await handOff(spent);
  spent.looks[41] = red;
  for (let round = 0; round < 4; round++) { await watchOnce(spent.options); spent.live.clear(); }
  assert.deepEqual(spent.calls.at(-2), ["workspace", "let-go", "41", "--reason", "PR #41 still red after 3 sessions; released by the watcher"], "released before its owner wait");
  assert.deepEqual(spent.calls.at(-1).slice(0, 6), ["arc", "increment", "wait", "increment_one", "--for", "owner"]);
});

test("4.21 · the watcher's status says when its look loop runs code other than the checkout's", async (t) => {
  const b = await box(t);
  const procs = { 7: "node /repo/packages/agent-pool/src/watch.mjs run", 8: "node /repo/packages/agent-pool/src/watch.mjs watch" };
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

test("4.17 · a watch loop on a folder other than the box's own reads no releases, so it starts no release fix session", async (t) => {
  const b = await box(t);
  // A home with the lane runner is the box's; the loop is given another folder, as a test on the box gives it.
  const home = await mkdtemp(join(tmpdir(), "lane-watch-box-"));
  t.after(() => removeTemp(home));
  await mkdir(join(home, "storytree-lanes"), { recursive: true });
  await writeFile(join(home, "storytree-lanes", "run-lane.sh"), "");
  let version = "tree-a";
  assert.equal(await main(["watch"], { ...b.options, home, loopPidFile: join(b.dir, "watch-loop.pid"), pid: 7, argsOf: async () => "",
    codeVersion: async () => version, sleep: async () => { version = "tree-b"; } }), RESTART);
  assert.doesNotMatch(b.lines.join("\n"), /release/);
});

test("4.24 · a hand-over from another machine runs on the configured machine, in its checkout as written there; with none configured its ssh is refused", async (t) => {
  assert.deepEqual(remoteCommand({ machine: "box", remoteCheckout: "~/src/shop" }, ["hand", "41", "increment_one", "--session", SESSION]),
    ["ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "box", `cd ~/src/shop && node packages/agent-pool/src/watch.mjs hand 41 increment_one --session ${SESSION}`]]);

  const home = await mkdtemp(join(tmpdir(), "lane-watch-nobox-"));
  t.after(() => removeTemp(home));
  await writeFile(join(home, "agent-pool.json"), JSON.stringify({ lanes: join(home, "lanes") }));
  const lines = [], written = [];
  assert.equal(await main(["handover", "41", "increment_one"], { home, env: { AGENT_POOL_CONFIG: join(home, "agent-pool.json") }, onBox: false, session: SESSION,
    out: (line) => lines.push(line), ownViewOf: async () => view(41), here: async (args) => { written.push(args); return ""; } }), 0);
  assert.match(lines.join("\n"), /names no machine to hand over to; handed over through the library instead/);
  assert.deepEqual(written.map((args) => args.slice(0, 4)), [["arc", "increment", "wait", "increment_one"], ["workspace", "hold", "41", "--holder"]]);
});

test("4.26 · a fix session counts as running while its runner runs", () => {
  assert.ok(isFixSession("/usr/bin/node /home/m/code/storytree03/packages/agent-pool/src/runner.mjs run /l/watch/fix-41-1-brief.md log err"));
  assert.ok(!isFixSession("/usr/bin/node /home/m/code/storytree03/packages/agent-pool/src/runner.mjs status"));
  assert.ok(!isFixSession("vim runner.mjs"));
  assert.ok(!isFixSession(""), "a process that is gone");
});

test("4.25 · each red the watcher handles writes one pr-red line as its fix session starts, with its conflict and failed checks, in the hand-off's own project", async (t) => {
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
  t.after(() => removeTemp(top));
  for (const [folder, name] of [["repo", "storytree"], ["arm", "arm-a"]]) {
    await mkdir(join(top, folder, "deep"), { recursive: true });
    await writeFile(join(top, folder, ".storytree.json"), JSON.stringify({ project: name }));
  }
  assert.deepEqual(await projectOf({ cwd: join(top, "arm", "deep"), repo: join(top, "repo"), home: "/h" }), { folder: join(top, "arm"), home: "/h" });
  assert.equal(await projectOf({ cwd: join(top, "repo", "deep"), repo: join(top, "repo"), home: "/h" }), undefined, "the watcher's own project needs no routing");
});

test("4.28 · every start of the watcher writes the one log its status names, the lanes folder's watch.runner.log", async (t) => {
  const b = await box(t);
  const lanes = await mkdtemp(join(tmpdir(), "lane-log-"));
  t.after(() => removeTemp(lanes));
  const started = [], outs = [];
  const options = { ...b.options, env: { ...process.env, LANES_DIR: lanes }, out: (line) => outs.push(line), pidFile: join(b.dir, "watch.pid"),
    loopPidFile: join(b.dir, "watch-loop.pid"), argsOf: async () => "", startWatcher: async (log) => { started.push(log); return 1; } };
  await main(["hand", "44", "increment_one", "--session", SESSION], options);
  await main(["status"], options);
  const log = join(lanes, "watch.runner.log");
  assert.deepEqual(started, [log], "a hand-over that starts the watcher sends its output to the log");
  assert.ok(outs.includes(`log: ${log}`), outs.join("\n"));
});

test("4.29 · a pull request red only on the runner is rerun with no fix session; a refused rerun falls to one on its second look", async (t) => {
  const b = await box(t);
  const reruns = [];
  let refuse = false;
  b.options.rerun = async (run) => { if (refuse) throw new Error("run 5 cannot be rerun"); reruns.push(run.id); };
  await handOff(b);
  const runner = { runs: [{ id: 5, attempt: 1, repo: "storytree-ai/storytree" }], why: "verify on macOS: no runner took it" };
  b.looks[41] = { ...red, why: "verify on macOS failed", runner };
  await watchOnce(b.options);
  assert.deepEqual(reruns, [5]);
  assert.equal(b.fixes.length, 0, "no model session for the runner's red");
  assert.match(b.lines.at(-1), /PR #41 .*runner.*no runner took it.*rerun/);
  // Rerun again on a later attempt's runner red; the bound is the reader's (runnerReruns), so a red without one is the code's.
  b.looks[41] = { ...red, runner: { ...runner, runs: [{ ...runner.runs[0], attempt: 2 }] } };
  await watchOnce(b.options);
  assert.deepEqual(reruns, [5, 5]);
  refuse = true;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 0, "a refused rerun is looked at again first: rerun-unrun.yml may have rerun it");
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1, "refused twice on one attempt: a fix session");
  b.looks[41] = red;
  b.live.clear();
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "a code red starts a fix session as before");
  assert.deepEqual(reruns, [5, 5]);
});

test("4.27 · each runner-only rerun the watcher starts on a handed-over pull request is recorded as a ci-rerun line naming the repository, the run and the attempt it starts; a refused one is not", async (t) => {
  const b = await box(t);
  let refuse = false;
  b.options.rerun = async () => { if (refuse) throw new Error("HTTP 403"); };
  await handOff(b);
  const runs = [{ id: 5, attempt: 1, repo: "storytree-ai/storytree" }, { id: 6, attempt: 2, repo: "storytree-ai/storytree" }];
  b.looks[41] = { ...red, runner: { runs, why: "verify on macOS: no runner took it" } };
  b.calls.length = 0;
  await watchOnce(b.options);
  assert.deepEqual(b.calls.filter((args) => args[1] === "rerun"), [
    ["workspace", "rerun", "5", "--repo", "storytree-ai/storytree", "--attempt", "2", "--what", "pr"],
    ["workspace", "rerun", "6", "--repo", "storytree-ai/storytree", "--attempt", "3", "--what", "pr"],
  ]);
  b.calls.length = 0;
  refuse = true;
  await watchOnce(b.options);
  assert.deepEqual(b.calls.filter((args) => args[1] === "rerun"), [], "a rerun GitHub refused started nothing to record");
});

test("4.29 · a failed check is read as its CI run when every failed check names an Actions run", () => {
  const options = { since: minutes(-60), now: at, graceMs: 10 * 60_000 };
  const job = (name, run) => ({ ...failed, name, detailsUrl: `https://github.com/storytree-ai/storytree/actions/runs/${run}/job/7${run}` });
  assert.deepEqual(readPull(pull({ checks: [passed, job("verify on macOS", 5), job("verify", 5)] }), options).runs, [5]);
  assert.equal(readPull(pull({ checks: [job("verify on macOS", 5), failed] }), options).runs, undefined);
});

test("4.31 · a green, unheld pull request outside the merge queue reads as stranded; a held, pending, queued, unverified or just-removed one does not", () => {
  const options = { since: minutes(-60), now: at, graceMs: 10 * 60_000 };
  const skipped = { __typename: "CheckRun", name: "automerge", status: "COMPLETED", conclusion: "SKIPPED" };
  assert.deepEqual(readPull(pull({ checks: [passed, skipped] }), options), { state: "pending", head: "h1", stranded: "PR_41" });
  assert.equal(readPull(pull({ checks: [passed, skipped], draft: true }), options).stranded, undefined, "a draft is held");
  assert.equal(readPull(pull({ checks: [passed, skipped], labels: ["hold"] }), options).stranded, undefined, "the hold label holds it");
  assert.equal(readPull(pull({ checks: [passed, skipped], queued: true }), options).stranded, undefined, "already queued");
  assert.equal(readPull(pull({ checks: [passed, { ...skipped, status: "IN_PROGRESS", conclusion: null }] }), options).stranded, undefined, "automerge may still land it");
  assert.equal(readPull(pull({ checks: [skipped] }), options).stranded, undefined, "verify has not passed");
  assert.equal(readPull(pull({ checks: [passed], removed: [{ createdAt: minutes(-5), reason: "failed_checks" }] }), options).stranded, undefined, "the requeue's grace");
  assert.equal(readPull(pull({ checks: [passed, failed] }), options).state, "red");
});

test("4.31 · the watcher enqueues a stranded pull request at its head once, retries a refusal at most three times, and leaves a held one alone", async (t) => {
  const b = await box(t);
  const enqueued = [];
  let refuse = false;
  b.options.enqueue = async (id, head) => { if (refuse) throw new Error("not mergeable yet"); enqueued.push([id, head]); };
  await handOff(b);
  b.looks[41] = { state: "pending", head: "h1" };
  await watchOnce(b.options);
  assert.deepEqual(enqueued, [], "a pull request that is not stranded is not enqueued");
  b.looks[41] = { state: "pending", head: "h1", stranded: "PR_41" };
  await watchOnce(b.options);
  await watchOnce(b.options);
  assert.deepEqual(enqueued, [["PR_41", "h1"]], "enqueued once at its head");
  assert.match(b.lines.at(-1), /PR #41 .*merge queue/);
  assert.equal(b.fixes.length, 0);
  refuse = true;
  b.looks[41] = { state: "pending", head: "h2", stranded: "PR_41" };
  for (let i = 0; i < 5; i++) await watchOnce(b.options);
  assert.equal(b.lines.filter((line) => /refused/.test(line)).length, 3, "a refused enqueue is tried three times on a head, then left");
  refuse = false;
  b.looks[41] = { state: "pending", head: "h3", stranded: "PR_41" };
  await watchOnce(b.options);
  assert.deepEqual(enqueued.at(-1), ["PR_41", "h3"], "a new head is enqueued afresh");
});

test("4.32 · a pull request whose head is not on this repository, or whose head GitHub does not say, is never handed over, adopted, landed or fixed", async (t) => {
  const options = { since: minutes(-60), now: at, graceMs: 0 };
  assert.equal(readPull(pull({ state: "MERGED", cross: true, from: "mallory/storytree" }), options).state, "foreign", "a fork's merge closes nothing");
  assert.equal(readPull(pull({ checks: [failed], cross: null }), options).state, "foreign", "no isCrossRepository: never this repository's");
  assert.equal(readPull(pull({ checks: [failed], from: null }), options).state, "foreign", "no head repository");

  const b = await box(t);
  await handOff(b);
  b.calls.length = 0;
  b.looks[41] = readPull(pull({ state: "MERGED", cross: true, from: "mallory/storytree" }), options);
  await watchOnce(b.options);
  assert.ok(!b.calls.some(([, , verb]) => verb === "close"), "the increment is not closed");
  assert.deepEqual(b.calls.map((args) => args.slice(0, 3)), [["arc", "increment", "unwait"], ["workspace", "let-go", "41"]]);
  assert.deepEqual(await readdir(b.dir), [], "it is no longer watched");
  assert.equal(b.fixes.length, 0);

  const lines = [];
  const handBox = (viewOf) => ({ dir: b.dir, now: b.options.now, out: (line) => lines.push(line), storytree: b.options.storytree, viewOf,
    project: async () => undefined, pidFile: join(b.dir, "pid"), argsOf: async () => "", startWatcher: async () => 1 });
  b.calls.length = 0;
  assert.equal(await main(["hand", "43", "increment_three", "--session", SESSION], handBox(async (pr) => view(pr, { cross: true, owner: "mallory" }))), 1);
  assert.equal(await main(["hand", "43", "increment_three", "--session", SESSION], handBox(async (pr) => ({ ...view(pr), isCrossRepository: undefined }))), 1);
  assert.equal(await main(["hand", "43", "increment_three", "--session", SESSION], handBox(async () => { throw new Error("gh: not found"); })), 1, "GitHub not answering refuses too");
  assert.match(lines.join("\n"), /not handed over: PR #43's head is not on storytree-ai\/storytree/);
  assert.deepEqual(b.calls, [], "nothing waits on it and no claim is held for it");
  assert.deepEqual(await readdir(b.dir), []);

  const sshed = [], written = [];
  const away = { onBox: false, session: SESSION, out: (line) => lines.push(line), remote: async (args) => { sshed.push(args); return ""; }, here: async (args) => { written.push(args); return ""; } };
  assert.equal(await main(["handover", "43", "increment_three"], { ...away, ownViewOf: async (pr) => view(pr, { cross: true, owner: "mallory" }) }), 1);
  assert.deepEqual([sshed, written], [[], []], "a fork's pull request is refused before the box or the library is asked");
  const refusing = await handOver({ pr: 43, increment: "increment_three", session: SESSION, onBox: false, local: async () => {},
    remote: async () => { throw Object.assign(new Error("Command failed: ssh"), { stdout: "not handed over: PR #43's head is not on storytree-ai/storytree\n" }); },
    library: async (args) => { written.push(args); return []; } });
  assert.equal(refusing.code, 1);
  assert.deepEqual(written, [], "the box's refusal is not taken round through the library");

  const waits = `  - event  PR #44 is open and green and handed to the Mint box's watcher through the library by session ${SESSION}, which closes this on its merge or starts a fix session on a red. — increment_four  The four, on arc_a  An arc; check back 2026-10-13\n`;
  const adopt = await box(t);
  adopt.options.storytree = async (args) => { adopt.calls.push(args); return args[1] === "waits" ? waits : ""; };
  await adoptRequests({ ...adopt.options, viewOf: async () => { throw new Error("gh: timed out"); } });
  assert.deepEqual(await readdir(adopt.dir), [], "a head GitHub cannot be asked about is not adopted");
  await adoptRequests({ ...adopt.options, viewOf: async (pr) => view(pr, { cross: true, owner: "mallory" }) });
  assert.deepEqual(await readdir(adopt.dir), [], "a fork's is refused");
  assert.deepEqual(adopt.calls.filter(([, verb]) => verb !== "waits").map((args) => args.slice(0, 3)),
    [["arc", "increment", "unwait"], ["workspace", "let-go", "44"]], "its wait and held claims are let go");
});

test("4.33 · a merged pull request has every story's risk reading read again once from main, the changed ones said, and a red one has none read", async (t) => {
  const b = await box(t);
  const readings = [];
  let text = "Wrote 2 stories' risk readings:\n  story_a  A: 3 · depth 1 (one dependent) · radius 1 (owner only)\n  story_b  B: 1 · depth 0 (a leaf) · radius 1 (owner only)";
  b.options.readRisks = async () => { readings.push(text); return text; };
  await handOff(b, 41, "increment_one");
  await handOff(b, 42, "increment_two");
  b.looks[41] = red;
  b.looks[42] = red;
  await watchOnce(b.options);
  assert.equal(readings.length, 0, "a red pull request reads no story");

  b.looks[41] = { state: "merged", head: "h1" };
  b.looks[42] = { state: "merged", head: "h1" };
  await watchOnce(b.options);
  assert.equal(readings.length, 1, "two merges in one look read main once");
  assert.ok(b.lines.some((line) => line.includes("story_a  A: 3")) && b.lines.some((line) => line.includes("story_b  B: 1")), "a first reading says every story");

  text = text.replace("story_b  B: 1 · depth 0 (a leaf)", "story_b  B: 3 · depth 1 (one dependent)");
  b.lines.length = 0;
  await handOff(b, 43, "increment_three");
  b.looks[43] = { state: "merged", head: "h1" };
  await watchOnce(b.options);
  assert.equal(readings.length, 2);
  assert.ok(b.lines.some((line) => line.includes("story_b  B: 3")), "the changed reading is said");
  assert.ok(!b.lines.some((line) => line.includes("story_a")), "an unchanged reading is not");

  b.options.readRisks = async () => { throw new Error("origin unreachable"); };
  await handOff(b, 44, "increment_four");
  b.looks[44] = { state: "merged", head: "h1" };
  await watchOnce(b.options);
  assert.ok(b.lines.some((line) => line.includes("origin unreachable")), "a reading that fails is said, and the look goes on");
  assert.ok(!(await readdir(b.dir)).includes("44.json"), "the merge was still handled");
});

/** A job's log line as `gh api …/jobs/<id>/logs` gives it, led by its timestamp. */
const logged = (...lines) => lines.map((line) => `2026-10-24T01:41:17.7416938Z ${line}`).join("\n");
const job = (name, log, conclusion = "failure") => ({ name, conclusion, steps: 9, log });
const ci = (jobs, id = 5, attempt = 1) => ({ id, attempt, repo: "storytree-ai/storytree", jobs });
/** A red the watcher read as failing in `units` and `tests`, all outside what the pull request changes unless `outside` is false. */
const flaky = ({ head = "h1", tests = ["4.17 · a browser draws"], units = ["packages/forest-world"], run = 5, attempt = 1, outside = true } = {}) => ({ ...red, head,
  failures: { outside, units, tests, runs: [{ id: run, attempt, repo: "storytree-ai/storytree" }], key: `${run}:${attempt}` } });

test("4.34 · a red's failing units and tests are read from its red jobs' logs, and it is outside the pull request's reach only when every failing unit is a package it does not change", () => {
  const reach = reachOf(["packages/library/src/a.ts", "apps/desktop/src/b.ts", ".github/workflows/ci.yml", "pnpm-lock.yaml"]);
  assert.deepEqual([...reach].sort(), ["apps/desktop", "packages/library"]);
  const windows = job("verify on Windows 2/2", logged("✖ 3.5 · a lane launches (120000.5ms)", "✖ failing tests:", "✖ 3.5 · a lane launches (120000.5ms)",
    "results:", "  PASS    packages/library", "  FAIL    packages/agent-pool — 77.8 s (limit 510 s, learned)"));
  const macos = job("verify on macOS", logged("✖ 4.17 · a browser draws (12ms)", "  FAIL    packages/forest-world — 12 s"));
  const verify = job("verify", "", "failure");
  const read = readFailures([ci([windows, macos, verify, job("verify on Linux", "", "success")])], reach);
  assert.deepEqual(read, { outside: true, units: ["packages/agent-pool", "packages/forest-world"], tests: ["3.5 · a lane launches", "4.17 · a browser draws"],
    runs: [{ id: 5, attempt: 1, repo: "storytree-ai/storytree" }], key: "5:1" }, "the follower verify job's red is no failure of its own");
  assert.equal(readFailures([ci([windows, job("verify on Linux", logged("  FAIL    packages/library — 3 s"))])], reach).outside, false, "a unit the pull request changes is in reach");
  assert.equal(readFailures([ci([windows, job("verify on Linux", logged("error TS2322: nope"))])], reach).outside, false, "a red job with no FAIL row failed on no test");
  assert.equal(readFailures([ci([job("verify on Linux", logged("  FAIL    guidance — 3 s"))])], reach).outside, false, "a unit outside packages/ and apps/ is no package");
});

test("4.34 · a red whose failing tests all lie outside the pull request's reach is refreshed from main, or rerun when main has nothing new, and counts nothing against its fix limit", async (t) => {
  const b = await box(t);
  const refreshed = [], reruns = [];
  let behind = true;
  b.options.refresh = async (pr, head) => { if (!behind) throw new Error("the branch is up to date with main"); refreshed.push([pr, head]); };
  b.options.rerun = async (one) => { reruns.push(one.id); };
  await handOff(b);
  b.looks[41] = flaky();
  await watchOnce(b.options);
  assert.deepEqual(refreshed, [[41, "h1"]]);
  assert.equal(b.fixes.length, 0, "no model session for a flake");
  assert.match(b.lines.at(-1), /PR #41 .*outside.*4\.17 · a browser draws.*not counted/);
  await watchOnce(b.options);
  assert.deepEqual(refreshed, [[41, "h1"]], "a look before the refresh's run has started does nothing again");
  behind = false;
  b.looks[41] = flaky({ head: "h2", tests: ["3.19 · a session times out"], units: ["packages/session-management"], run: 6 });
  await watchOnce(b.options);
  assert.deepEqual(reruns, [6], "main had nothing new, so its failed run is rerun");
  assert.ok(b.calls.some((args) => args[1] === "rerun" && args[2] === "6"), "the rerun is recorded as a ci-rerun line");
  b.looks[41] = { ...red, head: "h3" };
  for (let round = 0; round < 3; round++) { await watchOnce(b.options); b.live.clear(); }
  assert.equal(b.fixes.length, 2);
  assert.match(b.fixes[0].brief, /Fix session 1 of 2/, "the flakes before it counted nothing");
  assert.equal(b.reviews.length, 1, "a counted red past the limit is reviewed");
});

test("4.35 · a test that fails again on the same pull request counts, wherever it lies", async (t) => {
  const b = await box(t);
  b.options.refresh = async () => {};
  await handOff(b);
  b.looks[41] = flaky();
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 0);
  b.looks[41] = flaky({ head: "h2", run: 7 });
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 1, "the same test failed again: not random");
  assert.match(b.fixes[0].brief, /Fix session 1 of 2/);
  b.live.clear();
  b.looks[41] = flaky({ head: "h3", run: 8, tests: ["9.1 · another"], outside: false });
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 2, "a red in reach counts as before");
});

test("4.36 · a pull request whose session cap is spent on flakes goes to the owner with a friction naming the flaky tests, never back on its arc", async (t) => {
  const b = await box(t);
  b.options.cap = 3;
  b.options.refresh = async () => {};
  await handOff(b);
  for (let round = 0; round < 3; round++) { b.looks[41] = { ...flaky({ head: `h${round}`, run: round, tests: [`1.${round} · flaky`] }), branch: "claude/increment-one" }; await watchOnce(b.options); }
  assert.equal(b.fixes.length, 0);
  b.looks[41] = { ...flaky({ head: "h9", run: 9, tests: ["1.9 · flaky"] }), branch: "claude/increment-one" };
  await watchOnce(b.options);
  assert.ok(!b.calls.some(([, , verb, id]) => verb === "edit" && id === "increment_one"), "not given back to its arc, where the pool would start it over");
  const wait = b.calls.find(([, , verb, , , waitFor]) => verb === "wait" && waitFor === "owner");
  assert.ok(wait, "an owner wait");
  assert.match(wait[7], /No review ran/);
  const friction = b.calls.find(([noun, verb]) => noun === "friction" && verb === "new");
  assert.ok(friction, "a friction is filed");
  for (const name of ["1.0 · flaky", "1.1 · flaky", "1.2 · flaky", "PR #41"]) assert.ok(friction.join(" ").includes(name), name);
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is dropped");
  assert.match(b.lines.at(-1), /PR #41.*waits on the owner/);
});

test("4.38 · a fix session on a branch behind main is told how many commits it lacks and their subjects; a branch up to date, or one the watcher cannot read, is told nothing and still fixed", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.looks[41] = red;
  const subjects = Array.from({ length: 14 }, (_, i) => `main commit ${i + 1}`);
  const asked = [];
  b.options.behind = async (head) => { asked.push(head); return { count: 14, subjects }; };
  await watchOnce(b.options);
  assert.deepEqual(asked, ["h1"], "read at the head it judged red");
  const [fix] = b.fixes;
  assert.match(fix.brief, /14 commits behind main/);
  assert.match(fix.brief, /main commit 14/);
  assert.doesNotMatch(fix.brief, /main commit 4\b/, "the subjects are capped at the newest ten");
  assert.match(fix.brief, /and 4 more/);

  b.live.clear();
  b.looks[41] = { ...red, head: "h2" };
  b.options.behind = async () => ({ count: 0, subjects: [] });
  await watchOnce(b.options);
  assert.doesNotMatch(b.fixes[1].brief, /behind main/, "up to date: nothing said");

  b.live.clear();
  b.looks[41] = { ...red, head: "h3" };
  b.options.behind = async () => { throw new Error("gh: not found"); };
  b.options.limit = 5;
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 3, "a reading that fails never stops the fix session");
  assert.doesNotMatch(b.fixes[2].brief, /commits behind main/);
});

test("4.39 · a pull request handed over before the project's repository cut-over is never looked up: its number names another pull request now, so it is forgotten, its wait cleared and its claims let go; one handed over after it is watched", async (t) => {
  const b = await box(t);
  await handOff(b, 41, "increment_one");
  b.tick(60_000);
  const flip = new Date(at + 60_000).toISOString();
  await handOff(b, 7, "increment_two");
  b.calls.length = 0;
  const looked = [];
  b.options.look = async (pr) => { looked.push(pr); return { state: "merged", head: "h1" }; };
  b.options.cutover = async () => flip;
  await watchOnce(b.options);
  assert.deepEqual(looked, [7], "only the one handed over at or after the cut-over is looked up");
  assert.deepEqual(b.calls.filter((args) => args.includes("increment_one") || args.includes("41")), [
    ["arc", "increment", "unwait", "increment_one", "--for", "event"],
    ["workspace", "let-go", "41", "--reason", "PR #41 was handed over before the repository cut-over; released by the watcher"],
  ]);
  assert.ok(b.lines.some((line) => /PR #41: handed over before the repository cut-over/.test(line)));
  assert.deepEqual(await readdir(b.dir), [], "both hand-offs are forgotten, the old one unlooked-at");
});

test("4.40 · forget sets every pull request's record aside into a dated folder, so pull request numbers that start again match no old record; nothing is deleted", async (t) => {
  const b = await box(t);
  await handOff(b, 41, "increment_one");
  await handOff(b, 7, "increment_two");
  await writeFile(join(b.dir, "fix-41-1.log"), "kept\n");
  const lines = [];
  assert.equal(await main(["forget"], { dir: b.dir, now: () => at, out: (line) => lines.push(line) }), 0);
  assert.deepEqual(await handedOff(b.dir), [], "no hand-off is read any more");
  const aside = join(b.dir, "before-20261010T120000Z");
  assert.deepEqual((await readdir(aside)).sort(), ["41.json", "7.json"]);
  assert.equal(JSON.parse(await readFile(join(aside, "41.json"), "utf8")).increment, "increment_one");
  assert.ok((await readdir(b.dir)).includes("fix-41-1.log"), "the watcher's other files stay");
  assert.match(lines[0], /set aside 2 hand-offs \(#7, #41\)/);
  assert.deepEqual(await forget({ dir: b.dir }), { prs: [] }, "a second forget finds none");
});

test("4.41 · a failed code-scanning or secret check reads as security, whatever else failed or conflicts; any other failure stays red", () => {
  const options = { since: minutes(-60), now: at, graceMs: 10 * 60_000 };
  const scan = (name) => ({ ...failed, name, detailsUrl: "https://ci/scan/1" });
  assert.deepEqual(readPull(pull({ checks: [passed, scan("CodeQL")] }), options), { state: "security", head: "h1", checks: ["CodeQL"] });
  assert.deepEqual(readPull(pull({ checks: [scan("Analyze (javascript-typescript)"), failed] }), options).checks, ["Analyze (javascript-typescript)"]);
  assert.equal(readPull(pull({ checks: [scan("secret-check")], mergeable: "CONFLICTING" }), options).state, "security");
  assert.equal(readPull(pull({ checks: [passed, { ...scan("CodeQL"), conclusion: "SUCCESS" }, failed] }), options).state, "red");
  assert.equal(readPull(pull({ checks: [scan("Analyze the logs")] }), options).state, "red");
});

test("4.41 · a security failure starts no fix session and raises one owner question on its increment's arc, naming only the pull request and the check", async (t) => {
  const b = await box(t);
  await handOff(b);
  b.calls.length = 0;
  b.options.storytree = async (args) => { b.calls.push(args); return args[0] === "library" ? "arc_owning\n" : "Raised question_s on arc_owning.\n"; };
  b.looks[41] = { state: "security", head: "h1", checks: ["CodeQL"] };
  await watchOnce(b.options);
  assert.equal(b.fixes.length, 0);
  assert.equal(b.reviews.length, 0);
  const question = b.calls.find((args) => args[0] === "question");
  assert.deepEqual(question.slice(0, 4), ["question", "new", "--arc", "arc_owning"]);
  assert.deepEqual(question.slice(-2), ["--hold", "increment_one"]);
  const text = question.join(" ");
  assert.match(text, /PR #41/);
  assert.match(text, /CodeQL/);
  assert.doesNotMatch(text, /https?:/);
  assert.ok(b.calls.some((args) => args.join(" ") === "arc increment unwait increment_one --for event"));
  assert.ok(b.calls.some((args) => args[0] === "workspace" && args[1] === "let-go" && args[2] === "41"));
  assert.ok(!b.calls.some((args) => args[1] === "red"), "no pr-red line");
  assert.deepEqual(await readdir(b.dir), [], "the hand-off is forgotten, so the next look raises nothing again");
  await watchOnce(b.options);
  assert.equal(b.calls.filter((args) => args[0] === "question").length, 1);
});

test("4.41 · a release or main run read with its jobs names the security checks that ran and failed, and none when none did or its jobs are unread", () => {
  const one = { id: 3, head_sha: "c2", created_at: minutes(0), updated_at: minutes(5), status: "completed", conclusion: "failure", run_attempt: 1, html_url: "https://ci/run/3" };
  const job = (name, conclusion = "failure", steps = 4) => ({ name, conclusion, steps });
  assert.deepEqual(asRun(one, [job("verify on Linux"), job("secret-check"), job("CodeQL", "failure", 0), job("Analyze (actions)", "success")]).security, ["secret-check"]);
  assert.equal(asRun(one, [job("verify on Linux")]).security, undefined);
  assert.equal(asRun(one).security, undefined);
  assert.equal(asRun(one).repo, "storytree-ai/storytree");
});
