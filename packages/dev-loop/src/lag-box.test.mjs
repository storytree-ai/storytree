// The Mint box's lag runner (packages/dev-loop/src/lag-box.mjs, ADR-1001 D3): what it runs next, where each action's baseline sits,
// when a slowdown counts and which pull request it names are pure functions over a recorded history; the history is kept in the
// library's server, where any machine's `pnpm lag:box` reads it back; and a run that passes its limit is stopped, never left holding
// the heavy-run lock.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";

import { actionStates, decide, openHistory, runBounded, statusText } from "./lag-box.mjs";

const ACTIONS = ["open-smallest-island", "open-largest-island", "close-panel"];
// main's first-parent history, oldest first: m0, then merges m1..m20, each of pull request 100 + n.
const LOG = Array.from({ length: 21 }, (_, n) => ({ commit: `m${n}`, subject: n === 0 ? "start" : `Merge pull request #${100 + n} from storytree-ai/branch-${n}` }));
const main = (n) => ({ commit: `m${n}`, parent: `m${n - 1}` });
const verdicts = (slower = [], { size = "standard" } = {}) => ACTIONS.map((name) => ({ name, size, verdict: slower.includes(name) ? "slower" : "same", against: 100, this: slower.includes(name) ? 300 : 100 }));
let seq = 0;
const until = async (ready) => {
  while (!ready()) await new Promise((resolve) => setImmediate(resolve));
};
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

test("8.15 pnpm lag:box stops a run that passes its limit, records why, and leaves the heavy-run lock free", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "lag-box-home-"));
  const heavyLock = fileURLToPath(new URL("./heavy-lock.mjs", import.meta.url));
  try {
    const env = { ...process.env, STORYTREE_HOME: home };
    // Holds the heavy-run lock through the wrapper the runner starts the lag run in, then never ends. The test fires the limit
    // itself once the lock is held, so no real time decides the outcome.
    const timers = [];
    const running = runBounded(process.execPath, [heavyLock, "--", process.execPath, "-e", "setInterval(() => {}, 1000)"], { cwd: home, env, limitMs: 30 * 60_000, log: () => {}, setTimer: (fire) => timers.push(fire) });
    await until(() => existsSync(path.join(home, "heavy-run.lock")));
    timers[0]();
    const result = await running;
    assert.equal(result.timedOut, true);
    assert.match(result.reason, /passed its limit of 30 min/);
    assert.equal(existsSync(path.join(home, "heavy-run.lock")), false, "the lock is released");
    const quick = await runBounded(process.execPath, ["-e", "process.exit(3)"], { cwd: home, env, limitMs: 60_000, log: () => {} });
    assert.deepEqual({ timedOut: quick.timedOut, code: quick.code }, { timedOut: false, code: 3 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
