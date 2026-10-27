/**
 * Capability 5 · Factory plugins, contract 5.14 (ADR-1187): a plugin carries its own story's plan, its
 * capabilities and contracts, in a file its manifest names, and storytree imports it from there into the project's plan.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { dropTestDatabases, testServerUrl, uniqueProjectName } from "@storytree/library/testing/pg";
import { VerbRefusal } from "@storytree/library/verbs";

import { PLUGIN_INTERFACE } from "./factory.js";

const PLAN = {
  story: { title: "Talk to storytree by voice", description: "The owner reaches storytree by voice" },
  capabilities: [
    { title: "1 · The address and its guards", proposed: false, contracts: [{ title: "1.1 · A wrong path is answered 404" }, { title: "1.2 · A wrong method is answered 405" }] },
    { title: "2 · The read tools", proposed: false, contracts: [{ title: "2.1 · catch_up says what needs the owner" }] },
  ],
};

test("5.14 · A plugin's manifest names its plan file inside its folder: `plugin check` counts its capabilities, and `plugin import-plan` writes it into the project's plan, adopting a story the first time, saying what it added, edited, retired and kept; a plan outside the plugin's folder, or not JSON, is refused saying why", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-home-"));
  const saved = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => {
    if (saved === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });
  const plugin = path.join(home, "your-factory", "plugins", "voice");
  mkdirSync(plugin, { recursive: true });
  const manifest = (plan: string) => writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "voice", storytree: { interface: PLUGIN_INTERFACE, plan } }));
  manifest("./plan.json");
  writeFileSync(path.join(plugin, "plan.json"), JSON.stringify(PLAN));

  const { PLUGIN_FAMILIES } = await import("./verbs.js");
  const verb = (name: string) => PLUGIN_FAMILIES[0]!.verbs.find((each) => "name" in each.command && each.command.name === name)!;
  const words = { door: "command" as const, say: (step: { command?: string }) => `storytree ${step.command}` };
  assert.match((await verb("check").act({ plugin: "voice" } as never, { folder: home } as never, words)).text, /voice would load: it adds plan \(2\)/);

  const run = uniqueProjectName();
  const storytree = await connect({ url: testServerUrl() });
  try {
    const library = await storytree.openProject(run);
    const story = await library.addStory({ title: "Voice" });
    const address = await library.addCapability({ title: "1 · The address and its guards", story: story.id, proposed: false });
    const kept = await library.addContract({ title: "1.1 · A wrong path is answered 404", capability: address.id });
    const importPlan = (inputs: Record<string, unknown>) => verb("import-plan").act(inputs as never, { folder: home, project: run, library, session: "test" } as never, words);

    const first = await importPlan({ plugin: "voice", adopt: story.id });
    assert.equal(first.text, `Imported voice's plan into ${story.id}: 3 added, 1 edited, 0 retired, 2 kept.`);
    const { stories } = await library.projectTree();
    const voice = stories.find(({ id }) => id === story.id)!;
    assert.equal(voice.plugin, "voice");
    assert.deepEqual(voice.capabilities.map(({ title, contracts }) => [title, contracts.map((contract) => contract.title)]), PLAN.capabilities.map(({ title, contracts }) => [title, contracts.map((contract) => contract.title)]));
    assert.equal(voice.capabilities[0]!.contracts[0]!.id, kept.id, "a promise already planned keeps its id, and so its health");
    assert.equal((await importPlan({ plugin: "voice" })).text, `Imported voice's plan into ${story.id}: 0 added, 0 edited, 0 retired, 6 kept.`);

    manifest("../plan.json");
    await assert.rejects(importPlan({ plugin: "voice" }), (error: unknown) => error instanceof VerbRefusal && /outside its own folder/.test(error.message));
    manifest("./plan.json");
    writeFileSync(path.join(plugin, "plan.json"), "{ not json");
    await assert.rejects(importPlan({ plugin: "voice" }), (error: unknown) => error instanceof VerbRefusal && /plan\.json is not JSON/.test(error.message));
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${run}`]);
  }
});
