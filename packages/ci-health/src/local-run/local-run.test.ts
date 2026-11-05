// A project's own tests recorded as its stories' verified health (local-run.ts), through the front door: the `health local`
// verb run in a scratch project folder with no git repository, against a throwaway project of the Postgres `pnpm test`
// provides (STORYTREE_TEST_PG_URL), dropped afterwards.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { connect } from "@storytree/library";
import { mounted, type DoorWords } from "@storytree/library/verbs";

import { HEALTH_FAMILIES } from "../verbs.js";
import { recordLocalTests } from "./local-run.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("5.1, 3.17 · `health local`, on the command line only (no tool), runs a project's own numbered tests by its test command in a folder with no git repository and records them on its story's promises as a local test run: passing, then failing once a test fails; a project with no test command, or whose CI storytree reads, writes nothing and says why", async (t) => {
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
  await library.addContract({ capability: capability.id, title: "1.2 · hello greets by name" });
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", type: "module", scripts: { test: "node --test" } }));
  mkdirSync(path.join(folder, "packages", "greeting"), { recursive: true });
  const tests = path.join(folder, "packages", "greeting", "hello.test.js");
  writeFileSync(tests, `import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("1.1 · hello greets the world", () => {\n  assert.equal("hello, world", "hello, world");\n});\n` +
    `test("1.2 · hello greets by name", { skip: "not yet" }, () => {});\ntest("1.9 · hello's promise no story makes", () => {});\n`);
  assert.ok(!existsSync(path.join(folder, ".git")));

  const local = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "local")!;
  assert.ok(!mounted(local.tool), "the MCP server offers no tool for it: it runs the user's test command, through the agent's shell");
  const place = { library, project: name, session: "test", folder };
  const passing = await local.act({} as never, place as never, WORDS);
  assert.match(passing.text, /1 contracts verified passing, 0 failing, 1 not checked; 1 results named no contract of one story\./);
  assert.match(passing.text, /by `node --test`/, "it names the command it ran in the project");
  const verified = (await library.health(contract.id)).verified;
  assert.equal(verified.state, "passing");
  assert.equal(verified.by, "a local test run");
  assert.equal(verified.source, "local", "verified locally");

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

test("5.2 · `health local` runs a Python project's own tests by pytest -rA (through uv run or poetry run when its lockfile is uv's or Poetry's), crediting its numbered pytest tests from its .py files as CI does; a run with no results names pytest -rA", async (t) => {
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
  const story = await library.addStory({ title: "Check out" });
  const capability = await library.addCapability({ story: story.id, title: "1 · Checkout form" });
  const contract = await library.addContract({ capability: capability.id, title: "1.1 · the form shows" });
  writeFileSync(path.join(folder, "pyproject.toml"), `[tool.uv.workspace]\nmembers = ["packages/*"]\n`);
  mkdirSync(path.join(folder, "packages", "check-out", "tests"), { recursive: true });
  writeFileSync(path.join(folder, "packages", "check-out", "tests", "test_checkout.py"), "def test_1_1_shows_the_form():\n    pass\n");
  const commands: string[] = [];
  const pytest = (log: string) => async (command: string) => (commands.push(command), log);

  const read = await recordLocalTests({ library, folder, run: pytest("PASSED packages/check-out/tests/test_checkout.py::test_1_1_shows_the_form\n") });
  assert.equal(read.written, true, read.written ? "" : read.why);
  assert.deepEqual(commands, ["pytest -rA"]);
  assert.equal((await library.health(contract.id)).verified.state, "passing", "credited from packages/check-out/tests/test_checkout.py");

  writeFileSync(path.join(folder, "uv.lock"), "version = 1\n");
  const empty = await recordLocalTests({ library, folder, run: pytest("no tests ran in 0.01s\n") });
  assert.equal(commands.at(-1), "uv run pytest -rA");
  assert.ok(!empty.written && /pytest -rA/.test(empty.why), empty.written ? "" : empty.why);
  rmSync(path.join(folder, "uv.lock"));
  writeFileSync(path.join(folder, "poetry.lock"), "");
  await recordLocalTests({ library, folder, run: pytest("") });
  assert.equal(commands.at(-1), "poetry run pytest -rA");
});

test("5.4 · `health local` on a uv project whose .venv already exists runs its tests in that environment as it stands (uv run --no-sync), and syncs it from uv.lock only when there is none yet; the reading names the command it ran", async (t) => {
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
  writeFileSync(path.join(folder, "pyproject.toml"), "[project]\nname = \"island\"\n");
  writeFileSync(path.join(folder, "uv.lock"), "version = 1\n");
  const commands: string[] = [];
  const run = async (command: string) => (commands.push(command), "PASSED tests/test_island.py::test_1_1_floats\n");

  const fresh = await recordLocalTests({ library, folder, run });
  assert.equal(commands.at(-1), "uv run pytest -rA", "a fresh checkout has no environment yet, so uv makes it from uv.lock");
  assert.ok(fresh.written && fresh.command === "uv run pytest -rA");

  mkdirSync(path.join(folder, ".venv"));
  const existing = await recordLocalTests({ library, folder, run });
  assert.equal(commands.at(-1), "uv run --no-sync pytest -rA", "an environment the user built is run as it stands, adding and removing nothing");
  assert.ok(existing.written && existing.command === "uv run --no-sync pytest -rA");
});

test("5.3 · `health local` credits a flat Python project's numbered pytest tests (tests/ at its top, not under packages/<story>/) to the imported story whose folder holds them, by the number `land` credits", async (t) => {
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
  const { added: [story] } = await library.mapStories(folder, [{ package: ".", title: "checkbox", folders: ["."] }]);
  const capability = await library.addCapability({ story: story!.id, title: "1 · Todo API", covers: ["src"] });
  const contract = await library.addContract({ capability: capability.id, title: "1.1 · a todo is created" });
  writeFileSync(path.join(folder, "pyproject.toml"), `[project]\nname = "checkbox"\n`);
  mkdirSync(path.join(folder, "src"));
  writeFileSync(path.join(folder, "src", "__init__.py"), "");
  mkdirSync(path.join(folder, "tests"));
  writeFileSync(path.join(folder, "tests", "test_api.py"), "def test_1_1_creates_a_todo():\n    pass\n");

  const read = await recordLocalTests({ library, folder, run: async () => "PASSED tests/test_api.py::test_1_1_creates_a_todo\n" });
  assert.ok(read.written && read.unmatched === 0, JSON.stringify(read));
  assert.equal((await library.health(contract.id)).verified.state, "passing", "credited from tests/test_api.py, in the imported story's folder");
});
