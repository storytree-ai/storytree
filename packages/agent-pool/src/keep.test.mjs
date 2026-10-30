import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { laneEnv, loopOf, main, MARK } from "./keep.mjs";

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "pool-keep-"));
  t.after(() => removeTemp(path));
  return path;
}

/** A box whose loop and watcher are down, with pool.status `status`; what the keeper started and noted is recorded. */
function box(lanesDir, status, extra = {}) {
  const did = { loops: 0, watchers: 0, notes: [], lines: [] };
  return {
    did,
    lanesDir, checkout: "/home/me/code/storytree03", stopFile: join(lanesDir, "pool-stop"),
    looping: async () => false, status: async () => status,
    startLoop: async () => { did.loops++; return 4242; },
    note: async (line) => { did.notes.push(line); status += `2026-10-31T00:00:00Z ${line}\n`; },
    watcher: async () => { did.watchers++; return true; },
    say: (line) => did.lines.push(line),
    ...extra,
  };
}

test("3.29 · the keeper starts the dispatcher's loop and the watcher when they are down, and leaves a paused or exit-75 dispatcher stopped, saying so once", async (t) => {
  const lanesDir = await folder(t);
  const crashed = "2026-10-30T13:00:00Z dispatcher started\n2026-10-30T13:15:55Z start increment_a\n";
  const down = box(lanesDir, crashed);
  assert.equal(await main([], down), 0);
  assert.deepEqual([down.did.loops, down.did.watchers], [1, 1], "a loop killed mid-run, and the watcher, are started again");
  assert.match(down.did.lines.join("\n"), /started the dispatcher's loop \(pid 4242\)/);

  const up = box(lanesDir, crashed, { looping: async () => true, watcher: async () => false });
  await main([], up);
  assert.deepEqual([up.did.loops, up.did.lines], [0, []], "nothing running is started twice, and a quiet look says nothing");

  const stopped = `${crashed}2026-10-30T13:17:48Z pool stopped: engine failing at once on increment_a\n2026-10-30T13:17:48Z dispatcher ended\n`;
  const held = box(lanesDir, stopped);
  await main([], held);
  await main([], held);
  assert.equal(held.did.loops, 0, "an engine failing at once is the owner's to look at, not restarted every minute");
  assert.equal(held.did.notes.length, 1, "pool.status says it once, not every minute");
  assert.match(held.did.notes[0], /left the dispatcher stopped: its last run ended on exit 75 \(pool stopped: engine failing at once on increment_a\)/);
  const restarted = box(lanesDir, `${stopped}2026-10-30T20:46:48Z dispatcher started\n2026-10-30T21:35:19Z launch-pool.sh: dispatcher exited 3\n`);
  await main([], restarted);
  assert.equal(restarted.did.loops, 1, "a 75 before the dispatcher's last start no longer holds it");

  const table = "  7 1 bash /home/me/storytree-lanes/launch-pool.sh run\n  8 1 bash -c grep 'launch-pool.sh run'\n";
  assert.equal(loopOf(table, "/home/me/storytree-lanes"), true);
  assert.equal(loopOf("  7 1 bash launch-pool.sh run\n", "/home/me/storytree-lanes"), true, "a loop started from the lanes folder names its script bare");
  assert.equal(loopOf(table, "/tmp/other-lanes"), false, "another lanes folder's loop is not this one's");

  await writeFile(join(lanesDir, "pool-stop"), "paused\n");
  const paused = box(lanesDir, crashed);
  await main([], paused);
  assert.deepEqual([paused.did.loops, paused.did.watchers], [0, 1], "pool-stop pauses the dispatcher, never the watcher");
});

test("3.29 · the keeper's crontab line is added once, beside the user's own lines, and starts the loop with claude and node on PATH", async (t) => {
  const lanesDir = await folder(t);
  let table = "MAILTO=\"\"\n0 3 * * * echo mine\n";
  const writes = [];
  const b = { ...box(lanesDir, ""), crontab: { read: async () => table, write: async (next) => { writes.push(next); table = next; } } };
  await main(["install"], b);
  await main(["install"], b);
  assert.equal(writes.length, 1, "a second install changes nothing");
  const lines = table.trimEnd().split("\n");
  assert.deepEqual(lines.slice(0, 2), ["MAILTO=\"\"", "0 3 * * * echo mine"]);
  assert.match(lines[2], /^\* \* \* \* \* cd \/home\/me\/code\/storytree03 && .*node" packages\/agent-pool\/src\/keep\.mjs >> \S+keep\.log 2>&1 /);
  assert.ok(lines[2].endsWith(MARK));
  table = table.replace("keep.log", "old.log");
  await main(["install"], b);
  assert.equal(table.split("\n").filter((line) => line.includes(MARK)).length, 1, "an older line of its own is replaced, not doubled");

  const env = laneEnv({ PATH: "/usr/bin:/bin", CLAUDE_CODE_SESSION_ID: "s" }, { home: "/home/me", nodeBin: "/n/bin", uid: 1000, exists: () => true });
  assert.equal(env.PATH, "/n/bin:/home/me/.local/bin:/usr/bin:/bin", "cron's bare PATH has no claude (~/.local/bin) and no node");
  assert.equal(env.XDG_RUNTIME_DIR, "/run/user/1000");
  assert.equal(env.CLAUDE_CODE_SESSION_ID, undefined, "what it starts belongs to no agent session");
});
