/** Capability 3 · Counts before detail. The map's Node entry point: a live library reading joined to the caller's checkout. */
import { execFile } from "node:child_process";
import { affectedProject, type AffectedOptions } from "./affected.js";
import type { AnnotatedTree, Library } from "@storytree/library";
import { codeSurveyReader } from "./code-survey/read-survey.js";
import { buildGraph, type ProjectGraph } from "./graph.js";
import { focus, formatFocus, type FocusAnswer, type FocusOptions } from "./focus.js";

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

export async function readMap(library: PlanReader, folder: string): Promise<ProjectGraph> {
  const tree = await branchPlan(library, folder);
  const survey = await codeSurveyReader({ checkout: "current" }).read(folder, tree);
  return buildGraph(tree, survey);
}

export async function focusProject(library: PlanReader, folder: string, options: FocusOptions): Promise<FocusAnswer> {
  if (options.select.startsWith("diff:")) return affectedProject(onBranch(library, folder), folder, { ...options, range: options.select.slice(5) });
  return focus(await readMap(library, folder), options);
}

export async function mapCommand(library: PlanReader, folder: string, options: FocusOptions, json = false): Promise<string> {
  const answer = await focusProject(library, folder, options);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}

/** The affected front door and diff focus share one map implementation and renderer. */
export async function affectedCommand(library: PlanReader, folder: string, options: AffectedOptions, json = false): Promise<string> {
  const answer = await affectedProject(onBranch(library, folder), folder, options);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}
