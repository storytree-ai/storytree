/**
 * Adding a project (ADR-0752, ADR-0757): the folder the user chose, in the installer's folder step
 * or the app's Add project, becomes a storytree project through the agent link's one setup check,
 * as every other way of adding one does. The choice is the user's explicit yes; a folder that
 * already belongs to a project is left as it is (and put back on this computer's list, if it was
 * removed from it), and a folder the check refuses is said with why.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findProject, forgetProjectActivity, forgetTrunk, keepOnThisComputer, machineOf, MARKER_FILE, openActivityLog, openStorytree, ProjectFolderError, readClaims, readLibrary, readProjectChoice, recordRemovedProjects, removedProjects, setUpProject, storytreeHome, suggestProjectName, trunksOn, unusedName } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";

export { keepOnThisComputer, unusedName };

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
 * Removing a project added by mistake: the project leaves this computer's list of projects (the app's
 * Projects picker), and every record of it stays in the library, shared with every other machine.
 * Its folder here is freed: its marker is deleted and this machine's trunk record forgotten, so the
 * folder can be set up afresh, and the project comes back here only by joining it on purpose
 * (ADR-0757 D4). A marker git tracks is the user's to change: it is kept and named, so deleting it
 * frees the folder, and until then adding the folder again brings the project back.
 */
export type RemovedProject =
  | { status: "removed"; project: string; freed?: string; kept?: string }
  | { status: "no such project"; project: string; message: string };

/**
 * `projects` (every project in the library) less those removed from this computer. A removed name
 * no longer in the library was deleted (from any computer), so it leaves this computer's list too:
 * a later project of that name is a new one, shown here.
 */
export function projectsOnThisComputer(projects: readonly string[], home: string = storytreeHome()): string[] {
  const removed = removedProjects(home);
  const kept = removed.filter((name) => projects.includes(name));
  if (kept.length < removed.length) recordRemovedProjects(home, kept);
  return projects.filter((name) => !kept.includes(name));
}

/** Take `project` off this computer's list and free its folder here. Nothing in the library is deleted. */
export async function removeProject(project: string, options: AddProjectOptions = {}): Promise<RemovedProject> {
  const home = options.home ?? storytreeHome();
  return withLibrary({ ...options, home }, async (storytree) => {
    if (!(await storytree.listProjects()).includes(project)) return { status: "no such project", project, message: `There is no project called "${project}" in the library.` };
    return freeOnThisComputer(storytree, project, home);
  });
}

/** Take `project` off this computer's list and free its folder here. */
async function freeOnThisComputer(storytree: Storytree, project: string, home: string): Promise<RemovedProject & { status: "removed" }> {
  const machine = machineOf(home).id;
  const trunk = (await trunksOn(storytree, machine)).find((each) => each.project === project);
  let kept = false;
  if (trunk !== undefined) {
    const marker = path.join(trunk.folder, MARKER_FILE);
    if (markerProject(marker) === project) {
      kept = trackedByGit(trunk.folder);
      if (!kept) rmSync(marker);
    }
    await forgetTrunk(storytree, { project, machine });
  }
  recordRemovedProjects(home, [...removedProjects(home), project]);
  if (trunk === undefined) return { status: "removed", project };
  return kept ? { status: "removed", project, kept: trunk.folder } : { status: "removed", project, freed: trunk.folder };
}

/**
 * Deleting a project (ADR-0831): its database is dropped, with every record and all its history,
 * for every computer that uses the library, and it leaves their lists. Only once the user has typed
 * its name; a snapshot into this computer's backups first is the user's choice. Refused for the
 * project in use (the one the app here shows, or the one a command's folder belongs to), and while
 * a live session holds a claim in it.
 */
export type DeletedProject =
  | { status: "deleted"; project: string; snapshot?: string; freed?: string; kept?: string }
  | { status: "refused" | "no such project"; project: string; message: string };

export interface DeleteProjectOptions extends AddProjectOptions {
  /** The name the user typed to confirm. */
  readonly confirm: string;
  /** Whether to write a snapshot into this computer's backups first. */
  readonly snapshot: boolean;
  /** The project the caller is working in, besides the one the app here shows. */
  readonly inUse?: string;
  /** The snapshot's time, which names its file. */
  readonly now?: Date;
}

/** Where `project`'s records live and who loses them when it is deleted, in plain words. */
export function whoLoses(project: string, home: string = storytreeHome()): string {
  const library = readLibrary(home);
  return library.location === "cloudsql"
    ? `Deleting “${project}” deletes its plan, notes and whole history from your shared library on Cloud SQL (${library.instance}): every computer using that library loses it, at once. There is no undo except a snapshot.`
    : `Deleting “${project}” deletes its plan, notes and whole history from this computer’s library. There is no undo except a snapshot.`;
}

/** Delete `project`'s records once `confirm` is its name, after a snapshot when asked. */
export async function deleteProject(project: string, options: DeleteProjectOptions): Promise<DeletedProject> {
  const home = options.home ?? storytreeHome();
  if (options.confirm !== project) return { status: "refused", project, message: `Type the project’s name, “${project}”, to delete it.` };
  if (project === options.inUse || project === readProjectChoice(path.join(home, "project-choice.json"))) {
    return { status: "refused", project, message: `“${project}” is in use: it is the project ${project === options.inUse ? "this folder belongs to" : "the app on this computer shows"}. Switch to another project first.` };
  }
  return withLibrary({ ...options, home }, async (storytree) => {
    if (!(await storytree.listProjects()).includes(project)) return { status: "no such project", project, message: `There is no project called "${project}" in the library.` };
    const log = await openActivityLog(storytree);
    const live = await readClaims(log, project).finally(() => log.close());
    const working = live.filter((claim) => claim.holder === "live");
    if (working.length > 0) {
      const who = working.map((claim) => `${claim.session} (${claim.reason})`).join(", ");
      return { status: "refused", project, message: `A live session is working in “${project}”: ${who}. Wait until its claims end, then delete it.` };
    }
    let snapshot: string | undefined;
    if (options.snapshot) {
      const folder = path.join(home, "backups", project);
      mkdirSync(folder, { recursive: true });
      snapshot = path.join(folder, `${(options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(snapshot, `${JSON.stringify(await storytree.snapshot(project))}\n`);
    }
    const { freed, kept } = await freeOnThisComputer(storytree, project, home);
    await storytree.dropProject(project);
    await forgetProjectActivity(storytree, project);
    await forgetTrunk(storytree, { project });
    recordRemovedProjects(home, removedProjects(home).filter((name) => name !== project));
    return { status: "deleted", project, ...(snapshot === undefined ? {} : { snapshot }), ...(freed === undefined ? {} : { freed }), ...(kept === undefined ? {} : { kept }) };
  });
}

function markerProject(marker: string): string | undefined {
  try {
    const { project } = JSON.parse(readFileSync(marker, "utf8")) as { project?: unknown };
    return typeof project === "string" ? project : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the folder's marker is in git, where deleting it would be a change to the user's repository. */
function trackedByGit(folder: string): boolean {
  try {
    return execFileSync("git", ["ls-files", "--", MARKER_FILE], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() !== "";
  } catch {
    return false;
  }
}
