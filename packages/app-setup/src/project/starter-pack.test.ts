// Capability 6 · Make a folder a project.
import assert from "node:assert/strict";
import { test } from "node:test";

import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { connect, type Library } from "@storytree/library";

import { GUARDRAILS, PRINCIPLES, PROCESSES } from "./starter-notes.js";
import { ROLES } from "./starter-roles.js";
import { seedStarterPack, STARTER_PACK_VERSION, starterPackStatus, takeStarterPack } from "./starter-pack.js";

const V1 = { actor: "storytree setup (starter pack v1)" };

const KINDS = ["principle", "guardrail", "pattern", "process", "check", "agent"] as const;

async function held(library: Library): Promise<string[]> {
  return (await Promise.all(KINDS.map(async (kind) => (await library.list(kind)).map((record) => `${kind}: ${record.fields.title}`)))).flat().sort();
}

const principle = (title: string) => PRINCIPLES.find((note) => note.title === title)!;

const EXPLORER = [
  "agent: explorer",
  "guardrail: Escalate up when blocked or out of scope",
  "pattern: Pull-based context architecture",
  "principle: Delegate exploration to digest-returning subagents",
  "principle: No claim without evidence",
  "principle: Plain language first",
  "principle: Reference, don't restate",
];

test("6.9 taking a newer starter pack replaces a pack record its user has not edited and leaves an edited one as it is, named with the newer text beside it, adding none the bare bones leave out; a part named by its title is added with what it links; taking it again writes nothing", async () => {
  const [project, fresh] = [uniqueProjectName(), uniqueProjectName()];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const seededFresh = await storytree.openProject(fresh);
    await seedStarterPack(seededFresh);
    assert.deepEqual(await held(seededFresh), [], "the bare bones seed no role, check or note (ADR-1094 D1)");
    await seededFresh.close();

    const library = await storytree.openProject(project);
    try {
      const changed = await library.writeKnowledge("principle", { ...principle("Minimum to green"), statement: "Write the least code that passes." }, V1);
      const edited = await library.writeKnowledge("principle", { ...principle("Minimum test to red"), why: "A test never seen failing may test nothing." }, V1);
      await library.editNote(edited.id, { why: "Our team's own reason." }, { actor: "session:the-user" });
      const same = await library.writeKnowledge("principle", principle("Edit before adding"), V1);
      const kept = ["principle: Edit before adding", "principle: Minimum test to red", "principle: Minimum to green"];

      const took = await takeStarterPack(library);
      assert.deepEqual(took.replaced.map(({ kind, title, id }) => ({ kind, title, id })), [{ kind: "principle", title: "Minimum to green", id: changed.id }]);
      assert.deepEqual(took.kept, [{ kind: "principle", title: "Minimum test to red", id: edited.id, newer: principle("Minimum test to red") }]);
      assert.deepEqual(took.added, [], "nothing the bare bones leave out is added unasked");
      assert.deepEqual(await held(library), kept, "what the library held stays, and nothing is deleted");

      assert.equal(((await library.get(changed.id))?.fields as { statement?: string } | undefined)?.statement, "Write the least code that makes the failing test pass, then stop and land it.","the unedited record now carries the newer text");
      assert.equal(((await library.get(edited.id))?.fields as { why?: string } | undefined)?.why, "Our team's own reason.", "the user's edit stands");
      assert.equal((await library.history({ id: same.id })).length, 1, "a record already matching the newer pack is not rewritten");
      const replacedBy = (await library.history({ id: changed.id })).at(-1)?.actor;
      assert.match(replacedBy ?? "", /^storytree setup \(starter pack v\d+\)$/, "the replacement is the pack's, so a later pack may replace it again");
      assert.notEqual(replacedBy, V1.actor);

      await assert.rejects(takeStarterPack(library, undefined, ["explorer", "reviewer of everything"]), /"reviewer of everything" is no part of the starter pack.*change-reviewer.*Proxy assertion/);
      const explorer = await takeStarterPack(library, undefined, ["explorer"]);
      assert.deepEqual(explorer.added.map(({ kind, title }) => `${kind}: ${title}`).sort(), EXPLORER, "the role comes with every note it links");
      assert.deepEqual(await held(library), [...kept, ...EXPLORER].sort());

      const before = await library.history();
      const again = await takeStarterPack(library);
      assert.deepEqual({ added: again.added, replaced: again.replaced }, { added: [], replaced: [] });
      assert.deepEqual(again.kept.map(({ id }) => id), [edited.id], "the edited record is named again, still left as it is");
      assert.deepEqual(await library.history(), before, "taking it again writes nothing");
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProjects([project, fresh]);
  }
});

test("6.9 a product project holding no copy of the pack is offered and takes the newer pack into its factory, and a part by its title there, writing nothing of its own", async () => {
  const [factory, product] = [uniqueProjectName(), uniqueProjectName()];
  const storytree = await connect({ url: testServerUrl() });
  try {
    const made = await storytree.openProject(factory);
    await made.markFactory();
    const changed = await made.writeKnowledge("principle", { ...principle("Minimum to green"), statement: "Write the least code that passes." }, V1);
    await made.close();
    const built = await storytree.openProject(product);
    await built.recordFactory(factory);
    await built.close();
    const library = await storytree.openProject(product);
    try {
      assert.deepEqual(await starterPackStatus(library, storytree), { seeded: 1, current: STARTER_PACK_VERSION, offered: true, factory });

      const took = await takeStarterPack(library, storytree, ["explorer"]);
      assert.equal(took.factory, factory);
      assert.deepEqual(took.replaced.map(({ kind, title, id }) => ({ kind, title, id })), [{ kind: "principle", title: "Minimum to green", id: changed.id }]);
      assert.deepEqual(took.added.map(({ kind, title }) => `${kind}: ${title}`).sort(), EXPLORER, "the part named is added to the factory");
      assert.deepEqual(await library.history(), [], "the product writes nothing of its own");
      assert.deepEqual(await held(library), [...EXPLORER, "principle: Minimum to green"].sort(), "the product reads what it took through its factory");
      assert.deepEqual(await starterPackStatus(library, storytree), { seeded: STARTER_PACK_VERSION, current: STARTER_PACK_VERSION, offered: false, factory });
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    await dropTestProjects([factory, product]);
  }
});

test("6.17 the starter pack's Merge ceremony and orchestrator land green, reviewed work without a diff approval, showing a diff only when the user asks (ADR-1269)", () => {
  const diffStop = /show the user the diff|approval of the diff|diff approved by the user|approve[sd]? the diff/i;
  const ceremony = PROCESSES.find((process) => process.title === "Merge ceremony")!;
  for (const [field, text] of Object.entries(ceremony)) assert.doesNotMatch(String(text), diffStop, `Merge ceremony's ${field}`);
  assert.match(ceremony.steps, /diff[^.]*only (when|if) the user asks/i, "its landing step shows a diff only when asked");
  const orchestrator = ROLES.find((role) => role.workflow.includes("Merge ceremony"))!;
  assert.doesNotMatch(orchestrator.workflow, diffStop, "the orchestrator's land step");
});

test("6.19 a new starter pack's imported-code note asks only about code in a language the code survey knows, leaves README, docs and config to the agent, and names the edit gate and shell guard as its enforcement (ADR-1392)", () => {
  const note = GUARDRAILS.find((guardrail) => guardrail.title === "Ask the user before changing the imported code")!;
  const asks = `${note.statement}\n${note.rule}`;
  assert.doesNotMatch(note.statement, /anything in the imported (project|folder)/i, "it no longer asks about everything imported");
  assert.match(asks, /language[^.]*code survey|code survey[^.]*language/i, "imported code is a file in a language the code survey knows");
  assert.match(asks, /README[^.]*docs[^.]*config/i, "it names README, docs and config");
  assert.match(asks, /(agent's|agent is free|agent may)[^.]*change|change[^.]*(without asking|no yes|not asked)/i, "those are the agent's to change without asking");
  assert.match(note.enforcedBy, /edit gate/i, "its enforcedBy names the edit gate");
  assert.match(note.enforcedBy, /shell guard/i, "its enforcedBy names the shell guard");
  assert.doesNotMatch(note.enforcedBy, /nothing mechanical/i, "it no longer says nothing mechanical stops an edit");
  assert.ok(STARTER_PACK_VERSION > 17, `the change offers a newer pack than 17, got ${STARTER_PACK_VERSION}`);
});
