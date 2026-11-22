// Capability 5 · A project's own tests, run locally.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AnnotatedTree, Library } from "@storytree/library";

import { commitOf, filesIn, runTests, type RunTests } from "../plugin-run/plugin-run.js";
import { recordHealth, recordUnclaimed } from "../read-ci/record.js";
import { parseTestLog } from "../run-results/run-results.js";
import { judgeRun, proofsAt, unclaimedVerdicts, type Verdict } from "../verdicts/verdicts.js";

export const VERIFIED_BY_LOCAL_RUN = "a local test run";

export type LocalReading =
  | { written: false; why: string; unread?: true }
  | { written: true; command: string; commit?: string; tests: number; unmatched: number; passing: number; failing: number; notChecked: number; red: RedCapability[] };

export interface RedCapability {
  id: string;
  title: string;
}

function readByCi(tree: AnnotatedTree): boolean {
  return tree.stories.some(({ capabilities, edges }) =>
    capabilities.some(({ contracts, unclaimed }) => unclaimed?.source === "ci" || contracts.some(({ health }) => health.ci !== undefined)) ||
    (edges ?? []).some(({ contracts }) => contracts.some(({ health }) => health.ci !== undefined)));
}

const PYTHON_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py"];
const PYTHON_RUNNERS: [lockfile: string, runner: string][] = [["uv.lock", "uv run "], ["poetry.lock", "poetry run "]];

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

const NOT_FOUND = new Set([127, 9009]);
const CMD_NOT_FOUND = /is not recognized as an internal or external command/;

function unreadWhy(command: string, reads: string, output: string, code: number | null): string {
  const last = output.trimEnd().split(/\r?\n/).slice(-10).map((line) => `  ${line}`).join("\n");
  const printed = last.trim() === "" ? "It printed nothing." : `It printed:\n${last}`;
  const runner = command.trim().split(/\s+/)[0];
  const said = (code !== null && NOT_FOUND.has(code)) || CMD_NOT_FOUND.test(output)
    ? `This project's test command (${command}) could not be started: ${runner} is not a command this computer's shell can find (is it on PATH?). ${printed}`
    : `This project's test command (${command}) reported no test results storytree can read (${reads}). ${printed}`;
  return `${said}\nNothing was verified or written.`;
}

export async function recordLocalTests({ library, folder, run = runTests }: { library: Library; folder: string; run?: RunTests }): Promise<LocalReading> {
  const tests = testCommandOf(folder);
  if ("why" in tests) return { written: false, why: tests.why };
  const { command, reads } = tests;
  const tree = await library.projectTree();
  if (readByCi(tree)) return { written: false, why: "This project's tests run in its CI, and storytree holds CI's reading of them, so its verified health is read from there: run storytree health ci. A local run writes nothing over it." };

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
  const red = (await library.projectTree()).stories
    .filter(({ mapped }) => mapped !== undefined)
    .flatMap(({ capabilities }) => capabilities.filter(({ health }) => health.verified.state === "failing").map(({ id, title }) => ({ id, title })));
  return { written: true, command, ...(commit === undefined ? {} : { commit }), tests: results.length, unmatched: unmatched.length, passing: written.passing, failing: written.failing, notChecked, red };
}

export function localReadingText(read: Extract<LocalReading, { written: true }>): string {
  const counts = `Ran this project's ${read.tests} tests locally by \`${read.command}\`${read.commit === undefined ? "" : ` (commit ${read.commit.slice(0, 12)})`}: ${read.passing} contracts verified passing, ${read.failing} failing, ${read.notChecked} not checked` +
    `${read.unmatched === 0 ? "." : `; ${read.unmatched} results named no contract of one story.`}`;
  if (read.red.length === 0) return counts;
  const named = read.red.map(({ id, title }) => `"${title}" (${id})`).join(", ");
  return `${counts}\nRed on the imported code: ${named}. Plan one arc for it: an increment that fixes each, its capabilities list naming that capability, so selecting the arc rings exactly them, and the user's own requests as increments on the same arc. Ask the user before changing the imported code.`;
}
