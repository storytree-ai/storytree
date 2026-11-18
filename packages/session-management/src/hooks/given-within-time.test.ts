// Capability 3 · Hooks
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { quietFor } from "@storytree/test-waits";

import { alreadyGiven, type Given } from "./given-once.js";
import { givenWithinTime } from "./hooks.js";

interface Looked {
  readonly context: readonly string[];
  readonly given: readonly Given[];
}

test("3.7, 9.9 · a prompt lookup cut off by its time limit returns nothing and leaves the definitions and context-nudge ledgers without its ids, even after it settles; the same lookup in time returns its answer and records both", async (t) => {
  const session = `given-within-time-${process.pid}-${Date.now()}`;
  const definition = `definition-${session}`;
  t.after(() => {
    for (const ledger of ["definitions", "context-nudges"]) rmSync(path.join(tmpdir(), `storytree-${ledger}`, `${session}.json`), { force: true });
  });
  const answer: Looked = {
    context: ["[storytree] Definitions …", "[storytree] start fresh …"],
    given: [
      { ledger: "definitions", ids: [definition] },
      { ledger: "context-nudges", ids: ["start-fresh"] },
    ],
  };

  const given = () => ({ definition: alreadyGiven(session, definition, "definitions"), startFresh: alreadyGiven(session, "start-fresh", "context-nudges") });

  let answerLate: (looked: Looked) => void = () => undefined;
  const late = new Promise<Looked | undefined>((resolve) => (answerLate = resolve));
  assert.equal(await givenWithinTime(session, late, 1), undefined);
  answerLate(answer);
  await late;
  await quietFor(() => given().definition || given().startFresh, 200, "a cut-off lookup's ids recorded in the definitions or context-nudge ledger");
  assert.deepEqual(given(), { definition: false, startFresh: false });

  assert.equal(await givenWithinTime(session, Promise.resolve(answer), 1_000), answer);
  assert.deepEqual(given(), { definition: true, startFresh: true });
});
