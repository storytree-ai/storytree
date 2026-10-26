/** Capability 8 · Cloud connection: telling a failure apart as the library being unreachable (contract 8.10). */
import assert from "node:assert/strict";
import { test } from "node:test";

import pg from "pg";

import { ConnectionError, isUnreachable, LIBRARY_UNREACHABLE, saysUnreachable } from "./connection-error.js";

test("8.10 · a failure is told apart as the library being unreachable: a refusal for an unreachable or silent server, a network code, or pg's words for a connection timed out, lost or ended; one the user must fix is not", async () => {
  const pool = new pg.Pool();
  await pool.end();
  const ended = await pool.query("select 1").then(() => undefined, (error: unknown) => error);
  assert.ok(isUnreachable(ended), "a read on a pool already ended");
  assert.ok(isUnreachable(new ConnectionError("unreachable", "Storytree could not reach the library at postgres://box:5432/.")));
  assert.ok(isUnreachable(new ConnectionError("timeout", "The server did not answer in time.")));
  assert.ok(isUnreachable(Object.assign(new Error("connect EHOSTUNREACH 192.0.2.1:5432"), { code: "EHOSTUNREACH" })));
  assert.ok(isUnreachable(new Error("timeout exceeded when trying to connect")));
  assert.ok(isUnreachable(new Error("Connection terminated unexpectedly")));
  assert.ok(isUnreachable(new Error("reading the arcs failed", { cause: Object.assign(new Error("connect ENETUNREACH"), { code: "ENETUNREACH" }) })), "a failure it explains");
  assert.ok(!isUnreachable(new ConnectionError("password", "The library refused the password saved for it.")), "a refusal the user must fix");
  assert.ok(!isUnreachable(new Error("there is no project called \"x\"")));
  assert.ok(!isUnreachable(Object.assign(new Error("relation \"arcs\" does not exist"), { code: "42P01" })));
  assert.ok(saysUnreachable(new Error(`${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH`)), "as the page receives it");
  assert.ok(!saysUnreachable(new Error("fetch failed")));
});
