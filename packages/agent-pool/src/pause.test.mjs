import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { lanesBeside, loopRunning, main } from "./pause.mjs";

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "pool-pause-"));
  t.after(() => removeTemp(path));
  return path;
}

// Two lanes: 100's engine (its node child is no engine of its own), and 200's, which runs the shell calling pause.
const TABLE = `
  1 0 bash launch-pool.sh run
  100 1 claude -p # Pool lane: increment_a
  101 100 node something
  200 1 codex exec # Pool lane: increment_b
  201 200 bash -c node packages/agent-pool/src/pause.mjs pause
  202 201 node packages/agent-pool/src/pause.mjs pause
`;

test("3.23 · pause stops the pool taking new work and waits until no other lane runs and the merge queue is empty, then says what is still open", async (t) => {
  const lanesDir = await folder(t);
  assert.deepEqual(lanesBeside(TABLE, "202").map((one) => one.pid), ["100"], "the caller's own lane is not waited for");
  assert.equal(loopRunning(TABLE), true);
  assert.equal(loopRunning("  5 1 node other\n"), false);

  const running = [[{ pid: "100", args: "claude -p" }], [], []], queued = [[], [{ number: 7, title: "queued" }], []];
  const lines = [], sleeps = [];
  const box = {
    lanesDir, stopFile: join(lanesDir, "pool-stop"), say: (line) => lines.push(line), sleep: async (ms) => { sleeps.push(ms); },
    lanes: async () => running.shift(), queue: async () => queued.shift(),
    open: async () => [{ number: 9, title: "left open", isDraft: false }], handed: async () => [{ increment: "increment_c", note: "PR #9 is with the Mint box's watcher" }],
  };
  assert.equal(await main(["pause"], box), 0);
  assert.ok(existsSync(box.stopFile), "the stop file the dispatcher reads is written");
  assert.equal(sleeps.length, 2, "it waited through the running lane, then the queued pull request");
  assert.match(lines.join("\n"), /waiting: 1 lane running \(100\)/);
  assert.match(lines.join("\n"), /waiting: in the merge queue: #7/);
  assert.match(lines.join("\n"), /drained/);
  assert.match(lines.join("\n"), /#9 left open/);
  assert.match(lines.join("\n"), /PR #9: increment_c/);

  // A wait that runs out keeps the pool paused and says what still runs.
  lines.length = 0;
  let clock = 0;
  const stuck = { ...box, lanes: async () => [{ pid: "300", args: "claude -p # Pool lane: increment_d" }], queue: async () => [], now: () => clock, sleep: async () => { clock += 60_000; } };
  assert.equal(await main(["pause", "--wait-minutes", "2"], stuck), 1);
  assert.ok(existsSync(box.stopFile));
  assert.match(lines.join("\n"), /already paused/);
  assert.ok(lines.includes("not drained yet: 1 lane running (300)\n  300 claude -p # Pool lane: increment_d"), "each lane still running is listed on its own line");
});

test("3.23 · resume lets the pool take work again, starting the dispatcher's loop only when it has ended", async (t) => {
  const lanesDir = await folder(t);
  const stopFile = join(lanesDir, "pool-stop");
  await writeFile(stopFile, "paused\n");
  const started = [], lines = [];
  let looping = true;
  const box = { lanesDir, stopFile, say: (line) => lines.push(line), looping: async () => looping, startLoop: async () => { started.push(1); return 4242; } };
  assert.equal(await main(["resume"], box), 0);
  assert.equal(existsSync(stopFile), false, "the stop file goes");
  assert.deepEqual(started, [], "a loop still running starts the dispatcher again itself");

  await writeFile(stopFile, "paused\n");
  looping = false;
  assert.equal(await main(["resume"], box), 0);
  assert.equal(existsSync(stopFile), false);
  assert.deepEqual(started, [1], "an ended loop is started");
  assert.match(lines.at(-1), /started the dispatcher's loop \(pid 4242\)/);

  // One ssh command that checks ps for the loop and then resumes: its shell and its grep hold the text, and are no loop.
  const caller = `
  10 1 sshd: mickh@notty
  11 10 bash -c ps -eo args | grep -c "launch-pool.sh run"; node packages/agent-pool/src/pause.mjs resume
  12 11 grep -c launch-pool.sh run
  13 11 node packages/agent-pool/src/pause.mjs resume
`;
  assert.equal(loopRunning(caller), false, "the caller's command line is not the loop");
  assert.equal(loopRunning(`${caller}  20 1 bash /home/mickh/storytree-lanes/launch-pool.sh run\n`), true);
});

test("3.23 · status says whether the pool is paused, what runs beside it, the merge queue and what is still open", async (t) => {
  const lanesDir = await folder(t);
  const lines = [];
  const box = {
    lanesDir, stopFile: join(lanesDir, "pool-stop"), say: (line) => lines.push(line), looping: async () => true,
    lanes: async () => [{ pid: "100", args: "claude -p" }], queue: async () => [{ number: 7, title: "queued" }],
    open: async () => [], handed: async () => [],
  };
  assert.equal(await main(["status"], box), 0);
  await writeFile(box.stopFile, "paused\n");
  assert.equal(await main(["status"], box), 0);
  assert.deepEqual(lines.filter((line) => line.startsWith("pool:")), ["pool: taking work; dispatcher loop running", "pool: paused; dispatcher loop running"]);
  assert.ok(lines.includes("1 other lane running (100)"));
  assert.ok(lines.includes("in the merge queue: #7"));
  assert.ok(lines.includes("no open pull requests"));
});
