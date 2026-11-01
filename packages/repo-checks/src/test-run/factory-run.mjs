// Capability 7 · Own health. A story whose code is a plugin in the owner's factory (ADR-1174: voice, in
// HuaMick/storytree-factory's plugins/voice) is proved by the factory's tests, which storytree's CI never sees. This is
// the run configured for a factory: each story whose package names a plugin folder there (plugins/<name>, holding a
// package.json) has that folder's tests run by the factory's own test command (`node --import tsx scripts/test.mjs
// plugins/<name>`, its throwaway Postgres and all), read back from their junit report, and recorded as the story's
// verified health by record-run.mjs's rules, with the factory's commit in each note.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkStory } from "./record-run.mjs";
import { parseJunit, packageOf } from "./test-run.mjs";

/** Who writes a factory run's verified health: the factory's own tests, run and read by storytree. */
export const VERIFIED_BY_FACTORY = "factory test run";

/**
 * The stories of `stories` whose code is a plugin in `factory`: each one whose plugin (a plugin's own story, ADR-1187),
 * else whose package (packageOf), is a folder under its plugins/ holding a package.json, with that folder relative to the factory.
 * @template {{ id: string, title: string, plugin?: string }} S
 * @param {readonly S[]} stories
 * @param {string} factory
 * @returns {{ story: S, folder: string }[]}
 */
export function factoryPlugins(stories, factory) {
  return stories
    .map((story) => ({ story, folder: `plugins/${story.plugin ?? packageOf(story)}` }))
    .filter(({ folder }) => existsSync(path.join(factory, folder, "package.json")));
}

/**
 * The factory run a command line asks for: the folder after `--factory`, else `chosen()` (this computer's factory
 * setting) when `--factory` ends it, and whether `--unrecorded` asks to skip what is already recorded at its commit;
 * undefined, so storytree's own stories are recorded, without `--factory`.
 * @param {readonly string[]} args
 * @param {() => string} chosen
 * @returns {{ folder: string, unrecorded: boolean } | undefined}
 */
export function factoryArgument(args, chosen) {
  const at = args.indexOf("--factory");
  if (at === -1) return undefined;
  const named = args[at + 1];
  return { folder: path.resolve(named === undefined || named.startsWith("--") ? chosen() : named), unrecorded: args.includes("--unrecorded") };
}

/**
 * Record each of `stories` whose code is a plugin in `factory` (factoryPlugins) from a run of its plugin's tests
 * (`runTests(folder)`, by default the factory's own test command with `env`), as a factory test run at the factory's
 * commit. Exit code 1 if no plugin is a story's package (the commit is left unrecorded, so the Mint box's timer never
 * reports it recorded) or any run produced no report, else 0. The factory is taken at its real path, since the report
 * names each test file by it: one reached through a link (macOS's temp folder, /var under /private/var) would match none.
 * With `unrecorded`, a plugin whose story already holds a factory run's entry at that commit (recordedAt) is skipped,
 * so the Mint box's timer (packages/repo-checks/box/factory-health.sh) runs the tests once per factory commit.
 * @param {import("@storytree/library").Library} library
 * @param {readonly import("@storytree/library").AnnotatedStory[]} stories
 * @param {string} factory
 * @param {{ unrecorded?: boolean, env?: Record<string, string | undefined>, runTests?: (folder: string) => Promise<{ code: number, results?: import("./test-run.mjs").TestResult[] }>, log?: (line: string) => void, error?: (line: string) => void }} [options]
 */
export async function recordFactory(library, stories, linked, { unrecorded = false, env = process.env, runTests = (folder) => runFactoryTests(linked, folder, env), log = (line) => console.log(line), error = (line) => console.error(line) } = {}) {
  const factory = realpathSync(linked);
  const writer = { by: VERIFIED_BY_FACTORY, source: "local", commit: factoryCommit(factory) };
  const plugins = factoryPlugins(stories, factory);
  if (plugins.length === 0) {
    error(`the factory at ${factory}, commit ${writer.commit}: no plugin is a story's package, so nothing is recorded and the commit stays unrecorded`);
    return 1;
  }
  log(`the factory at ${factory}, commit ${writer.commit}: ${plugins.map(({ folder }) => folder).join(", ")}`);
  let code = 0;
  for (const { story, folder } of plugins) {
    if (unrecorded && recordedAt(story, writer.commit)) {
      log(`\n"${story.title}" (${folder}) is already recorded at commit ${writer.commit}, so its tests are not run again.`);
      continue;
    }
    if (!(await checkStory(library, story, writer, { root: factory, folders: [folder], runTests: () => runTests(folder), log, error }))) code = 1;
  }
  return code;
}

/**
 * Whether `story` already holds a factory run's verified entry at `commit`: any of its contracts written by a factory
 * test run with that commit in its note (record.ts's seenAt writes " at commit <sha>").
 * @param {import("@storytree/library").AnnotatedStory} story
 * @param {string} commit
 */
export function recordedAt(story, commit) {
  return story.capabilities.some((capability) =>
    capability.contracts.some(({ health: { verified } }) => verified.by === VERIFIED_BY_FACTORY && (verified.note ?? "").includes(` at commit ${commit}`)),
  );
}

/** The factory's checked-out commit, for each note its run writes. */
export function factoryCommit(factory) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: factory, encoding: "utf8" }).trim();
}

/**
 * Run the tests of the plugin in `folder` through `factory`'s own test command, reading their junit report: Node's
 * junit reporter is asked for through NODE_OPTIONS, since the factory's script passes on no flags of its own; its
 * report's path is escaped there, since NODE_OPTIONS reads a backslash in quotes as an escape (Windows' separator).
 * `env` is what the tests run with, less NODE_TEST_CONTEXT: a run started from inside a test would otherwise report to
 * that test's runner instead of writing its report.
 * @param {string} factory
 * @param {string} folder
 * @param {Record<string, string | undefined>} env
 */
export async function runFactoryTests(factory, folder, env) {
  const work = mkdtempSync(path.join(tmpdir(), "storytree-factory-health-"));
  const report = path.join(work, "tests.xml");
  try {
    const { NODE_TEST_CONTEXT: _, ...own } = env;
    const options = [env.NODE_OPTIONS, "--test-reporter=junit", `--test-reporter-destination="${report.replace(/[\\"]/g, "\\$&")}"`].filter(Boolean).join(" ");
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "test.mjs"), folder], {
        cwd: factory,
        stdio: "inherit",
        env: { ...own, NODE_OPTIONS: options },
      });
      child.on("error", reject);
      child.on("exit", (exitCode) => resolve(exitCode ?? 1));
    });
    const xml = existsSync(report) ? readFileSync(report, "utf8") : "";
    return { code, results: xml.includes("<testsuites") ? parseJunit(xml) : undefined };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
