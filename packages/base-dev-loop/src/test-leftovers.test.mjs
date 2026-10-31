// increment_e72347bdd355: a test Postgres started under Temp on 2026-10-11 was still running twelve days
// later, from a worktree that no longer existed, beside hundreds of storytree scratch folders. These
// tests run real servers through @storytree/local-postgres and leave each one to be stopped by what
// they test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { start } from "@storytree/local-postgres";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import { sweepLeftovers } from "./test-leftovers.mjs";
import { killTree, runUnit } from "./unit-run.mjs";

const localPostgres = pathToFileURL(fileURLToPath(import.meta.resolve("@storytree/local-postgres"))).href;
const DAY = 24 * 60 * 60 * 1000;

/** Cleanups run last first, so a server is stopped before the folder holding it is removed. */
function cleanups(t) {
  const steps = [];
  t.after(async () => {
    for (const step of steps.reverse()) await step();
  });
  return steps;
}

function folder(steps, prefix) {
  const made = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  steps.push(() => removeTemp(made));
  return made;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** The postmaster's pid, read from the data folder while the server runs. */
function postmaster(dataDir) {
  return Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
}

/**
 * A pid no process can have: above Linux's and macOS's pid ranges, and on Windows, which hands out
 * small pids, never reached. An exited child's pid would not do: Windows can reuse it at once.
 */
function deadPid() {
  return 2 ** 31 - 1;
}

/** Start a server on `dataDir` from a process that then exits without stopping it, as a killed run does. */
function abandoned(dataDir) {
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const script = path.join(path.dirname(dataDir), `${path.basename(dataDir)}.abandon.mjs`);
  writeFileSync(script, `import { start } from ${JSON.stringify(localPostgres)};
await start({ dataDir: ${JSON.stringify(dataDir)} });
process.exit(0);`);
  const run = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8", cwd: fileURLToPath(new URL(".", import.meta.url)) });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return postmaster(dataDir);
}

/** Make a data folder's owner record name a gone process: the exited starter's own pid, Windows can reuse at once. */
function goneOwner(dataDir) {
  const owner = `${dataDir}.owner.json`;
  writeFileSync(owner, JSON.stringify({ ...JSON.parse(readFileSync(owner, "utf8")), pid: deadPid() }));
}

/** A stopper for a server the test itself must stop if what it tests did not. */
function stopLater(steps, pid) {
  steps.push(() => {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  });
}

/** A unit whose one test starts a server in the unit's temp folder, records it, then ends as `ending` says. */
function serverUnit(steps, ending) {
  const root = folder(steps, "leftovers-unit-");
  writeFileSync(path.join(root, "server.test.mjs"), `import { readFileSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path"; import { test } from "node:test";
import { start } from ${JSON.stringify(localPostgres)};
test("starts a server and never stops it", async () => {
  const dataDir = path.join(tmpdir(), "db");
  await start({ dataDir });
  writeFileSync("RECORD", JSON.stringify({ temp: tmpdir(), pid: Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\\n")[0]) }));
  ${ending}
});`);
  return root;
}

async function untilRecord(root) {
  const file = path.join(root, "RECORD");
  await waitUntil(() => existsSync(file), 30_000, `the unit to write ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

test("4.20 · a unit's end stops every Postgres server running on a data folder in its temp folder, whether it passed, failed or was killed, before the folder is removed", { timeout: 180_000 }, async (t) => {
  const steps = cleanups(t);
  for (const [ending, kill] of [["", false], ["throw new Error('red');", false], ["await new Promise(() => {});", true]]) {
    const root = serverUnit(steps, ending);
    let child;
    const run = runUnit({ root, files: ["server.test.mjs"], env: process.env, stdio: "ignore", onSpawn: (spawned) => (child = spawned) });
    const seen = await untilRecord(root);
    stopLater(steps, seen.pid);
    if (kill) killTree(child);
    const result = await run;
    assert.equal(result.code === 0, ending === "", `the unit ${ending === "" ? "passed" : "did not pass"}`);
    await waitUntil(() => !alive(seen.pid), 1_000, `the server a unit left running (${ending || "pass"}) to be stopped when the unit ends`);
    assert.equal(existsSync(seen.temp), false, "and its temp folder is removed with the data folder in it");
  }
});

test("4.21 · a run's start stops any Postgres server in Temp left by a run that has gone, and removes that run's temp folders", { timeout: 180_000 }, async (t) => {
  const steps = cleanups(t);
  const temp = folder(steps, "leftovers-temp-");
  const deadRun = path.join(temp, `st-unit-${deadPid()}-AbC123`);
  const orphan = abandoned(path.join(deadRun, "db"));
  stopLater(steps, orphan);
  const legacy = path.join(temp, "storytree-local-postgres-Xy9876");
  const stale = abandoned(path.join(legacy, "stale"));
  stopLater(steps, stale);
  goneOwner(path.join(legacy, "stale"));
  const owned = await start({ dataDir: path.join(legacy, "owned") });
  steps.push(() => owned.stop());
  const liveRun = path.join(temp, `st-unit-${process.pid}-LiVe99`);
  mkdirSync(liveRun);

  sweepLeftovers({ tmp: temp });

  await waitUntil(() => !alive(orphan), 10_000, "the server in a gone run's unit folder to be stopped");
  assert.equal(existsSync(deadRun), false, "and the gone run's unit folder removed");
  await waitUntil(() => !alive(stale), 10_000, "a server in a storytree scratch folder whose owner has gone to be stopped");
  assert.equal(alive(postmaster(owned.dataDir)), true, "a server whose owner lives is left running");
  assert.equal(existsSync(liveRun), true, "a live run's unit folder is left alone");
});

test("4.22 · a run's start removes storytree scratch folders in Temp older than three days, keeping a newer one and one a live server still uses", { timeout: 120_000 }, async (t) => {
  const steps = cleanups(t);
  const temp = folder(steps, "leftovers-temp-");
  const old = new Date(Date.now() - 4 * DAY);
  const made = (name, date) => {
    const at = path.join(temp, name);
    mkdirSync(path.join(at, "inside"), { recursive: true });
    writeFileSync(path.join(at, "inside", "file"), "x");
    if (date !== undefined) utimesSync(at, date, date);
    return at;
  };
  const stale = [made("storytree-link-AAAAAA", old), made("storytree-cli-bin-BBBBBB", old), made("st-unit-CCCCCC", old)];
  const fresh = made("storytree-cli-DDDDDD", new Date(Date.now() - 1 * DAY));
  const notScratch = made("storytree-captures", old);
  const used = path.join(temp, "storytree-local-postgres-EEEEEE");
  const server = await start({ dataDir: path.join(used, "db") });
  steps.push(() => server.stop());
  utimesSync(used, old, old);

  sweepLeftovers({ tmp: temp });

  for (const at of stale) assert.equal(existsSync(at), false, `${path.basename(at)} is swept`);
  assert.equal(existsSync(fresh), true, "a folder younger than three days is kept");
  assert.equal(existsSync(notScratch), true, "a folder not named as scratch is kept");
  assert.equal(existsSync(used), true, "a folder a live server uses is kept");
  assert.equal(alive(postmaster(server.dataDir)), true, "and its server left running");
});
