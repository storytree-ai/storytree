/**
 * Capability 1 · Lifecycle, contract 1.32: after five restarts in a row the app stops restarting itself, and a start that
 * stays up resets the count. Each start of the app is a new background() with a new restartLimit on the same file.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { background } from "./background.js";
import { RESTARTS_IN_A_ROW, restartLimit, RestartsStopped, STABLE_AFTER_MS } from "./restart-limit.js";

const NEWER = { execPath: "/runtime/b/electron", args: ["/runtime/b/app"] };

/** One start of the app: its restart into a newer build, and what it did. */
async function startAndRestart(file: string): Promise<{ restarted: boolean; stopped: boolean; refusal?: unknown }> {
  let stopped = false;
  let relaunched = false;
  const app = background({
    stopDatabase: async () => { stopped = true; },
    exit: () => {},
    relaunch: () => { relaunched = true; },
    limit: restartLimit({ file }),
  });
  try {
    await app.restart(NEWER, true);
    return { restarted: relaunched, stopped };
  } catch (refusal) {
    return { restarted: relaunched, stopped, refusal };
  }
}

test("1.32 after five restarts in a row the app stops restarting itself: the sixth stops nothing and is refused, and a start that stays up resets the count", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dir = mkdtempSync(path.join(tmpdir(), "restart-limit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "restarts.json");

  for (let restart = 1; restart <= RESTARTS_IN_A_ROW; restart++) {
    assert.deepEqual(await startAndRestart(file), { restarted: true, stopped: true }, `restart ${restart} of ${RESTARTS_IN_A_ROW} runs`);
  }
  const sixth = await startAndRestart(file);
  assert.equal(sixth.stopped, false, "the sixth in a row stops nothing: the app and its database keep running");
  assert.equal(sixth.restarted, false, "and starts no other build");
  assert.ok(sixth.refusal instanceof RestartsStopped, "it is refused, saying why");
  assert.equal((await startAndRestart(file)).restarted, false, "and stays refused while no start has stayed up");

  // This start stays up: the restarts before it are no longer in a row.
  restartLimit({ file });
  t.mock.timers.tick(STABLE_AFTER_MS);
  for (let restart = 1; restart <= RESTARTS_IN_A_ROW; restart++) {
    assert.equal((await startAndRestart(file)).restarted, true, `after a stable start, restart ${restart} runs again`);
  }
  assert.equal((await startAndRestart(file)).restarted, false);
});
