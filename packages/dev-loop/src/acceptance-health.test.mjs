// The rules of `pnpm record:acceptance` (packages/dev-loop/src/acceptance-health.mjs): how an acceptance
// run's observed checks become each contract's verified health (ADR-0825 D5). Minting is pure; the
// recording test runs against the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), in a project
// of its own that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { mintAcceptance, readObservations, recordAcceptance } from "./acceptance-health.mjs";
import { contractsOf } from "./own-health.mjs";

test("5.5 an acceptance verdict passes only when the harness ran checks for the contract and every one passed; any failure fails it; none, or one not observed, leaves it not checked", () => {
  const check = (contract, observed, name = "a check") => ({ contract, name, observed });
  const verdicts = mintAcceptance({
    contracts: ["1.1", "1.2", "1.3", "1.4", "1.5"],
    checks: [
      check("1.1", "pass", "the command ran"),
      check("1.1", "pass", "its exit code was 0"),
      check("1.2", "pass"),
      check("1.2", "fail"),
      check("1.2", "not-observed"),
      check("1.3", "pass"),
      check("1.3", "not-observed", "the window"),
      check("9.9", "pass", "a contract the story does not have"),
    ],
  });
  const brief = (number) => {
    const { state, note, reason } = verdicts.get(number);
    return { state, ...(note === undefined ? {} : { note }), ...(reason === undefined ? {} : { reason }) };
  };
  assert.deepEqual(brief("1.1"), { state: "passing", note: "2/2 checks passed" });
  assert.deepEqual(brief("1.2"), { state: "failing", note: "1/3 checks passed" });
  assert.deepEqual(brief("1.3"), { state: "not-checked", reason: "1 of 2 checks not observed (the window)" });
  assert.deepEqual(brief("1.4"), { state: "not-checked", reason: "no checks" });
  assert.equal(verdicts.has("9.9"), false, "a check for a contract the story does not have counts for none");
});

test("5.5 an observation the harness did not mint is refused: a check whose result is not pass, fail or not-observed, or a run with no commit or evidence path", () => {
  const run = { story: "The app setup", commit: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6", evidence: "packages/app-setup/evidence/acceptance-run", checks: [{ contract: "1.1", name: "ran", observed: "pass" }] };
  assert.deepEqual(readObservations(JSON.stringify(run)), run);
  assert.throws(() => readObservations(JSON.stringify({ ...run, checks: [{ contract: "1.1", name: "ran", observed: "the agent says it worked" }] })), /pass, fail or not-observed/);
  assert.throws(() => readObservations(JSON.stringify({ ...run, commit: undefined })), /commit/);
  assert.throws(() => readObservations(JSON.stringify({ ...run, evidence: "" })), /evidence/);
});

test("5.5 recordAcceptance writes each passing or failing verdict to the verified column by \"acceptance run\", with the commit and the evidence path, and nothing for not checked", async () => {
  await withLibrary(async (lib) => {
    const story = await lib.addStory({ title: "The app setup" });
    const capability = await lib.addCapability({ story: story.id, title: "1 · Get storytree" });
    for (const number of [1, 2, 3]) await lib.addContract({ capability: capability.id, title: `1.${number} · It does ${number}` });
    const { contractIds } = contractsOf((await lib.projectTree()).stories[0]);
    const verdicts = mintAcceptance({
      contracts: ["1.1", "1.2", "1.3"],
      checks: [
        { contract: "1.1", name: "ran", observed: "pass" },
        { contract: "1.2", name: "ran", observed: "fail" },
      ],
    });
    const written = await recordAcceptance(lib, contractIds, verdicts, { commit: "9f3734a", evidence: "packages/app-setup/evidence/acceptance-run" });
    assert.deepEqual(written, { passing: 1, failing: 1, notChecked: 1 });

    const passing = await lib.health(contractIds.get("1.1"));
    assert.equal(passing.verified.state, "passing");
    assert.equal(passing.verified.by, "acceptance run");
    assert.equal(passing.verified.note, "1/1 checks passed, evidence packages/app-setup/evidence/acceptance-run, at commit 9f3734a");
    assert.deepEqual(passing.reported, { state: "not-checked" }, "the reported column is left alone");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "nothing is written for a contract not checked");
  });
});

/** Run `body` with a library for a fresh project on the test server, dropped afterwards, pass or fail. */
async function withLibrary(body) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const lib = await storytree.openProject(name);
    try {
      await body(lib);
    } finally {
      await lib.close();
    }
  } finally {
    await storytree.close();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
