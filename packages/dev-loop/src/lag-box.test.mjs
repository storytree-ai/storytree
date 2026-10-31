// The Mint box's lag runner (packages/dev-loop/src/lag-box.mjs, ADR-1001 D3): what it runs next, where each action's baseline sits,
// when a slowdown counts and which pull request it names are pure functions over a recorded history; the history is kept in the
// library's server, where any machine's `pnpm lag:box` reads it back; and a run that passes its limit is stopped, never left holding
// the heavy-run lock.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

import { actionStates, decide, lagVerdicts, makeCheckouts, openHistory, recordLagVerdicts, runBounded, runLimitMs, statusText, tick as runTick } from "./lag-box.mjs";

const ACTIONS = ["open-smallest-island", "open-largest-island", "close-panel"];
// main's first-parent history, oldest first: m0, then merges m1..m20, each of pull request 100 + n.
const LOG = Array.from({ length: 21 }, (_, n) => ({ commit: `m${n}`, subject: n === 0 ? "start" : `Merge pull request #${100 + n} from storytree-ai/branch-${n}` }));
const main = (n) => ({ commit: `m${n}`, parent: `m${n - 1}` });
const verdicts = (slower = [], { size = "standard" } = {}) => ACTIONS.map((name) => ({ name, size, verdict: slower.includes(name) ? "slower" : "same", against: 100, this: slower.includes(name) ? 300 : 100 }));
let seq = 0;
const done = (purpose, head, against, slower = [], actions = null) => ({ seq: ++seq, purpose, head, against, actions, state: "done", rows: verdicts(slower) });

test("8.11 pnpm lag:box runs the newest main once main has moved past the last commit measured and no run is going: ten merges while one run is going produce one further run, on the tenth", () => {
  const history = [{ seq: 1, purpose: "measure", head: "m1", against: "m0", actions: null, state: "running" }];
  for (let n = 2; n <= 10; n += 1) assert.deepEqual(decide({ history, main: main(n), actions: ACTIONS, log: LOG }).comparisons, [], `merge m${n} lands while m1 is measured: nothing starts`);
  history[0] = { ...history[0], state: "done", rows: verdicts() };
  const next = decide({ history, main: main(10), actions: ACTIONS, log: LOG });
  assert.deepEqual(next.comparisons, [{ purpose: "measure", head: "m10", against: "m1", actions: null }], "one run, on the newest main, against the last commit within the margin; m2..m9 are skipped");
  history.push({ seq: 2, ...next.comparisons[0], state: "done", rows: verdicts() });
  assert.deepEqual(decide({ history, main: main(10), actions: ACTIONS, log: LOG }).comparisons, [], "main measured: nothing to run");
  assert.deepEqual(decide({ history: [], main: main(3), actions: ACTIONS, log: LOG }).comparisons, [{ purpose: "measure", head: "m3", against: "m2", actions: null }], "the first run compares main with its parent");
  const timedOut = [{ seq: 1, purpose: "measure", head: "m3", against: "m2", actions: null, state: "not-run", reason: "passed its limit" }];
  assert.deepEqual(decide({ history: timedOut, main: main(3), actions: ACTIONS, log: LOG }).comparisons, [], "a run that could not finish is not retried on the same main");
});

test("8.12 pnpm lag:box keeps each action's baseline at the last commit it was within the margin: a slowdown counts once a second run agrees, the baseline does not move over it, and a re-baseline moves it with its reason", () => {
  seq = 0;
  const history = [done("measure", "m1", "m0")];
  history.push(done("measure", "m4", "m1", ["close-panel"]));
  let state = actionStates({ history, actions: ACTIONS, log: LOG });
  assert.equal(state["open-smallest-island"].baseline, "m4", "within the margin: the baseline moves to the commit measured");
  assert.equal(state["close-panel"].baseline, "m1", "slower once: the baseline stays");
  assert.equal(state["close-panel"].slowdown, undefined, "one run is not a slowdown");
  assert.equal(state["close-panel"].suspect, "m4");
  assert.deepEqual(decide({ history, main: main(4), actions: ACTIONS, log: LOG }).comparisons, [{ purpose: "confirm", head: "m4", against: "m1", actions: ["close-panel"] }], "a second run is asked for, though main has not moved");

  const once = [...history, done("confirm", "m4", "m1", [], ["close-panel"])];
  state = actionStates({ history: once, actions: ACTIONS, log: LOG });
  assert.equal(state["close-panel"].slowdown, undefined, "the second run disagrees: no slowdown");
  assert.equal(state["close-panel"].baseline, "m4");

  history.push(done("confirm", "m4", "m1", ["close-panel"], ["close-panel"]));
  state = actionStates({ history, actions: ACTIONS, log: LOG });
  assert.deepEqual({ ...state["close-panel"].slowdown, pr: undefined }, { baseline: "m1", at: "m4", lo: "m1", hi: "m4", culprit: undefined, between: ["m2", "m3"], pr: undefined }, "the second run agrees: a slowdown, the merges between it and its baseline to halve");
  history.push(done("measure", "m6", "m4", [], ["open-smallest-island", "open-largest-island"]), done("measure", "m6", "m1", ["close-panel"], ["close-panel"]));
  state = actionStates({ history, actions: ACTIONS, log: LOG });
  assert.equal(state["close-panel"].baseline, "m1", "still slower: the baseline does not move forward over the slowdown");
  assert.equal(state["open-largest-island"].baseline, "m6");
  assert.deepEqual(decide({ history: history.concat({ seq: 99, purpose: "bisect", head: "m3", against: "m1", actions: ["close-panel"], state: "done", rows: verdicts(["close-panel"]) }, { seq: 100, purpose: "bisect", head: "m2", against: "m1", actions: ["close-panel"], state: "done", rows: verdicts() }), main: main(7), actions: ACTIONS, log: LOG }).comparisons,
    [{ purpose: "measure", head: "m7", against: "m6", actions: ["open-smallest-island", "open-largest-island"] }, { purpose: "measure", head: "m7", against: "m1", actions: ["close-panel"] }], "each action is measured against its own baseline");

  history.push({ seq: ++seq, purpose: "rebaseline", head: "m6", against: null, actions: ["close-panel"], state: "done", reason: "the panel's new shadow is worth 60 ms" });
  state = actionStates({ history, actions: ACTIONS, log: LOG });
  assert.equal(state["close-panel"].baseline, "m6", "a re-baseline moves it");
  assert.equal(state["close-panel"].slowdown, undefined);
  assert.equal(state["close-panel"].rebaselined.reason, "the panel's new shadow is worth 60 ms", "with its reason written down");
  history.push(done("measure", "m8", "m6", [], null));
  assert.equal(actionStates({ history, actions: ACTIONS, log: LOG })["close-panel"].baseline, "m8", "back within the margin, the baseline moves on");
});

test("8.12 pnpm lag:box re-baselines an action whose baseline is not in main's history on main's parent, with that reason, and measures it this tick, though main is measured", () => {
  seq = 0;
  // open-smallest-island's baseline, x1, left with an old history; close-panel was slower once against it.
  const history = [done("measure", "x1", "x0", [], ["open-smallest-island", "close-panel"]), done("measure", "m5", "m4", [], ["open-largest-island"]), done("measure", "m5", "x1", ["close-panel"], ["close-panel"])];
  const next = decide({ history, main: main(5), actions: ACTIONS, log: LOG });
  assert.deepEqual(next.rebaselines.map(({ action, head }) => [action, head]), [["open-smallest-island", "m4"], ["close-panel", "m4"]], "each action measured against a commit main does not hold gets main's parent");
  assert.match(next.rebaselines[0].reason, /baseline x1 is not in main's history/, "the reason names the lost commit");
  assert.equal(next.why, "main (m5) is measured; 2 action(s) re-baselined on m4", "tick.log says what it re-baselined");
  assert.deepEqual(next.comparisons, [{ purpose: "measure", head: "m5", against: "m4", actions: ["open-smallest-island", "close-panel"] }], "measured against it now, though main is measured; no second run against the lost baseline");
  const after = [...history, ...next.rebaselines.map(({ action, head, reason }) => ({ seq: ++seq, purpose: "rebaseline", head, against: null, actions: [action], state: "done", reason })), { seq: ++seq, ...next.comparisons[0], state: "done", rows: verdicts() }];
  const state = actionStates({ history: after, actions: ACTIONS, log: LOG });
  assert.deepEqual(ACTIONS.map((action) => state[action].baseline), ["m5", "m5", "m5"], "measured against a baseline that exists, each moves on");
  const settled = decide({ history: after, main: main(5), actions: ACTIONS, log: LOG });
  assert.deepEqual([settled.comparisons, settled.rebaselines], [[], []], "once re-baselined, nothing more to do");
  assert.equal(settled.why, "main (m5) is measured");
});

test("8.13 pnpm lag:box halves the merges between a slowdown's baseline and where it was seen, and names the pull request that slowed the action", () => {
  seq = 0;
  // close-panel slowed at m9 (pull request #109's merge), seen at m16, its baseline m8.
  const history = [done("measure", "m8", "m7"), done("measure", "m16", "m8", ["close-panel"]), done("confirm", "m16", "m8", ["close-panel"], ["close-panel"])];
  const slowedBy = "m9";
  const isSlow = (commit) => Number(commit.slice(1)) >= Number(slowedBy.slice(1));
  const asked = [];
  for (let step = 0; step < 10; step += 1) {
    const next = decide({ history, main: main(16), actions: ACTIONS, log: LOG }).comparisons;
    if (next.length === 0 || next[0].purpose !== "bisect") break;
    const [ask] = next;
    assert.equal(ask.against, "m8", "every step is measured against the baseline");
    assert.deepEqual(ask.actions, ["close-panel"], "and only the slowed action");
    asked.push(ask.head);
    history.push(done("bisect", ask.head, ask.against, isSlow(ask.head) ? ["close-panel"] : [], ask.actions));
  }
  assert.ok(asked.length <= Math.ceil(Math.log2(8)) + 1, `halving, not one by one: ${asked.join(", ")}`);
  const { slowdown } = actionStates({ history, actions: ACTIONS, log: LOG })["close-panel"];
  assert.equal(slowdown.culprit, "m9");
  assert.equal(slowdown.pr, 109, "the merge's pull request is named");
  assert.deepEqual(decide({ history, main: main(16), actions: ACTIONS, log: LOG }).comparisons, [], "named: the runner waits for the next merge");
});

test("8.14 pnpm lag:box keeps the history in the library's server and prints, per action, its last runs, its baseline and any standing slowdown with its pull request", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (!url) throw new Error("STORYTREE_TEST_PG_URL is not set; run through pnpm test");
  const project = `lag-box-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const history = await openHistory(storytree, project);
    const started = await history.start({ purpose: "measure", head: "m8", against: "m7", actions: null });
    assert.deepEqual((await history.read()).map((row) => [row.purpose, row.head, row.state]), [["measure", "m8", "running"]], "a run is written as it starts, so another tick sees it going");
    await history.finish(started, { state: "done", rows: verdicts() });
    for (const [purpose, head, against, slower, actions] of [["measure", "m16", "m8", ["close-panel"], null], ["confirm", "m16", "m8", ["close-panel"], ["close-panel"]], ["bisect", "m12", "m8", ["close-panel"], ["close-panel"]], ["bisect", "m10", "m8", ["close-panel"], ["close-panel"]], ["bisect", "m9", "m8", ["close-panel"], ["close-panel"]]]) {
      await history.finish(await history.start({ purpose, head, against, actions }), { state: "done", rows: verdicts(slower) });
    }
    await history.rebaseline({ action: "open-largest-island", head: "m16", reason: "a larger seed" });
    const read = await history.read();
    assert.equal(read.length, 7);
    assert.ok(read.every((row, at) => at === 0 || row.seq > read[at - 1].seq), "oldest first");
    const text = statusText({ history: read, actions: ACTIONS, log: LOG });
    assert.match(text, /close-panel\s+baseline m8\s+SLOWER since m16: pull request #109 \(m9\)/);
    assert.match(text, /open-largest-island\s+baseline m16\s+re-baselined at m16: a larger seed/);
    assert.match(text, /open-smallest-island\s+baseline m16\s+within the margin/);
    assert.match(text, /m9 against m8\s+bisect\s+slower/, "the action's last runs");
    const other = await openHistory(storytree, `${project}-other`);
    assert.deepEqual(await other.read(), [], "a project reads only its own runs");
    await history.forget();
  } finally {
    await storytree.close();
  }
});

test("8.14 a lag-box tick that cannot measure records itself NOT RUN with its cause, once however often it repeats, and pnpm lag:box prints the last measuring run's age and the last failure", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (!url) throw new Error("STORYTREE_TEST_PG_URL is not set; run through pnpm test");
  const project = `lag-box-${randomBytes(4).toString("hex")}`;
  const box = mkdtempSync(path.join(tmpdir(), "lag-box-box-"));
  const storytree = await connect({ url });
  try {
    const history = await openHistory(storytree, project);
    await history.finish(await history.start({ purpose: "measure", head: "m8", against: "m7", actions: null }), { state: "done", rows: verdicts() });
    const open = (use) => use(history, storytree);
    let clock = Date.parse("2026-10-12T04:37:00.000Z");
    const failing = () => assert.rejects(runTick([], { box, home: box, open, log: () => {}, now: () => new Date((clock += 15 * 60_000)) }), /no measuring checkout at /, "the tick still fails, so tick.log keeps saying why");
    await failing();
    const first = (await history.read()).at(-1);
    for (let n = 0; n < 2; n += 1) await failing();
    const read = await history.read();
    assert.deepEqual(read.map((row) => [row.purpose, row.state]), [["measure", "done"], ["tick", "not-run"]], "one NOT RUN row for a failure however many ticks repeat it");
    assert.match(read[1].reason, /no measuring checkout at .*: run pnpm lag:box install/);
    assert.deepEqual([first.started, read[1].ended], ["2026-10-12T04:52:00.000Z", "2026-10-12T05:22:00.000Z"], "the row's end moves to the latest tick that failed");
    assert.equal(read[1].started, first.started, "its start stays at the first");
    assert.deepEqual(decide({ history: read, main: main(9), actions: ACTIONS, log: LOG }).comparisons, [{ purpose: "measure", head: "m9", against: "m8", actions: null }], "a tick that did not measure does not stand in for a measuring run");
    const now = new Date(Date.parse(read[0].ended) + 3 * 86_400_000 + 3_600_000);
    const text = statusText({ history: read, actions: ACTIONS, log: LOG, now });
    assert.ok(text.includes(`NOT RUN ${read[1].started.slice(0, 16)} to ${read[1].ended.slice(0, 16)}  tick: no measuring checkout at `), text);
    assert.match(text, /last measured .* \(3 days ago\)/);
    assert.match(text, /last failure .*: tick: no measuring checkout at /);
    const failingSince = [read[0], { ...read[1], started: "2026-10-20T00:00:00.000Z", ended: "2026-10-23T00:00:00.000Z" }];
    assert.match(statusText({ history: failingSince, actions: ACTIONS, log: LOG, now: new Date(Date.parse(read[0].ended) + 10 * 86_400_000) }), /last measured .* \(10 days ago\)/, "a tick that did not measure is not the last measuring run");
    await history.forget();
  } finally {
    await storytree.close();
    await removeTemp(box);
  }
});

test("8.19 a lag-box tick that cannot measure, two days after the last measuring run, marks each budget contract it owns not re-run, once; within two days its verdict stands", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (!url) throw new Error("STORYTREE_TEST_PG_URL is not set; run through pnpm test");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const box = mkdtempSync(path.join(tmpdir(), "lag-box-box-"));
  const storytree = await connect({ url, connectTimeoutMs: 10_000 });
  try {
    const history = await openHistory(storytree, name);
    const lib = await storytree.openProject(name);
    try {
      const story = await lib.addStory({ title: "The forest" });
      const capability = await lib.addCapability({ story: story.id, title: "4 · Drill-down" });
      await lib.setProposed(capability.id, false);
      const contract = await lib.addContract({ capability: capability.id, title: "4.16 · Opening an island answers within 100 ms" });
      await history.finish(await history.start({ purpose: "measure", head: "m8", against: "m7", actions: null }), { state: "done", rows: verdicts() });
      await recordLagVerdicts(lib, new Map([[contract.id, { state: "passing", note: "open-largest-island within the margin of its baseline m7" }]]), { commit: "m8", evidence: "pnpm lag:box, run 1" });
      const measured = Date.parse((await history.read())[0].ended);
      const owners = Object.fromEntries(ACTIONS.map((action) => [action, contract.id]));
      const said = [];
      const failingAt = (ms) => assert.rejects(runTick([], { box, home: box, open: (use) => use(history, storytree), log: (line) => said.push(line), now: () => new Date(measured + ms), project: name, owners }), /no measuring checkout at /);
      const marked = () => said.filter((line) => line.includes("marked not re-run"));

      await failingAt(86_400_000);
      assert.equal((await lib.health(contract.id)).verified.state, "passing", "a tick that fails within two days of the last measuring run leaves its verdict standing");

      await failingAt(2 * 86_400_000 + 3_600_000);
      const stale = (await lib.health(contract.id)).verified;
      assert.deepEqual({ state: stale.state, by: stale.by, was: stale.was?.state }, { state: "not-checked", by: "lag run", was: "passing" });
      assert.match(stale.note, /not re-run at commit m8: NOT RUN: not measured since .* \(2 days\): no measuring checkout at /);
      assert.equal((await lib.projectTree()).stories[0].capabilities[0].why?.reason, "not re-run", "the capability reaches the health worklist as not re-run");
      assert.deepEqual(marked(), ["lag:box: 1 lag verdict(s) not renewed for two days, marked not re-run"], "tick.log says what it marked");

      await failingAt(3 * 86_400_000);
      assert.equal((await lib.health(contract.id)).verified.at, stale.at, "a later failing tick does not write it again");
      assert.equal(marked().length, 1, "nor says it again");
    } finally {
      await lib.close();
    }
    await history.forget();
  } finally {
    await storytree.close();
    await removeTemp(box);
    await dropTestDatabases([`storytree_${name}`]);
  }
});

test("8.15 pnpm lag:box stops a run that passes its limit, records why, and leaves the heavy-run lock free", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "lag-box-home-"));
  const heavyLock = fileURLToPath(new URL("./heavy-lock.mjs", import.meta.url));
  try {
    const env = { ...process.env, STORYTREE_HOME: home };
    // Holds the heavy-run lock through the wrapper the runner starts the lag run in, then never ends. The test fires the limit
    // itself once the lock is held, so no real time decides the outcome.
    const timers = [];
    const running = runBounded(process.execPath, [heavyLock, "--", process.execPath, "-e", "setInterval(() => {}, 1000)"], { cwd: home, env, limitMs: 30 * 60_000, log: () => {}, setTimer: (fire) => timers.push(fire) });
    await waitUntil(() => existsSync(path.join(home, "heavy-run.lock")), 10_000, "the run to take the heavy-run lock");
    timers[0]();
    const result = await running;
    assert.equal(result.timedOut, true);
    assert.match(result.reason, /passed its limit of 30 min/);
    assert.equal(existsSync(path.join(home, "heavy-run.lock")), false, "the lock is released");
    const quick = await runBounded(process.execPath, ["-e", "process.exit(3)"], { cwd: home, env, limitMs: 60_000, log: () => {} });
    assert.deepEqual({ timedOut: quick.timedOut, code: quick.code }, { timedOut: false, code: 3 });
  } finally {
    await removeTemp(home);
  }
});

test("8.15 a lag-box tick bounds its run at 60 minutes unless --limit-minutes says otherwise, so a measure of the whole catalogue on both seeds fits", () => {
  assert.equal(runLimitMs(["tick"]), 60 * 60_000);
  assert.equal(runLimitMs(["--limit-minutes", "90"]), 90 * 60_000);
});

test("8.20 pnpm lag:box install makes each checkout locked, and locks one it finds there unlocked, so the session worktree reaper leaves it", async () => {
  const temp = realpathSync(mkdtempSync(path.join(tmpdir(), "lag-box-install-")));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const origin = path.join(temp, "origin.git");
    const repo = path.join(temp, "repo");
    const box = path.join(temp, "box");
    git(temp, "init", "-q", "--bare", "-b", "main", origin);
    git(temp, "clone", "-q", origin, repo);
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
    git(repo, "push", "-q", "origin", "HEAD:main");
    // The measuring checkout is already there, unlocked, as an earlier install left it.
    git(repo, "worktree", "add", "-q", "--detach", path.join(box, "measure"), "origin/main");
    const setUp = [];
    makeCheckouts({ repo, box, say: () => {}, setUp: (tree) => setUp.push(tree) });
    // Git names a worktree in its own spelling (forward slashes on Windows, a short temp folder spelt long), so both sides are compared resolved.
    const real = (tree) => realpathSync.native(tree);
    const locked = git(repo, "worktree", "list", "--porcelain").split("\n\n").filter((block) => /^locked/m.test(block)).map((block) => real(block.split("\n")[0].slice("worktree ".length)));
    assert.deepEqual(locked.sort(), [real(path.join(box, "measure")), real(path.join(box, "runner"))]);
    assert.deepEqual(setUp, [path.join(box, "runner")], "only the new checkout is installed");
    makeCheckouts({ repo, box, say: () => {}, setUp: (tree) => setUp.push(tree) });
    assert.equal(setUp.length, 1, "a reinstall over locked checkouts changes nothing");
  } finally {
    await removeTemp(temp);
  }
});

// Two islands share one budget contract; closing the panel has its own.
const OWNERS = { "open-smallest-island": "contract-open", "open-largest-island": "contract-open", "close-panel": "contract-close" };
const states = (verdictsOf) => Object.fromEntries([...verdictsOf].map(([contract, { state }]) => [contract, state]));

test("8.16 after each measuring run the box mints each budget contract's verdict: passing within the margin, nothing while a slower run waits for its second, failing once it agrees, not re-run when the action was NOT RUN; over a history with one noisy run no failing verdict is minted", () => {
  seq = 0;
  const history = [];
  const tick = (...runs) => {
    history.push(...runs);
    return lagVerdicts({ history, actions: ACTIONS, log: LOG, owners: OWNERS, ran: runs.map((run) => run.seq) });
  };
  const minted = [];
  const mint = (...runs) => {
    const verdictsOf = tick(...runs);
    minted.push(...verdictsOf.values());
    return verdictsOf;
  };
  assert.deepEqual(states(mint(done("measure", "m1", "m0"))), { "contract-open": "passing", "contract-close": "passing" });
  assert.deepEqual(states(mint(done("measure", "m4", "m1", ["close-panel"]))), { "contract-open": "passing" }, "one slower run: nothing minted for its contract until a second run says");
  assert.deepEqual(states(mint(done("confirm", "m4", "m1", [], ["close-panel"]))), { "contract-close": "passing" }, "the second run disagrees: the noisy run passes");
  assert.equal(minted.some(({ state }) => state === "failing"), false, "a history with one noisy run mints no failing verdict");

  const slower = mint(done("measure", "m6", "m4", ["open-largest-island"]));
  assert.deepEqual(states(slower), { "contract-close": "passing" }, "one island slower once: the shared contract waits");
  const failing = mint(done("confirm", "m6", "m4", ["open-largest-island"], ["open-largest-island"]));
  assert.deepEqual(states(failing), { "contract-open": "failing" }, "the second run agrees: the contract fails, though the other island is within");
  assert.match(failing.get("contract-open").note, /open-largest-island slower since m6 against its baseline m4/);

  const notRun = mint({ seq: ++seq, purpose: "measure", head: "m8", against: "m4", actions: null, state: "not-run", reason: "passed its limit of 30 min" });
  assert.deepEqual(states(notRun), { "contract-open": "failing", "contract-close": "not-checked" }, "a slowdown stands over a run that did not happen; a contract it did not measure is not re-run, never passed");
  assert.deepEqual({ skip: notRun.get("contract-close").skip, reason: notRun.get("contract-close").reason }, { skip: "other", reason: "NOT RUN: passed its limit of 30 min" });

  const added = [...ACTIONS, "open-app"];
  const firstRows = [...verdicts(), { name: "open-app", size: "standard", rounds: 0, notRun: "against: not measured" }];
  const first = { seq: ++seq, purpose: "measure", head: "m8", against: "m7", actions: null, state: "done", rows: firstRows };
  const withAdded = lagVerdicts({ history: [first], actions: added, log: LOG, owners: { ...OWNERS, "open-app": "contract-app" }, ran: [first.seq] });
  assert.equal(withAdded.has("contract-app"), false, "an action main's parent could not perform, with no baseline yet, waits: its contract's standing verdict holds");
  assert.equal(withAdded.get("contract-close").state, "passing", "the actions beside it are judged as usual");

  const bisect = tick(done("bisect", "m5", "m4", ["open-largest-island"], ["open-largest-island"]));
  assert.equal(bisect.size, 0, "halving names the pull request; it mints nothing");
  assert.deepEqual(states(tick(done("measure", "m9", "m4", [], ["open-smallest-island", "open-largest-island"]), done("measure", "m9", "m6", [], ["close-panel"]))), { "contract-open": "passing", "contract-close": "passing" }, "the fix: within the margin of the baseline again, it passes");
});

test("8.16, 12.11 pnpm lag:box writes each verdict to its contract's verified column as a lag run, with the commit and the evidence; a failing one makes its capability read unhealthy, failing, and a NOT RUN after it reads not re-run", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (!url) throw new Error("STORYTREE_TEST_PG_URL is not set; run through pnpm test");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url, connectTimeoutMs: 10_000 });
  try {
    const lib = await storytree.openProject(name);
    try {
      const story = await lib.addStory({ title: "The forest" });
      const capability = await lib.addCapability({ story: story.id, title: "4 · Drill-down" });
      await lib.setProposed(capability.id, false);
      const contract = await lib.addContract({ capability: capability.id, title: "4.16 · Opening an island answers within 100 ms" });
      const why = async () => (await lib.projectTree()).stories[0].capabilities[0].why?.reason;

      await recordLagVerdicts(lib, new Map([[contract.id, { state: "passing", note: "open-largest-island within the margin of its baseline m1" }]]), { commit: "m4", evidence: "pnpm lag:box, run 2" });
      const passing = (await lib.health(contract.id)).verified;
      assert.deepEqual({ state: passing.state, by: passing.by, source: passing.source, note: passing.note }, { state: "passing", by: "lag run", source: "local", note: "open-largest-island within the margin of its baseline m1, evidence pnpm lag:box, run 2, at commit m4" });
      assert.equal(await why(), undefined, "healthy");

      await recordLagVerdicts(lib, new Map([[contract.id, { state: "failing", note: "open-largest-island slower since m6 against its baseline m4" }]]), { commit: "m6", evidence: "pnpm lag:box, run 4" });
      assert.equal((await lib.health(contract.id)).verified.state, "failing");
      assert.equal(await why(), "failing", "the capability reads unhealthy, failing, so the health worklist offers it");
      assert.deepEqual((await lib.healthWorklist()).map((item) => item.capability), [capability.id]);

      await recordLagVerdicts(lib, new Map([[contract.id, { state: "not-checked", skip: "other", reason: "NOT RUN: passed its limit of 30 min" }]]), { commit: "m8", evidence: "pnpm lag:box, run 5" });
      const notRun = (await lib.health(contract.id)).verified;
      assert.deepEqual({ state: notRun.state, by: notRun.by, was: notRun.was?.state }, { state: "not-checked", by: "lag run", was: "failing" });
      assert.equal(await why(), "not re-run");
    } finally {
      await lib.close();
    }
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${name}`]);
  }
});
