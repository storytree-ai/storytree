/** Capability 3 · Hooks, contracts 3.51 and 3.52: hooks over a wss:// library, which every round trip crosses Cloudflare and a tunnel to reach (ADR-1093). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { setLibrary } from "@storytree/project-and-caller";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { AFTER_TOOL } from "./at-once.js";
import { DEADLINE_MS, GUARDED_DEADLINE_MS, hookDeadline, REMOTE_DEADLINE_MS } from "./deadlines.js";
import { EDIT_GATE } from "./edit-gate.js";
import { OBSERVE_STEP } from "./shell-edits.js";
import { remoteLibrary, takeTurn, TURN_FILE } from "./remote-turn.js";

test("3.51 over a wss:// library a hook nothing waits for may run 50 s, inside Claude Code's 60 s; hooks the agent waits for keep their deadlines", () => {
  assert.equal(hookDeadline([AFTER_TOOL], OBSERVE_STEP.floorMs, true), REMOTE_DEADLINE_MS);
  assert.ok(REMOTE_DEADLINE_MS < 60_000);
  assert.equal(hookDeadline([EDIT_GATE], OBSERVE_STEP.floorMs, true), GUARDED_DEADLINE_MS);
  assert.equal(hookDeadline([], OBSERVE_STEP.floorMs, true), DEADLINE_MS);
  assert.ok(hookDeadline([AFTER_TOOL], OBSERVE_STEP.floorMs, false) < REMOTE_DEADLINE_MS);
});

test("3.51 the library is remote when this machine's setting is a wss:// address, and not when it is a postgres:// one or the local library", async () => {
  await withTempDir((dir) => {
    assert.equal(remoteLibrary(dir), false, "no setting: the local library");
    setLibrary(["postgres", "postgres://storytree_library@mint:5432/postgres"], dir);
    assert.equal(remoteLibrary(dir), false);
    setLibrary(["postgres", "wss://storytree_library@library-host/postgres"], dir);
    assert.equal(remoteLibrary(dir), true);
  });
});

test("3.52 one hook at a time on a machine holds the turn to reach a wss:// library; a turn its holder left behind is taken, and letting go frees it", async () => {
  await withTempDir((dir) => {
    const release = takeTurn(dir);
    assert.ok(release !== undefined, "a free turn is taken");
    // Another live process holding it: this process's parent stands in for a second hook.
    writeFileSync(path.join(dir, TURN_FILE), String(process.ppid));
    assert.equal(takeTurn(dir), undefined, "held by a live process: refused");
    // A holder that has gone.
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout;
    writeFileSync(path.join(dir, TURN_FILE), gone);
    const taken = takeTurn(dir);
    assert.ok(taken !== undefined, "left by a gone process: taken");
    taken();
    const again = takeTurn(dir);
    assert.ok(again !== undefined, "let go: free again");
    again();
  });
});
