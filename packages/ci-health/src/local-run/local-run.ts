/**
 * Capability 5 · A project's own tests, run locally (ADR-1193 D1, D2: the health ladder's local rung; ADR-1194). A project with no
 * CI storytree can read, perhaps with no repository at all, has its own tests run here: its package.json `test` script,
 * through a shell, in the project's folder, its output read as a CI log is (parseTestLog), each numbered test tied to its
 * contract as a CI run's are (proofsAt, judgeRun) over the folder's files as they stand, and its verdicts written to the
 * verified column by "a local test run", with the folder's commit in each note when it is a git repository.
 * - A project whose CI storytree reads (a GitHub origin and a workflow under .github/workflows) is read from its CI
 *   (`health ci`, ADR-0901) and never written by a local run: the newest CI verdict is of the merged tree, a local run's
 *   of whatever the folder holds, so a local run writes nothing there and says so (ADR-1194 D2).
 * - A Python project (a pyproject.toml, setup.cfg or setup.py, and no package.json test command) has its tests run by
 *   `pytest -rA`, whose short test summary is what a CI log of it is read by, through `uv run` or `poetry run` when its
 *   lockfile is uv's or Poetry's; its .py files are read beside its JS and TS, as reading its CI reads them. A uv project
 *   whose .venv already exists runs `uv run --no-sync`, so the environment its user built is tested as it stands, with
 *   nothing added or removed from uv.lock; with no .venv yet, `uv run` makes it.
 * - A project with no test command (neither), or whose run reported no results, writes nothing and says why; a run with
 *   no results says what it printed, or that its runner could not be started, and `health local` then fails (5.5).
 * - The tests no contract claims colour the explored capabilities their files reach (ADR-1274 D3, unclaimedVerdicts): each
 *   reached capability's own reading is written, and one no such test reaches any more turns not checked (5.6).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Library } from "@storytree/library";

import { commitOf, filesIn, runTests, type RunTests } from "../plugin-run/plugin-run.js";
import { gitIn, repositoryOf } from "../read-ci/read-ci.js";
import { recordHealth, recordUnclaimed } from "../read-ci/record.js";
import { parseTestLog } from "../run-results/run-results.js";
import { judgeRun, proofsAt, unclaimedVerdicts, type Verdict } from "../verdicts/verdicts.js";

/** Who writes a verdict from a local run of a project's own tests. */
export const VERIFIED_BY_LOCAL_RUN = "a local test run";

export type LocalReading =
  | { written: false; why: string; unread?: true }
  | { written: true; command: string; commit?: string; tests: number; unmatched: number; passing: number; failing: number; notChecked: number };

/** The GitHub repository whose CI storytree reads for `folder`: its origin's, when the folder holds a workflow; else undefined. */
async function ciOf(folder: string): Promise<string | undefined> {
  const workflows = path.join(folder, ".github", "workflows");
  if (!existsSync(workflows) || !readdirSync(workflows).some((file) => /\.ya?ml$/.test(file))) return undefined;
  return repositoryOf(await gitIn(folder)(["remote", "get-url", "origin"]).catch(() => ""));
}

/** The files that make `folder` a Python project, and the lockfiles that name the runner its pytest runs through. */
const PYTHON_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py"];
const PYTHON_RUNNERS: [lockfile: string, runner: string][] = [["uv.lock", "uv run "], ["poetry.lock", "poetry run "]];

/** The project in `folder`'s test command and the output storytree reads of it, or why it has none. */
function testCommandOf(folder: string): { command: string; reads: string } | { why: string } {
  const manifest = path.join(folder, "package.json");
  const script: unknown = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).scripts?.test : undefined;
  if (typeof script === "string" && script.trim() !== "") return { command: script, reads: "node --test's output" };
  if (PYTHON_MANIFESTS.some((file) => existsSync(path.join(folder, file)))) {
    let runner = PYTHON_RUNNERS.find(([lockfile]) => existsSync(path.join(folder, lockfile)))?.[1] ?? "";
    if (runner === "uv run " && existsSync(path.join(folder, ".venv"))) runner = "uv run --no-sync ";
    return { command: `${runner}pytest -rA`, reads: "pytest -rA's short test summary" };
  }
  if (!existsSync(manifest)) return { why: `This project's folder (${folder}) has no package.json and no pyproject.toml, so storytree has no test command of it to run; nothing was written.` };
  return { why: `This project has no test command (a "test" script in its package.json), so storytree has no tests of it to run; nothing was written.` };
}

/** The exit codes a shell gives a command it cannot find: sh's 127, cmd.exe's 9009. */
const NOT_FOUND = new Set([127, 9009]);
/** What cmd.exe prints for a command it cannot find, since `cmd /c` may exit 1 instead of 9009. */
const CMD_NOT_FOUND = /is not recognized as an internal or external command/;

/** Why a run of `command` that reported no results storytree reads wrote nothing: that its runner could not be started, or its last lines. */
function unreadWhy(command: string, reads: string, output: string, code: number | null): string {
  const last = output.trimEnd().split(/\r?\n/).slice(-10).map((line) => `  ${line}`).join("\n");
  const printed = last.trim() === "" ? "It printed nothing." : `It printed:\n${last}`;
  const runner = command.trim().split(/\s+/)[0];
  const said = (code !== null && NOT_FOUND.has(code)) || CMD_NOT_FOUND.test(output)
    ? `This project's test command (${command}) could not be started: ${runner} is not a command this computer's shell can find (is it on PATH?). ${printed}`
    : `This project's test command (${command}) reported no test results storytree can read (${reads}). ${printed}`;
  return `${said}\nNothing was verified or written.`;
}

/** Run the project in `folder`'s own tests and write their verdicts to its stories' verified health, as a local run. */
export async function recordLocalTests({ library, folder, run = runTests }: { library: Library; folder: string; run?: RunTests }): Promise<LocalReading> {
  const tests = testCommandOf(folder);
  if ("why" in tests) return { written: false, why: tests.why };
  const { command, reads } = tests;
  const repository = await ciOf(folder);
  if (repository !== undefined) return { written: false, why: `This project's tests run in ${repository}'s CI, so its verified health is read from there: run storytree health ci. A local run writes nothing over it.` };

  const tree = await library.projectTree();
  const files = filesIn(folder);
  const proofs = proofsAt(tree, files);
  const { output, code } = await run(command, folder);
  const results = parseTestLog(output);
  if (results.length === 0) return { written: false, unread: true, why: unreadWhy(command, reads, output, code) };
  const { verdicts, unmatched } = judgeRun(proofs, results);
  const commit = await commitOf(folder);
  const tested = new Map<string, Verdict>([...verdicts].filter(([, { total }]) => total > 0));
  const writer = { by: VERIFIED_BY_LOCAL_RUN, source: "local" as const, ...(commit === undefined ? {} : { commit: commit.slice(0, 12) }) };
  const written = await recordHealth(library, new Map([...tested.keys()].map((id) => [id, id])), tested, writer);
  await recordUnclaimed(library, tree, await unclaimedVerdicts(tree, files, unmatched), writer);
  const notChecked = [...tested.values()].filter(({ state }) => state === "not-checked").length;
  return { written: true, command, ...(commit === undefined ? {} : { commit }), tests: results.length, unmatched: unmatched.length, passing: written.passing, failing: written.failing, notChecked };
}
