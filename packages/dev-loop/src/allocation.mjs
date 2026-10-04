// Which source files of a story package no numbered test reaches (ADR-0838 D5): the guardrail that keeps
// every line of code on an island inside a capability's territory. packages/dev-loop/src/allocation.test.mjs
// runs it over the checkout in every `pnpm test`, and so in CI.
//
// The plan lives in the library, which CI cannot read, so the story packages are those the dev loop
// declares (STORIES, as the package-boundary check takes them), and any numbered test of a package, or its
// coverage map (survey-coverage.json), allocates: the map's code survey runs over this checkout as it stands.
// A test numbered for a capability the plan lacks is own health's to report, not this check's.

import path from "node:path";
import { codeSurveyReader } from "@storytree/map/code-survey";
import { STORIES } from "./package-boundaries.mjs";

/** Enough capabilities that every number a story's tests can carry names one. */
const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

/** Each source file of the `stories` packages (packages/<id>) at `root` that no numbered test reaches, repo-relative, with its lines. */
export async function unallocatedCode(root, stories = STORIES) {
  const tree = { arcs: [], stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((n) => ({ id: `${id}#${n}`, title: `${n} · ${n}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree);
  return Object.entries(survey).flatMap(([id, { files }]) => files.filter((file) => !file.capability)
    .map((file) => ({ file: path.posix.normalize(`packages/${id}/${file.path}`), lines: file.lines })))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** One sentence per unallocated source file, each with the three ways out; empty when every file is allocated. */
export async function allocationProblems(root, stories = STORIES) {
  return (await unallocatedCode(root, stories)).map(({ file, lines }) =>
    `${file} (${lines} lines) belongs to no capability: no numbered test reaches it (ADR-0838 D5). Three ways out: number a test that reaches it ("N.M · …" for capability N), plan a contract for its behaviour and write that test, or delete it if nothing needs it.`);
}
