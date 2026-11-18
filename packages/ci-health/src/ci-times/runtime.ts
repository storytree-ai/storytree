// Capability 6 · CI times.
import type { Storytree } from "@storytree/library";

import { CI_TIMES_CHANNELS, type CiTimesBridge } from "./bridge.js";
import { ciTimesReading, type CiTimesReading } from "./reading.js";
import type { ActionsReader } from "./record.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";

export const RECORD_AFTER_MS = 10 * 60 * 1000;

export interface CiTimesPageFrame {
  server(): Pick<Storytree, "ownDatabase" | "listProjects"> | undefined;
  library(): { projectFolder(project: unknown): Promise<string | undefined> };
}

export type CiTimesRecorder = (db: CiTimesDb, project: string, folder: string) => Promise<void>;

export function ciTimesAnswers(frame: CiTimesPageFrame, { record = (db, project, folder) => recordFromFolder(db, project, folder), now = () => new Date() }: { record?: CiTimesRecorder; now?: () => Date } = {}): CiTimesBridge {
  const recording = new Map<string, Promise<void>>();
  return {
    async ciTimes(project: unknown): Promise<CiTimesReading | undefined> {
      const server = frame.server();
      if (server === undefined) return undefined;
      if (typeof project !== "string" || !(await server.listProjects()).includes(project)) throw new Error(`there is no project called ${JSON.stringify(project)}`);
      const db = await ciTimesPool(server);
      const reading = await ciTimesReading(db, project, now());
      const stale = reading === undefined || now().getTime() - Date.parse(reading.readAt) >= RECORD_AFTER_MS;
      if (stale && !recording.has(project)) {
        const started = frame.library().projectFolder(project).then((folder) => (folder === undefined ? undefined : record(untilEnded(db), project, folder)))
          .catch((error: unknown) => {
            if (error instanceof LibraryClosed) return;
            console.error(`The CI times of ${project} could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
          })
          .finally(() => recording.delete(project));
        recording.set(project, started.then(() => undefined));
      }
      return reading;
    },
  };
}

class LibraryClosed extends Error {}

function untilEnded(db: CiTimesDb): CiTimesDb {
  return {
    query: (text, values) => ((db as { ending?: boolean }).ending === true ? Promise.reject(new LibraryClosed("the library closed")) : db.query(text, values)),
  };
}

export async function recordFromFolder(db: CiTimesDb, project: string, folder: string, actions?: ActionsReader): Promise<void> {
  const [{ ghActions, recordCiTimes }, { gitIn, repositoryOf }, { ciScopeRule }] = await Promise.all([import("./record.js"), import("../read-ci/read-ci.js"), import("./scope.js")]);
  const repository = repositoryOf(await gitIn(folder)(["remote", "get-url", "origin"]).catch(() => ""));
  if (repository !== undefined) await recordCiTimes({ db, project, repository, actions: actions ?? ghActions(), scopeOf: ciScopeRule(folder) });
}

export const ciTimesPageAnswers = [(frame: CiTimesPageFrame) => ({ channels: CI_TIMES_CHANNELS, answers: ciTimesAnswers(frame) })];
