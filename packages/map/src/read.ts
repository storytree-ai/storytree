/** Capability 3 · Counts before detail. The map's Node entry point: a live library reading joined to the caller's checkout. */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { affectedProject, changedOnMain, namedOnMain, type AffectedOptions } from "./affected.js";
import type { AnnotatedTree, HealthWorkItem, Library } from "@storytree/library";
import { codeSurveyReader, type ImportedFolder } from "./code-survey/read-survey.js";
import { buildGraph, type ProjectGraph } from "./graph.js";
import { focus, formatFocus, type FocusAnswer, type FocusOptions } from "./focus.js";
import { crossingsOf, formatCrossing, type CrossingAnswer, type CrossingOptions } from "./code-survey/crossings.js";

type PlanReader = Pick<Library, "projectTree">;

/**
 * The increment a branch's name carries (a workspace's branch is claude/increment-<id>-<suffix>), as its
 * library id; undefined when it names none. The gate reads names the same way (packages/dev-loop/src/capability-list.mjs).
 */
export function incrementOfBranch(branch: string | undefined): string | undefined {
  const named = /(?:^|[/_-])increment[-_]([0-9a-f]{12})(?![0-9a-f])/i.exec(branch ?? "");
  return named === null ? undefined : `increment_${named[1]!.toLowerCase()}`;
}

/** The branch the checkout at `folder` is on, or undefined when Git cannot say. */
function branchAt(folder: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: folder }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  });
}

/** The top of the checkout `folder` is in, where built stories' packages are; `folder` itself when Git cannot say. */
function topOf(folder: string): Promise<string> {
  return new Promise(resolve => {
    execFile("git", ["rev-parse", "--show-toplevel"], { cwd: folder }, (error, stdout) => resolve(error ? folder : stdout.trim()));
  });
}

/**
 * The plan the checkout at `folder` reads (ADR-0966 D3): the live plan with the pending changes of the
 * increment its branch names laid over, or the live plan when it names none.
 */
export async function branchPlan(library: PlanReader, folder: string): Promise<AnnotatedTree> {
  return library.projectTree({ pendingOf: incrementOfBranch(await branchAt(folder)) });
}

/** `library` as the checkout at `folder` reads it: every plan it gives is that branch's. */
function onBranch(library: PlanReader, folder: string): PlanReader {
  return { projectTree: () => branchPlan(library, folder) };
}

/** The map of the checkout at `folder`, with each mapped story `imports` holds, the folders this machine imports (ADR-0993 D2). */
export async function readMap(library: PlanReader, folder: string, imports: readonly ImportedFolder[] = []): Promise<ProjectGraph> {
  const tree = await branchPlan(library, folder);
  const survey = await codeSurveyReader({ checkout: "current" }).read(folder, tree, imports);
  return buildGraph(tree, survey);
}

export async function focusProject(library: PlanReader, folder: string, options: FocusOptions, imports: readonly ImportedFolder[] = []): Promise<FocusAnswer> {
  if (options.select.startsWith("diff:")) return affectedProject(onBranch(library, folder), folder, { ...options, range: options.select.slice(5) });
  const top = await topOf(folder);
  return focus(await readMap(library, folder, imports), options, { exists: file => existsSync(path.join(top, file)) });
}

export async function mapCommand(library: PlanReader, folder: string, options: FocusOptions, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await focusProject(library, folder, options, imports);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}

/**
 * What crosses a line drawn round files of a mapped island of the checkout at `folder` (ADR-0993 D6, D10): the
 * island's files are read for their imports only when this is asked.
 */
export async function crossingProject(library: PlanReader, folder: string, options: CrossingOptions, imports: readonly ImportedFolder[] = []): Promise<CrossingAnswer> {
  const tree = await branchPlan(library, folder);
  const survey = await codeSurveyReader({ checkout: "current" }).read(folder, tree, imports);
  return crossingsOf(tree, survey, await topOf(folder), options);
}

export async function crossingCommand(library: PlanReader, folder: string, options: CrossingOptions, json = false, imports: readonly ImportedFolder[] = []): Promise<string> {
  const answer = await crossingProject(library, folder, options, imports);
  return json ? JSON.stringify(answer) : formatCrossing(answer);
}

/** The affected front door and diff focus share one map implementation and renderer. */
export async function affectedCommand(library: PlanReader, folder: string, options: AffectedOptions, json = false): Promise<string> {
  const answer = await affectedProject(onBranch(library, folder), folder, options);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}

export { changedOnMain };
export { formatCrossing };
export type { CrossingAnswer, CrossingOptions, ImportedFolder };

/** How far back main's commits are read for the health worklist: longer than any merge's own-health run takes, so the library's bound decides. */
const MAIN_READ_BACK = 24 * 60 * 60 * 1000;

/**
 * The health worklist as the checkout at `folder` sees main: a capability whose story's code changed
 * on its fetched origin/main since its contracts were last verified waits on that commit's own-health run,
 * and one offered as "no test names it" whose every such contract a test on main names waits on a run
 * to record it. Main's tests are read only when the worklist offers one so.
 */
export async function healthWorklistAt(library: Pick<Library, "projectTree" | "healthWorklist">, folder: string): Promise<HealthWorkItem[]> {
  const tree = await library.projectTree();
  const changed = await changedOnMain(tree.stories, folder, { within: MAIN_READ_BACK });
  const offered = await library.healthWorklist({ changed });
  const unnamed = new Set(offered.flatMap(({ why, waits }) => (waits === undefined && why.reason === "no test names it" ? why.contracts : [])));
  if (unnamed.size === 0) return offered;
  const named = await namedOnMain(tree, folder, unnamed);
  return named === undefined || named.contracts.length === 0 ? offered : library.healthWorklist({ changed, named });
}
