// Capability 1 · Story nodes. Compatibility for existing app mounts; The map owns the code survey (ADR-0864).
import path from "node:path";

import type { AnnotatedTree } from "@storytree/library";
import { offThreadSurveyReader, type CodeSurveyReader, type ImportedFolder } from "@storytree/map/code-survey";

import { FOREST_CHANNELS, type ForestBridge } from "../render/page.js";

export * from "@storytree/map/code-survey";

/** What a host offers the forest's page part: its home, the open library's reads, the tree the page last read, and the bundled survey worker. */
export interface SurveyPageFrame {
  readonly home: string;
  /** The open library's reads, asked at each survey: it opens after the part is made, and may reopen. */
  library(): {
    projectFolder(project: unknown): Promise<string | undefined>;
    projectTree(project: unknown): Promise<AnnotatedTree>;
    projectImports(project: unknown): Promise<ImportedFolder[]>;
  };
  /** The tree the page last read for the project, if it read one: the survey surveys it rather than reading it a second time. */
  treeRead(project: unknown): AnnotatedTree | undefined;
  /** The survey worker's bundled file. */
  readonly surveyWorker: string;
}

/** The main process's side, named in its manifest (`pageAnswers`, ADR-1030): the desktop answers the page's code survey with it. */
export const forestPageAnswers = [(frame: SurveyPageFrame) => {
  // Surveys parse every changed file: on a worker thread, so the main process keeps answering meanwhile (map 8.16),
  // and kept between starts, so a start with main unmoved parses nothing (map 8.25). A start's first survey answers
  // from the main already fetched, without waiting on the fetch; the page asks again for what it brought (map 8.27).
  // Made at the first survey, as the worker's file is read to name the code that keeps them.
  let surveys: CodeSurveyReader | undefined;
  const answers: { [Method in keyof ForestBridge]: (project: unknown) => ReturnType<ForestBridge[Method]> } = {
    codeSurvey: async (project) => {
      const library = frame.library();
      const folder = await library.projectFolder(project);
      if (folder === undefined) return {};
      surveys ??= offThreadSurveyReader(frame.surveyWorker, { keptIn: path.join(frame.home, "code-survey"), startFromFetched: true });
      // The folders this machine imports, where the survey reads the project's mapped stories (ADR-0993 D2).
      return surveys.read(folder, frame.treeRead(project) ?? await library.projectTree(project), await library.projectImports(project));
    },
  };
  return { channels: FOREST_CHANNELS, answers };
}];
