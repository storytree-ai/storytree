// A factory plugin's own test run recorded as its story's health (factory-run.mjs, through record-run.mjs): against a
// throwaway factory (a git folder with the factory's test-command shape and one plugin) and a library project of its own
// in the Postgres `pnpm test` provides (STORYTREE_TEST_PG_URL), dropped afterwards.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";
import { removeTemp } from "@storytree/test-waits";

import { factoryArgument, factoryCommit, factoryPlugins, recordFactory, runFactoryTests } from "./factory-run.mjs";
import { contractsOf } from "./test-run.mjs";

const tsx = fileURLToPath(new URL("../../node_modules/tsx", import.meta.url));

test("12.8 · a story whose code is a factory plugin has that folder's tests run by the factory's own test command and recorded as its verified health at the factory's commit; no package's test counts for it", async (t) => {
  const factory = mkdtempSync(path.join(tmpdir(), "factory-health-"));
  t.after(() => removeTemp(factory));
  const write = (file, lines) => {
    mkdirSync(path.dirname(path.join(factory, file)), { recursive: true });
    writeFileSync(path.join(factory, file), lines.join("\n"));
  };
  mkdirSync(path.join(factory, "node_modules"));
  symlinkSync(tsx, path.join(factory, "node_modules", "tsx"), "junction");
  // The factory's test command: every test under the folders named, run with --test; it dies of a signal for plugins/kettle.
  write("scripts/test.mjs", [
    'import { spawnSync } from "node:child_process";',
    'if (process.argv[2] === "plugins/kettle") process.kill(process.pid, "SIGKILL");',
    'import { readdirSync } from "node:fs";',
    'import path from "node:path";',
    "const files = process.argv.slice(2).flatMap((dir) => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f)));",
    "process.exitCode = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1;",
  ]);
  write("plugins/cli/package.json", ['{ "name": "cli" }']);
  write("plugins/cli/src/kettle.test.mjs", [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'test("1.1 it does a", () => {});',
    'test("1.2 it does b", () => assert.fail("spilt"));',
  ]);
  write("plugins/teapot/package.json", ['{ "name": "teapot" }']);
  write("plugins/kettle/package.json", ['{ "name": "kettle" }']);
  write("plugins/kettle/src/boil.test.mjs", ['import { test } from "node:test";', 'test("1.1 it boils", () => {});']);
  write("plugins/whistle/package.json", ['{ "name": "whistle" }']);
  write("packages/door/src/door.test.mjs", ['import { test } from "node:test";', 'test("cli 1.3 it does c, through a door", () => {});']);
  execFileSync("git", ["init", "-q"], { cwd: factory });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "factory"], { cwd: factory });
  const commit = factoryCommit(factory);
  // Reached through a link, as macOS's temp folder is (/var under /private/var): the report names the real path.
  const linked = `${factory}-link`;
  symlinkSync(factory, linked, "junction");
  t.after(() => removeTemp(linked));

  await withLibrary(async (lib) => {
    const story = await lib.addStory({ title: "The cli" });
    const capability = await lib.addCapability({ story: story.id, title: "1 · Front door" });
    for (const [number, words] of [[1, "a"], [2, "b"], [3, "c"]]) await lib.addContract({ capability: capability.id, title: `1.${number} · It does ${words}` });
    const kettle = await lib.addStory({ title: "The kettle" });
    const boils = await lib.addContract({ capability: (await lib.addCapability({ story: kettle.id, title: "1 · Boiling" })).id, title: "1.1 · It boils" });
    await lib.addStory({ title: "The teacup" });
    // A plugin's own story (ADR-1187) is found by the plugin it names, whatever its title says.
    await lib.importPluginPlan("whistle", { story: { title: "Hear the kettle whistle" }, capabilities: [] });
    const { stories } = await lib.projectTree();
    const quiet = { log: () => {}, error: () => {} };

    assert.deepEqual(factoryPlugins(stories, factory).map(({ story: { title }, folder }) => [title, folder]), [["The cli", "plugins/cli"], ["The kettle", "plugins/kettle"], ["Hear the kettle whistle", "plugins/whistle"]], "only a story whose package or plugin is a plugin folder");
    const planned = stories.find(({ title }) => title === "The cli");
    assert.equal(await recordFactory(lib, [planned], linked, { ...quiet }), 0);
    assert.equal(await recordFactory(lib, stories, linked, { ...quiet }), 1, "a plugin whose run left no report fails the recording");
    assert.deepEqual(await lib.healthHistory(boils.id), [], "and records nothing for its story");

    const { contractIds } = contractsOf(planned);
    const passed = (await lib.health(contractIds.get("1.1"))).verified;
    assert.equal(passed.state, "passing");
    assert.equal(passed.by, "factory test run");
    assert.ok(passed.note.includes(commit), "the factory's commit is in the note");
    assert.equal((await lib.health(contractIds.get("1.2"))).verified.state, "failing");
    assert.deepEqual(await lib.healthHistory(contractIds.get("1.3")), [], "a package's test titled with the story's package counts for nothing");
  });
});

test("12.8 · a factory run that dies of a signal fails with no results, and `--factory` names the folder after it or else this computer's factory", async (t) => {
  const factory = mkdtempSync(path.join(tmpdir(), "factory-killed-"));
  t.after(() => removeTemp(factory));
  mkdirSync(path.join(factory, "scripts"));
  mkdirSync(path.join(factory, "node_modules"));
  symlinkSync(tsx, path.join(factory, "node_modules", "tsx"), "junction");
  writeFileSync(path.join(factory, "scripts", "test.mjs"), 'process.kill(process.pid, "SIGKILL");');
  assert.deepEqual(await runFactoryTests(factory, "plugins/kettle", process.env), { code: 1, results: undefined });

  const chosen = () => path.join(factory, "chosen");
  assert.equal(factoryArgument([], chosen), undefined, "without --factory, storytree's own stories");
  assert.deepEqual(factoryArgument(["--factory"], chosen), { folder: path.join(factory, "chosen"), unrecorded: false });
  assert.deepEqual(factoryArgument(["--factory", "elsewhere"], chosen), { folder: path.resolve("elsewhere"), unrecorded: false });
});

test("12.9 · a factory run with --unrecorded skips each plugin whose story already holds a factory test run's entry at the factory's commit, and records the rest; a new commit is recorded again", async (t) => {
  const factory = mkdtempSync(path.join(tmpdir(), "factory-unrecorded-"));
  t.after(() => removeTemp(factory));
  const write = (file, lines) => {
    mkdirSync(path.dirname(path.join(factory, file)), { recursive: true });
    writeFileSync(path.join(factory, file), lines.join("\n"));
  };
  mkdirSync(path.join(factory, "node_modules"));
  symlinkSync(tsx, path.join(factory, "node_modules", "tsx"), "junction");
  write("scripts/test.mjs", [
    'import { spawnSync } from "node:child_process";',
    'import { readdirSync } from "node:fs";',
    'import path from "node:path";',
    "const files = process.argv.slice(2).flatMap((dir) => readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.test.mjs')).map((f) => path.join(dir, f)));",
    "process.exitCode = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1;",
  ]);
  for (const name of ["cli", "kettle"]) {
    write(`plugins/${name}/package.json`, [`{ "name": "${name}" }`]);
    write(`plugins/${name}/src/${name}.test.mjs`, ['import { test } from "node:test";', 'test("1.1 it works", () => {});']);
  }
  const commit = () => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "factory"], { cwd: factory });
  execFileSync("git", ["init", "-q"], { cwd: factory });
  commit();

  assert.deepEqual(factoryArgument(["--factory", "--unrecorded"], () => factory), { folder: factory, unrecorded: true }, "the timer's command line");
  assert.deepEqual(factoryArgument(["--factory", factory, "--unrecorded"], () => "chosen"), { folder: factory, unrecorded: true });

  await withLibrary(async (lib) => {
    for (const title of ["The cli", "The kettle"]) {
      const story = await lib.addStory({ title });
      await lib.addContract({ capability: (await lib.addCapability({ story: story.id, title: "1 · Working" })).id, title: "1.1 · It works" });
    }
    const runs = [];
    const record = async (only, unrecorded = true) => {
      const { stories } = await lib.projectTree();
      runs.length = 0;
      const chosen = only === undefined ? stories : stories.filter(({ title }) => title === only);
      const code = await recordFactory(lib, chosen, factory, {
        ...(unrecorded ? { unrecorded } : {}),
        log: () => {},
        error: () => {},
        runTests: (folder) => (runs.push(folder), runFactoryTests(factory, folder, process.env)),
      });
      return { code, runs: [...runs] };
    };

    assert.deepEqual(await record("The cli"), { code: 0, runs: ["plugins/cli"] });
    assert.deepEqual(await record(), { code: 0, runs: ["plugins/kettle"] }, "the cli is already recorded at this commit");
    assert.deepEqual(await record(), { code: 0, runs: [] }, "nothing is run while the factory stays at a recorded commit");
    assert.deepEqual(await record("The cli", false), { code: 0, runs: ["plugins/cli"] }, "without --unrecorded, a recorded commit is run again");
    commit();
    assert.deepEqual(await record(), { code: 0, runs: ["plugins/cli", "plugins/kettle"] }, "a new factory commit is recorded again");
  });
});

async function withLibrary(body) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const lib = await storytree.openProject(name);
    try {
      await body(lib);
    } finally {
      await lib.close();
    }
  } finally {
    await storytree.close();
    await dropTestDatabases([`storytree_${name}`]);
  }
}
