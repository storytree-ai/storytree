import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";
import pg from "pg";

import { compareOracle, listOracle, readRuntime } from "./library-pilot.mjs";

const repository = path.resolve(import.meta.dirname, "../../..");

const ALPHA = [
  'import { test } from "node:test";',
  "",
  'test("3.1 · alpha answers", () => {});',
  'test("an unnumbered check", () => {});',
  'test("3.1 · alpha answers again", () => {});',
  "",
].join("\n");

const BETA = [
  'import { contract } from "./contract.ts";',
  "",
  'contract("3.2", "beta keeps two", () => {});',
  "",
].join("\n");

const GAMMA = [
  'import { test } from "node:test";',
  "",
  'const shape = "square";',
  'test(`3.3 · a plain template title`, () => {});',
  'test(`3.4 · a title naming ${shape}`, () => {});',
  "",
].join("\n");

const CONTRACT_HELPER = [
  'import { test } from "node:test";',
  "",
  'export const contract = (number, title, body) => test("9.9 · a helper that is not a test file", body);',
  "",
].join("\n");

const OTHER_STORY = [
  'import { test } from "node:test";',
  "",
  'test("1.1 · another story\'s test", () => {});',
  "",
].join("\n");

const ALPHA_SHA = "480659106034ab8e409bb4e80627bf7fe434e71d3568f52ee6fe9f48a3b2be32";
const BETA_SHA = "e21c124d25e6ac6ec77cdb4c085ad470d3d6d6d654170a115ffafbf474fbf347";
const GAMMA_SHA = "a5cb27ff31207f4a62f5da3dc0b4abf43ef1eb95ed46d22c26a11754843e92a4";

function checkout(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "library-pilot-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const frozenFiles = {
  "packages/library/src/a/alpha.test.ts": ALPHA,
  "packages/library/src/b/beta.test.ts": BETA,
  "packages/library/src/b/contract.ts": CONTRACT_HELPER,
  "packages/other/src/other.test.ts": OTHER_STORY,
};

test("11.3 · the oracle lists each library test file's tests by title and contract number, a template-literal title included, with the file's path in the checkout and its sha256, and nothing outside the library's test files", async (t) => {
  const listing = await listOracle(checkout(t, { ...frozenFiles, "packages/library/src/a/gamma.test.ts": GAMMA }));
  assert.deepEqual(listing, {
    tests: [
      { file: "packages/library/src/a/alpha.test.ts", sha256: ALPHA_SHA, title: "3.1 · alpha answers", contract: "3.1" },
      { file: "packages/library/src/a/alpha.test.ts", sha256: ALPHA_SHA, title: "an unnumbered check", contract: null },
      { file: "packages/library/src/a/alpha.test.ts", sha256: ALPHA_SHA, title: "3.1 · alpha answers again", contract: "3.1" },
      { file: "packages/library/src/a/gamma.test.ts", sha256: GAMMA_SHA, title: "3.3 · a plain template title", contract: "3.3" },
      { file: "packages/library/src/a/gamma.test.ts", sha256: GAMMA_SHA, title: "3.4 · a title naming ${shape}", contract: "3.4" },
      { file: "packages/library/src/b/beta.test.ts", sha256: BETA_SHA, title: "beta keeps two", contract: "3.2" },
    ],
  });
});

test("11.3 · comparing a checkout with the frozen oracle finds a test whose file moved and changed, and names each frozen test it lacks by title and each contract no test of it carries", async (t) => {
  const frozen = await listOracle(checkout(t, frozenFiles));

  const moved = checkout(t, {
    "packages/library/src/a/alpha.test.ts": ALPHA,
    "packages/library/src/c/beta-moved.test.ts": `${BETA}\n`,
    "packages/library/src/c/contract.ts": CONTRACT_HELPER,
  });
  assert.deepEqual(await compareOracle(frozen, await listOracle(moved)), { missingContracts: [], missingTitles: [] });

  const withoutTwo = checkout(t, {
    "packages/library/src/a/alpha.test.ts": ALPHA,
    "packages/library/src/b/beta.test.ts": 'import { contract } from "./contract.ts";\n',
    "packages/library/src/b/contract.ts": CONTRACT_HELPER,
  });
  assert.deepEqual(await compareOracle(frozen, await listOracle(withoutTwo)), { missingContracts: ["3.2"], missingTitles: ["beta keeps two"] });

  const fewerOfOne = checkout(t, {
    "packages/library/src/a/alpha.test.ts": ['import { test } from "node:test";', "", 'test("3.1 · alpha answers", () => {});', ""].join("\n"),
    "packages/library/src/b/beta.test.ts": BETA,
    "packages/library/src/b/contract.ts": CONTRACT_HELPER,
  });
  assert.deepEqual(await compareOracle(frozen, await listOracle(fewerOfOne)), {
    missingContracts: [],
    missingTitles: ["an unnumbered check", "3.1 · alpha answers again"],
  });
});

const SERVERS = "library-pilot.test servers";

function wrappedLibrary(t) {
  const root = mkdtempSync(path.join(tmpdir(), "library-pilot-checkout-"));
  t.after(() => removeTemp(root));
  const library = path.join(root, "packages", "library");
  mkdirSync(path.join(library, "src"), { recursive: true });
  copyFileSync(path.join(repository, "packages", "library", "package.json"), path.join(library, "package.json"));
  symlinkSync(path.join(repository, "node_modules"), path.join(root, "node_modules"), "junction");
  symlinkSync(path.join(repository, "packages", "library", "node_modules"), path.join(library, "node_modules"), "junction");
  const log = path.join(root, "calls.log");
  writeFileSync(log, "");
  const real = pathToFileURL(path.join(repository, "packages", "library", "src", "index.ts")).href;
  writeFileSync(path.join(library, "src", "index.ts"), [
    'import { appendFileSync } from "node:fs";',
    `import * as real from ${JSON.stringify(real)};`,
    `export * from ${JSON.stringify(real)};`,
    `const note = (entry) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + "\\n");`,
    "export async function connect(options) {",
    "  const server = await real.connect(options);",
    `  (globalThis[Symbol.for(${JSON.stringify(SERVERS)})] ??= []).push(server);`,
    "  const open = server.openProject.bind(server);",
    "  server.openProject = async (name, ...rest) => {",
    "    note({ opened: name });",
    "    const library = await open(name, ...rest);",
    "    const define = library.defineTerm.bind(library);",
    "    const get = library.get.bind(library);",
    "    library.defineTerm = async (...args) => {",
    "      const made = await define(...args);",
    "      note({ wrote: made.id });",
    "      return made;",
    "    };",
    "    library.get = async (id, ...more) => {",
    "      const found = await get(id, ...more);",
    "      note({ read: id, found: found?.id ?? null });",
    "      return found;",
    "    };",
    "    return library;",
    "  };",
    "  return server;",
    "}",
    "",
  ].join("\n"));
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { root, calls, opened: () => calls().filter((call) => "opened" in call).map(({ opened }) => opened) };
}

async function databases(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return new Set((await client.query("SELECT datname FROM pg_database")).rows.map((row) => row.datname));
  } finally {
    await client.end();
  }
}

test("11.4 · the runtime reading opens a fresh project per run through the checkout's own library, times the open and a write read back by its id in each, summarises them, and leaves no database and no open server connection behind", { timeout: 120_000 }, async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const { root, calls, opened } = wrappedLibrary(t);
  const servers = [];
  globalThis[Symbol.for(SERVERS)] = servers;
  t.after(async () => {
    delete globalThis[Symbol.for(SERVERS)];
    await Promise.allSettled(servers.map((server) => server.close()));
  });
  const before = await databases(url);

  const reading = await readRuntime({ checkout: root, url, runs: 3 });

  const after = await databases(url);
  const projects = opened();
  assert.equal(projects.length, 3, `one project opened through the checkout's library per run, saw ${JSON.stringify(projects)}`);
  assert.equal(new Set(projects).size, 3, "each run opens a project of its own");
  for (const name of projects) {
    assert.equal(before.has(`storytree_${name}`), false, `${name} existed before the reading: it is not fresh`);
    assert.equal(after.has(`storytree_${name}`), false, `${name}'s database is left on the server`);
  }
  const written = calls().filter((call) => "wrote" in call).map(({ wrote }) => wrote);
  assert.deepEqual(
    calls(),
    projects.flatMap((name, run) => [{ opened: name }, { wrote: written[run] }, { read: written[run], found: written[run] }]),
    "each run opens its project, writes one record, then reads that record back by its id",
  );
  assert.equal(servers.length, 1, "the reading connects to the server once");
  await assert.rejects(servers[0].listProjects(), /connection is closed/, "the reading left its server connection open");

  assert.deepEqual(Object.keys(reading).sort(), ["runs", "summary"]);
  assert.equal(reading.runs.length, 3);
  for (const run of reading.runs) {
    assert.deepEqual(Object.keys(run).sort(), ["openMs", "roundTripMs"]);
    for (const value of Object.values(run)) assert.ok(Number.isFinite(value) && value > 0, `${value} is not a positive time`);
  }
  assert.deepEqual(Object.keys(reading.summary).sort(), ["openMs", "roundTripMs"]);
  for (const measure of ["openMs", "roundTripMs"]) {
    const [low, middle, high] = reading.runs.map((run) => run[measure]).sort((a, b) => a - b);
    assert.deepEqual(reading.summary[measure], { median: middle, min: low, max: high }, measure);
  }
});

test("11.4 · run from the command line, the runtime reading prints the reading of the number of runs it is asked for and exits 0, and exits 0 printing the error when it cannot reach the server", { timeout: 120_000 }, async (t) => {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const { root, opened } = wrappedLibrary(t);
  const script = path.join(import.meta.dirname, "library-pilot.mjs");
  const run = promisify(execFile);

  const { stdout } = await run(process.execPath, [script, "runtime", root, "--url", url, "--runs", "2"], { cwd: repository });
  const reading = JSON.parse(stdout);
  assert.equal(opened().length, 2, `two projects opened through the checkout's library, saw ${JSON.stringify(opened())}`);
  assert.deepEqual(Object.keys(reading).sort(), ["runs", "summary"]);
  assert.equal(reading.runs.length, 2);
  assert.deepEqual(Object.keys(reading.summary).sort(), ["openMs", "roundTripMs"]);

  const unreachable = await run(process.execPath, [script, "runtime", root, "--url", "postgres://storytree@127.0.0.1:1/postgres", "--runs", "1"], { cwd: repository });
  const failed = JSON.parse(unreachable.stdout);
  assert.deepEqual(Object.keys(failed), ["error"]);
  assert.match(failed.error, /\S/);
});
