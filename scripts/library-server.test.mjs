// How `pnpm seed:library` reaches the app's library (scripts/library-server.mjs): it joins the
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

test("the seed joins the running app's database instead of refusing, and leaves it running", async () => {
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

test("two seeds never write at once: the second waits for the first's writing lock", async () => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const said = [];
  const first = await holdSeedLock(url, { log: (line) => said.push(`first: ${line}`) });
  let secondHas = false;
  const second = holdSeedLock(url, { log: (line) => said.push(`second: ${line}`) }).then((lock) => {
    secondHas = true;
    return lock;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(secondHas, false, "while the first holds it, the second waits");
  assert.ok(said.some((line) => /^second: .*waiting/.test(line)), "and says it is waiting");
  await first.release();
  const lock = await second;
  assert.equal(secondHas, true, "once the first lets go, the second has it");
  await lock.release();
});
