// increment_e72347bdd355: a test Postgres started under Temp on 2026-10-11 was still running twelve days
// later, from a worktree that no longer existed, beside hundreds of storytree scratch folders. These
// tests run real servers through @storytree/local-postgres and leave each one to be stopped by what
// they test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { start } from "@storytree/local-postgres";
import pg from "pg";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import { removeFolder, removeWhenFree, stopServersUnder, sweepLeftovers } from "./test-leftovers.mjs";
import { killTree, runUnit } from "./unit-run.mjs";

const localPostgres = pathToFileURL(fileURLToPath(import.meta.resolve("@storytree/local-postgres"))).href;
const DAY = 24 * 60 * 60 * 1000;
// increment_6237cbe8961f: on Windows CI a Postgres start outlasted the inner unit's 60 s test limit, so no
// RECORD came, and a unit's temp folder stayed held past the harness's ten seconds. The inner units get
// limits a slow start fits in, and the test waits on the unit's write and the folder's removal.
const SLOW_START_MS = 300_000;

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

/**
 * A stopper for a server the test itself must stop if what it tests did not, and a check, true once the
 * server is seen gone. A pid seen gone is never signalled: Windows can give it at once to another
 * process, as a test file's of this same run, killed with exit code 1 and no word on CI (increment_bd97e464ae7a).
 */
function stopLater(steps, pid) {
  let gone = false;
  steps.push(() => {
    if (!gone && alive(pid)) process.kill(pid, "SIGKILL");
  });
  return () => (gone = !alive(pid));
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

/**
 * The unit's RECORD, waited for until it is written, or failed at once if the unit ends without it, as
 * one whose server start outlasted its limits does.
 */
async function untilRecord(root, run) {
  const file = path.join(root, "RECORD");
  let ended;
  run.then((result) => (ended = result), (error) => (ended = { output: error.stack }));
  await waitUntil(() => {
    if (existsSync(file)) return true;
    if (ended !== undefined) assert.fail(`the unit ended (code ${ended.code}) before it wrote ${file}:\n${ended.output}`);
    return false;
  }, SLOW_START_MS, `the unit to write ${file} or end`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Wait until `at` is gone: the harness removes a held folder once its hold lets go. */
async function untilGone(at, what) {
  await waitUntil(() => !existsSync(at), 120_000, what);
}

test("4.20 · a unit's end stops every Postgres server running on a data folder in its temp folder, whether it passed, failed or was killed, before the folder is removed", { timeout: 900_000 }, async (t) => {
  const steps = cleanups(t);
  for (const [ending, kill] of [["", false], ["throw new Error('red');", false], ["await new Promise(() => {});", true]]) {
    const root = serverUnit(steps, ending);
    let child;
    const run = runUnit({ root, files: ["server.test.mjs"], env: process.env, hold: true, testLimitMs: SLOW_START_MS, unitLimitMs: SLOW_START_MS, onSpawn: (spawned) => (child = spawned) });
    const seen = await untilRecord(root, run);
    const stopped = stopLater(steps, seen.pid);
    if (kill) killTree(child);
    const result = await run;
    assert.equal(result.code === 0, ending === "", `the unit ${ending === "" ? "passed" : "did not pass"}:\n${result.output}`);
    await waitUntil(stopped, 1_000, `the server a unit left running (${ending || "pass"}) to be stopped when the unit ends`);
    await untilGone(seen.temp, `the unit's temp folder (${ending || "pass"}) to be removed with the data folder in it`);
  }
});

test("4.21 · a run's start stops any Postgres server in Temp left by a run that has gone, and removes that run's temp folders", { timeout: 180_000 }, async (t) => {
  const steps = cleanups(t);
  const temp = folder(steps, "leftovers-temp-");
  const deadRun = path.join(temp, `st-unit-${deadPid()}-AbC123`);
  const orphan = abandoned(path.join(deadRun, "db"));
  const orphanStopped = stopLater(steps, orphan);
  const legacy = path.join(temp, "storytree-local-postgres-Xy9876");
  const stale = abandoned(path.join(legacy, "stale"));
  const staleStopped = stopLater(steps, stale);
  goneOwner(path.join(legacy, "stale"));
  const owned = await start({ dataDir: path.join(legacy, "owned") });
  steps.push(() => owned.stop());
  const liveRun = path.join(temp, `st-unit-${process.pid}-LiVe99`);
  mkdirSync(liveRun);

  sweepLeftovers({ tmp: temp });

  await waitUntil(orphanStopped, 10_000, "the server in a gone run's unit folder to be stopped");
  assert.equal(existsSync(deadRun), false, "and the gone run's unit folder removed");
  await waitUntil(staleStopped, 10_000, "a server in a storytree scratch folder whose owner has gone to be stopped");
  assert.equal(alive(postmaster(owned.dataDir)), true, "a server whose owner lives is left running");
  assert.equal(existsSync(liveRun), true, "a live run's unit folder is left alone");
});

// friction_4e5b26e21141: 4.20 and 4.21 failed on Windows with EPERM removing a temp folder a Postgres
// just killed still held, past Node's own retries of about a second and a half.
test("4.20 · 4.21 · a folder whose files stay held for a while after its server stops is still removed, and one held past the budget fails with the reason", async (t) => {
  const steps = cleanups(t);
  const at = folder(steps, "leftovers-held-");
  writeFileSync(path.join(at, "file"), "x");
  let clock = 0;
  const time = { now: () => clock, pause: (ms) => (clock += ms) };
  const codes = ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"];
  let tries = 0;
  removeFolder(at, {
    ...time,
    rm: (target) => {
      if (clock < 2_000) throw Object.assign(new Error(`${codes[tries % codes.length]}: held`), { code: codes[tries++ % codes.length] });
      rmSync(target, { recursive: true, force: true });
    },
  });
  assert.equal(existsSync(at), false, "removed once the hold lets go");
  assert.ok(tries > codes.length, "retried through every held code");
  clock = 0;
  assert.throws(() => removeFolder(at, { ...time, rm: () => { throw Object.assign(new Error("EPERM: still held"), { code: "EPERM" }); } }), /still held/);
  assert.ok(clock >= 10_000, "after retrying for the whole ten-second budget");
});

// increment_6237cbe8961f: on Windows CI a unit's temp folder was still held when the ten seconds ran out,
// and nothing tried again, so the folder stayed.
test("4.20 · a folder still held past the budget is removed in the background once the hold lets go, and an error that is no hold gives up with the reason", async (t) => {
  const steps = cleanups(t);
  const at = folder(steps, "leftovers-late-");
  writeFileSync(path.join(at, "file"), "x");
  let clock = 0;
  const time = { now: () => clock, pause: (ms) => (clock += ms), retryMs: 1 };
  const fail = (code) => {
    throw Object.assign(new Error(`${code}: no`), { code });
  };
  let held = true;
  let retries = 0;
  const logged = [];
  const removed = removeWhenFree(at, {
    ...time,
    log: (message) => logged.push(message),
    rm: (target) => {
      if (clock >= 10_000) retries++;
      if (held) fail("EPERM");
      rmSync(target, { recursive: true, force: true });
    },
  });
  assert.equal(existsSync(at), true, "still there while the hold lasts");
  assert.match(logged.join("\n"), /still held/, "and the wait is said");
  await waitUntil(() => retries >= 3, 10_000, "the folder to be tried again while it stays held");
  held = false;
  await untilGone(at, "the folder to be removed once its hold lets go");
  assert.equal(await removed, true);

  const said = [];
  assert.equal(await removeWhenFree(at, { ...time, log: (message) => said.push(message), rm: () => fail("EIO") }), false, "an error that is no hold gives up at once");
  let tries = 0;
  assert.equal(await removeWhenFree(at, { ...time, log: (message) => said.push(message), rm: () => fail(++tries < 200 ? "EBUSY" : "EIO") }), false, "and so does one that comes after a hold");
  assert.equal(said.filter((message) => /could not remove .*EIO/.test(message)).length, 2, "each with the reason");
});

// friction_963e813bb97c: on 2026-11-12 Windows CI's shared test Postgres went into recovery mode four times
// under packages/cli while the base dev loop's unit, whose tests kill servers, ran beside it. A killed
// server leaves its postmaster.pid, and Windows hands its pid to the next process, often a backend of the
// live test Postgres (every connection is a process there): stopping that pid crashed the server.
test("4.20 · 4.21 · a data folder's stale postmaster.pid whose pid is now another server's backend stops nothing", { timeout: 120_000 }, async (t) => {
  const steps = cleanups(t);
  const live = await start({ dataDir: path.join(folder(steps, "leftovers-live-"), "db") });
  steps.push(() => live.stop());
  const client = new pg.Client({ connectionString: live.url });
  await client.connect();
  steps.push(() => client.end().catch(() => {}));
  const backend = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const stale = path.join(folder(steps, "leftovers-stale-"), "db");
  mkdirSync(stale, { recursive: true });
  writeFileSync(path.join(stale, "PG_VERSION"), "17\n");
  writeFileSync(path.join(stale, "postmaster.pid"), `${backend}\n${stale}\n`);

  const stopped = stopServersUnder(path.dirname(stale));

  assert.deepEqual(stopped, [], "the pid is not that folder's server");
  assert.equal(alive(backend), true, "the live server's backend is left running");
  assert.deepEqual((await client.query("SELECT 1 AS one")).rows, [{ one: 1 }], "and the live server still answers it");
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
