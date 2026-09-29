/**
 * Adding a project (ADR-0752, ADR-0757): the folder the user chose, in the installer's folder step
 * or the app's Add project, becomes a storytree project through the agent link's one setup check,
 * as every other way of adding one does. The choice is the user's explicit yes; a folder that
 * already belongs to a project is left as it is, and a folder the check refuses is said with why.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { findProject, openStorytree, ProjectFolderError, setUpProject, storytreeHome, suggestProjectName, unusedName } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";

export { unusedName };

/** The project a folder belongs to, or the name no project has yet to suggest for it. The folder need not exist yet. */
export type ProjectFolder = { folder: string; project: string } | { folder: string; suggestion: string };

export type AddedProject =
  | { status: "set up" | "already a project"; folder: string; project: string }
  /** Another name would do: the message says why this one would not, and suggests one. */
  | { status: "name refused"; folder: string; message: string; suggestion?: string }
  /** The folder cannot be a project of its own (it is inside, or holds, another project's folder). */
  | { status: "folder refused"; folder: string; message: string };

export interface AddProjectOptions {
  /** The app's home, where the project choice is recorded. By default, storytreeHome(). */
  readonly home?: string;
  /** How to reach the library. By default, the running app's (opened when it is closed). */
  readonly open?: (home: string) => Promise<Storytree>;
  /** A library already open, such as the app's own: used, and left open. */
  readonly library?: Storytree;
}

/** What `folder` is: the project it belongs to, or the name to suggest, which no project has yet. */
export async function projectFolder(folder: string, options: AddProjectOptions = {}): Promise<ProjectFolder> {
  const resolved = path.resolve(folder);
  const found = findProject(resolved);
  if (found.project !== undefined) return { folder: resolved, project: found.project };
  return { folder: resolved, suggestion: await withLibrary(options, (storytree) => suggestProjectName(resolved, storytree)) };
}

async function openLibrary(home: string): Promise<Storytree> {
  const running = await openStorytree({ home });
  if (running.state === "not running") throw new Error(running.message);
  const { connect } = await import("@storytree/library");
  return connect(running.library);
}

async function withLibrary<T>(options: AddProjectOptions, use: (storytree: Storytree) => Promise<T>): Promise<T> {
  const storytree = options.library ?? await (options.open ?? openLibrary)(options.home ?? storytreeHome());
  try {
    return await use(storytree);
  } finally {
    if (options.library === undefined) await storytree.close();
  }
}

/** Make `folder` (created if missing) project `name`, and the one the app shows. Nothing is made for a folder already in a project. */
export async function addProject(folder: string, name: string, options: AddProjectOptions = {}): Promise<AddedProject> {
  const resolved = path.resolve(folder);
  const found = findProject(resolved);
  if (found.project !== undefined) return { status: "already a project", folder: resolved, project: found.project };
  const home = options.home ?? storytreeHome();
  return withLibrary({ ...options, home }, async (storytree) => {
    try {
      mkdirSync(resolved, { recursive: true });
      await setUpProject({ folder: resolved, project: name, storytree, storytreeHome: home });
      return { status: "set up", folder: resolved, project: name };
    } catch (error) {
      if (error instanceof ProjectFolderError) {
        return error.suggestion === undefined
          ? { status: "folder refused", folder: resolved, message: error.message }
          : { status: "name refused", folder: resolved, message: error.message, suggestion: error.suggestion };
      }
      if (error instanceof Error && error.name === "ProjectNameError") return { status: "name refused", folder: resolved, message: error.message };
      throw error;
    }
  });
}
