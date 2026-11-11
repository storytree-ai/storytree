import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "@storytree/library";
import type { Library } from "@storytree/library";
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
  assert.deepEqual(health!.verbs.map((one) => "family" in one.command ? one.command.name : undefined), ["worklist", "ci", "times", "local", "plugin", "tell"]);
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

test("3.21 `health tell` tells the owner each verdict turn of the last twelve hours, or the hours given, that its writer could not, naming each with what it released", async () => {
  const asked: string[] = [];
  const turns = [
    { contract: "contract_aaaaaaaaaaaa", title: "Red: 4.45 · Updates", at: "2026-11-11T06:02:13.000Z", released: ["increment_bbbbbbbbbbbb"] },
    { contract: "contract_cccccccccccc", title: "Green again: 3.49 · Opening fresh", at: "2026-11-11T06:57:35.000Z", released: [] },
  ];
  const library = { tellUntold: async (from: string) => (asked.push(from), [turns, turns.slice(1), []][asked.length - 1]!) } as unknown as Library;
  const tell = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "tell")!;
  const context = { library, project: "p", session: "test", folder: tmpdir() };

  const started = Date.now();
  const told = await tell.act({}, context, WORDS);
  const hours = (Date.now() - Date.parse(asked[0]!)) / 3_600_000;
  assert.ok(hours >= 12 && hours <= 12 + (Date.now() - started) / 3_600_000 + 0.01, `twelve hours back by default, not ${hours}`);
  assert.match(told.text, /^Told 2 verdict turns /);
  for (const said of ["Red: 4.45 · Updates (verdict at 2026-11-11T06:02:13.000Z); released increment_bbbbbbbbbbbb", "Green again: 3.49 · Opening fresh (verdict at 2026-11-11T06:57:35.000Z)"]) assert.ok(told.text.includes(said), `it says ${said}`);

  const one = await tell.act({ hours: 3 }, context, WORDS);
  assert.ok(Math.abs(Date.now() - Date.parse(asked[1]!) - 3 * 3_600_000) < 60_000, "the hours given");
  assert.match(one.text, /^Told 1 verdict turn /);
  assert.match((await tell.act({}, context, WORDS)).text, /^Nothing untold/);
});
