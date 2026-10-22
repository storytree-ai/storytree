import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

import { mainErrorRecords } from "./main-error-records.js";
import { logMainErrors, type MainProcess } from "./main-errors.js";

function testServerUrl(): string {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined || url === "") throw new Error("STORYTREE_TEST_PG_URL is not set: run the tests via `pnpm test`, which starts a local Postgres.");
  return url;
}

function fakeMain(): { main: MainProcess; fire: (event: "uncaughtException" | "unhandledRejection", reason: unknown) => void } {
  const heard = new Map<string, (reason: unknown) => void>();
  return {
    main: { on: (event: string, listener: (reason: unknown) => void) => { heard.set(event, listener); } },
    fire: (event, reason) => heard.get(event)!(reason),
  };
}

function failure(stack: string): Error {
  const error = new Error(stack.split("\n")[0]!.replace(/^Error: /, ""));
  error.stack = stack;
  return error;
}

test("1.25 each uncaught main-process exception and unhandled rejection becomes one record in the user's own library, with its stack, build, time and count; a repeat adds to its count, and one before the library opens is recorded once it does", async () => {
  const database = `storytree-app-errors-t-${randomBytes(4).toString("hex")}`;
  const storytree: Storytree = await connect({ url: testServerUrl() });
  try {
    const logged: string[] = [];
    let clock = Date.parse("2026-10-22T10:00:00Z");
    const records = mainErrorRecords({ build: () => "0.3.41", log: line => logged.push(line), now: () => new Date((clock += 1000)), database });
    const { main, fire } = fakeMain();
    logMainErrors(main, { log: line => logged.push(line), ask: async () => "keep-going", restart: () => {}, record: records.record });

    const early = "Error: before the library\n    at start (main.cjs:1:1)";
    fire("uncaughtException", failure(early));
    await records.open(storytree);
    const rejected = "Error: connection reset\n    at read (main.cjs:9:9)";
    fire("unhandledRejection", failure(rejected));
    fire("unhandledRejection", failure(rejected));
    await records.settled();
    fire("unhandledRejection", failure(rejected));
    await records.settled();

    const pool = await storytree.ownDatabase(database);
    const { rows } = await pool.query<{ kind: string; build: string; stack: string; count: number; first_at: Date; last_at: Date }>(
      "SELECT kind, build, stack, count, first_at, last_at FROM main_errors ORDER BY first_at",
    );
    assert.deepEqual(rows.map(({ kind, build, stack, count }) => ({ kind, build, stack, count })), [
      { kind: "uncaught-exception", build: "0.3.41", stack: early, count: 1 },
      { kind: "unhandled-rejection", build: "0.3.41", stack: rejected, count: 3 },
    ]);
    assert.ok(rows[1]!.last_at > rows[1]!.first_at);
    assert.equal(logged.length, 4, "app.log still has each error, and nothing else");
  } finally {
    await storytree.close();
    await dropTestDatabases([database]);
  }
});

test("1.26 when the library cannot take the errors, app.log keeps writing them as before, says the library missed them, and nothing more is thrown or rejected", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    for (const server of [
      { ownDatabase: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); } },
      { ownDatabase: async () => ({ query: async () => { throw new Error("terminating connection due to administrator command"); } }) },
    ] as unknown as Pick<Storytree, "ownDatabase">[]) {
      const logged: string[] = [];
      const records = mainErrorRecords({ build: () => "0.3.41", log: line => logged.push(line) });
      const { main, fire } = fakeMain();
      logMainErrors(main, { log: line => logged.push(line), ask: async () => "keep-going", restart: () => {}, record: records.record });

      await records.open(server);
      fire("uncaughtException", new Error("first"));
      await records.settled();
      fire("unhandledRejection", new Error("second"));
      await records.settled();
      await new Promise(resolve => setImmediate(resolve));

      assert.ok(logged.some(line => /^main process uncaught exception: Error: first\n/.test(line)));
      assert.ok(logged.some(line => /^main process unhandled rejection: Error: second\n/.test(line)));
      assert.ok(logged.some(line => /not (be )?recorded in the library/.test(line)), logged.join("\n"));
    }
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
