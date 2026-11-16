// Capability 1 · Story nodes. Compatibility for existing app mounts; The map owns the code survey (ADR-0864).
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedTree, SchemaRecord } from "@storytree/library";
import { pinWorldOf, unresolved, type PinReading } from "@storytree/map/pins";
import { noMergedMain, offThreadSurveyReader, type CodeSurveyReader, type ImportedFolder, type ProjectSurvey } from "@storytree/map/code-survey";

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
    /** The project's live pin records; a host without it has none. */
    pins?(project: unknown): Promise<SchemaRecord<"pin">[]>;
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
  // The last survey answered for each project, which its pins are read against (3.119).
  const surveyed = new Map<unknown, { folder: string; survey: ProjectSurvey }>();
  const answers: { [Method in keyof ForestBridge]: (project: unknown) => ReturnType<ForestBridge[Method]> } = {
    codeSurvey: async (project) => {
      const library = frame.library();
      const folder = await library.projectFolder(project);
      if (folder === undefined) return {};
      surveys ??= offThreadSurveyReader(frame.surveyWorker, { keptIn: path.join(frame.home, "code-survey"), startFromFetched: true });
      // The folders this machine imports, where the survey reads the project's mapped stories (ADR-0993 D2).
      const reading = surveys.read(folder, frame.treeRead(project) ?? await library.projectTree(project), await library.projectImports(project));
      const survey = await refusalSaidOnce(folder, reading);
      surveyed.set(project, { folder, survey });
      return survey;
    },
    // The live pins, each read against the code last surveyed here: stale, with why, once its anchor no longer resolves (map
    // 9.2). Before a survey of the project's checkout, none is judged stale.
    pins: async (project) => {
      const library = frame.library();
      const pins = await library.pins?.(project) ?? [];
      const last = surveyed.get(project);
      if (pins.length === 0 || last === undefined) return pins.map((pin): PinReading => ({ pin }));
      const tree = frame.treeRead(project) ?? await library.projectTree(project);
      const world = pinWorldOf(tree.stories, last.survey, last.folder, (file) => readFile(path.resolve(last.folder, file), "utf8").catch(() => undefined));
      return Promise.all([...pins].sort((one, other) => one.id.localeCompare(other.id)).map(async (pin): Promise<PinReading> => {
        const stale = await unresolved(pin.fields.anchor, world);
        return stale === undefined ? { pin } : { pin, stale };
      }));
    },
  };
  // A project whose origin has no fetchable main is refused its survey at every ask; a rejected answer would have Electron
  // log a whole stack each time, so it is answered with no code, and the refusal is said once per folder and reason (1.13).
  const refused = new Map<string, string>();
  const refusalSaidOnce = async (folder: string, reading: Promise<ProjectSurvey>): Promise<ProjectSurvey> => {
    try {
      const survey = await reading;
      if (refused.delete(folder)) console.error(`The code survey of ${folder} reads origin/main again.`);
      return survey;
    } catch (error) {
      if (!noMergedMain(error)) throw error;
      const message = (error as Error).message;
      if (refused.get(folder) !== message) console.error(`${message} The forest shows ${folder} without its code until its main can be fetched.`);
      refused.set(folder, message);
      return {};
    }
  };
  return { channels: FOREST_CHANNELS, answers };
}];
