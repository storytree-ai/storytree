// Capability 10 · The allocation rule
import { readFileSync } from "node:fs";
import path from "node:path";

import { codeSurveyReader, type CodeSurveyReader, type ProjectSurvey } from "@storytree/map/code-survey";

import { storiesOf } from "../package-rule/package-rule.js";

type SurveyedFile = ProjectSurvey[string]["files"][number];

const NUMBERS = Array.from({ length: 99 }, (_, at) => at + 1);

export interface Unallocated {
  readonly file: string;
  readonly lines: number;
}

export interface Misdeclared {
  readonly file: string;
  readonly declared: number;
  readonly reachedBy: readonly number[];
}

async function surveyed(root: string, stories: readonly string[]): Promise<SurveyedFile[]> {
  const tree = { arcs: [], stories: stories.map((id) => ({ id, title: id, capabilities: NUMBERS.map((n) => ({ id: `${id}#${n}`, title: `${n} · ${n}` })) })) };
  const survey = await codeSurveyReader({ checkout: "current" }).read(root, tree as unknown as Parameters<CodeSurveyReader["read"]>[1]);
  return Object.entries(survey).flatMap(([id, { files }]) => files.map((file) => ({ ...file, path: path.posix.normalize(`packages/${id}/${file.path}`) })))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const unallocatedOf = (files: readonly SurveyedFile[]): Unallocated[] =>
  files.filter((file) => !file.capability).map((file) => ({ file: file.path, lines: file.lines }));

const misdeclaredOf = (files: readonly SurveyedFile[]): Misdeclared[] =>
  files.flatMap(({ path: file, declared, reachedBy = [] }) => declared === undefined || reachedBy.length === 0 || reachedBy.includes(declared) ? [] : [{ file, declared, reachedBy }]);

export interface Undeclared {
  readonly file: string;
  readonly suggested: number;
}

export interface AllocationOptions {
  readonly undeclaredFails?: boolean;
}

const undeclaredOf = (files: readonly SurveyedFile[]): Undeclared[] =>
  files.flatMap(({ path: file, declared, capability }) => declared !== undefined || !capability ? [] : [{ file, suggested: Number(capability.slice(capability.lastIndexOf("#") + 1)) }]);

export async function unallocatedCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Unallocated[]> {
  return unallocatedOf(await surveyed(root, stories));
}

export async function misdeclaredCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Misdeclared[]> {
  return misdeclaredOf(await surveyed(root, stories));
}

export async function undeclaredCode(root: string, stories: readonly string[] = storiesOf(root)): Promise<Undeclared[]> {
  return undeclaredOf(await surveyed(root, stories));
}

function remeasure(root: string, file: string): string {
  const [, id = "", ...rest] = file.split("/");
  let map: Record<string, unknown>;
  try {
    map = JSON.parse(readFileSync(path.join(root, "packages", id, "survey-coverage.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return "";
  }
  return Object.hasOwn(map, rest.join("/")) ? "" : ` Or, if a test reaches it only through a process it starts, re-measure ${id}'s coverage map, which has no entry for it: pnpm survey:coverage ${id}. That re-measure counts Node processes, and a browser proof only once it records its coverage, so a file only a browser proof reaches enters the map after that proof calls recordBrowserCoverage (@storytree/repo-checks/coverage-map) as it passes.`;
}

export async function allocationProblems(root: string, stories: readonly string[] = storiesOf(root), options: AllocationOptions = {}): Promise<string[]> {
  const files = await surveyed(root, stories);
  return [
    ...unallocatedOf(files).map(({ file, lines }) =>
      `${file} (${lines} lines) belongs to no capability: no numbered test reaches it (ADR-0838 D5). Three ways out: number a test that reaches it ("N.M · …" for capability N), plan a contract for its behaviour and write that test, or delete it if nothing needs it.${remeasure(root, file)}`),
    ...misdeclaredOf(files).map(({ file, declared, reachedBy }) =>
      `${file} declares capability ${declared} in its opening comment, but no numbered test of capability ${declared} reaches it (ADR-0925 D2). The capabilities whose tests reach it: ${reachedBy.join(", ")}. Declare one of those, or number a test of capability ${declared} that reaches it.${remeasure(root, file)}`),
    ...(options.undeclaredFails ? undeclaredOf(files) : []).map(({ file, suggested }) =>
      `${file} declares no capability (ADR-0925 D2). Begin its opening comment with "Capability ${suggested} · <title>", the capability the survey infers for it, or another whose numbered tests reach it.`),
  ];
}
