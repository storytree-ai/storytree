/**
 * Adding a project (ADR-0752, ADR-0757): the folder the user chose, in the installer's folder step
 * or the app's Add project, becomes a storytree project through the agent link's one setup check,
 * as every other way of adding one does. The choice is the user's explicit yes; a folder that
 * already belongs to a project is left as it is (and put back on this computer's list, if it was
 * removed from it), and a folder the check refuses is said with why.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
  const home = options.home ?? storytreeHome();
  const found = findProject(resolved);
  if (found.project !== undefined) {
    keepOnThisComputer(found.project, home);
    return { status: "already a project", folder: resolved, project: found.project };
  }
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

/**
 * Removing a project added by mistake, its non-destructive half: the project leaves this computer's
 * list of projects (the app's Projects picker), and every record of it stays in the library, shared
 * with every other machine. Its folder is left as it is, so adding that folder again brings it back.
 */
export type RemovedProject =
  | { status: "removed"; project: string }
  | { status: "no such project"; project: string; message: string };

const REMOVED_FILE = "removed-projects.json";

/** The projects taken off this computer's list, kept in the app's home. */
function removedHere(home: string): string[] {
  try {
    const { removed } = JSON.parse(readFileSync(path.join(home, REMOVED_FILE), "utf8")) as { removed?: unknown };
    return Array.isArray(removed) ? removed.filter((name): name is string => typeof name === "string") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function recordRemoved(home: string, removed: readonly string[]): void {
  mkdirSync(home, { recursive: true });
  const file = path.join(home, REMOVED_FILE);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ removed: [...new Set(removed)].sort() }, null, 2)}\n`);
  renameSync(temp, file);
}

/** `projects` (every project in the library) less those removed from this computer. */
export function projectsOnThisComputer(projects: readonly string[], home: string = storytreeHome()): string[] {
  const removed = new Set(removedHere(home));
  return projects.filter((name) => !removed.has(name));
}

/** Put `project` back on this computer's list, if it was taken off. */
export function keepOnThisComputer(project: string, home: string = storytreeHome()): void {
  const removed = removedHere(home);
  if (removed.includes(project)) recordRemoved(home, removed.filter((name) => name !== project));
}

/** Take `project` off this computer's list. Nothing in the library is deleted. */
export async function removeProject(project: string, options: AddProjectOptions = {}): Promise<RemovedProject> {
  const home = options.home ?? storytreeHome();
  const projects = await withLibrary({ ...options, home }, (storytree) => storytree.listProjects());
  if (!projects.includes(project)) return { status: "no such project", project, message: `There is no project called "${project}" in the library.` };
  recordRemoved(home, [...removedHere(home), project]);
  return { status: "removed", project };
}
