/**
 * Capability 3 · Hooks (contract 3.7) and the context guidance of contract 9.9: the prompt hook's
 * lookup is raced against its time limit, and what it gives is recorded in the per-session ledgers
 * only when its answer is the one the hook prints. A lookup cut off by the limit must leave the
 * definitions and context-nudge ledgers as they were, or the definition and the start-fresh advice
 * would never be shown in that session.
 */
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { alreadyGiven, type Given } from "./given-once.js";
import { givenWithinTime } from "./hooks.js";

interface Looked {
  readonly context: readonly string[];
  readonly given: readonly Given[];
}

/** A promise of `value` that settles after `ms`. */
function after<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
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

  const late = after(80, answer);
  assert.equal(await givenWithinTime(session, late, 20), undefined);
  await late;
  // Let anything the cut-off lookup chained onto its settling run before reading the ledgers.
  await after(20, undefined);
  assert.deepEqual(
    { definition: alreadyGiven(session, definition, "definitions"), startFresh: alreadyGiven(session, "start-fresh", "context-nudges") },
    { definition: false, startFresh: false },
  );

  assert.equal(await givenWithinTime(session, Promise.resolve(answer), 1_000), answer);
  assert.deepEqual(
    { definition: alreadyGiven(session, definition, "definitions"), startFresh: alreadyGiven(session, "start-fresh", "context-nudges") },
    { definition: true, startFresh: true },
  );
});
