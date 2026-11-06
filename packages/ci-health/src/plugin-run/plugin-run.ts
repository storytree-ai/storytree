/**
 * Capability 4 · A factory plugin's own tests. A user's factory plugin has no CI storytree can read (ADR-0902 reads a
 * project's CI and never runs the tests), so its own tests are run here instead: the plugin's package.json `test` script,
 * through a shell, in the plugin's folder of this computer's factory, its output read as a CI log is (parseTestLog), each
 * numbered test tied to its contract as a CI run's are (proofsAt, judgeRun), and its verdicts written to the verified
 * column of the stories whose package that plugin is (packageOf names the plugin's folder), with the factory's commit in
 * each note when it is a git repository.
 * - The plugin's files are read as the files of a package of that name (`packages/<plugin>/…`), so a story's tests are
 *   found where the map finds them in a project.
 * - A plugin missing, with no test command, with no story, or whose run reported no results writes nothing and says why.
 * - A run re-runs only its own platform's tests: a `platform:<os>` skip of another platform leaves that contract's earlier
 *   pass standing (4.2), so the Mint box keeps the laptop's Windows-only passes and the laptop the box's Linux-only ones.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { Library } from "@storytree/library";

import { parseTestLog } from "../run-results/run-results.js";
import { recordHealth, type RecordedVerdict } from "../read-ci/record.js";
import { judgeRun, proofsAt, type Verdict } from "../verdicts/verdicts.js";

/** Who writes a verdict from a run of a factory plugin's own tests. */
export const VERIFIED_BY_PLUGIN_TESTS = "factory plugin's tests";

export type PluginReading =
  | { written: false; why: string }
  | { written: true; commit?: string; tests: number; unmatched: number; passing: number; failing: number; notChecked: number };

/** A run of a plugin's test command in `folder`: what it printed, read whatever its exit code, and that code. */
export type RunTests = (command: string, folder: string) => Promise<{ output: string; code: number | null }>;

/** The plugin's test command run through a shell in its folder, without the test runner's context of any run around it. */
export const runTests: RunTests = (command, folder) =>
  new Promise((resolve, reject) => {
    // A run started from inside a test would otherwise report to that test's runner, printing nothing to read.
    const { NODE_TEST_CONTEXT: _, ...env } = process.env;
    const child = spawn(command, { cwd: folder, shell: true, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ output, code }));
  });

/** Folders whose files are never a project's own: installed packages, virtual environments, caches and git's. */
const NOT_OWN = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", ".tox"]);

/** Each code file in `folder` (JavaScript, TypeScript or Python), outside installed packages, virtual environments and .git, by its path from `folder` with `/` between folders, after `prefix`. */
export function filesIn(folder: string, prefix = ""): { path: string; text: string }[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]sx?|py)$/.test(entry.name))
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .filter((file) => !file.split(path.sep).some((part) => NOT_OWN.has(part)))
    .map((file) => ({ path: `${prefix}${file.split(path.sep).join("/")}`, text: readFileSync(path.join(folder, file), "utf8") }));
}

/** The checked-out commit of `folder`, or undefined when it is not a git repository. */
export async function commitOf(folder: string): Promise<string | undefined> {
  try {
    return (await promisify(execFile)("git", ["-C", folder, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true })).stdout.trim();
  } catch {
    return undefined;
  }
}

/** Run plugin `plugin`'s own tests in factory folder `factory`, on `platform` (this computer's), and write their verdicts to its stories' verified health. */
export async function recordPluginTests({ library, factory, plugin, run = runTests, platform = process.platform }: { library: Library; factory: string; plugin: string; run?: RunTests; platform?: NodeJS.Platform }): Promise<PluginReading> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin)) return { written: false, why: `${JSON.stringify(plugin)} is not a plugin's name: use lower-case letters, digits and dashes.` };
  const folder = path.join(factory, "plugins", plugin);
  const manifest = path.join(folder, "package.json");
  if (!existsSync(manifest)) return { written: false, why: `This computer's factory (${factory}) has no plugin called ${plugin}.` };
  const command: unknown = JSON.parse(readFileSync(manifest, "utf8")).scripts?.test;
  if (typeof command !== "string" || command.trim() === "") return { written: false, why: `${plugin} has no test command (a "test" script in its package.json), so storytree has no tests of it to run; nothing was written.` };

  const files = filesIn(folder, `packages/${plugin}/`);
  const proofs = proofsAt(await library.projectTree(), files).filter(({ packages }) => packages.includes(plugin));
  if (proofs.length === 0) return { written: false, why: `No story in this project has ${plugin} as its package (a story of that plugin, or titled ${JSON.stringify(plugin)}), so its tests prove no contract here; nothing was written.` };

  const results = parseTestLog((await run(command, folder)).output);
  if (results.length === 0) return { written: false, why: `${plugin}'s test command (${command}) reported no test results storytree can read (node --test's output); nothing was written.` };
  const { verdicts, unmatched } = judgeRun(proofs, results);
  const commit = await commitOf(factory);
  // A skip for another platform than this run's was never this run's to reach, so a pass from that platform stands.
  const unrun = ({ skip }: Verdict) => /^platform:/.test(skip ?? "") && skip !== `platform:${platform}`;
  const tested = new Map<string, Verdict & RecordedVerdict>(
    [...verdicts].filter(([, { total }]) => total > 0).map(([id, verdict]) => [id, verdict.state === "not-checked" && unrun(verdict) ? { ...verdict, unrun: true } : verdict]),
  );
  const written = await recordHealth(library, new Map([...tested.keys()].map((id) => [id, id])), tested, { by: VERIFIED_BY_PLUGIN_TESTS, source: "local", ...(commit === undefined ? {} : { commit: commit.slice(0, 12) }) });
  const notChecked = [...tested.values()].filter(({ state }) => state === "not-checked").length;
  return { written: true, ...(commit === undefined ? {} : { commit }), tests: results.length, unmatched: unmatched.length, passing: written.passing, failing: written.failing, notChecked };
}
