import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { countEngines, holdRunner, waitForSlot } from "./queue.mjs";

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

test("12.3 · one dispatcher at a time: a live one refuses a second, and a dead one's leftover pid does not block", async (t) => {
  const dir = await folder(t);
  const pidFile = join(dir, "pool.pid");
  const marks = [/launch\.mjs pool( |$)/];
  const processes = { 10: "node --import tsx packages/dev-loop/src/lanes/launch.mjs pool", 11: "node /repo/launch.mjs pool", 12: "node /repo/launch.mjs pools", 13: "vim" };
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
