import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { composeBrief, countEngines, holdRunner, popRan, runQueue, waitForSlot } from "./queue.mjs";

const now = () => Date.parse("2026-10-08T04:00:00Z");
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-queue-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("12.1 · each running lane's engine counts once: not its wrapper or native child, nor a process that only mentions an engine", async () => {
  const codex = "/home/m/.nvm/versions/node/v24.19.0/lib/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/bin/codex";
  const table = [
    "  100     1 bash /home/m/storytree-lanes/launch-night.sh run L",
    "  101   100 bash /home/m/storytree-lanes/run-lane.sh /home/m/storytree-lanes/night-L-a-brief.md log err",
    "  102   101 node /home/m/.nvm/versions/node/v24.19.0/bin/codex exec # Overnight lane: track L, a",
    `  103   102 ${codex} exec # Overnight lane: track L, a`,
    `  104   103 ${codex.replace(/codex$/, "codex-code-mode-host")}`,
    "  200   199 node /home/m/code/storytree03/packages/dev-loop/src/lanes/runner.mjs run brief log err",
    "  201   200 /home/m/.local/bin/claude -p # Overnight lane: track B, b --model claude-opus-5-5",
    "  202   201 /home/m/.local/bin/claude -p child of the same lane",
    "  300   299 codex exec Reply with the single word OK.",
    "  400   399 grep -E codex exec|claude -p",
    "  401   399 bash -c pgrep -fc 'codex exec|claude -p'",
    "  402   399 vim notes about codex exec",
    "  500     1 node /usr/bin/codex resume --last",
  ].join("\n");
  assert.equal(countEngines(table), 3, "Codex lane a, Claude lane b and the bare probe");
  assert.equal(countEngines(""), 0);

  const lines = [];
  let looks = 0, sleeps = 0;
  const counts = [5, 6, 4];
  const running = await waitForSlot({ max: 5, count: async () => counts[looks++], sleep: async (ms) => { assert.equal(ms, 60_000); sleeps++; }, onWait: (n) => lines.push(n) });
  assert.equal(running, 4);
  assert.equal(sleeps, 2);
  assert.deepEqual(lines, [5], "it says it waits once");
  assert.equal(await waitForSlot({ max: 5, count: async () => 0, sleep: () => assert.fail(), onWait: () => assert.fail() }), 0);
});

test("12.1 · a waiting runner reads the cap on every poll, so a raised cap starts it with no lane ending", async () => {
  let cap = 5, sleeps = 0;
  const running = await waitForSlot({ max: async () => cap, count: async () => 5, onWait: () => {},
    sleep: async () => { sleeps++; if (sleeps === 2) cap = 6; if (sleeps > 3) assert.fail("the raised cap was never read"); } });
  assert.equal(running, 5, "five still run: the raised cap, not a lane ending, freed the slot");
  assert.equal(sleeps, 2);
});

test("12.2 · a lane's line leaves the queue only when its lane ends, and it is the line naming that lane wherever a dispatcher moved it", async (t) => {
  const dir = await folder(t);
  const queue = join(dir, "night-queue-A.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "first\nsecond\n");
  const ran = [];
  const code = await runQueue({ queueFile: queue, stopFile: stop, now, say: () => {}, runLane: async (id) => {
    ran.push(id);
    assert.equal((await readFile(queue, "utf8")).split("\n")[0], id, "a lane's line stays queued while it runs");
    if (id === "first") await writeFile(queue, "urgent\nfirst\nsecond\n");
    return 0;
  } });
  assert.equal(code, 0, "an empty queue with no refill ends the runner");
  assert.deepEqual(ran, ["first", "urgent", "second"], "the dispatcher's urgent line was run, not dropped");
  assert.equal(await readFile(queue, "utf8"), "");

  await writeFile(queue, "failing\nnext\n");
  const lines = [];
  assert.equal(await runQueue({ queueFile: queue, stopFile: stop, now, say: (line) => lines.push(line), runLane: async () => 75 }), 75);
  assert.equal(await readFile(queue, "utf8"), "failing\nnext\n", "75 keeps the lane queued and stops");
  assert.match(lines.at(-1), /^2026-10-08T04:00:00Z track stopped: engine failing, failing kept at the head of the queue$/);
  assert.equal(await runQueue({ queueFile: queue, stopFile: stop, stopOnFailure: true, now, say: () => {}, runLane: async () => 1 }), 1);
  assert.equal(await readFile(queue, "utf8"), "failing\nnext\n", "a queue that stops on failure keeps its failed lane");
  const ends = [];
  await runQueue({ queueFile: queue, stopFile: stop, now, say: () => {}, runLane: async (id) => { ends.push(id); return id === "failing" ? 1 : 0; } });
  assert.deepEqual(ends, ["failing", "next"], "otherwise a failed lane leaves like any other");
  await writeFile(queue, "bad line; rm\n");
  assert.equal(await runQueue({ queueFile: queue, stopFile: stop, now, say: () => {}, runLane: () => assert.fail() }), 1);
  assert.equal(await popRan(queue, "absent"), false);
});

test("12.3 · one runner per queue: a live runner refuses a second, and a dead runner's leftover pid does not block", async (t) => {
  const dir = await folder(t);
  const pidFile = join(dir, "night-A.pid");
  const marks = [/launch-night\.sh run A( |$)/, /launch\.mjs night A( |$)/];
  const processes = { 10: "bash /home/m/storytree-lanes/launch-night.sh run A", 11: "node /repo/launch.mjs night A", 12: "bash launch-night.sh run AB", 13: "vim" };
  const argsOf = async (pid) => processes[pid] ?? "";
  for (const [old, held] of [["10", false], ["11", false], ["12", true], ["13", true], ["99", true], ["", true]]) {
    await writeFile(pidFile, old);
    const result = await holdRunner({ pidFile, pid: 20, marks, argsOf });
    assert.equal(result.held, held, `pid file naming ${old || "nothing"}`);
    assert.equal((await readFile(pidFile, "utf8")).trim(), held ? "20" : old);
    if (!held) assert.equal(result.by, old);
  }
  await writeFile(pidFile, "20");
  assert.equal((await holdRunner({ pidFile, pid: 20, marks, argsOf: async () => processes[10] })).held, true, "its own pid is not another runner");
});

test("12.4 · the stop file stops the runner after its current lane, keeping the rest queued", async (t) => {
  const dir = await folder(t);
  const queue = join(dir, "q.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "one\ntwo\n");
  const lines = [], ran = [];
  const code = await runQueue({ queueFile: queue, stopFile: stop, now, say: (line) => lines.push(line),
    runLane: async (id) => { ran.push(id); await writeFile(stop, ""); return 0; } });
  assert.equal(code, 0);
  assert.deepEqual(ran, ["one"]);
  assert.equal(await readFile(queue, "utf8"), "two\n");
  assert.deepEqual(lines, ["2026-10-08T04:00:00Z stopped by night-stop"]);
});

test("12.5 · a lane's brief is its header, the increment's notes when it has any, then the common brief", () => {
  const header = { title: "Overnight lane: track A, inc_1", intro: "Your increment: inc_1. Your track: A. Your write fence: packages/x." };
  assert.equal(composeBrief({ ...header, notes: "Notes for inc_1.\n\n", common: "Common rules.\n" }),
    "# Overnight lane: track A, inc_1\n\nYour increment: inc_1. Your track: A. Your write fence: packages/x.\n\nNotes for inc_1.\n\nCommon rules.\n");
  assert.equal(composeBrief({ ...header, common: "Common rules.\n" }),
    "# Overnight lane: track A, inc_1\n\nYour increment: inc_1. Your track: A. Your write fence: packages/x.\n\nCommon rules.\n");
});
