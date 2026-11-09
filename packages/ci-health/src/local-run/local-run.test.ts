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
import { mounted, VerbRefusal, type DoorWords } from "@storytree/library/verbs";

import { HEALTH_FAMILIES } from "../verbs.js";
import { localReadingText, recordLocalTests } from "./local-run.js";

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
  const pytest = (log: string) => async (command: string) => (commands.push(command), { output: log, code: 0 });

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
  const run = async (command: string) => (commands.push(command), { output: "PASSED tests/test_island.py::test_1_1_floats\n", code: 0 });

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

  const read = await recordLocalTests({ library, folder, run: async () => ({ output: "PASSED tests/test_api.py::test_1_1_creates_a_todo\n", code: 0 }) });
  assert.ok(read.written && read.unmatched === 0, JSON.stringify(read));
  assert.equal((await library.health(contract.id)).verified.state, "passing", "credited from tests/test_api.py, in the imported story's folder");
});

test("5.5 · `health local` whose test command reports no results it can read says what the command printed, or that it could not be started, naming the runner it chose, and fails, since nothing was verified", async (t) => {
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
  const local = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "local")!;
  const place = { library, project: name, session: "test", folder };
  const refused = (said: RegExp) => (error: unknown) => error instanceof VerbRefusal && said.test(error.message) && /nothing was verified/i.test(error.message);

  // A runner this computer cannot find, through the real shell.
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", scripts: { test: "storytree-no-such-runner --run" } }));
  await assert.rejects(local.act({} as never, place as never, WORDS), refused(/could not be started.*storytree-no-such-runner/s));

  // A command that ran and printed nothing storytree reads: its last lines are quoted.
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", scripts: { test: `node -e "console.log('collected 0 items')"` } }));
  await assert.rejects(local.act({} as never, place as never, WORDS), refused(/collected 0 items/));
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", scripts: { test: `node -e ""` } }));
  await assert.rejects(local.act({} as never, place as never, WORDS), refused(/printed nothing/));

  // The reported case: a uv project whose uv is not on PATH reads as uv missing, not as pytest's output.
  rmSync(path.join(folder, "package.json"));
  writeFileSync(path.join(folder, "pyproject.toml"), "[project]\nname = \"checkbox\"\n");
  writeFileSync(path.join(folder, "uv.lock"), "version = 1\n");
  mkdirSync(path.join(folder, ".venv"));
  const read = await recordLocalTests({ library, folder, run: async () => ({ output: "/bin/sh: 1: uv: not found\n", code: 127 }) });
  assert.ok(!read.written && /could not be started/.test(read.why) && /\buv\b is not/.test(read.why), JSON.stringify(read));
});

test("5.6 · `health local` records, on each explored capability its tests no contract claims reach, those tests' verdict as the capability's own reading, and turns a reading no such test makes any more not checked", async (t) => {
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
  const todos = await library.addCapability({ story: story!.id, title: "Todo API", covers: ["src/todos.py"] });
  const users = await library.addCapability({ story: story!.id, title: "Users", covers: ["src/users.py"] });
  writeFileSync(path.join(folder, "pyproject.toml"), `[project]\nname = "checkbox"\n`);
  mkdirSync(path.join(folder, "src"));
  for (const file of ["__init__.py", "todos.py", "users.py"]) writeFileSync(path.join(folder, "src", file), "");
  mkdirSync(path.join(folder, "tests"));
  writeFileSync(path.join(folder, "tests", "test_api.py"), "from src.todos import *\n\ndef test_creates():\n    pass\n");
  writeFileSync(path.join(folder, "tests", "test_users.py"), "from src.users import *\n\ndef test_signs_up():\n    pass\n");
  const stateOf = async (id: string) => (await library.health(id)).verified.state;

  const first = await recordLocalTests({ library, folder, run: async () => ({ output: "XFAIL tests/test_api.py::test_creates - leaks between tenants\nPASSED tests/test_users.py::test_signs_up\n", code: 0 }) });
  assert.ok(first.written && first.unmatched === 2, JSON.stringify(first));
  assert.equal(await stateOf(todos.id), "failing", "its expected failure, which no contract claims, reaches src/todos.py");
  assert.equal(await stateOf(users.id), "passing");
  assert.equal(await stateOf(story!.id), "failing", "the island reads red");

  // The users test is gone: its reading no longer stands. The folder is now a git repository, so each note names its commit.
  execFileSync("git", ["init", "--quiet", folder]);
  execFileSync("git", ["-C", folder, "add", "."]);
  execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "start"]);
  const commit = execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12);
  await recordLocalTests({ library, folder, run: async () => ({ output: "XFAIL tests/test_api.py::test_creates - leaks between tenants\n", code: 0 }) });
  const unclaimed = async (id: string) => (await library.projectTree()).stories[0]!.capabilities.find((capability) => capability.id === id)!.unclaimed;
  assert.equal((await unclaimed(users.id))?.state, "not-checked");
  assert.equal((await unclaimed(users.id))?.note, `no test that no contract claims reached it, at commit ${commit}`);
  assert.equal(await stateOf(todos.id), "failing");
  assert.equal((await unclaimed(todos.id))?.note?.endsWith(`, at commit ${commit}`), true, (await unclaimed(todos.id))?.note);
});

test("5.7 · `health local` on an imported story whose tests fail names each red capability by title and id and asks for one arc whose increments fix them, each naming its capability, and carry the user's requests; an arc so planned names exactly the red capabilities (ADR-1271)", async (t) => {
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
  const todos = await library.addCapability({ story: story!.id, title: "Todo API", covers: ["src/todos.py"] });
  const users = await library.addCapability({ story: story!.id, title: "Users", covers: ["src/users.py"] });
  writeFileSync(path.join(folder, "pyproject.toml"), `[project]\nname = "checkbox"\n`);
  mkdirSync(path.join(folder, "src"));
  for (const file of ["__init__.py", "todos.py", "users.py"]) writeFileSync(path.join(folder, "src", file), "");
  mkdirSync(path.join(folder, "tests"));
  writeFileSync(path.join(folder, "tests", "test_api.py"), "from src.todos import *\n\ndef test_creates():\n    pass\n");
  writeFileSync(path.join(folder, "tests", "test_users.py"), "from src.users import *\n\ndef test_signs_up():\n    pass\n");
  const red = "FAILED tests/test_api.py::test_creates - AssertionError\nPASSED tests/test_users.py::test_signs_up\n";
  const read = await recordLocalTests({ library, folder, run: async () => ({ output: red, code: 1 }) });
  assert.ok(read.written, JSON.stringify(read));
  assert.deepEqual(read.red, [{ id: todos.id, title: todos.fields.title }], "only the capability its failing test reaches reads red");

  const said = localReadingText(read);
  assert.ok(said.includes(`"${todos.fields.title}" (${todos.id})`), said);
  assert.ok(!said.includes(users.id), "a passing capability is not named");
  assert.match(said, /plan one arc/i);
  assert.match(said, /capabilities list nam/i, "each fix increment names its capability, so selecting the arc rings it");
  assert.match(said, /user's own requests/i);

  // The agent does as it says: one arc, a fix increment naming each red capability, the user's request beside it.
  const arc = await library.createArc({ title: "Fix checkbox and add sharing", intent: "Its tests pass, and todos can be shared", endState: "Every capability reads green and sharing works" });
  for (const { id, title } of read.red) await library.addIncrement({ arc: arc.id, title: `Fix ${title}`, objective: `${title}'s tests pass`, body: "Fix the failing test", capabilities: [id] });
  await library.addIncrement({ arc: arc.id, title: "Share a todo", objective: "A user shares a todo", body: "The user's request" });
  const ringed = (await library.projectTree()).stories.flatMap(({ capabilities }) => capabilities).filter(({ openWork }) => openWork !== undefined).map(({ id }) => id);
  assert.deepEqual(ringed, [todos.id], "selecting the arc rings exactly the red capabilities");

  // A run that leaves nothing red asks for no arc.
  const passing = await recordLocalTests({ library, folder, run: async () => ({ output: "PASSED tests/test_api.py::test_creates\nPASSED tests/test_users.py::test_signs_up\n", code: 0 }) });
  assert.ok(passing.written && passing.red.length === 0, JSON.stringify(passing));
  assert.doesNotMatch(localReadingText(passing), /plan one arc/i);
});

test("5.8 · storytree health local records a local test titled with an edge contract's number on that contract, so a fault between two parts can turn verified green", async (t) => {
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
  const story = await library.addStory({ title: "Context" });
  const retrieval = await library.addCapability({ story: story.id, title: "1 · Retrieval" });
  const api = await library.addCapability({ story: story.id, title: "2 · Context API", dependsOn: [retrieval.id] });
  const edge = (await library.projectTree()).stories[0]!.edges![0]!;
  assert.equal(edge.from, api.id);
  const contract = await library.addContract({ edge: edge.id, title: "the caller's identity reaches retrieval" });
  const number = /^(\d+\.\d+) · /.exec(contract.fields.title)?.[1];
  assert.ok(number !== undefined, contract.fields.title);
  writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "scratch", type: "module", scripts: { test: "node --test" } }));
  mkdirSync(path.join(folder, "packages", "context"), { recursive: true });
  writeFileSync(path.join(folder, "packages", "context", "api.test.js"), `import { test } from "node:test";\ntest("${number} · the caller's identity reaches retrieval", () => {});\n`);

  const local = HEALTH_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === "local")!;
  const reading = await local.act({} as never, { library, project: name, session: "test", folder } as never, WORDS);
  assert.match(reading.text, /1 contracts verified passing, 0 failing/, reading.text);
  const verified = (await library.health(contract.id)).verified;
  assert.equal(verified.state, "passing");
  assert.equal(verified.source, "local");
});
