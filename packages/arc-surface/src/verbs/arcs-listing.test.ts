/**
 * Capability 3 · Arc surface: contract 3.28, `arc increment new` refusing a capability another open increment lists and
 * `arc increment edit` telling of it, run on a fresh project's library and activity log on the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test, type TestContext } from "node:test";

import { connect, type Library } from "@storytree/library";
import { openActivityLog, type ActivityLog } from "@storytree/session-management";
import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import { ARC_FAMILIES, type ArcVerbContext } from "./index.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const verbOf = (name: string) => ARC_FAMILIES.find((family) => family.name === "arc")!.families!.find((family) => family.name === "increment")!.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, ArcVerbContext>;

/** A fresh project's library and activity log, dropped when the test ends. */
async function aProject(t: TestContext): Promise<{ library: Library; log: ActivityLog; project: string }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(project);
  const log = await openActivityLog(storytree, { machine: "mint" });
  t.after(async () => {
    try {
      await log.close();
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
    }
  });
  return { library, log, project };
}

test("3.28 · `arc increment new` naming a capability another open increment lists is refused, naming that increment and its arc, with nothing written; `arc increment edit` newly listing it is not refused, and says that increment, its title and its arc in a notice that the edit is saved, worded apart from the park's refusal", async (t) => {
  const { library, log, project } = await aProject(t);
  const context: ArcVerbContext = { library, log, project, session: "person:test", folder: "/work", writer: { actor: "person:test" } };
  const story = await library.addStory({ title: "Visitor can sign up" });
  const form = await library.addCapability({ title: "Form", story: story.id });
  const checks = await library.addCapability({ title: "Checks", story: story.id });
  const arc = await library.createArc({ title: "Signup", intent: "Ship signup", endState: "Signup is live" });
  const drain = await library.createArc({ title: "Drain", intent: "Route health", endState: "Nothing unrouted" });
  const first = await library.addIncrement({ arc: arc.id, title: "Route the form", objective: "Route it", body: "…", capabilities: [form.id] });

  const before = await library.history();
  let refusal = "";
  await assert.rejects(
    verbOf("new").act({ arc: drain.id, title: "Route the form again", objective: "Route it", body: "…", capabilities: `${checks.id},${form.id}` }, context, WORDS),
    (error: unknown) => error instanceof VerbRefusal && error.message.includes(first.id) && error.message.includes(arc.id) && error.message.includes(form.id) && Boolean((refusal = error.message)),
  );
  assert.deepEqual(await library.history(), before, "nothing was written");

  const second = await library.addIncrement({ arc: drain.id, title: "Route the checks", objective: "Route them", body: "…", capabilities: [checks.id] });
  const edit = verbOf("edit");
  const told = await edit.act({ increment: second.id, capabilities: `${checks.id},${form.id}` }, context, WORDS);
  assert.deepEqual(((await library.get(second.id))?.fields as { capabilities?: string[] }).capabilities, [checks.id, form.id], "the edit is written");
  const lines = told.text.split("\n");
  assert.equal(lines.length, 2, told.text);
  assert.ok(lines[1]!.includes(first.id) && lines[1]!.includes("Route the form") && lines[1]!.includes(arc.id) && lines[1]!.includes(form.id) && !lines[1]!.includes(checks.id), told.text);
  assert.ok(lines[1]!.includes(`${form.id} is also`) && lines[1]!.includes("your edit is saved"), `the notice says the edit is saved: ${told.text}`);
  assert.ok(!refusal.includes(lines[1]!.replace(/\.$/, "")), `the notice is not the park's refusal: ${told.text} / ${refusal}`);

  const again = await edit.act({ increment: second.id, capabilities: `${checks.id},${form.id}`, title: "Route the checks and form" }, context, WORDS);
  assert.equal(again.text, `Edited increment ${second.id}.`, "a capability it already listed is not told of again");

  const label = await library.addCapability({ title: "Label", story: story.id });
  await library.editIncrement(first.id, { capabilities: [form.id, label.id] });
  const third = await library.addIncrement({ arc: drain.id, title: "Route the label", objective: "Route it", body: "…" });
  const both = (await edit.act({ increment: third.id, capabilities: `${form.id},${label.id}` }, context, WORDS)).text.split("\n");
  assert.ok(both.some((line) => line.includes(first.id) && line.includes(`${form.id}, ${label.id} are also`)), `two capabilities another lists are told together: ${both.join("\n")}`);
});
