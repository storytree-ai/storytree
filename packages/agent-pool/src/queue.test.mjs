import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { countEngines, holdRunner, processTable, reserveSlot, waitForSlot } from "./queue.mjs";

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-queue-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("3.1 · each running lane's engine counts once: not its wrapper or native child, nor a process that only mentions an engine", async () => {
  const codex = "/home/m/.nvm/versions/node/v24.19.0/lib/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/bin/codex";
  const table = [
    "  100     1 bash /home/m/storytree-lanes/launch-night.sh run L",
    "  101   100 bash /home/m/storytree-lanes/run-lane.sh /home/m/storytree-lanes/night-L-a-brief.md log err",
    "  102   101 node /home/m/.nvm/versions/node/v24.19.0/bin/codex exec # Overnight lane: track L, a",
    `  103   102 ${codex} exec # Overnight lane: track L, a`,
    `  104   103 ${codex.replace(/codex$/, "codex-code-mode-host")}`,
    "  200   199 node /home/m/code/storytree03/packages/agent-pool/src/runner.mjs run brief log err",
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

test("3.1 · a waiting runner reads the cap on every poll, so a raised cap starts it with no lane ending", async () => {
  let cap = 5, sleeps = 0;
  const running = await waitForSlot({ max: async () => cap, count: async () => 5, onWait: () => {},
    sleep: async () => { sleeps++; if (sleeps === 2) cap = 6; if (sleeps > 3) assert.fail("the raised cap was never read"); } });
  assert.equal(running, 5, "five still run: the raised cap, not a lane ending, freed the slot");
  assert.equal(sleeps, 2);
});

test("3.3 · one dispatcher at a time: a live one refuses a second, and a dead one's leftover pid does not block", async (t) => {
  const dir = await folder(t);
  const pidFile = join(dir, "pool.pid");
  const marks = [/launch\.mjs pool( |$)/];
  const processes = { 10: "node --import tsx packages/agent-pool/src/launch.mjs pool", 11: "node /repo/launch.mjs pool", 12: "node /repo/launch.mjs pools", 13: "vim" };
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

test("3.26 · on Windows each lane's engine counts once from the process list, its paths quoted and its brief over many lines", () => {
  const listed = [
    { ProcessId: 100, ParentProcessId: 1, CommandLine: String.raw`"C:\Program Files\nodejs\node.exe" --import tsx packages/agent-pool/src/launch.mjs pool` },
    { ProcessId: 101, ParentProcessId: 100, CommandLine: String.raw`"C:\Users\m\.local\bin\claude.exe" -p "# Pool lane: a` + "\r\n\r\n" + `Your increment: a." --model claude-opus-5-5` },
    { ProcessId: 102, ParentProcessId: 101, CommandLine: String.raw`"C:\Users\m\.local\bin\claude.exe" -p child of the same lane` },
    { ProcessId: 200, ParentProcessId: 1, CommandLine: String.raw`C:\nvm\node.exe C:\npm\node_modules\@openai\codex\bin\codex.js exec brief` },
    { ProcessId: 300, ParentProcessId: 1, CommandLine: 'powershell.exe -NoProfile -Command "claude -p"' },
    { ProcessId: 4, ParentProcessId: 0, CommandLine: null },
  ];
  const table = processTable(JSON.stringify(listed));
  assert.equal(countEngines(table), 2, "the Claude lane and the Codex lane, each once");
  assert.match(table, /^100 1 .*launch\.mjs pool$/m, "a runner's command line reads on one line, as holdRunner matches it");
  assert.equal(countEngines(processTable(JSON.stringify(listed[1]))), 1, "one process lists as one object, not a list");
  assert.equal(processTable(""), "");
});

test("3.32 · two engine starters racing for the last slot under the cap start one engine between them; a dead starter's reservation holds none", async (t) => {
  const dir = join(await folder(t), "engine-slots");
  // One engine runs under a cap of 2; a starter's engine shows in the process table only once it is up, a moment after its count.
  let engines = 1;
  const count = async () => { const seen = engines; await new Promise((go) => setTimeout(go, 20)); return seen; };
  const started = [], waits = [];
  const starter = (pid) => reserveSlot({ dir, max: 2, count, pid, alive: () => true, onWait: (running) => waits.push({ pid, running }),
    sleep: async () => {
      started.push("slept"); engines = 2; await winner.release(); engines = 1;
      assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".slot")), [], "release frees the winner's slot");
    } })
    .then((slot) => { started.push(pid); return slot; });
  let winner;
  const first = starter(11), second = starter(12);
  winner = await Promise.race([first, second]);
  const loser = await (winner === await first ? second : first);
  assert.equal(started.length, 3, "the second starter took a slot only after waiting");
  assert.equal(started[1], "slept", "one starter waited while the other held the last slot");
  assert.deepEqual(waits.map((one) => one.running), [2], "the waiter counted the engine running and the other's reservation");
  await loser.release();
  assert.deepEqual(await readdir(dir), [], "each released slot, and the lock, are gone");
  // A reservation whose starter died leaves its slot free, and is cleared.
  await reserveSlot({ dir, max: 2, count: async () => 1, pid: 21, alive: () => true, onWait: () => {}, sleep: async () => {} });
  const freed = await reserveSlot({ dir, max: 2, count: async () => 1, pid: 22, alive: (pid) => pid !== 21, onWait: () => assert.fail("a dead starter's reservation held the slot"), sleep: async () => {} });
  assert.equal(freed.running, 1);
  assert.deepEqual((await readdir(dir)).map((name) => name.split("-")[0]), ["22"], "only the live starter's reservation is left");
});
