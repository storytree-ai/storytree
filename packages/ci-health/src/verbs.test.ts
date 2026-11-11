import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "@storytree/library";
import type { DoorWords } from "@storytree/library/verbs";

import { ciTimesPool } from "./ci-times/store.js";
import { HEALTH_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("3.14 CI health declares the `health` verbs the command line mounts: `health ci` in a project with no GitHub origin says why and writes nothing", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-verbs-"));
  t.after(() => removeTemp(folder));
  execFileSync("git", ["-C", folder, "init", "-q"]);

  const [health] = HEALTH_FAMILIES;
  assert.deepEqual(health!.verbs.map((one) => "family" in one.command ? one.command.name : undefined), ["worklist", "ci", "times", "local", "plugin"]);
  const ci = health!.verbs.find((one) => "name" in one.command && one.command.name === "ci")!;
  const answer = await ci.act({}, { library, project: name, session: "test", folder }, WORDS);
  assert.match(answer.text, /no GitHub origin/);
  assert.equal((await library.projectTree()).unverified, true, "nothing was written");
});

test("6.5 `health times` records the project's CI times and prints the reading; a project with no GitHub origin says why and records nothing", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
    }
  });
  const folder = mkdtempSync(path.join(tmpdir(), "ci-health-verbs-"));
  t.after(() => removeTemp(folder));
  execFileSync("git", ["-C", folder, "init", "-q"]);

  const times = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "times");
  assert.ok(times, "the health family declares `times`");
  const answer = await times.act({}, { library, project: name, session: "test", folder, server: storytree }, WORDS);
  assert.match(answer.text, /no GitHub origin/);
  const db = await ciTimesPool(storytree);
  assert.deepEqual((await db.query("SELECT project FROM ci_readings WHERE project = $1", [name])).rows, [], "nothing was recorded");
});
