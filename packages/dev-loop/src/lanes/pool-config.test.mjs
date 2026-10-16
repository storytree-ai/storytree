import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { poolConfig } from "./pool-config.mjs";

/** The checkout these tests run in, as Git names it. */
const CHECKOUT = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname, encoding: "utf8" }).trim());

async function configFile(t, fields) {
  const dir = await mkdtemp(join(tmpdir(), "pool-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "agent-pool.json");
  if (fields !== undefined) await writeFile(file, JSON.stringify(fields));
  return file;
}

test("12.15 · the pool reads its machine, checkout, lanes, session cap, models and watcher limits from its configuration, ~ as this machine's home", async (t) => {
  const file = await configFile(t, { machine: "box", checkout: "~/src/shop", lanes: "~/pool", addDirs: ["~/src/shop-wt", "/srv/shared"], sessions: 3,
    engines: { codex: { model: "codex-model" }, claude: { model: "claude-model" }, switchAt: 80 },
    watcher: { fixesPerRed: 1, fixesPerPullRequest: 4, intervalSeconds: 30 } });
  assert.deepEqual(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }), {
    machine: "box", checkout: join("/home/u", "src/shop"), remoteCheckout: "~/src/shop", lanesDir: join("/home/u", "pool"),
    addDirs: [join("/home/u", "src/shop-wt"), "/srv/shared", join("/home/u", "pool")], sessions: 3,
    models: { codex: "codex-model", claude: "claude-model" }, switchAt: 80,
    watcher: { fixesPerRed: 1, fixesPerPullRequest: 4, intervalMs: 30_000 },
  });

  // The environment the pool read before still overrides the file.
  const env = { AGENT_POOL_CONFIG: file, LANES_DIR: "/tmp/lanes", CODEX_STOP_AT: "70", WATCH_BOX_HOST: "other", WATCH_FIX_LIMIT: "3", WATCH_FIX_CAP: "9", WATCH_INTERVAL_S: "5" };
  const over = poolConfig({ home: "/home/u", env });
  assert.equal(over.lanesDir, "/tmp/lanes"); assert.equal(over.addDirs.at(-1), "/tmp/lanes");
  assert.equal(over.switchAt, 70); assert.equal(over.machine, "other");
  assert.deepEqual(over.watcher, { fixesPerRed: 3, fixesPerPullRequest: 9, intervalMs: 5000 });

  // A configuration that cannot be read stops the pool rather than running it on defaults.
  await writeFile(file, "{ not json");
  assert.throws(() => poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }), /could not read the agent pool's configuration/);
});

test("12.16 · with no configuration the pool runs on general defaults: this checkout, no other machine, the engines' own models, Codex until it is spent", async (t) => {
  const file = await configFile(t);
  assert.deepEqual(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }), {
    machine: undefined, checkout: CHECKOUT, remoteCheckout: CHECKOUT, lanesDir: join("/home/u", ".storytree/agent-pool"),
    addDirs: [join("/home/u", ".storytree/agent-pool")], sessions: 2, models: { codex: undefined, claude: undefined }, switchAt: 100,
    watcher: { fixesPerRed: 2, fixesPerPullRequest: 6, intervalMs: 60_000 },
  });
});
