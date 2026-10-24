import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { restartLimit } from "@storytree/app/lifecycle/restart-limit";
import { connect, type Storytree } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

import { appLog } from "./app-log.js";
import { askToReportErrors, mainErrorRecords, reportBox } from "./main-error-records.js";
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
    assert.equal(logged.length, 4, "the log still has each error, and nothing else");
  } finally {
    await storytree.close();
    await dropTestDatabases([database]);
  }
});

test("1.26 when the library cannot take the errors, app.log keeps writing them as before, says the library missed them, and nothing more is thrown or rejected", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "main-error-records-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    for (const server of [
      { ownDatabase: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); } },
      { ownDatabase: async () => ({ query: async () => { throw new Error("terminating connection due to administrator command"); } }) },
    ] as unknown as Pick<Storytree, "ownDatabase">[]) {
      const file = path.join(mkdtempSync(path.join(dir, "home-")), "app.log");
      const log = appLog(file);
      const records = mainErrorRecords({ build: () => "0.3.41", log: line => log.write(line) });
      const { main, fire } = fakeMain();
      logMainErrors(main, { log: line => log.write(line), ask: async () => "keep-going", restart: () => {}, record: records.record });

      await records.open(server);
      fire("uncaughtException", new Error("first"));
      await records.settled();
      fire("unhandledRejection", new Error("second"));
      await records.settled();
      await new Promise(resolve => setImmediate(resolve));

      // app.log's entries, split at each one's timestamp, since a stack runs over several lines.
      const logged = readFileSync(file, "utf8").split(/^\d{4}-\d\d-\d\dT\S+Z /m).slice(1);
      assert.ok(logged.some(line => /^main process uncaught exception: Error: first\n/.test(line)));
      assert.ok(logged.some(line => /^main process unhandled rejection: Error: second\n/.test(line)));
      assert.ok(logged.some(line => /not (be )?recorded in the library/.test(line)), logged.join("\n"));
    }
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("1.31 while the user's library holds an app error not yet marked submitted, opening the app asks to have their agent submit a GitHub issue; \"It's been submitted\" marks it so and the box stops, and Keep going leaves it asking", async () => {
  const database = `storytree-app-errors-t-${randomBytes(4).toString("hex")}`;
  const storytree: Storytree = await connect({ url: testServerUrl() });
  try {
    // The box's buttons, as the person presses them: 0 is Keep going (also closing it), 1 is "It's been submitted".
    const opening = async (answer: "keep-going" | "submitted") => {
      const records = mainErrorRecords({ build: () => "0.3.41", log: () => {}, database });
      await records.open(storytree);
      const asked: { detail: string; buttons: readonly string[]; defaultId: number; cancelId: number }[] = [];
      await askToReportErrors(records, { ask: reportBox(async options => { asked.push(options); return { response: answer === "submitted" ? 1 : 0 }; }) });
      return { records, asked };
    };

    assert.deepEqual((await opening("submitted")).asked, [], "no error, no box");

    const first = await opening("keep-going");
    first.records.record("uncaught-exception", "TypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)");
    first.records.record("unhandled-rejection", "Error: connection reset\n    at read (main.cjs:9:9)");
    await first.records.settled();

    const kept = await opening("keep-going");
    assert.equal(kept.asked.length, 1);
    assert.deepEqual(kept.asked[0]!.buttons, ["Keep going", "It's been submitted"]);
    assert.equal(kept.asked[0]!.defaultId, 0);
    assert.equal(kept.asked[0]!.cancelId, 0);
    assert.match(kept.asked[0]!.detail, /ask your agent to submit a GitHub issue on github\.com\/storytree-ai\/storytree/);
    assert.match(kept.asked[0]!.detail, /we'll work on it/);
    assert.match(kept.asked[0]!.detail, /TypeError: Object has been destroyed/);
    assert.match(kept.asked[0]!.detail, /Error: connection reset/);
    assert.doesNotMatch(kept.asked[0]!.detail, /titleWindow/, "only each error's first line");

    assert.equal((await opening("submitted")).asked.length, 1, "Keep going leaves it asking");
    assert.deepEqual((await opening("keep-going")).asked, [], "once submitted, the box stops");

    const pool = await storytree.ownDatabase(database);
    const { rows } = await pool.query<{ submitted: boolean }>("SELECT submitted_at IS NOT NULL AS submitted FROM main_errors");
    assert.deepEqual(rows.map(row => row.submitted), [true, true]);
  } finally {
    await storytree.close();
    await dropTestDatabases([database]);
  }
});

test("1.32 when the app stops restarting itself after five restarts in a row, the stop is recorded as an error in the user's own library and asks to be reported, on an install whose records predate it too", async (t) => {
  const database = `storytree-app-errors-t-${randomBytes(4).toString("hex")}`;
  const dir = mkdtempSync(path.join(tmpdir(), "restart-limit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storytree: Storytree = await connect({ url: testServerUrl() });
  try {
    // An install from before the stop was a kind of error.
    await storytree.ownDatabase(database, { tables: [
      `CREATE TABLE main_errors (key text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('uncaught-exception', 'unhandled-rejection')),
        build text NOT NULL, stack text NOT NULL, count integer NOT NULL, first_at timestamptz NOT NULL, last_at timestamptz NOT NULL)`,
    ] });
    const logged: string[] = [];
    const records = mainErrorRecords({ build: () => "0.3.41", log: line => logged.push(line), database });
    await records.open(storytree);
    const limit = restartLimit({ file: path.join(dir, "restarts.json"), stopped: message => records.record("restarts-stopped", message) });
    let restarts = 0;
    for (let start = 0; start < 7; start++) if (limit.mayRestart()) restarts++;
    await records.settled();

    assert.equal(restarts, 5);
    assert.deepEqual(logged, [], "the stop is recorded, not dropped");
    const pool = await storytree.ownDatabase(database);
    const { rows } = await pool.query<{ kind: string; count: number }>("SELECT kind, count FROM main_errors");
    assert.deepEqual(rows, [{ kind: "restarts-stopped", count: 2 }], "each refused restart adds to one record");
    const asked = await records.unsubmitted();
    assert.equal(asked.length, 1);
    assert.match(asked[0]!.stack, /stopped restarting itself after 5 restarts in a row/);
  } finally {
    await storytree.close();
    await dropTestDatabases([database]);
  }
});
