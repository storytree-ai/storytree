import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main } from "./health.mjs";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const ago = (minutes) => new Date(NOW - minutes * 60_000);
const stamp = (minutes) => ago(minutes).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A green pull request, as GitHub's GraphQL returns it, ready for the merge queue and in it. */
const green = (extra = {}) => ({
  state: "OPEN", isDraft: false, labels: { nodes: [] }, mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", mergeQueueEntry: { state: "QUEUED" },
  headRefOid: "abc", headRefName: "claude/x", isCrossRepository: false, headRepository: { nameWithOwner: "storytree-ai/storytree" },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: "CheckRun", name: "verify", status: "COMPLETED", conclusion: "SUCCESS" }] } } } }] },
  timelineItems: { nodes: [] }, ...extra,
});

/** A lanes folder with a live dispatcher and its status lines, and the box's processes and GitHub faked. */
async function box(t, { status = [], live = { 100: "node launch.mjs pool", 200: "node watch.mjs run" }, engines = 2, cap = 5, pulls = {} } = {}) {
  const lanesDir = await mkdtemp(join(tmpdir(), "pool-health-"));
  t.after(() => rm(lanesDir, { recursive: true, force: true }));
  await mkdir(join(lanesDir, "watch"));
  await writeFile(join(lanesDir, "pool.pid"), "100\n");
  await writeFile(join(lanesDir, "watch", "watch.pid"), "200\n");
  await writeFile(join(lanesDir, "pool.status"), [`${stamp(600)} dispatcher started`, ...status, ""].join("\n"));
  const lines = [];
  return {
    lanesDir, lines,
    b: { lanesDir, credentials: join(lanesDir, "no-credentials.json"), now: () => NOW, out: (line) => lines.push(line), argsOf: async (pid) => live[pid] ?? "",
      count: async () => engines, maxLanes: async () => cap,
      pull: async (pr) => { if (!pulls[pr]) throw new Error("not found"); return pulls[pr]; } },
  };
}

async function touch(path, minutes, text = "") {
  await writeFile(path, text);
  await utimes(path, ago(minutes), ago(minutes));
}

const hand = (lanesDir, pr, increment, extra = {}) => writeFile(join(lanesDir, "watch", `${pr}.json`),
  JSON.stringify({ fixes: [], fixing: null, pr, increment, keepOpen: false, closed: false, handedAt: ago(30).toISOString(), ...extra }));

test("8.1 · a dispatcher not running is a concern unless the stop file says it was stopped on purpose", async (t) => {
  const down = await box(t, { live: { 200: "node watch.mjs run" } });
  assert.equal(await main([], down.b), 1);
  assert.match(down.lines[0], /^concern: dispatcher not running, and no pool-stop says that is on purpose/);

  const stopped = await box(t, { live: { 200: "node watch.mjs run" } });
  await writeFile(join(stopped.lanesDir, "pool-stop"), "");
  assert.equal(await main([], stopped.b), 0);
  assert.deepEqual(stopped.lines.filter((line) => line.startsWith("concern")), []);
  assert.match(stopped.lines.join("\n"), /dispatcher stopped on purpose \(pool-stop is there\)/);

  // A pid file left by a dead dispatcher, its pid now another program's, is no dispatcher.
  const reused = await box(t, { live: { 100: "vim notes.md", 200: "node watch.mjs run" } });
  assert.equal(await main([], reused.b), 1);
});

test("8.2 · engines running are read against the cap, and over the cap is a concern", async (t) => {
  const within = await box(t, { engines: 3, cap: 5 });
  assert.equal(await main([], within.b), 0);
  assert.match(within.lines.join("\n"), /3 of 5 slots/);

  const over = await box(t, { engines: 6, cap: 5 });
  assert.equal(await main([], over.b), 1);
  assert.match(over.lines[0], /^concern: 6 engines running, over the cap of 5/);
});

test("8.3 · a running session whose log has not grown in 90 minutes while the dispatcher lives is stuck", async (t) => {
  const { lanesDir, lines, b } = await box(t, { status: [
    `${stamp(200)} start increment_stuck`, `${stamp(200)} engine claude forced`,
    `${stamp(120)} start increment_busy`,
    `${stamp(300)} start increment_done`, `${stamp(250)} end increment_done exit 0`] });
  await touch(join(lanesDir, "pool-increment_stuck-20261021T084000.log"), 95);
  await touch(join(lanesDir, "pool-increment_busy-20261021T100000.log"), 100);
  await touch(join(lanesDir, "pool-increment_busy-20261021T100000.claude.log"), 2);
  await touch(join(lanesDir, "pool-increment_done.report.md"), 250);
  assert.equal(await main(["--all"], b), 1);
  const concerns = lines.filter((line) => line.startsWith("concern"));
  assert.deepEqual(concerns, ["concern: increment_stuck stuck: running 3h20m, its log last grew 1h35m ago"]);
  assert.ok(lines.includes("session increment_busy: running 2h0m, its log grew 2m ago"), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("increment_done") && line.startsWith("session")));

  // With the dispatcher down its sessions are not judged stuck: the dispatcher's own concern says it.
  const down = await box(t, { live: {}, status: [`${stamp(200)} start increment_stuck`] });
  await touch(join(down.lanesDir, "pool-increment_stuck-20261021T084000.log"), 95);
  await main([], down.b);
  assert.ok(!down.lines.some((line) => /stuck/.test(line)), down.lines.join("\n"));
});

test("8.4 · a session that ended in the last day leaving no report since its start is a concern", async (t) => {
  const { lanesDir, lines, b } = await box(t, { status: [
    `${stamp(2000)} start increment_old`, `${stamp(1900)} end increment_old exit 0`,
    `${stamp(300)} start increment_none`, `${stamp(200)} end increment_none exit 1`,
    `${stamp(180)} start increment_stale`, `${stamp(100)} end increment_stale exit 0`,
    `${stamp(90)} start increment_good`, `${stamp(60)} end increment_good exit 0`] });
  await touch(join(lanesDir, "pool-increment_stale.report.md"), 500);
  await touch(join(lanesDir, "pool-increment_good.report.md"), 61);
  assert.equal(await main([], b), 1);
  assert.deepEqual(lines.filter((line) => line.startsWith("concern")), [
    "concern: increment_none ended 3h20m ago (exit 1) with no report",
    "concern: increment_stale ended 1h40m ago (exit 0) with no report",
  ]);
});

test("8.5 · each hand-off the watcher holds is read with its pull request's state, and hand-offs with no watcher running are a concern", async (t) => {
  const red = green({ mergeQueueEntry: null, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: "CheckRun", name: "verify", conclusion: "FAILURE" }] } } } }] } });
  const { lanesDir, lines, b } = await box(t, { pulls: { 11: green(), 12: red } });
  await hand(lanesDir, 11, "increment_a");
  await hand(lanesDir, 12, "increment_b", { fixes: [{ at: ago(5).toISOString() }], fixing: { pid: 9 } });
  await hand(lanesDir, 13, "increment_c");
  assert.equal(await main(["--all"], b), 1);
  assert.ok(lines.includes("hand-off PR #11 increment_a: handed 30m ago, pending, 0 fix sessions"), lines.join("\n"));
  assert.ok(lines.includes("hand-off PR #12 increment_b: handed 30m ago, red (verify failed), 1 fix session, one running"), lines.join("\n"));
  assert.ok(lines.includes("concern: PR #13 increment_c: could not read it on GitHub (not found)"), lines.join("\n"));

  const alone = await box(t, { live: { 100: "node launch.mjs pool" }, pulls: { 11: green() } });
  await hand(alone.lanesDir, 11, "increment_a");
  assert.equal(await main([], alone.b), 1);
  assert.deepEqual(alone.lines, ["concern: watcher not running while it holds 1 hand-off"]);
});

test("8.6 · a handed-over pull request open, ready, unheld, clean, its verify passed, yet out of the merge queue is a stalled green concern", async (t) => {
  const out = { mergeQueueEntry: null };
  const { lanesDir, lines, b } = await box(t, { pulls: {
    21: green(out), 22: green(), 23: green({ ...out, isDraft: true }), 24: green({ ...out, labels: { nodes: [{ name: "hold" }] } }),
    25: green({ ...out, mergeStateStatus: "BLOCKED" }), 26: green({ ...out, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] } }),
  } });
  for (const pr of [21, 22, 23, 24, 25, 26]) await hand(lanesDir, pr, `increment_${pr}`);
  assert.equal(await main([], b), 1);
  assert.deepEqual(lines.filter((line) => line.startsWith("concern")), [
    "concern: PR #21 increment_21 stalled green: open, ready, clean and its verify passed, but not in the merge queue",
  ]);
});

test("8.7 · concerns print first and exit non-zero; with none, one pool healthy line and exit 0", async (t) => {
  const healthy = await box(t, { engines: 1, cap: 5, pulls: { 11: green() }, status: [`${stamp(10)} start increment_a`] });
  await touch(join(healthy.lanesDir, "pool-increment_a-20261021T115000.log"), 1);
  await hand(healthy.lanesDir, 11, "increment_b");
  assert.equal(await main([], healthy.b), 0);
  assert.deepEqual(healthy.lines, ["pool healthy: dispatcher running (pid 100), 1 of 5 slots, 1 session running, 1 hand-off"]);

  const sick = await box(t, { engines: 9, cap: 5, live: { 200: "node watch.mjs run" } });
  assert.equal(await main(["--all"], sick.b), 1);
  const first = sick.lines.findIndex((line) => !line.startsWith("concern"));
  assert.equal(first, 2, sick.lines.join("\n"));
  assert.ok(sick.lines.slice(first).every((line) => !line.startsWith("concern")));
  assert.ok(!sick.lines.some((line) => line.startsWith("pool healthy")));
});

test("8.8 · a hand-off whose pull request's head is not on this repository, or whose head GitHub does not say, is a concern, never read as stalled green", async (t) => {
  const { lanesDir, lines, b } = await box(t, { pulls: { 21: green({ mergeQueueEntry: null, isCrossRepository: true, headRepository: { nameWithOwner: "mallory/storytree" } }), 22: green({ isCrossRepository: undefined }) } });
  await hand(lanesDir, 21, "increment_a");
  await hand(lanesDir, 22, "increment_b");
  assert.equal(await main([], b), 1);
  assert.deepEqual(lines, ["concern: PR #21 increment_a: its head is not on storytree-ai/storytree, or GitHub did not say where it is",
    "concern: PR #22 increment_b: its head is not on storytree-ai/storytree, or GitHub did not say where it is"]);
});

test("8.9 · A lane whose engine started with any tool server other than storytree, or a stored claude.ai login on the box, is a concern", async (t) => {
  const { lanesDir, lines, b } = await box(t, { status: [`${stamp(20)} start increment_a`, `${stamp(20)} start increment_b`] });
  const init = (servers) => `${JSON.stringify({ type: "system", subtype: "init", session_id: "s", mcp_servers: servers.map((name) => ({ name, status: "connected" })) })}\n{"type":"assistant"}\n`;
  await touch(join(lanesDir, "pool-increment_a-20261021T114000.log"), 1, init(["storytree"]));
  await touch(join(lanesDir, "pool-increment_b-20261021T114000.claude.log"), 1, init(["storytree", "claude.ai Gmail", "claude.ai Google Drive"]));
  await touch(join(lanesDir, "watch", "fix-31-1.log"), 5, init(["github"]));
  await touch(join(lanesDir, "pool-increment_c-20261019T114000.log"), 3 * 24 * 60, init(["claude.ai Gmail"]));
  assert.equal(await main([], b), 1);
  assert.deepEqual(lines, ["concern: pool-increment_b-20261021T114000.claude.log: its engine started with tool servers other than storytree (claude.ai Gmail, claude.ai Google Drive)",
    "concern: watch/fix-31-1.log: its engine started with tool servers other than storytree (github)"]);

  const clean = await box(t);
  await touch(join(clean.lanesDir, "pool-increment_a-20261021T114000.log"), 1, init(["storytree"]));
  assert.equal(await main([], clean.b), 0);
  await touch(clean.b.credentials, 1, "{}");
  assert.equal(await main([], clean.b), 1);
  assert.deepEqual(clean.lines.slice(1), [`concern: a stored claude.ai login is on this box (${clean.b.credentials}); lanes run only on the lane token, so sign the box out of claude.ai`]);
});
