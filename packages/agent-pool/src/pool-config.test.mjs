import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

test("3.15 · the pool reads its machine, checkout, lanes, briefs, session cap, lane memory, models, identity and watcher limits from this machine's own file, ~ as this machine's home", async (t) => {
  const fields = { machine: "box", checkout: "~/src/shop", lanes: "~/pool", briefs: "~/pool/briefs", addDirs: ["~/src/shop-wt", "/srv/shared"], sessions: 3, laneMemory: "12G",
    engines: { codex: { model: "codex-model" }, claude: { model: "claude-model" }, switchAt: 80 },
    identity: { name: "Lane Owner", email: "owner@example.com" },
    watcher: { fixesPerRed: 1, fixesPerPullRequest: 4, intervalSeconds: 30 } };
  const file = await configFile(t, fields);
  const expected = {
    file, machine: "box", checkout: join("/home/u", "src/shop"), remoteCheckout: "~/src/shop", lanesDir: join("/home/u", "pool"),
    briefsDir: join("/home/u", "pool/briefs"), addDirs: [join("/home/u", "src/shop-wt"), "/srv/shared", join("/home/u", "pool")], sessions: 3, laneMemory: "12G",
    models: { codex: "codex-model", claude: "claude-model" }, switchAt: 80, identity: { name: "Lane Owner", email: "owner@example.com" },
    watcher: { fixesPerRed: 1, fixesPerPullRequest: 4, intervalMs: 30_000 }, machineOnly: false, projects: [{ name: "storytree" }],
  };
  assert.deepEqual(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }), expected);

  // With no AGENT_POOL_CONFIG it is the machine file under this machine's home, ~/.storytree/agent-pool.json (ADR-1216 D1).
  const home = await mkdtemp(join(tmpdir(), "pool-config-home-"));
  t.after(() => removeTemp(home));
  await mkdir(join(home, ".storytree"));
  await writeFile(join(home, ".storytree", "agent-pool.json"), JSON.stringify(fields));
  assert.deepEqual(poolConfig({ home, env: {} }), { ...expected, file: join(home, ".storytree", "agent-pool.json"), checkout: join(home, "src/shop"), lanesDir: join(home, "pool"), briefsDir: join(home, "pool/briefs"),
    addDirs: [join(home, "src/shop-wt"), "/srv/shared", join(home, "pool")] });

  // An identity is read only whole: a name with no email (or the reverse) is none, and git's own configuration decides.
  await writeFile(file, JSON.stringify({ identity: { name: "Lane Owner" } }));
  assert.equal(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).identity, undefined);
  await writeFile(file, JSON.stringify({ identity: { email: "owner@example.com" } }));
  assert.equal(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).identity, undefined);

  // A hand-over from another machine runs in the pool's checkout there, which may be named apart from this machine's own.
  await writeFile(file, JSON.stringify({ machine: "box", checkout: "C:/src/shop", machineCheckout: "~/code/shop" }));
  assert.equal(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).remoteCheckout, "~/code/shop");

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
    file, machine: undefined, checkout: CHECKOUT, remoteCheckout: CHECKOUT, lanesDir: join("/home/u", ".storytree/agent-pool"), briefsDir: undefined,
    addDirs: [join("/home/u", ".storytree/agent-pool")], sessions: undefined, models: { codex: undefined, claude: undefined }, switchAt: 100, identity: undefined,
    watcher: { fixesPerRed: 2, fixesPerPullRequest: 6, intervalMs: 60_000 }, machineOnly: false, projects: [{ name: "storytree" }],
  });
});

test("3.35 · the pool serves each project its machine names, each from its checkout there, ~ as this machine's home; with none named it serves storytree alone, from the pool's own checkout", async (t) => {
  const file = await configFile(t, { projects: [{ name: "storytree" }, { name: "storytree-website", checkout: "~/code/storytree-website" }] });
  const read = () => poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).projects;
  assert.deepEqual(read(), [{ name: "storytree" }, { name: "storytree-website", checkout: join("/home/u", "code/storytree-website") }]);
  await writeFile(file, JSON.stringify({ projects: [] }));
  assert.deepEqual(read(), [{ name: "storytree" }], "an empty list names none");
  // Only storytree's lanes may start in the pool's own checkout: another project's must say where its own is.
  await writeFile(file, JSON.stringify({ projects: [{ name: "storytree-website" }] }));
  assert.throws(read, /project storytree-website names no checkout/);
});

test("3.36 · another project's entry keeps the checks and review its lanes are briefed with; one naming neither keeps none", async (t) => {
  const file = await configFile(t, { projects: [{ name: "storytree-website", checkout: "/srv/site", checks: ["pnpm test", "pnpm build"], review: "CI reviews it." },
    { name: "shop", checkout: "/srv/shop", checks: [] }] });
  assert.deepEqual(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).projects, [
    { name: "storytree-website", checkout: "/srv/site", checks: ["pnpm test", "pnpm build"], review: "CI reviews it." },
    { name: "shop", checkout: "/srv/shop" },
  ]);
});

test("3.24 · a pool configured machineOnly is read as machine-only; any other value, or none, is not (ADR-1179 D2)", async (t) => {
  const file = await configFile(t, { machine: "laptop", machineOnly: true });
  assert.equal(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).machineOnly, true);
  await writeFile(file, JSON.stringify({ machineOnly: "yes" }));
  assert.equal(poolConfig({ home: "/home/u", env: { AGENT_POOL_CONFIG: file } }).machineOnly, false);
});

test("3.17 · with nothing pinning it, the cap is what the box's size allows: the smaller of its cores and its memory per lane, at least one", async () => {
  const GiB = 1024 ** 3;
  const unpinned = { lanesDir: "/lanes", readText: async () => { throw new Error("ENOENT"); } };
  assert.equal(await readCap({ ...unpinned, box: { cores: 12, memoryBytes: 32 * GiB } }), 6, "12 cores / 2 = 6, under 32 GB / 3 GB = 10");
  assert.equal(await readCap({ ...unpinned, box: { cores: 32, memoryBytes: 16 * GiB } }), 5, "memory bound: 16 GB / 3 GB");
  assert.equal(await readCap({ ...unpinned, box: { cores: 1, memoryBytes: 2 * GiB } }), 1, "a small machine still runs one");
  assert.equal(await readCap({ ...unpinned, sessions: 4, box: { cores: 12, memoryBytes: 32 * GiB } }), 4, "a configured sessions count pins it");
  assert.equal(await readCap({ lanesDir: "/lanes", sessions: 4, box: { cores: 12, memoryBytes: 32 * GiB },
    readText: async (path) => { assert.equal(path, join("/lanes", "night-max-lanes")); return "7\n"; } }), 7, "night-max-lanes pins it over both");
});
