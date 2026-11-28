import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { SEED_CONNECTION } from "@storytree/library";
import { DataDirInUseError } from "@storytree/local-postgres";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import pg from "pg";

import { holdSeedLock, libraryServer } from "./library-server.mjs";

const APP = "the storytree 0.3 desktop app";
const SEED = "pnpm seed:library";
const noSleep = async () => {};

test("7.13 the seed joins the running app's database instead of refusing, and leaves it running", async () => {
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
  await server.stop();
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

test("7.13 two seeds never write at once: the second waits for the first's writing lock", { timeout: 60_000 }, async () => {
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
    await Promise.race([waiting, second]);
    assert.equal(secondHas, false, "while the first holds it, the second waits, and says so");
  } finally {
    await first.release();
    const lock = await second;
    await lock.release();
  }
  assert.equal(secondHas, true, "once the first lets go, the second has it");
});

async function seedLockDatabase(t) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`");
  const database = `storytree_t-${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  admin.on("error", () => {});
  await admin.connect();
  t.after(async () => {
    await admin.end();
    await dropTestDatabases([database]);
  });
  await admin.query(`CREATE DATABASE "${database}"`);
  const address = new URL(url);
  address.pathname = `/${database}`;
  const seedBackends = async () =>
    (await admin.query("select pid from pg_stat_activity where datname = $1 and application_name = $2 order by pid", [database, SEED_CONNECTION])).rows.map(({ pid }) => pid);
  const terminate = async (pids) => {
    for (const pid of pids) {
      const { rows } = await admin.query("select pg_terminate_backend($1) as gone", [pid]);
      assert.equal(rows[0].gone, true, `backend ${pid} was terminated`);
    }
  };
  return { url: address.href, seedBackends, terminate };
}

function crashOr(promise) {
  let onCrash;
  const crashed = new Promise((resolve) => {
    onCrash = (error) => resolve({ crashed: error });
    process.once("uncaughtException", onCrash);
  });
  return Promise.race([promise, crashed]).finally(() => process.removeListener("uncaughtException", onCrash));
}

test("7.13 a seed whose writing lock's connection the server ends is told the lock was lost, without crashing, and still releases", { timeout: 60_000 }, async (t) => {
  const { url, seedBackends, terminate } = await seedLockDatabase(t);
  let toldLost;
  const lost = new Promise((resolve) => {
    toldLost = resolve;
  });
  const lock = await holdSeedLock(url, {
    log: (line) => {
      if (/lost/.test(line)) toldLost({ line });
    },
  });
  const backends = await seedBackends();
  assert.equal(backends.length, 1, "the held lock is the one seed connection on this database");
  await terminate(backends);
  const outcome = await crashOr(lost);
  assert.equal(outcome.crashed, undefined, `the process did not crash: ${outcome.crashed?.stack}`);
  assert.match(outcome.line, /writing lock.*lost|lost.*writing lock/i, "the seed is told its writing lock was lost");
  await lock.release();
});

test("7.13 a seed waiting for the writing lock whose connection the server ends is refused with the server's error, without crashing", { timeout: 60_000 }, async (t) => {
  const { url, seedBackends, terminate } = await seedLockDatabase(t);
  const first = await holdSeedLock(url, { log: () => {} });
  t.after(() => first.release());
  const [holder] = await seedBackends();
  let saidWaiting;
  const waiting = new Promise((resolve) => {
    saidWaiting = resolve;
  });
  const second = holdSeedLock(url, {
    log: (line) => {
      if (/waiting/.test(line)) saidWaiting();
    },
  }).then(
    () => ({ held: true }),
    (error) => ({ refused: error }),
  );
  await waiting;
  const waiter = (await seedBackends()).filter((pid) => pid !== holder);
  assert.equal(waiter.length, 1, "the waiting seed is the one other seed connection on this database");
  await terminate(waiter);
  const outcome = await crashOr(second);
  assert.equal(outcome.crashed, undefined, `the process did not crash: ${outcome.crashed?.stack}`);
  assert.equal(outcome.held, undefined, "the waiting seed did not get the lock");
  assert.equal(outcome.refused?.code, "57P01", `it is refused with the server's terminate error, not ${outcome.refused?.message}`);
  assert.match(outcome.refused.message, /terminating connection due to administrator command/);
});
