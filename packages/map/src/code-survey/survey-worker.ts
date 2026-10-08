// Capability 8 · Code survey. The worker thread an off-thread reader starts (8.16): it keeps one reader, as
// readCodeSurvey does in place, and answers each ask with the survey or the reason it failed.
import { parentPort } from "node:worker_threads";

import type { AnnotatedTree } from "@storytree/library";

import { readCodeSurvey } from "./read-survey.js";

parentPort?.on("message", ({ id, folder, tree }: { id: number; folder: string; tree: AnnotatedTree }) => {
  readCodeSurvey(folder, tree).then(
    (survey) => parentPort!.postMessage({ id, survey }),
    (error: unknown) => parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
});
