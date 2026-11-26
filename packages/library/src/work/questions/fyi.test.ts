// Capability 12 · Owner's inbox
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { LIBRARY_FAMILIES, type LibraryVerbContext } from "../../commands/index.js";
import { connect } from "../../index.js";
import { testServerUrl, uniqueProjectName } from "../../testing/pg.js";
import { mounted, VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "../../verbs/verb.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("12.20 · The library declares the fyi family: fyi new records an FYI, by the caller unless --by names another, fyi list lists the unheard ones oldest first, offering no fyi heard as a next step (friction_6b3c03ad52db), and fyi heard marks them heard so the list no longer shows them; none is a tool (ADR-1184 D3)", async (t) => {
  const storytree = await connect({ url: testServerUrl() });
  const project = uniqueProjectName();
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  const library = await storytree.openProject(project);
  const family = LIBRARY_FAMILIES.find((one) => one.name === "fyi");
  assert.ok(family, "the fyi family is declared");
  assert.ok(family.verbs.every((one) => !mounted(one.tool)), "no verb is a tool");
  const verbOf = (name: string): Verb<VerbInputs, LibraryVerbContext> => family.verbs.find((one) => mounted(one.command) && one.command.name === name)!;
  const context: LibraryVerbContext = {
    library, project, session: "lane", folder: tmpdir(), writer: { actor: "session:lane" },
    claims: async () => [],
    testedNumbers: async () => ({ tested: [], untested: [] }),
  };

  assert.equal((await verbOf("list").act({}, context, WORDS)).text, "No FYIs waiting to be heard.");
  const made = await verbOf("new").act({ title: "The exemptions list changed", what: "Two paths were added", about: "PR #31", at: "2026-10-27T09:00:00.000Z", by: undefined }, context, WORDS);
  const id = /fyi_[0-9a-f]{12}/.exec(made.text)?.[0];
  assert.ok(id, made.text);
  assert.equal(((await library.get(id))?.fields as { by?: string } | undefined)?.by, "session:lane", "written by the caller");
  await verbOf("new").act({ title: "A routine was paused", what: "The nightly sweep is off", about: "process_000000000001", at: "2026-10-26T09:00:00.000Z", by: "routine:sweep" }, context, WORDS);

  const answer = await verbOf("list").act({}, context, WORDS);
  const listed = answer.text;
  assert.ok(!(answer.next ?? []).some((step) => step.command?.startsWith("fyi heard")), JSON.stringify(answer.next));
  assert.ok(listed.indexOf("A routine was paused") < listed.indexOf("The exemptions list changed"), listed);
  assert.match(listed, /PR #31/);

  const heard = await verbOf("heard").act({ ids: [id] }, context, WORDS);
  assert.match(heard.text, new RegExp(`Marked heard: ${id}`));
  const after = (await verbOf("list").act({}, context, WORDS)).text;
  assert.doesNotMatch(after, /The exemptions list changed/);
  assert.match(after, /A routine was paused/);
  await assert.rejects(verbOf("heard").act({ ids: ["fyi_000000000000"] }, context, WORDS), VerbRefusal);
});
