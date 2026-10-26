import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { poolConfig, readCap } from "./pool-config.mjs";

/** The checkout these tests run in, as Git names it. */
const CHECKOUT = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname, encoding: "utf8" }).trim());

async function configFile(t, fields) {
  const dir = await mkdtemp(join(tmpdir(), "pool-config-"));
  t.after(() => removeTemp(dir));
  const file = join(dir, "agent-pool.json");
  if (fields !== undefined) await writeFile(file, JSON.stringify(fields));
  return file;
}

test("3.15 · the pool reads its machine, checkout, lanes, session cap, models and watcher limits from its configuration, ~ as this machine's home", async (t) => {
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

test("3.16 · with no configuration the pool runs on general defaults: this checkout, no other machine, no pinned session cap, the engines' own models, Codex until it is spent", async (t) => {
  const file = await configFile(t);
  assert.deepEqual(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }), {
    machine: undefined, checkout: CHECKOUT, remoteCheckout: CHECKOUT, lanesDir: join("/home/u", ".storytree/agent-pool"),
    addDirs: [join("/home/u", ".storytree/agent-pool")], sessions: undefined, models: { codex: undefined, claude: undefined }, switchAt: 100,
    watcher: { fixesPerRed: 2, fixesPerPullRequest: 6, intervalMs: 60_000 },
  });
});

test("3.17 · with nothing pinning it, the cap is what the box's size allows: the smaller of its cores and its memory per lane, at least one", async () => {
  const GiB = 1024 ** 3;
  const unpinned = { lanesDir: "/lanes", readText: async () => { throw new Error("ENOENT"); } };
  assert.equal(await readCap({ ...unpinned, box: { cores: 12, memoryBytes: 32 * GiB } }), 6, "the Mint box: 12 cores / 2 = 6, under 32 GB / 3 GB = 10");
  assert.equal(await readCap({ ...unpinned, box: { cores: 32, memoryBytes: 16 * GiB } }), 5, "memory bound: 16 GB / 3 GB");
  assert.equal(await readCap({ ...unpinned, box: { cores: 1, memoryBytes: 2 * GiB } }), 1, "a small machine still runs one");
  assert.equal(await readCap({ ...unpinned, sessions: 4, box: { cores: 12, memoryBytes: 32 * GiB } }), 4, "a configured sessions count pins it");
  assert.equal(await readCap({ lanesDir: "/lanes", sessions: 4, box: { cores: 12, memoryBytes: 32 * GiB },
    readText: async (path) => { assert.equal(path, join("/lanes", "night-max-lanes")); return "7\n"; } }), 7, "night-max-lanes pins it over both");
});
