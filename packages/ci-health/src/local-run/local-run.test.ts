// A project's own tests recorded as its stories' verified health (local-run.ts), through the front door: the `health local`
// verb run in a scratch project folder with no git repository, against a throwaway project of the Postgres `pnpm test`
// provides (STORYTREE_TEST_PG_URL), dropped afterwards.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "@storytree/library";
import { mounted, type DoorWords } from "@storytree/library/verbs";

import { HEALTH_FAMILIES } from "../verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("5.1 · `health local`, on the command line only (no tool), runs a project's own numbered tests by its test command in a folder with no git repository and records them on its story's promises as a local test run: passing, then failing once a test fails; a project with no test command, or whose CI storytree reads, writes nothing and says why", async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const name = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(name);
  const folder = mkdtempSync(path.join(tmpdir(), "storytree-local-"));
  t.after(async () => {
    try {
      await storytree.dropProject(name);
    } finally {
      await storytree.close();
      await removeTemp(folder);
    }
  });
  const story = await library.addStory({ title: "Greeting" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Hello" });
  const contract = await library.addContract({ capability: capability.id, title: "1.1 · hello greets the world" });
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", type: "module", scripts: { test: "node --test" } }));
  mkdirSync(path.join(folder, "packages", "greeting"), { recursive: true });
  const tests = path.join(folder, "packages", "greeting", "hello.test.js");
  writeFileSync(tests, `import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("1.1 · hello greets the world", () => {\n  assert.equal("hello, world", "hello, world");\n});\n`);
  assert.ok(!existsSync(path.join(folder, ".git")));

  const local = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "local")!;
  assert.ok(!mounted(local.tool), "the MCP server offers no tool for it: it runs the user's test command, through the agent's shell");
  const place = { library, project: name, session: "test", folder };
  const passing = await local.act({} as never, place as never, WORDS);
  assert.match(passing.text, /1 contracts verified passing, 0 failing/);
  const verified = (await library.health(contract.id)).verified;
  assert.equal(verified.state, "passing");
  assert.equal(verified.by, "a local test run");

  writeFileSync(tests, readFileSync(tests, "utf8").replace(`"hello, world");`, `"goodbye");`));
  const failing = await local.act({} as never, place as never, WORDS);
  assert.match(failing.text, /0 contracts verified passing, 1 failing/);
  assert.equal((await library.health(contract.id)).verified.state, "failing");

  // Its CI is read instead, once storytree can: a GitHub origin with a workflow.
  execFileSync("git", ["init", "--quiet", folder]);
  execFileSync("git", ["-C", folder, "remote", "add", "origin", "https://github.com/someone/scratch.git"]);
  mkdirSync(path.join(folder, ".github", "workflows"), { recursive: true });
  writeFileSync(path.join(folder, ".github", "workflows", "test.yml"), "on: push\n");
  assert.match((await local.act({} as never, place as never, WORDS)).text, /health ci/);

  assert.match((await local.act({} as never, { ...place, folder: path.join(folder, "packages") } as never, WORDS)).text, /no package\.json/);
  const bare = mkdtempSync(path.join(tmpdir(), "storytree-local-"));
  t.after(() => removeTemp(bare));
  writeFileSync(path.join(bare, "package.json"), JSON.stringify({ name: "bare" }));
  assert.match((await local.act({} as never, { ...place, folder: bare } as never, WORDS)).text, /no test command/);
  assert.equal((await library.healthHistory(contract.id)).length, 2, "nothing more was written");
});
