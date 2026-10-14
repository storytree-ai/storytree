import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { DoorWords } from "@storytree/project-and-caller/verbs";

import { LAG_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("3.1 · Lag in real use declares the `lag` family the command line mounts, 7th in its list: its bare verb prints the report over the readings kept in the storytree home", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "lag-verbs-"));
  const was = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = was;
    rmSync(home, { recursive: true, force: true });
  });

  const [lag] = LAG_FAMILIES;
  assert.equal(lag!.order, 7);
  assert.deepEqual(lag!.verbs, []);
  assert.equal(lag!.bare!.callerless, true);
  const answer = await lag!.bare!.act({}, { folder: home }, WORDS);
  assert.match(answer.text, /^Lag in real use, the last 7 days/);
  assert.ok(answer.text.includes(path.join(home, "lag-readings.jsonl")), answer.text);
});
