/** The map's Node entry point: a live library reading joined to the caller's checkout. */
import type { Library } from "@storytree/library";
import { codeSurveyReader } from "./code-survey/read-survey.js";
import { buildGraph, type ProjectGraph } from "./graph.js";
import { focus, formatFocus, type FocusAnswer, type FocusOptions } from "./focus.js";

export async function readMap(library: Pick<Library, "projectTree">, folder: string): Promise<ProjectGraph> {
  const tree = await library.projectTree();
  const survey = await codeSurveyReader({ checkout: "current" }).read(folder, tree);
  return buildGraph(tree, survey);
}

export async function focusProject(library: Pick<Library, "projectTree">, folder: string, options: FocusOptions): Promise<FocusAnswer> {
  return focus(await readMap(library, folder), options);
}

export async function mapCommand(library: Pick<Library, "projectTree">, folder: string, options: FocusOptions, json = false): Promise<string> {
  const answer = await focusProject(library, folder, options);
  return json ? JSON.stringify(answer) : formatFocus(answer);
}
