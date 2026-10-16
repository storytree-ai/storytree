import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { main as launchMain } from "@storytree/agent-pool/launch";
import { main as runnerMain } from "@storytree/agent-pool/runner";
import { main as watchMain } from "@storytree/agent-pool/watch";

import * as launch from "./launch.mjs";
import * as runner from "./runner.mjs";
import * as watch from "./watch.mjs";

const run = promisify(execFile);

/** Runs the old lanes path as the box's scripts and older checkouts do (`node packages/dev-loop/src/lanes/<name>.mjs …`), under a throwaway home. */
async function runOld(t, name, args) {
  const home = await mkdtemp(join(tmpdir(), "lanes-forwarder-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  return run(process.execPath, [file, ...args], { env: { ...process.env, HOME: home, USERPROFILE: home } })
    .then(({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }), (error) => ({ code: error.code, output: `${error.stdout}${error.stderr}` }));
}

test("10.13 · the lane runner's old path, which run-lane.sh runs, forwards to the agent pool's runner", async (t) => {
  assert.equal(runner.main, runnerMain);
  const { code, output } = await runOld(t, "runner", ["no-such-verb"]);
  assert.equal(code, 2);
  assert.match(output, /usage: runner\.mjs run/);
});

test("12.18 · the dispatcher's old path, which launch-pool.sh runs, forwards to the agent pool's dispatcher", async (t) => {
  assert.equal(launch.main, launchMain);
  const { code, output } = await runOld(t, "launch", ["no-such-verb"]);
  assert.equal(code, 2);
  assert.match(output, /usage: launch\.mjs pool/);
});

test("13.27 · the watcher's old path, which a hand-over from an older checkout runs, forwards to the agent pool's watcher", async (t) => {
  assert.equal(watch.main, watchMain);
  const { code, output } = await runOld(t, "watch", ["no-such-verb"]);
  assert.equal(code, 2);
  assert.match(output, /usage: watch\.mjs handover/);
});
