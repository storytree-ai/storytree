/**
 * Capability 2 · Agent activity log, contract 2.5, its live reading (ADR-1345 D1, D5): `storytree activity observe` reads
 * which machines wrote a project's activity log lately and reads their latest lines back in order, and with `--record` it
 * records that as the contract's live reading. Run with a fresh project's library and the real log on the Postgres `pnpm
 * test` provides, where "two machines" are two connections, each naming its own machine.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect, type Line } from "@storytree/library";
import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { withLibrary } from "../friction/testing/pg.js";
import { ACTIVITY_FAMILIES } from "./verbs.js";
import { ACTIVITY_DATABASE, openActivityLog, type ActivityLog, type LineFilter } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const DAY = 86_400_000;
const observe = ACTIVITY_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "observe")!;

/** Run `body` with a log written from two machines, laptop and mint, each through its own connection, for one fresh project. */
async function twoMachines(body: (logs: { laptop: ActivityLog; mint: ActivityLog }, project: string) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  const [one, two] = await Promise.all([connect({ url: testServerUrl() }), connect({ url: testServerUrl() })]);
  try {
    const [laptop, mint] = await Promise.all([openActivityLog(one, { machine: "laptop" }), openActivityLog(two, { machine: "mint" })]);
    await body({ laptop, mint }, project);
    await Promise.all([laptop.close(), mint.close()]);
  } finally {
    await (await one.ownDatabase(ACTIVITY_DATABASE)).query("DELETE FROM activity WHERE project = $1", [project]).catch(() => undefined);
    await Promise.all([one.close(), two.close()]);
  }
}

const line = (session: string, command: string) => ({ session, harness: "codex" as const, source: "hook" as const, kind: "command-run" as const, command });

test("2.5 · the log's live reading passes while two machines wrote a project's lines within its freshness and their latest read back in order, naming each machine and its count; it fails when only one did, naming the one gone quiet, or when their latest lines do not all read back in order", async () => {
  await twoMachines(async ({ laptop, mint }, project) => {
    const now = Date.now();
    await laptop.append(project, line("a", "one"), { at: new Date(now - 5 * DAY).toISOString() });
    await laptop.append(project, line("a", "two"));
    await mint.append(project, line("b", "three"));
    await mint.append(project, line("b", "four"));
    await withLibrary(async (library) => {
      const context = { library, log: mint, project, session: "watcher", folder: process.cwd() };
      const passing = await observe.act({ freshness: "2d" }, context, WORDS);
      assert.equal(passing.data?.state, "passing");
      assert.match(passing.text, /^passing: 2 machines wrote .* in the last 2 days, their latest lines read back in order: laptop 1 line \(/);
      assert.match(passing.text, /mint 2 lines \(/);

      await laptop.append(project, { ...line("c", "now and then"), machine: "vm" }, { at: new Date(now - 3 * DAY).toISOString() });
      const third = await observe.act({ freshness: "2d" }, context, WORDS);
      assert.equal(third.data?.state, "passing", "an occasional third machine going quiet fails nothing while two still share the log");
      assert.match(third.text, /; vm wrote no line in the last 2 days \(its last at /);

      const readBack = (lines: (all: Line[]) => Line[]): ActivityLog => Object.assign(Object.create(mint) as ActivityLog, {
        machineTally: mint.machineTally.bind(mint),
        lines: async (of: string, filter: LineFilter) => lines(await mint.lines(of, filter)),
      });
      const dropped = await observe.act({ freshness: "2d" }, { ...context, log: readBack((all) => all.filter((one) => one.machine !== "laptop")) }, WORDS);
      assert.equal(dropped.data?.state, "failing", "a machine's latest line that does not read back fails it");
      assert.match(dropped.text, /^failing: laptop's latest line did not read back/);
      const reversed = await observe.act({ freshness: "2d" }, { ...context, log: readBack((all) => [...all].reverse()) }, WORDS);
      assert.equal(reversed.data?.state, "failing", "the latest lines out of number order fail it");
      assert.match(reversed.text, /^failing: the machines' latest lines read back out of order/);
    });
  });
  await twoMachines(async ({ laptop, mint }, project) => {
    const now = Date.now();
    await laptop.append(project, line("a", "one"), { at: new Date(now - 3 * DAY).toISOString() });
    await mint.append(project, line("b", "two"));
    await withLibrary(async (library) => {
      const failing = await observe.act({ freshness: "2d" }, { library, log: mint, project, session: "watcher", folder: process.cwd() }, WORDS);
      assert.equal(failing.data?.state, "failing");
      assert.match(failing.text, /^failing: laptop wrote no line in the last 2 days \(its last at .*\): only mint wrote /);
    });
  });
});

test("2.5 · `activity observe --record` records its reading as the contract's live reading, taking the contract's freshness, and refuses a contract observability does not prove", async () => {
  await twoMachines(async ({ laptop, mint }, project) => {
    await laptop.append(project, line("a", "one"));
    await mint.append(project, line("b", "two"));
    await withLibrary(async (library) => {
      const story = await library.addStory({ title: "Session management" });
      const capability = await library.addCapability({ title: "Agent activity log", story: story.id });
      const contract = await library.addContract({ title: "Two machines' lines read back", capability: capability.id });
      const context = { library, log: mint, project, session: "watcher", folder: process.cwd() };
      await assert.rejects(observe.act({ record: contract.id }, context, WORDS), VerbRefusal, "a contract a test proves takes no live reading");

      await library.editContract(contract.id, { proof: { by: "observability-as-proof", reason: "Only both machines working show it.", freshness: "1d", watcher: "the activity watcher" } });
      await assert.rejects(observe.act({ record: contract.id, freshness: "2d" }, context, WORDS), VerbRefusal, "the freshness is the contract's own");
      const recorded = await observe.act({ record: contract.id }, context, WORDS);
      assert.match(recorded.text, /in the last 1 day.*\. Recorded as contract_[0-9a-f]+'s live reading\.$/);
      const verified = (await library.health(contract.id)).verified;
      assert.equal(verified.state, "passing");
      assert.equal(verified.by, "the activity watcher");
      assert.match(verified.note ?? "", /^2 machines wrote .*laptop 1 line .*mint 1 line .*, taken on /);
    });
  });
});
