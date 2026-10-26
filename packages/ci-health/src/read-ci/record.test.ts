// How a verdict is written to a contract's verified column (record.ts's recordHealth), whoever judged it: a project's CI
// read from its logs here, or a run of the tests (Mick's dev loop's recording of a test run, through this package's
// interface). The tests run against the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), each in a project of its
// own that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";
import { recordHealth, type RecordedVerdict } from "../index.js";

/** A project in the test Postgres with one story, one capability and contracts 1.1 to 1.4, dropped afterwards; their ids by number. */
async function kettle(t: { after(fn: () => Promise<void>): void }): Promise<{ lib: Library; contractIds: Map<string, string> }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const lib = await storytree.openProject(name);
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const story = await lib.addStory({ title: "The cli" });
  const capability = await lib.addCapability({ story: story.id, title: "1 · Front door" });
  const contractIds = new Map<string, string>();
  for (const [number, words] of [[1, "a"], [2, "b"], [3, "c"], [4, "d"]] as const) {
    contractIds.set(`1.${number}`, (await lib.addContract({ capability: capability.id, title: `1.${number} · It does ${words}` })).id);
  }
  return { lib, contractIds };
}

test("3.1 · recordHealth writes each passing or failing verdict to the verified column, with who and how many tests, and nothing for not checked", async (t) => {
  const { lib, contractIds } = await kettle(t);
  const verdicts = new Map<string, RecordedVerdict>([
    ["1.1", { state: "passing", note: "2/2 tests passed" }],
    ["1.2", { state: "failing", note: "1/2 tests passed" }],
    ["1.3", { state: "not-checked", reason: "no tests" }],
  ]);
  const written = await recordHealth(lib, contractIds, verdicts, { by: "storytree test run" });
  assert.deepEqual(written, { passing: 1, failing: 1, notChecked: 1, marked: 0 });

  const passing = await lib.health(contractIds.get("1.1")!);
  assert.equal(passing.verified.state, "passing");
  assert.equal(passing.verified.by, "storytree test run");
  assert.equal(passing.verified.note, "2/2 tests passed");
  assert.deepEqual(passing.reported, { state: "not-checked" }, "the reported column is left alone");
  assert.equal((await lib.health(contractIds.get("1.2")!)).verified.state, "failing");
  assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")!), [], "nothing is written for a contract not checked");
  assert.deepEqual(await lib.healthHistory(contractIds.get("1.4")!), [], "nor for one with no verdict");
});

test("3.1 · recordHealth writes as the writer it is given: a run on CI says so, with its commit in the note", async (t) => {
  const { lib, contractIds } = await kettle(t);
  const verdicts = new Map<string, RecordedVerdict>([["1.1", { state: "passing", note: "2/2 tests passed" }]]);
  await recordHealth(lib, contractIds, verdicts, { by: "storytree test run on CI", commit: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6" });
  const { verified } = await lib.health(contractIds.get("1.1")!);
  assert.equal(verified.by, "storytree test run on CI");
  assert.equal(verified.note, "2/2 tests passed, at commit 9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6");
});

test("3.16 · recordHealth records a skip's kind, marks a verdict the run did not reproduce as not re-run at the commit, and writes the same mark only once", async (t) => {
  const { lib, contractIds } = await kettle(t);
  const id = (number: string) => contractIds.get(number)!;
  const failed = await lib.recordVerified(id("1.1"), "failing", { by: "storytree test run", note: "11/13 tests passed" });
  const passed = await lib.recordVerified(id("1.3"), "passing", { by: "storytree test run" });
  await lib.recordVerified(id("1.4"), "passing", { by: "acceptance run", note: "3/3 checks passed" });
  const writer = { by: "storytree test run on CI", commit: "abc123" };
  const verdicts = new Map<string, RecordedVerdict>([
    ["1.1", { state: "not-checked", skip: "owner", reason: "1 of 1 tests skipped (owner: needs a sign-in)" }],
    ["1.2", { state: "not-checked", skip: "platform:win32", reason: "1 of 1 tests skipped" }],
    ["1.3", { state: "not-checked", crashed: true, reason: "a.test.ts produced no results" }],
    ["1.4", { state: "not-checked", reason: "no tests" }],
  ]);

  await recordHealth(lib, contractIds, verdicts, writer);

  const verified = async (number: string) => (await lib.health(id(number))).verified;
  const owner = await verified("1.1");
  assert.equal(owner.state, "not-checked");
  assert.equal(owner.skip, "owner");
  assert.deepEqual(owner.was, { state: "failing", at: failed.at }, "the failing it did not reproduce");
  assert.match(owner.note ?? "", /^not re-run at commit abc123: 1 of 1 tests skipped/);
  assert.deepEqual((await lib.healthHistory(id("1.1"))).map(({ state }) => state), ["failing", "not-checked"], "history keeps the old verdict");
  assert.equal((await verified("1.2")).skip, "platform:win32", "a skip is recorded even with nothing earlier");
  assert.deepEqual((await verified("1.3")).was, { state: "passing", at: passed.at }, "a verdict a crash left unreproduced");
  assert.equal((await verified("1.3")).skip, undefined);
  assert.equal((await lib.healthHistory(id("1.4"))).length, 1, "no tests to re-run it: a verdict from elsewhere (an acceptance run) stands");

  await recordHealth(lib, contractIds, verdicts, { ...writer, commit: "def456" });
  assert.equal((await lib.healthHistory(id("1.1"))).length, 2, "the same mark is not written again");
  assert.match((await verified("1.1")).note ?? "", /abc123/, "it still says since when");
});
