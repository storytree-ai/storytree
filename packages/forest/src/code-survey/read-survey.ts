// Capability 1 · Story nodes
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AnnotatedTree, SchemaRecord } from "@storytree/library";
import { pinWorldOf, unresolved, type PinReading } from "@storytree/map/pins";
import { noMergedMain, offThreadSurveyReader, type CodeSurveyReader, type ImportedFolder, type ProjectSurvey } from "@storytree/map/code-survey";

import { FOREST_CHANNELS, type ForestBridge } from "../render/page.js";

export * from "@storytree/map/code-survey";

export interface SurveyPageFrame {
  readonly home: string;
  library(): {
    projectFolder(project: unknown): Promise<string | undefined>;
    projectTree(project: unknown): Promise<AnnotatedTree>;
    projectImports(project: unknown): Promise<ImportedFolder[]>;
    pins?(project: unknown): Promise<SchemaRecord<"pin">[]>;
  };
  treeRead(project: unknown): AnnotatedTree | undefined;
  readonly surveyWorker: string;
}

export const forestPageAnswers = [(frame: SurveyPageFrame) => {
  let surveys: CodeSurveyReader | undefined;
  const surveyed = new Map<unknown, { folder: string; survey: ProjectSurvey }>();
  const answers: { [Method in keyof ForestBridge]: (project: unknown) => ReturnType<ForestBridge[Method]> } = {
    codeSurvey: async (project) => {
      const library = frame.library();
      const folder = await library.projectFolder(project);
      if (folder === undefined) return {};
      surveys ??= offThreadSurveyReader(frame.surveyWorker, { keptIn: path.join(frame.home, "code-survey"), startFromFetched: true });
      const reading = surveys.read(folder, frame.treeRead(project) ?? await library.projectTree(project), await library.projectImports(project));
      const survey = await refusalSaidOnce(folder, reading);
      surveyed.set(project, { folder, survey });
      return survey;
    },
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
