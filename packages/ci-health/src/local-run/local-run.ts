/**
 * Capability 5 · A project's own tests, run locally (ADR-1193 D1, D2: the health ladder's local rung; ADR-1194). A project with no
 * CI storytree can read, perhaps with no repository at all, has its own tests run here: its package.json `test` script,
 * through a shell, in the project's folder, its output read as a CI log is (parseTestLog), each numbered test tied to its
 * contract as a CI run's are (proofsAt, judgeRun) over the folder's files as they stand, and its verdicts written to the
 * verified column by "a local test run", with the folder's commit in each note when it is a git repository.
 * - A project whose CI storytree reads (a GitHub origin and a workflow under .github/workflows) is read from its CI
 *   (`health ci`, ADR-0901) and never written by a local run: the newest CI verdict is of the merged tree, a local run's
 *   of whatever the folder holds, so a local run writes nothing there and says so (ADR-1194 D2).
 * - A project with no package.json, no test command, or whose run reported no results writes nothing and says why.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Library } from "@storytree/library";

import { commitOf, filesIn, runTests, type RunTests } from "../plugin-run/plugin-run.js";
import { gitIn, repositoryOf } from "../read-ci/read-ci.js";
import { recordHealth } from "../read-ci/record.js";
import { parseTestLog } from "../run-results/run-results.js";
import { judgeRun, proofsAt, type Verdict } from "../verdicts/verdicts.js";

/** Who writes a verdict from a local run of a project's own tests. */
export const VERIFIED_BY_LOCAL_RUN = "a local test run";

export type LocalReading =
  | { written: false; why: string }
  | { written: true; commit?: string; tests: number; unmatched: number; passing: number; failing: number; notChecked: number };

/** The GitHub repository whose CI storytree reads for `folder`: its origin's, when the folder holds a workflow; else undefined. */
async function ciOf(folder: string): Promise<string | undefined> {
  const workflows = path.join(folder, ".github", "workflows");
  if (!existsSync(workflows) || !readdirSync(workflows).some((file) => /\.ya?ml$/.test(file))) return undefined;
  return repositoryOf(await gitIn(folder)(["remote", "get-url", "origin"]).catch(() => ""));
}

/** Run the project in `folder`'s own tests and write their verdicts to its stories' verified health, as a local run. */
export async function recordLocalTests({ library, folder, run = runTests }: { library: Library; folder: string; run?: RunTests }): Promise<LocalReading> {
  const manifest = path.join(folder, "package.json");
  if (!existsSync(manifest)) return { written: false, why: `This project's folder (${folder}) has no package.json, so storytree has no test command of it to run; nothing was written.` };
  const command: unknown = JSON.parse(readFileSync(manifest, "utf8")).scripts?.test;
  if (typeof command !== "string" || command.trim() === "") return { written: false, why: `This project has no test command (a "test" script in its package.json), so storytree has no tests of it to run; nothing was written.` };
  const repository = await ciOf(folder);
  if (repository !== undefined) return { written: false, why: `This project's tests run in ${repository}'s CI, so its verified health is read from there: run storytree health ci. A local run writes nothing over it.` };

  const proofs = proofsAt(await library.projectTree(), filesIn(folder));
  const results = parseTestLog(await run(command, folder));
  if (results.length === 0) return { written: false, why: `This project's test command (${command}) reported no test results storytree can read (node --test's output); nothing was written.` };
  const { verdicts, unmatched } = judgeRun(proofs, results);
  const commit = await commitOf(folder);
  const tested = new Map<string, Verdict>([...verdicts].filter(([, { total }]) => total > 0));
  const written = await recordHealth(library, new Map([...tested.keys()].map((id) => [id, id])), tested, { by: VERIFIED_BY_LOCAL_RUN, source: "local", ...(commit === undefined ? {} : { commit: commit.slice(0, 12) }) });
  const notChecked = [...tested.values()].filter(({ state }) => state === "not-checked").length;
  return { written: true, ...(commit === undefined ? {} : { commit }), tests: results.length, unmatched: unmatched.length, passing: written.passing, failing: written.failing, notChecked };
}
