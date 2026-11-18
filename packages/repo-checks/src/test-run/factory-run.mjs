// Capability 7 · Own health

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkStory } from "./record-run.mjs";
import { parseJunit, packageOf } from "./test-run.mjs";

export const VERIFIED_BY_FACTORY = "factory test run";

export function factoryPlugins(stories, factory) {
  return stories
    .map((story) => ({ story, folder: `plugins/${story.plugin ?? packageOf(story)}` }))
    .filter(({ folder }) => existsSync(path.join(factory, folder, "package.json")));
}

export function factoryArgument(args, chosen) {
  const at = args.indexOf("--factory");
  if (at === -1) return undefined;
  const named = args[at + 1];
  return { folder: path.resolve(named === undefined || named.startsWith("--") ? chosen() : named), unrecorded: args.includes("--unrecorded") };
}

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

export function recordedAt(story, commit) {
  return story.capabilities.some((capability) =>
    capability.contracts.some(({ health: { verified } }) => verified.by === VERIFIED_BY_FACTORY && (verified.note ?? "").includes(` at commit ${commit}`)),
  );
}

export function factoryCommit(factory) {
  const head = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const commit = head(factory);
  const storytree = path.join(factory, "storytree");
  if (!existsSync(path.join(storytree, ".git"))) return commit;
  return `${commit} with storytree ${head(storytree)}`;
}

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
