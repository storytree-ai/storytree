// A factory plugin's own tests recorded as its story's verified health (plugin-run.ts), through the front door: a
// plugin started by `plugin new` in a storytree home of its own, and the `health plugin` verb run in a throwaway
// project of the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "@storytree/library";
import { mounted, type DoorWords, type VerbFamily } from "@storytree/library/verbs";

import { HEALTH_FAMILIES } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

/** Verb `name` of `families`' first family. */
function verbOf(families: readonly VerbFamily[], name: string) {
  return families[0]!.verbs.find((one) => "name" in one.command && one.command.name === name)!;
}

/** A storytree home of its own, so this computer's factory is its default one, put back afterwards. */
function home(t: TestContext): string {
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-home-"));
  const before = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = folder;
  t.after(() => {
    if (before === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = before;
    return removeTemp(folder);
  });
  return path.join(folder, "your-factory");
}

test("4.1 · `health plugin <plugin>`, on the command line only (no record_plugin_health tool), runs a freshly made plugin's own numbered test in this computer's factory and records it on its story's promise in the project: passing, then failing once the test fails; a plugin with no story, or no test command, writes nothing and says why", async (t) => {
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
  const factory = home(t);
  const { PLUGIN_FAMILIES } = await import("@storytree/plugin-loader/verbs");
  const start = (plugin: string) => verbOf(PLUGIN_FAMILIES, "new").act({ plugin } as never, { folder: factory } as never, WORDS);
  await start("my-health");
  const story = await library.addStory({ title: "my-health" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Hello" });
  const contract = await library.addContract({ capability: capability.id, title: "1.1 · my-health's hello says it is mounted" });
  const nested = await library.addContract({ capability: capability.id, title: "1.2 · my-health's hello names the folder it is called in" });
  // A test in a folder of the plugin's own counts as one beside its verbs does.
  mkdirSync(path.join(factory, "plugins", "my-health", "test"));
  writeFileSync(
    path.join(factory, "plugins", "my-health", "test", "folder.test.js"),
    `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { PLUGIN_FAMILIES } from "../verbs.js";\n` +
      `test("1.2 · my-health's hello names the folder it is called in", async () => {\n  assert.match((await PLUGIN_FAMILIES[0].verbs[0].act({}, { folder: "/here" })).text, /\\/here/);\n});\n`,
  );

  const record = verbOf(HEALTH_FAMILIES, "plugin");
  assert.ok(!mounted(record.tool), "the MCP server offers no tool for it: it runs the user's test command, through the agent's shell");
  const place = { library, project: name, session: "test", folder: factory };
  const passing = await record.act({ plugin: "my-health" } as never, place as never, WORDS);
  assert.match(passing.text, /2 contracts verified passing, 0 failing, 0 not checked/);
  assert.equal((await library.health(nested.id)).verified.state, "passing");
  const verified = (await library.health(contract.id)).verified;
  assert.equal(verified.state, "passing");
  assert.equal(verified.by, "factory plugin's tests");

  const tests = path.join(factory, "plugins", "my-health", "verbs.test.js");
  writeFileSync(tests, readFileSync(tests, "utf8").replace(/is mounted/g, "is not mounted"));
  const failing = await record.act({ plugin: "my-health" } as never, place as never, WORDS);
  assert.match(failing.text, /1 contracts verified passing, 1 failing, 0 not checked/);
  assert.equal((await library.health(contract.id)).verified.state, "failing");

  await start("stray");
  assert.match((await record.act({ plugin: "stray" } as never, place as never, WORDS)).text, /no story/i);
  const manifest = path.join(factory, "plugins", "stray", "package.json");
  const { scripts: _, ...bare } = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(manifest, JSON.stringify(bare));
  assert.match((await record.act({ plugin: "stray" } as never, place as never, WORDS)).text, /no test command/);
  assert.equal((await library.healthHistory(contract.id)).length, 2, "nothing more was written");
  assert.equal((await library.healthHistory(nested.id)).length, 2);
});
