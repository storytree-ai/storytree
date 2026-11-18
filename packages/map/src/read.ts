// Capability 3 · Counts before detail
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { affectedProject, changedOnMain, namedOnMain, type AffectedOptions } from "./affected.js";
import type { AnnotatedTree, HealthWorkItem, Library } from "@storytree/library";
import { readFile } from "node:fs/promises";
import { codeSurveyReader, surveyCodeName, type ImportedFolder } from "./code-survey/read-survey.js";
import { pinWorldOf, type PinWorld } from "./pins/pins.js";
import { buildGraph, type ProjectGraph } from "./graph.js";
import { focus, formatFocus, type FocusAnswer, type FocusOptions } from "./focus.js";
import { crossingsOf, formatCrossing, type CrossingAnswer, type CrossingOptions } from "./code-survey/crossings.js";
import { formatLinks, linksOf, type LinksAnswer } from "./code-survey/links.js";
import { capabilityTreeOf, formatCapabilityTree, type CapabilityTree } from "./capability-tree.js";

type PlanReader = Pick<Library, "projectTree">;

const current = codeSurveyReader({ checkout: "current", codeName: () => surveyCodeName() });

export function incrementOfBranch(branch: string | undefined): string | undefined {
  const named = /(?:^|[/_-])increment[-_]([0-9a-f]{12})(?![0-9a-f])/i.exec(branch ?? "");
  return named === null ? undefined : `increment_${named[1]!.toLowerCase()}`;
}

function branchAt(folder: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: folder }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
}

function topOf(folder: string): Promise<string> {
  return new Promise(resolve => {
    execFile("git", ["rev-parse", "--show-toplevel"], { cwd: folder }, (error, stdout) => resolve(error ? folder : stdout.trim()));
  });
}

export async function branchPlan(library: PlanReader, folder: string): Promise<AnnotatedTree> {
  return library.projectTree({ pendingOf: incrementOfBranch(await branchAt(folder)) });
}

function onBranch(library: PlanReader, folder: string): PlanReader {
  return { projectTree: () => branchPlan(library, folder) };
}

export async function readMap(library: PlanReader, folder: string, imports: readonly ImportedFolder[] = []): Promise<ProjectGraph> {
  const tree = await branchPlan(library, folder);
  const survey = await current.read(folder, tree, imports);
  return buildGraph(tree, survey);
}

export async function focusProject(library: PlanReader, folder: string, options: FocusOptions, imports: readonly ImportedFolder[] = []): Promise<FocusAnswer> {
  if (options.select.startsWith("diff:")) return affectedProject(onBranch(library, folder), folder, { ...options, range: options.select.slice(5) }, current);
  const top = await topOf(folder);
  return focus(await readMap(library, folder, imports), options, { exists: file => existsSync(path.join(top, file)) });
}

export async function mapCommand(library: PlanReader, folder: string, options: FocusOptions, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await focusProject(library, folder, options, imports);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}

export async function crossingProject(library: PlanReader, folder: string, options: CrossingOptions, imports: readonly ImportedFolder[] = []): Promise<CrossingAnswer> {
  const tree = await branchPlan(library, folder);
  const survey = await current.read(folder, tree, imports);
  return crossingsOf(tree, survey, await topOf(folder), options);
}

export async function crossingCommand(library: PlanReader, folder: string, options: CrossingOptions, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await crossingProject(library, folder, options, imports);
  return json ? JSON.stringify(answer) : formatCrossing(answer);
}

export async function capabilityTreeProject(library: PlanReader, folder: string, select: string, imports: readonly ImportedFolder[] = []): Promise<CapabilityTree> {
  const tree = await branchPlan(library, folder);
  return capabilityTreeOf(tree, await current.read(folder, tree, imports), select);
}

export async function capabilitiesCommand(library: PlanReader, folder: string, select: string, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await capabilityTreeProject(library, folder, select, imports);
  return json ? JSON.stringify(answer) : formatCapabilityTree(answer);
}

export async function linksProject(library: PlanReader, folder: string, select: string, imports: readonly ImportedFolder[] = []): Promise<LinksAnswer> {
  const tree = await branchPlan(library, folder);
  return linksOf(tree, await current.read(folder, tree, imports), await topOf(folder), select);
}

export async function linksCommand(library: PlanReader, folder: string, select: string, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await linksProject(library, folder, select, imports);
  return json ? JSON.stringify(answer) : formatLinks(answer);
}

export async function affectedCommand(library: PlanReader, folder: string, options: AffectedOptions, json = false): Promise<string> {
  const answer = await affectedProject(onBranch(library, folder), folder, options, current);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}

export async function pinWorldAt(library: PlanReader, folder: string, imports: readonly ImportedFolder[] = []): Promise<PinWorld> {
  const tree = await branchPlan(library, folder);
  const [survey, top] = await Promise.all([current.read(folder, tree, imports), topOf(folder)]);
  return pinWorldOf(tree.stories, survey, top, (file) => readFile(file, "utf8").catch(() => undefined));
}

export { changedOnMain };
export { formatCrossing };
export type { CrossingAnswer, CrossingOptions, ImportedFolder, LinksAnswer };

const MAIN_READ_BACK = 24 * 60 * 60 * 1000;

export async function healthWorklistAt(library: Pick<Library, "projectTree" | "healthWorklist">, folder: string): Promise<HealthWorkItem[]> {
  const tree = await library.projectTree();
  const changed = await changedOnMain(tree.stories, folder, { within: MAIN_READ_BACK });
  const offered = await library.healthWorklist({ changed });
  const unnamed = new Set(offered.flatMap(({ why, waits }) => (waits === undefined && why.reason === "no test names it" ? why.contracts : [])));
  if (unnamed.size === 0) return offered;
  const named = await namedOnMain(tree, folder, unnamed);
  return named === undefined || named.contracts.length === 0 ? offered : library.healthWorklist({ changed, named });
}
