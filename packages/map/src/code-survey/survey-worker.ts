// Capability 8 · Code survey
import { parentPort, workerData } from "node:worker_threads";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader, readCodeSurvey, type ImportedFolder, type SurveyKeep } from "./read-survey.js";

const { keep, startFromFetched = false } = (workerData as { keep?: SurveyKeep; startFromFetched?: boolean } | null) ?? {};
const read = keep === undefined && !startFromFetched ? readCodeSurvey : codeSurveyReader({ ...(keep === undefined ? {} : { keep }), startFromFetched }).read;

parentPort?.on("message", ({ id, folder, tree, imports }: { id: number; folder: string; tree: AnnotatedTree; imports?: ImportedFolder[] }) => {
  read(folder, tree, imports).then(
    (survey) => parentPort!.postMessage({ id, survey }),
    (error: unknown) => parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
});
