// Capability 1 · Lifecycle
import { homedir } from "node:os";
import path from "node:path";

export interface AppHome {
  readonly dir: string;
  readonly pgdata: string;
  readonly electron: string;
  readonly launchRecord: string;
  readonly backups: string;
}

export function appHome(home?: string): AppHome {
  const fromEnv = process.env.STORYTREE_HOME;
  const dir = home === undefined && fromEnv !== undefined && fromEnv !== "" ? path.resolve(fromEnv) : path.join(home ?? homedir(), ".storytree", "0.3");
  return { dir, pgdata: path.join(dir, "pgdata"), electron: path.join(dir, "electron"), launchRecord: path.join(dir, "app.json"), backups: path.join(dir, "backups") };
}

export const APP_OWNER = "the storytree 0.3 desktop app";
