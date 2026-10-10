/**
 * Capability 3 · First-run guide. Adding a project (ADR-0752, ADR-0757): the folder the user chose, in the installer's folder step
 * or the app's Add project, becomes a storytree project through the one setup check (capability 6, making.ts),
 * as every other way of adding one does. The choice is the user's explicit yes; a folder that
 * already belongs to a project is left as it is (and put back on this computer's list, if it was
 * removed from it), and a folder the check refuses is said with why.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findProject, forgetProjectActivity, forgetTrunk, keepOnThisComputer, machineOf, MARKER_FILE, openActivityLog, ProjectFolderError, readClaims, readLibrary, readProjectChoice, recordRemovedProjects, removedProjects, storytreeHome, trunksOn } from "@storytree/agent-link";
import type { Storytree } from "@storytree/library";
import { forgetProjectQuality } from "@storytree/quality-assurance";

import { openStorytree } from "../setup/open-storytree.js";
import { setUpProject, suggestProjectName, unusedName } from "./making.js";

export { keepOnThisComputer, unusedName };
export { notAProjectYet, setUpProject, suggestedName, suggestProjectName } from "./making.js";
export type { SetUpOptions } from "./making.js";
export { seedStarterPack, STARTER_PACK_VERSION, STARTER_ROLES, starterRolesIn } from "./starter-pack.js";

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
 * `projects` (every project in the library, by the identity of its database) less those removed
 * from this computer. A removed project no longer in the library was deleted (from any computer),
 * so it leaves this computer's list too: a later project of that name has a database of its own, a
 * new project, shown here, even when this computer did not look in between.
 */
export function projectsOnThisComputer(projects: Readonly<Record<string, string>>, home: string = storytreeHome()): string[] {
  const removed = removedProjects(home);
  const kept = removed.filter((each) => projects[each.name] !== undefined && (each.identity === undefined || each.identity === projects[each.name]));
  if (kept.length < removed.length) recordRemovedProjects(home, kept);
  return Object.keys(projects)
    .filter((name) => !kept.some((each) => each.name === name))
    .sort();
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
    await forgetTrunk(storytree, { project, machine }, home);
  }
  const identity = (await storytree.projectIdentities())[project];
  recordRemovedProjects(home, [...removedProjects(home).filter((each) => each.name !== project), { name: project, ...(identity === undefined ? {} : { identity }) }]);
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
  const shared = library.location === "cloudsql" ? `on Cloud SQL (${library.instance})` : library.location === "postgres" ? `at ${library.address}` : undefined;
  return shared !== undefined
    ? `Deleting “${project}” deletes its plan, notes and whole history from your shared library ${shared}: every computer using that library loses it, at once. There is no undo except a snapshot.`
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
      const backups = path.join(home, "backups"), folder = path.join(backups, project);
      // Protect both new and existing folders before saving anything.
      for (const dir of [backups, folder]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (!lstatSync(dir).isDirectory()) throw new Error(`Backup folder is not a directory: ${dir}`);
        if (process.platform !== "win32") chmodSync(dir, 0o700);
      }
      if (process.platform === "win32") windowsSnapshotPermissions([backups, folder].map(file => ({ file, kind: "directory" })));
      snapshot = path.join(folder, `${(options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")}.json`);
      const contents = `${JSON.stringify(await storytree.snapshot(project))}\n`;
      // Create the Windows file exclusively with its DACL before it receives the snapshot.
      if (process.platform === "win32") windowsSnapshotPermissions([{ file: snapshot, kind: "create" }]);
      writeFileSync(snapshot, contents, { mode: 0o600, flag: process.platform === "win32" ? "r+" : "wx" });
    }
    const { freed, kept } = await freeOnThisComputer(storytree, project, home);
    await storytree.dropProject(project);
    await forgetProjectActivity(storytree, project);
    await forgetProjectQuality(storytree, project);
    await forgetTrunk(storytree, { project }, home);
    recordRemovedProjects(home, removedProjects(home).filter((each) => each.name !== project));
    return { status: "deleted", project, ...(snapshot === undefined ? {} : { snapshot }), ...(freed === undefined ? {} : { freed }), ...(kept === undefined ? {} : { kept }) };
  });
}

/** Same owner-only policy as automatic backups, owned here by project deletion. The non-propagating
 * directory repair leaves unrelated children alone; each new file has an explicit protected DACL.
 * A failed permission operation aborts deletion, with no chmod fallback on Windows.
 */
function windowsSnapshotPermissions(entries: { file: string; kind: "directory" | "create" }[]): void {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$entries = ConvertFrom-Json ([Console]::In.ReadToEnd())
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
# SetAccessControl/SetNamedSecurityInfo propagate removal of inherited rules into unrelated files.
# This supported legacy API changes only the named object (including its protected-DACL flag).
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DeletionSnapshotPermissions {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool SetFileSecurityW(string name, uint information, byte[] descriptor);
  public static void Set(string name, byte[] descriptor) {
    // OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
    if (!SetFileSecurityW(name, 0x80000005, descriptor)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
foreach ($entry in $entries) {
  $acl = if ($entry.kind -eq 'directory') { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($owner)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'Allow'))
  if ($entry.kind -eq 'create') {
    try {
      $stream = [IO.FileStream]::new($entry.file, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
      $stream.Dispose()
    } catch {
      $code = $_.Exception.GetBaseException().HResult -band 0xffff
      if ($code -eq 80 -or $code -eq 183) { exit 73 } # ERROR_FILE_EXISTS / ERROR_ALREADY_EXISTS
      throw
    }
  } else {
    [DeletionSnapshotPermissions]::Set($entry.file, $acl.GetSecurityDescriptorBinaryForm())
  }
}`;
  const env = { ...process.env };
  // A parent PowerShell 7's module path can break Windows PowerShell 5's built-in cmdlets.
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  try {
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { input: JSON.stringify(entries), env, windowsHide: true, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    if ((error as { status?: number }).status === 73) {
      throw Object.assign(new Error("The deletion snapshot already exists."), { code: "EEXIST" });
    }
    throw error;
  }
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
