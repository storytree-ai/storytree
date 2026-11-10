/**
 * Capability 6 · CI times. The main process's side of the page's read: the project's CI times reading, from the database
 * beside the library. While the page shows it, the app records again once the last recording is ten minutes old, in the
 * background and one at a time per project, from the project's folder on this machine through the user's `gh`: so a user
 * with no scheduled recorder (no Mint box, no watcher) still gets the strip, and its live count stays near current. The
 * reading is answered at once, never waiting on a recording; a recording that fails is tried again at the next ask.
 */
import type { Storytree } from "@storytree/library";

import { CI_TIMES_CHANNELS, type CiTimesBridge } from "./bridge.js";
import { ciTimesReading, type CiTimesReading } from "./reading.js";
import type { ActionsReader } from "./record.js";
import { ciTimesPool, type CiTimesDb } from "./store.js";

/** How old the last recording may be before the app records again while the strip is on show. */
export const RECORD_AFTER_MS = 10 * 60 * 1000;

/** What the frame offers this part: the open library's server and the project's folder on this machine. */
export interface CiTimesPageFrame {
  /** The open library's server, asked at call time: none before the library opens. */
  server(): Pick<Storytree, "ownDatabase" | "listProjects"> | undefined;
  library(): { projectFolder(project: unknown): Promise<string | undefined> };
}

/** Records `project`'s CI times from `folder`'s GitHub origin into `db`; the app's is `health times`' recorder. */
export type CiTimesRecorder = (db: CiTimesDb, project: string, folder: string) => Promise<void>;

/** The page's read, answered over `frame`, recording through `record` (the user's `gh` by default) as of `now`. */
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
        const started = frame.library().projectFolder(project).then((folder) => (folder === undefined ? undefined : record(db, project, folder)))
          .catch((error: unknown) => console.error(`The CI times of ${project} could not be recorded: ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => recording.delete(project));
        recording.set(project, started.then(() => undefined));
      }
      return reading;
    },
  };
}

/** Record from `folder`'s GitHub origin, if it has one, through `actions` (the user's `gh` by default); a folder with none records nothing. */
export async function recordFromFolder(db: CiTimesDb, project: string, folder: string, actions?: ActionsReader): Promise<void> {
  const [{ ghActions, recordCiTimes }, { gitIn, repositoryOf }] = await Promise.all([import("./record.js"), import("../read-ci/read-ci.js")]);
  const repository = repositoryOf(await gitIn(folder)(["remote", "get-url", "origin"]).catch(() => ""));
  if (repository !== undefined) await recordCiTimes({ db, project, repository, actions: actions ?? ghActions() });
}

/** The main process's side, named in CI health's manifest (`pageAnswers`): the desktop answers the page's CI times read with it. */
export const ciTimesPageAnswers = [(frame: CiTimesPageFrame) => ({ channels: CI_TIMES_CHANNELS, answers: ciTimesAnswers(frame) })];
