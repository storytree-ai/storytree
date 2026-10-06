/**
 * Capability 2 · The allocation rule (the Guardrails story, ADR-0911 D2): which source files of a story
 * package no numbered test reaches (ADR-0838 D5), the rule that keeps every line of code on an island
 * inside a capability's territory. A user's project runs it as `storytree check`; storytree's own dev
 * loop runs it over its checkout in every `pnpm test` (packages/dev-loop/src/allocation.mjs).
 *
 * It needs no plan: any numbered test of a package, or its coverage map (survey-coverage.json), allocates,
 * as the map's code survey reads the checkout as it stands. A test numbered for a capability the plan
 * lacks is the plan's health to report, not this rule's.
 *
 * A source file that declares its capability in its opening comment ("Capability N · <title>", ADR-0925 D1)
 * is checked against the same reach (D2): it fails when capability N's numbered tests and coverage map do not
 * reach it while another's do, named with the capabilities that do.
 */
import path from "node:path";

import { codeSurveyReader, type CodeSurveyReader, type ProjectSurvey } from "@storytree/map/code-survey";

import { storiesOf } from "../package-rule/package-rule.js";

type SurveyedFile = ProjectSurvey[string]["files"][number];

/** Enough capabilities that every number a story's tests can carry names one. */
const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

/** A source file no numbered test reaches, repo-relative, with its lines of code. */
export interface Unallocated {
  readonly file: string;
  readonly lines: number;
}

/** A source file declaring capability `declared`, which only the capabilities `reachedBy` reach, repo-relative. */
export interface Misdeclared {
  readonly file: string;
  readonly declared: number;
  readonly reachedBy: readonly number[];
}

/** The source files of the `stories` packages at `root` as the code survey allocates them, repo-relative. */
async function surveyed(root: string, stories: readonly string[]): Promise<SurveyedFile[]> {
  const tree = { arcs: [], stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((n) => ({ id: `${id}#${n}`, title: `${n} · ${n}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree as unknown as Parameters<CodeSurveyReader["read"]>[1]);
  return Object.entries(survey).flatMap(([id, { files }]) => files.map((file) => ({ ...file, path: path.posix.normalize(`packages/${id}/${file.path}`) })))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const unallocatedOf = (files: readonly SurveyedFile[]): Unallocated[] =>
  files.filter((file) => !file.capability).map((file) => ({ file: file.path, lines: file.lines }));

/** A declared file another capability's tests reach, but not its own; a file nothing reaches is unallocated instead. */
const misdeclaredOf = (files: readonly SurveyedFile[]): Misdeclared[] =>
  files.flatMap(({ path: file, declared, reachedBy = [] }) => declared === undefined || reachedBy.length === 0 || reachedBy.includes(declared) ? [] : [{ file, declared, reachedBy }]);

/** Each source file of the `stories` packages (packages/<id>) at `root` that no numbered test reaches; by default, of every package under packages/. */
export async function unallocatedCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Unallocated[]> {
  return unallocatedOf(await surveyed(root, stories));
}

/** Each source file of the `stories` packages at `root` whose declared capability's numbered tests do not reach it (ADR-0925 D2). */
export async function misdeclaredCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Misdeclared[]> {
  return misdeclaredOf(await surveyed(root, stories));
}

/** One sentence per unallocated or misdeclared source file, each with its ways out; empty when every file is allocated as it says. */
export async function allocationProblems(root: string, stories: readonly string[] = storiesOf(root)): Promise<string[]> {
  const files = await surveyed(root, stories);
  return [
    ...unallocatedOf(files).map(({ file, lines }) =>
      `${file} (${lines} lines) belongs to no capability: no numbered test reaches it (ADR-0838 D5). Three ways out: number a test that reaches it ("N.M · …" for capability N), plan a contract for its behaviour and write that test, or delete it if nothing needs it.`),
    ...misdeclaredOf(files).map(({ file, declared, reachedBy }) =>
      `${file} declares capability ${declared} in its opening comment, but no numbered test of capability ${declared} reaches it (ADR-0925 D2). The capabilities whose tests reach it: ${reachedBy.join(", ")}. Declare one of those, or number a test of capability ${declared} that reaches it.`),
  ];
}
