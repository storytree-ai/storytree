import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { createTestRole, dropTestDatabases, dropTestRoles, testRoleUrl, uniqueProjectName, withTestClient, withTestClientAs } from "@storytree/library/testing/pg";

import { recordHealth, type RecordedVerdict } from "../index.js";

test("3.25 · recordHealth signed in as CI's health role under infra/library-host/grants.sql records a quiet pass, a turn red, a repeated failure, a green again, a pass after a pass and not-checked marks for a platform skip, a crash and an owner skip, with no run refused, each verdict read back by the owner as recorded, and untold naming exactly the contracts that turned red or green again in that run", async () => {
  const run = uniqueProjectName();
  const [owner, ci, creator] = [`${run}-owner@storytree.test`, `${run}-ci-health@storytree.test`, `${run}-creator`];
  const database = `storytree_${run}`;
  const opened: { close(): Promise<void> }[] = [];
  try {
    await createTestRole(owner, { createdb: false });
    await createTestRole(ci, { createdb: false });
    await createTestRole(creator, { createdb: true, login: false });
    await withTestClient((client) => client.query(`GRANT "${creator}" TO "${owner}"`));

    const laptop = await connect({ url: testRoleUrl(owner) });
    opened.push(laptop);
    const onLaptop = await laptop.openProject(run);
    const story = await onLaptop.addStory({ title: "Checkout", description: "Paying for an order." });
    const capability = await onLaptop.addCapability({ title: "1 · Card payment", story: story.id });
    const contractIds = new Map<string, string>();
    for (const number of ["1.1", "1.2", "1.3", "1.4", "1.5"]) {
      contractIds.set(number, (await onLaptop.addContract({ title: `${number} · Card payment does ${number}`, capability: capability.id })).id);
    }
    const id = (number: string) => contractIds.get(number)!;

    const grants = readFileSync(new URL("../../../../infra/library-host/grants.sql", import.meta.url), "utf8")
      .replaceAll("storytree_storytree", database).replaceAll(':"ci_role"', `"${ci}"`).replaceAll(":'ci_role'", `'${ci}'`);
    await withTestClientAs(owner, (client) => client.query(grants), database);

    const onCi = await connect({ url: testRoleUrl(ci) });
    opened.push(onCi);
    const recorder = await onCi.openProject(run);
    const writer = (n: number) => ({ by: "storytree test run on CI", source: "ci" as const, commit: `${n}`.repeat(7), run: `${n}00` });
    const read = async (number: string) => {
      const { verified } = await onLaptop.health(id(number));
      return verified.state === "not-checked" ? [verified.state, verified.skip, verified.was?.state] : [verified.state];
    };

    const first = await recordHealth(recorder, contractIds, new Map<string, RecordedVerdict>([
      ["1.1", { state: "passing", note: "1/1 tests passed" }],
      ["1.2", { state: "failing", note: "0/1 tests passed" }],
      ["1.3", { state: "failing", note: "0/1 tests passed" }],
      ["1.4", { state: "passing", note: "1/1 tests passed" }],
      ["1.5", { state: "passing", note: "1/1 tests passed" }],
    ]), writer(1));
    assert.deepEqual(first, { passing: 3, failing: 2, notChecked: 0, marked: 0, untold: [`1.2 (${id("1.2")})`, `1.3 (${id("1.3")})`] });
    assert.deepEqual(await Promise.all(["1.1", "1.2", "1.3", "1.4", "1.5"].map(read)), [["passing"], ["failing"], ["failing"], ["passing"], ["passing"]]);
    assert.equal((await onLaptop.health(id("1.2"))).verified.note, "0/1 tests passed, at commit 1111111, run 100");

    const second = await recordHealth(recorder, contractIds, new Map<string, RecordedVerdict>([
      ["1.1", { state: "passing", note: "1/1 tests passed" }],
      ["1.2", { state: "failing", note: "0/1 tests passed" }],
      ["1.3", { state: "passing", note: "1/1 tests passed" }],
      ["1.4", { state: "not-checked", skip: "platform:win32", reason: "1 of 1 tests skipped (platform:win32)" }],
      ["1.5", { state: "not-checked", crashed: true, reason: "the test file crashed" }],
    ]), writer(2), { platformsSeen: new Set(["linux", "win32"]) });
    assert.deepEqual(second, { passing: 2, failing: 1, notChecked: 2, marked: 2, untold: [`1.3 (${id("1.3")})`] });
    assert.deepEqual(await Promise.all(["1.1", "1.2", "1.3", "1.4", "1.5"].map(read)), [
      ["passing"], ["failing"], ["passing"], ["not-checked", "platform:win32", "passing"], ["not-checked", undefined, "passing"],
    ]);

    const third = await recordHealth(recorder, contractIds, new Map<string, RecordedVerdict>([
      ["1.1", { state: "passing", note: "1/1 tests passed" }],
      ["1.2", { state: "failing", note: "0/1 tests passed" }],
      ["1.3", { state: "passing", note: "1/1 tests passed" }],
      ["1.4", { state: "passing", note: "1/1 tests passed" }],
      ["1.5", { state: "not-checked", skip: "owner", reason: "1 of 1 tests skipped (owner: needs a sign-in)" }],
    ]), writer(3));
    assert.deepEqual(third, { passing: 3, failing: 1, notChecked: 1, marked: 1 });
    assert.deepEqual(await Promise.all(["1.1", "1.2", "1.3", "1.4", "1.5"].map(read)), [
      ["passing"], ["failing"], ["passing"], ["passing"], ["not-checked", "owner", "passing"],
    ]);
    assert.equal((await onLaptop.health(id("1.4"))).verified.note, "1/1 tests passed, at commit 3333333, run 300");
  } finally {
    await Promise.allSettled(opened.map((storytree) => storytree.close()));
    await dropTestDatabases([database]);
    await dropTestRoles([ci, owner, creator]);
  }
});
