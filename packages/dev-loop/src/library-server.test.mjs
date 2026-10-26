// How `pnpm seed:library` reaches the app's library (packages/dev-loop/src/library-server.mjs): it joins the
// running app's database instead of refusing, waits its turn behind another seed instead of
// refusing, and never writes at the same time as another seed. Seen 2026-09-27: the seed refused
// while the app ran in its tray, and a sibling session's seed held the library for many minutes
// while a second one only refused. The waiting tests use stand-ins for starting and locating
// Postgres; the writing lock runs against the Postgres `pnpm test` provides.
import assert from "node:assert/strict";
import { test } from "node:test";

import { DataDirInUseError } from "@storytree/local-postgres";

import { holdSeedLock, libraryServer } from "./library-server.mjs";

const APP = "the storytree 0.3 desktop app";
const SEED = "pnpm seed:library";
const noSleep = async () => {};

test("5.1 the seed joins the running app's database instead of refusing, and leaves it running", async () => {
  const said = [];
  const server = await libraryServer({
    dataDir: "home/pgdata",
    owner: SEED,
    appOwner: APP,
    start: async () => {
      throw new DataDirInUseError("home/pgdata", 4242, APP);
    },
    locate: () => ({ running: true, url: "postgres://postgres@127.0.0.1:5555/postgres" }),
    sleep: noSleep,
    log: (line) => said.push(line),
  });
  assert.equal(server.url, "postgres://postgres@127.0.0.1:5555/postgres", "it uses the app's own database");
  assert.equal(server.joined, true);
  await server.stop(); // must not stop the app's database: the stand-in has nothing to stop
  assert.match(said.join("\n"), /storytree 0\.3 app is running \(process 4242\)/, "and it says whose database it joined");
});

test("the seed waits its turn behind another seed holding the library, then starts it itself", async () => {
  const said = [];
  let attempts = 0;
  const server = await libraryServer({
    dataDir: "home/pgdata",
    owner: SEED,
    appOwner: APP,
    start: async () => {
      attempts++;
      if (attempts < 3) throw new DataDirInUseError("home/pgdata", 777, SEED);
      return { url: "postgres://own", stop: async () => said.push("stopped its own") };
    },
    locate: () => ({ running: false }),
    sleep: noSleep,
    log: (line) => said.push(line),
  });
  assert.equal(attempts, 3, "it tried again until the other seed let go");
  assert.equal(server.joined, false);
  await server.stop();
  assert.equal(said.filter((line) => /waiting/.test(line)).length, 1, "it says once that it is waiting, naming the holder");
  assert.match(said[0], /process 777 \(pnpm seed:library\)/);
  assert.equal(said.at(-1), "stopped its own", "a database it started itself it stops");
});

test("the seed gives up waiting only after its deadline, naming the holder", async () => {
  let now = 0;
  await assert.rejects(
    libraryServer({
      dataDir: "home/pgdata",
      owner: SEED,
      appOwner: APP,
      start: async () => {
        throw new DataDirInUseError("home/pgdata", 777, SEED);
      },
      locate: () => ({ running: false }),
      sleep: async (ms) => {
        now += ms;
      },
      clock: () => now,
      waitMs: 60_000,
      log: () => {},
    }),
    /process 777/,
  );
  assert.ok(now >= 60_000, "it waited the whole time first");
});

// A timeout, so a waiter that never gets the lock fails this test instead of hanging it; the
// harness's own limits (packages/dev-loop/src/unit-run.mjs) end the process if an open connection outlives it.
test("5.1 two seeds never write at once: the second waits for the first's writing lock", { timeout: 60_000 }, async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const first = await holdSeedLock(url, { log: () => {} });
  let secondHas = false;
  let saidWaiting;
  const waiting = new Promise((resolve) => {
    saidWaiting = resolve;
  });
  const second = holdSeedLock(url, {
    log: (line) => {
      if (/waiting/.test(line)) saidWaiting();
    },
  }).then((lock) => {
    secondHas = true;
    return lock;
  });
  try {
    // Whichever comes first: the second saying it waits (right), or the second getting the lock.
    await Promise.race([waiting, second]);
    assert.equal(secondHas, false, "while the first holds it, the second waits, and says so");
  } finally {
    await first.release();
    const lock = await second;
    await lock.release();
  }
  assert.equal(secondHas, true, "once the first lets go, the second has it");
});
