/**
 * The storytree 0.3 desktop app's home. Everything the app keeps lives in ~/.storytree/0.3/: its
 * Postgres cluster in pgdata/ (with the server's logs and owner record beside it), Electron's own
 * files in electron/, and app.json, which records how the app was started so that an agent's
 * session start can open it again (the agent link's setup check), and runtime/, where the app that
 * follows merged main is built and run from (@storytree/app's follow-main), and backups/, each
 * project's snapshots. Nothing else in ~/.storytree/ is
 * ever read or written: storytree 0.2 keeps its files there (secrets.json among them), and 0.3
 * leaves them alone.
 *
 * STORYTREE_HOME, when set, is the home instead: the agent link reads the same variable, so the app
 * and the agents' tools can be pointed at a throwaway home together.
 *
 * The repo's library commands (scripts/export-library.mjs, check-own-health.mjs, restore-library.mjs)
 * import this too, so they agree on where the library is.
 */
import { homedir } from "node:os";
import path from "node:path";

export interface AppHome {
  /** ~/.storytree/0.3, or STORYTREE_HOME */
  readonly dir: string;
  /** The Postgres cluster: ~/.storytree/0.3/pgdata */
  readonly pgdata: string;
  /** Electron's own files, its cache and settings: ~/.storytree/0.3/electron */
  readonly electron: string;
  /** How the app was last started, for opening it again: ~/.storytree/0.3/app.json */
  readonly launchRecord: string;
  /** The app that follows merged main, a clone and two build slots: ~/.storytree/0.3/runtime */
  readonly runtime: string;
  /** Each project's snapshots, newest 14 (@storytree/app's backUp): ~/.storytree/0.3/backups */
  readonly backups: string;
}

/** The app's home under `home` (by default, STORYTREE_HOME if set, else the user's home directory's). */
export function appHome(home?: string): AppHome {
  const fromEnv = process.env.STORYTREE_HOME;
  const dir = home === undefined && fromEnv !== undefined && fromEnv !== "" ? path.resolve(fromEnv) : path.join(home ?? homedir(), ".storytree", "0.3");
  return { dir, pgdata: path.join(dir, "pgdata"), electron: path.join(dir, "electron"), launchRecord: path.join(dir, "app.json"), runtime: path.join(dir, "runtime"), backups: path.join(dir, "backups") };
}

/** How the app names itself as the owner of its Postgres data, so a start refused by it can say so. */
export const APP_OWNER = "the storytree 0.3 desktop app";
