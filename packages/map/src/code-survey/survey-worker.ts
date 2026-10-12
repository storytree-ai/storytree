// Capability 8 · Code survey. The worker thread an off-thread reader starts (8.16): it keeps one reader, as
// readCodeSurvey does in place, keeping its surveys where the asker said (8.25), and answers each ask with the
// survey or the reason it failed.
import { parentPort, workerData } from "node:worker_threads";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader, readCodeSurvey, type ImportedFolder, type SurveyKeep } from "./read-survey.js";

const keep = (workerData as { keep?: SurveyKeep } | null)?.keep;
const read = keep === undefined ? readCodeSurvey : codeSurveyReader({ keep }).read;

parentPort?.on("message", ({ id, folder, tree, imports }: { id: number; folder: string; tree: AnnotatedTree; imports?: ImportedFolder[] }) => {
  read(folder, tree, imports).then(
    (survey) => parentPort!.postMessage({ id, survey }),
    (error: unknown) => parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
});
