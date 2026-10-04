/**
 * Capability 2 · The allocation rule (the Guardrails story, ADR-0911 D2): which source files of a story
 * package no numbered test reaches (ADR-0838 D5), the rule that keeps every line of code on an island
 * inside a capability's territory. A user's project runs it as `storytree check`; storytree's own dev
 * loop runs it over its checkout in every `pnpm test` (packages/dev-loop/src/allocation.mjs).
 *
 * It needs no plan: any numbered test of a package, or its coverage map (survey-coverage.json), allocates,
 * as the map's code survey reads the checkout as it stands. A test numbered for a capability the plan
 * lacks is the plan's health to report, not this rule's.
 */
import path from "node:path";

import { codeSurveyReader, type CodeSurveyReader } from "@storytree/map/code-survey";

import { storiesOf } from "../package-rule/package-rule.js";

/** Enough capabilities that every number a story's tests can carry names one. */
const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

/** A source file no numbered test reaches, repo-relative, with its lines of code. */
export interface Unallocated {
  readonly file: string;
  readonly lines: number;
}

/** Each source file of the `stories` packages (packages/<id>) at `root` that no numbered test reaches; by default, of every package under packages/. */
export async function unallocatedCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Unallocated[]> {
  const tree = { arcs: [], stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((n) => ({ id: `${id}#${n}`, title: `${n} · ${n}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree as unknown as Parameters<CodeSurveyReader["read"]>[1]);
  return Object.entries(survey).flatMap(([id, { files }]) => files.filter((file) => !file.capability)
    .map((file) => ({ file: path.posix.normalize(`packages/${id}/${file.path}`), lines: file.lines })))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** One sentence per unallocated source file, each with the three ways out; empty when every file is allocated. */
export async function allocationProblems(root: string, stories?: readonly string[]): Promise<string[]> {
  return (await unallocatedCode(root, stories)).map(({ file, lines }) =>
    `${file} (${lines} lines) belongs to no capability: no numbered test reaches it (ADR-0838 D5). Three ways out: number a test that reaches it ("N.M · …" for capability N), plan a contract for its behaviour and write that test, or delete it if nothing needs it.`);
}
