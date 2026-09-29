/**
 * Adding a project (ADR-0752): the folder the user chose, in the installer's folder step or the
 * app's Add project, becomes a storytree project exactly as the setup check's yes makes one. The
 * choice is the user's explicit yes; a folder that already belongs to a project is left as it is.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { findProject, openStorytree, setUpProject, storytreeHome, suggestedName } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";

/** The project a folder belongs to, or the name to suggest for it. The folder need not exist yet. */
export type ProjectFolder = { folder: string; project: string } | { folder: string; suggestion: string };

export type AddedProject =
  | { status: "set up" | "already a project"; folder: string; project: string }
  | { status: "name refused"; folder: string; message: string };

export interface AddProjectOptions {
  /** The app's home, where the project choice is recorded. By default, storytreeHome(). */
  readonly home?: string;
  /** How to reach the library. By default, the running app's (opened when it is closed). */
  readonly open?: (home: string) => Promise<Storytree>;
}

export function projectFolder(folder: string): ProjectFolder {
  const resolved = path.resolve(folder);
  const found = findProject(resolved);
  return found.project === undefined ? { folder: resolved, suggestion: suggestedName(resolved) } : { folder: resolved, project: found.project };
}

async function openLibrary(home: string): Promise<Storytree> {
  const running = await openStorytree({ home });
  if (running.state === "not running") throw new Error(running.message);
  const { connect } = await import("@storytree/library");
  return connect(running.library);
}

/** Make `folder` (created if missing) project `name`, and the one the app shows. Nothing is made for a folder already in a project. */
export async function addProject(folder: string, name: string, options: AddProjectOptions = {}): Promise<AddedProject> {
  const current = projectFolder(folder);
  if ("project" in current) return { status: "already a project", ...current };
  const home = options.home ?? storytreeHome();
  const storytree = await (options.open ?? openLibrary)(home);
  try {
    mkdirSync(current.folder, { recursive: true });
    await setUpProject({ folder: current.folder, project: name, storytree, storytreeHome: home });
    return { status: "set up", folder: current.folder, project: name };
  } catch (error) {
    if (error instanceof Error && error.name === "ProjectNameError") return { status: "name refused", folder: current.folder, message: error.message };
    throw error;
  } finally {
    await storytree.close();
  }
}
