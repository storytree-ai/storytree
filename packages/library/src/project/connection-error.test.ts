/** Capability 8 · Cloud connection: telling a failure apart as the library being unreachable (contract 8.10), and saying it once per outage (8.11). */
import assert from "node:assert/strict";
import { test } from "node:test";

import pg from "pg";

import { ConnectionError, isUnreachable, LIBRARY_UNREACHABLE, outageSaidOnce, saysUnreachable } from "./connection-error.js";

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

test("8.11 · a polling surface says an unreachable library once per outage, as one line with no error, and its recovery once; any other failure each time, with its error", () => {
  const said: unknown[][] = [];
  const outage = outageSaidOnce((...parts) => { said.push(parts); });
  outage.answered();
  assert.deepEqual(said, [], "an answer with no outage says nothing");
  const page = new Error(`${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH`);
  for (let poll = 0; poll < 5; poll++) outage.failed("the projects could not be read", page);
  outage.failed("the forest could not be read", new Error("Connection terminated due to connection timeout"));
  assert.deepEqual(said, [[`the projects could not be read: ${LIBRARY_UNREACHABLE}: connect EHOSTUNREACH Said once until it answers again.`]]);
  const other = new Error("there is no project called \"x\"");
  outage.failed("the projects could not be read", other);
  outage.failed("the projects could not be read", other);
  assert.deepEqual(said.slice(1), [["the projects could not be read", other], ["the projects could not be read", other]], "another failure is said each time");
  outage.answered();
  outage.answered();
  assert.deepEqual(said.slice(3), [["the library answers again"]]);
  outage.failed("the projects could not be read", page);
  assert.equal(said.length, 5, "the next outage is said again");
});
