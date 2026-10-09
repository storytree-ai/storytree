// The rules of `pnpm record:acceptance` (packages/dev-loop/src/acceptance-health.mjs): how an acceptance
// run's observed checks become each contract's verified health (ADR-0825 D5). Minting is pure; the
// recording test runs against the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), in a project
// of its own that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { acceptRun } from "./record-acceptance.mjs";
import { mintAcceptance, readObservations, recordAcceptance, reportedStates, wentRedThenGreen } from "./acceptance-health.mjs";
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

test("5.5 a harness reads a contract's reported health from its whole history, oldest first: red then green between two former polls is seen, never red is not, and a history it cannot read is no reading", () => {
  const fields = (state) => `    fields: {"contract":"contract_5ec0bf62325f","column":"reported","state":"${state}","by":"session:d8024e51"}`;
  // Captured as Windows PowerShell 5.1 writes `storytree library history <id> --fields` to a file; out of seq order on purpose.
  const quick = [
    "History of health_contract_5ec0bf62325f_reported:",
    "  62  2026-10-05T05:52:59.100Z  updated  session:d8024e51-fe47-4880-b806-7fea314228af",
    fields("passing"),
    "  59  2026-10-05T05:52:58.332Z  created  session:d8024e51-fe47-4880-b806-7fea314228af",
    fields("failing"),
    "  70  2026-10-05T05:58:00.000Z  retired  session:d8024e51-fe47-4880-b806-7fea314228af  contract dropped",
    fields("passing"),
  ].join("\r\n");
  assert.deepEqual(reportedStates(quick), ["failing", "passing", "passing"]);
  assert.equal(wentRedThenGreen(reportedStates(quick)), true, "a failing then passing 0.8 s apart, inside one 3 s poll, is seen");

  const neverRed = ["History of health_contract_69c55fff651c_reported:", "  60  2026-10-05T05:53:00.000Z  created  session:d8024e51", fields("passing")].join("\n");
  assert.deepEqual(reportedStates(neverRed), ["passing"]);
  assert.equal(wentRedThenGreen(reportedStates(neverRed)), false);
  assert.equal(wentRedThenGreen(["passing", "failing"]), false, "green then red is not red then green");

  assert.deepEqual(reportedStates("No history for health_contract_7db9af49bad4_reported."), [], "never reported: no states, so never red");
  assert.equal(reportedStates(undefined), undefined, "no file: not read");
  assert.equal(reportedStates("History of health_contract_5ec0bf62325f_reported:\n  59  2026-10-05T05:52:58.332Z  created  session:d8024e51\n  62  2026-10-05T05:53:48.826Z  updated  session:d8024e51"), undefined, "a history printed without --fields: not read");
});

test("5.5 an observation the harness did not mint is refused: a check whose result is not pass, fail or not-observed, or a run with no commit or evidence path", () => {
  const run = { story: "The app setup", commit: "9f3734a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6", evidence: "packages/app-setup/evidence/acceptance-run", checks: [{ contract: "1.1", name: "ran", observed: "pass" }] };
  assert.deepEqual(readObservations(JSON.stringify(run)), run);
  assert.throws(() => readObservations(JSON.stringify({ ...run, checks: [{ contract: "1.1", name: "ran", observed: "the agent says it worked" }] })), /pass, fail or not-observed/);
  assert.throws(() => readObservations(JSON.stringify({ ...run, commit: undefined })), /commit/);
  assert.throws(() => readObservations(JSON.stringify({ ...run, evidence: "" })), /evidence/);
});

test("5.5 recordAcceptance writes each passing or failing verdict to the verified column by \"acceptance run\", with the commit, the evidence path and the run's own note, and nothing for not checked", async () => {
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
    const written = await recordAcceptance(lib, contractIds, verdicts, { commit: "9f3734a", evidence: "packages/app-setup/evidence/acceptance-run", note: "visited the locally built site" });
    assert.deepEqual(written, { passing: 1, failing: 1, notChecked: 1, marked: 0 });

    const passing = await lib.health(contractIds.get("1.1"));
    assert.equal(passing.verified.state, "passing");
    assert.equal(passing.verified.by, "acceptance run");
    assert.equal(passing.verified.note, "1/1 checks passed, visited the locally built site, evidence packages/app-setup/evidence/acceptance-run, at commit 9f3734a");
    assert.deepEqual(passing.reported, { state: "not-checked" }, "the reported column is left alone");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "nothing is written for a contract not checked");
  });
});

test("5.5 a run's verdicts are written to its story's contracts; --dry-run only prints them, and a run naming a story the library lacks writes nothing", async () => {
  await withLibrary(async (lib) => {
    const story = await lib.addStory({ title: "The app setup" });
    const capability = await lib.addCapability({ story: story.id, title: "1 · Get storytree" });
    await lib.addContract({ capability: capability.id, title: "1.1 · It installs" });
    const { contractIds } = contractsOf((await lib.projectTree()).stories[0]);
    const run = { story: "The app setup", commit: "9f3734a", evidence: "evidence/run", checks: [{ contract: "1.1", name: "installed", observed: "pass" }, { contract: "9.9", name: "stray", observed: "pass" }] };
    const said = [];
    const io = { log: (line) => said.push(line), error: (line) => said.push(line) };

    assert.equal(await acceptRun(lib, { ...run, story: "No such story" }, { dryRun: false, ...io }), 1);
    assert.equal(await acceptRun(lib, run, { dryRun: true, ...io }), 0);
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.1")), [], "a dry run writes nothing");
    assert.match(said.join("\n"), /count for none: 9\.9[\s\S]*1\.1 +passing/);

    assert.equal(await acceptRun(lib, run, { dryRun: false, ...io }), 0);
    assert.equal((await lib.health(contractIds.get("1.1"))).verified.by, "acceptance run");
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
    const admin = new pg.Client({ connectionString: process.env.STORYTREE_TEST_PG_ADMIN_URL || url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}
