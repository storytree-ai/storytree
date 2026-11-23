// Capability 6 · CI times.
import type { Library, Storytree } from "@storytree/library";

import { readCiOnRefresh, type CiLook } from "../read-ci/on-refresh.js";
import { CI_TIMES_CHANNELS, type CiTimesBridge } from "./bridge.js";
import { ciTimesReading, type CiTimesReading } from "./reading.js";
import type { ActionsReader } from "./record.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";

export const RECORD_AFTER_MS = 10 * 60 * 1000;

export interface CiTimesPageFrame {
  server(): Pick<Storytree, "ownDatabase" | "listProjects" | "openProject"> | undefined;
  library(): { projectFolder(project: unknown): Promise<string | undefined> };
}

export type CiTimesRecorder = (db: CiTimesDb, project: string, folder: string) => Promise<void>;

export function ciTimesAnswers(frame: CiTimesPageFrame, { record = (db, project, folder) => recordFromFolder(db, project, folder), now = () => new Date(), readCi = readCiOnRefresh({ open: (name) => openOnce(frame.server()!, name) }) }: { record?: CiTimesRecorder; now?: () => Date; readCi?: CiLook } = {}): CiTimesBridge {
  const recording = new Map<string, Promise<void>>();
  return {
    async ciTimes(project: unknown): Promise<CiTimesReading | undefined> {
      const server = frame.server();
      if (server === undefined) return undefined;
      if (typeof project !== "string" || !(await server.listProjects()).includes(project)) throw new Error(`there is no project called ${JSON.stringify(project)}`);
      frame.library().projectFolder(project).then((folder) => (folder === undefined ? undefined : readCi(project, folder)))
        .catch((error: unknown) => {
          if (closedLibrary(error)) return;
          console.error(`The CI of ${project} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        });
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

type Opener = Pick<Storytree, "openProject">;

const opened = new WeakMap<Opener, Map<string, Promise<Library>>>();

function openOnce(server: Opener, name: string): Promise<Library> {
  let libraries = opened.get(server);
  if (libraries === undefined) {
    libraries = new Map();
    opened.set(server, libraries);
  }
  let open = libraries.get(name);
  if (open === undefined) {
    open = server.openProject(name, { create: false });
    libraries.set(name, open);
    open.catch(() => libraries.delete(name));
  }
  return open;
}

class LibraryClosed extends Error {}

function closedLibrary(error: unknown): boolean {
  return error instanceof LibraryClosed || (error instanceof Error && /connection is closed|after calling end on the pool/.test(error.message));
}

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
