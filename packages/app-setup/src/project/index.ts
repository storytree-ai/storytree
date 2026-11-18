// Capability 3 · First-run guide.
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { forgetProjectActivity, openActivityLog, readClaims } from "@storytree/session-management";
import { findProject, forgetTrunk, keepOnThisComputer, machineOf, markerIn, PROJECT_FILE, ProjectFolderError, projectOnShow, readLibrary, readProjectChoice, recordRemovedProjects, removedProjects, storytreeHome, trunksOn } from "@storytree/project-and-caller";
import type { Storytree } from "@storytree/library";
import { folderLanguages } from "@storytree/map/folder-languages";
import { unreadableOf } from "@storytree/map/languages";

import { openStorytree } from "../setup/open-storytree.js";
import { setUpProject, suggestProjectName, unusedName } from "./making.js";

export { keepOnThisComputer, unusedName };
export { COMMIT_STORYTREE, IGNORE_FILE, STORYTREE_FOLDER } from "./storytree-folder.js";
export { firstCommit, IDENTITY_FIX, makeRepository, notAProjectYet, setUpProject, suggestedName, suggestProjectName } from "./making.js";
export type { RepositoryMade, SetUpOptions } from "./making.js";
export { SMALL_FIXES_ARC, smallFixesArc, smallFixesSentence } from "./small-fixes.js";
export { moveOntoFactory, type Moved, type MoveOptions } from "./factory-move.js";
export { ImportRefusedError, importLines, importProject, unimportedPackages, unimportedSentence } from "./importing.js";
export type { FileChanges, Imported, ImportOptions, Named, Redrawn } from "./importing.js";
export { seedStarterPack, STARTER_CHECKS, STARTER_PACK_VERSION, STARTER_ROLES, starterPackStatus, starterRolesIn, takeStarterPack, type StarterPackRecord, type StarterPackStatus, type StarterPackTake } from "./starter-pack.js";

export type ProjectFolder = { folder: string; project: string } | { folder: string; suggestion: string };

export type AddedProject =
  | { status: "set up" | "already a project" | "brought back"; folder: string; project: string; replaced?: string; unreadable?: string[] }
  | { status: "name refused"; folder: string; message: string; suggestion?: string }
  | { status: "folder refused"; folder: string; message: string };

export interface AddProjectOptions {
  readonly home?: string;
  readonly open?: (home: string) => Promise<Storytree>;
  readonly library?: Storytree;
}

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

export async function addProject(folder: string, name: string, options: AddProjectOptions = {}): Promise<AddedProject> {
  const resolved = path.resolve(folder);
  const home = options.home ?? storytreeHome();
  const found = findProject(resolved);
  return withLibrary({ ...options, home }, async (storytree) => {
    if (found.project !== undefined) {
      if (found.folder !== resolved || (await storytree.listProjects()).includes(found.project)) {
        keepOnThisComputer(found.project, home);
        return { status: "already a project", folder: resolved, project: found.project };
      }
    }
    const project = found.project ?? name;
    try {
      const identities = await storytree.projectIdentities();
      const removed = removedProjects(home).find((each) => each.folder === resolved && identities[each.name] !== undefined && (each.identity === undefined || each.identity === identities[each.name]));
      if (removed !== undefined) {
        await setUpProject({ folder: resolved, project: removed.name, storytree, storytreeHome: home, join: true });
        return { status: "brought back", folder: resolved, project: removed.name };
      }
      mkdirSync(resolved, { recursive: true });
      const { replaced } = await setUpProject({ folder: resolved, project, storytree, storytreeHome: home });
      const unreadable = unreadableOf(await folderLanguages(resolved).catch(() => undefined));
      return { status: "set up", folder: resolved, project, ...(replaced === undefined ? {} : { replaced }), ...(unreadable === undefined ? {} : { unreadable }) };
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

export type RemovedProject =
  | { status: "removed"; project: string; freed?: string; kept?: string }
  | { status: "no such project"; project: string; message: string };

export function projectsOnThisComputer(projects: Readonly<Record<string, string>>, home: string = storytreeHome()): string[] {
  const removed = removedProjects(home);
  const kept = removed.filter((each) => projects[each.name] !== undefined && (each.identity === undefined || each.identity === projects[each.name]));
  if (kept.length < removed.length) recordRemovedProjects(home, kept);
  return Object.keys(projects)
    .filter((name) => !kept.some((each) => each.name === name))
    .sort();
}

export async function projectInView(storytree: Storytree, home: string = storytreeHome()): Promise<string | undefined> {
  return projectOnShow(projectsOnThisComputer(await storytree.projectIdentities(), home), readProjectChoice(path.join(home, "project-choice.json")));
}

export async function removeProject(project: string, options: AddProjectOptions = {}): Promise<RemovedProject> {
  const home = options.home ?? storytreeHome();
  return withLibrary({ ...options, home }, async (storytree) => {
    if (!(await storytree.listProjects()).includes(project)) return { status: "no such project", project, message: `There is no project called "${project}" in the library.` };
    return freeOnThisComputer(storytree, project, home);
  });
}

async function freeOnThisComputer(storytree: Storytree, project: string, home: string): Promise<RemovedProject & { status: "removed" }> {
  const machine = machineOf(home).id;
  const trunk = (await trunksOn(storytree, machine)).find((each) => each.project === project);
  let kept = false;
  if (trunk !== undefined) {
    const marker = markerIn(trunk.folder);
    if (marker !== undefined && markerProject(marker) === project) {
      kept = trackedByGit(trunk.folder, marker);
      if (!kept) rmSync(marker);
    }
    await forgetTrunk(storytree, { project, machine }, home);
  }
  const identity = (await storytree.projectIdentities())[project];
  const known = { ...(identity === undefined ? {} : { identity }), ...(trunk === undefined ? {} : { folder: path.resolve(trunk.folder) }) };
  recordRemovedProjects(home, [...removedProjects(home).filter((each) => each.name !== project), { name: project, ...known }]);
  if (trunk === undefined) return { status: "removed", project };
  return kept ? { status: "removed", project, kept: trunk.folder } : { status: "removed", project, freed: trunk.folder };
}

export type DeletedProject =
  | { status: "deleted"; project: string; snapshot?: string; freed?: string; kept?: string }
  | { status: "refused" | "no such project"; project: string; message: string };

export interface DeleteProjectOptions extends AddProjectOptions {
  readonly confirm: string;
  readonly snapshot: boolean;
  readonly inUse?: string;
  readonly now?: Date;
  readonly records?: readonly ProjectRecords[] | undefined;
}

export interface ProjectRecords {
  readonly name: string;
  forget(server: Storytree, project: string): Promise<void>;
}

export function whoLoses(project: string, home: string = storytreeHome()): string {
  const library = readLibrary(home);
  const shared = library.location === "postgres" ? `at ${library.address}` : undefined;
  return shared !== undefined
    ? `Deleting “${project}” deletes its plan, notes and whole history from your shared library ${shared}: every computer using that library loses it, at once. There is no undo except a snapshot.`
    : `Deleting “${project}” deletes its plan, notes and whole history from this computer’s library. There is no undo except a snapshot.`;
}

export async function deleteProject(project: string, options: DeleteProjectOptions): Promise<DeletedProject> {
  const home = options.home ?? storytreeHome();
  if (options.confirm !== project) return { status: "refused", project, message: `Type the project’s name, “${project}”, to delete it.` };
  const inUse = (because: string): DeletedProject => ({ status: "refused", project, message: `“${project}” is in use: it is the project ${because}. Switch to another project first.` });
  if (project === options.inUse) return inUse("this folder belongs to");
  return withLibrary({ ...options, home }, async (storytree) => {
    if (project === await projectInView(storytree, home)) return inUse("the app on this computer shows");
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
      for (const dir of [backups, folder]) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        if (!lstatSync(dir).isDirectory()) throw new Error(`Backup folder is not a directory: ${dir}`);
        if (process.platform !== "win32") chmodSync(dir, 0o700);
      }
      snapshot = path.join(folder, `${(options.now ?? new Date()).toISOString().replace(/[:.]/g, "-")}.json`);
      const contents = `${JSON.stringify(await storytree.snapshot(project))}\n`;
      if (process.platform === "win32") {
        windowsSnapshotPermissions([...[backups, folder].map(file => ({ file, kind: "directory" as const })), { file: snapshot, kind: "create" }]);
      }
      writeFileSync(snapshot, contents, { mode: 0o600, flag: process.platform === "win32" ? "r+" : "wx" });
    }
    const { freed, kept } = await freeOnThisComputer(storytree, project, home);
    await storytree.dropProject(project);
    await forgetProjectActivity(storytree, project);
    for (const records of options.records ?? []) await records.forget(storytree, project);
    await forgetTrunk(storytree, { project }, home);
    recordRemovedProjects(home, removedProjects(home).filter((each) => each.name !== project));
    return { status: "deleted", project, ...(snapshot === undefined ? {} : { snapshot }), ...(freed === undefined ? {} : { freed }), ...(kept === undefined ? {} : { kept }) };
  });
}

function windowsSnapshotPermissions(entries: { file: string; kind: "directory" | "create" }[]): void {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$entries = ConvertFrom-Json ([Console]::In.ReadToEnd())
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
# SetAccessControl/SetNamedSecurityInfo propagate removal of inherited rules into unrelated files.
# This supported legacy API changes only the named object (including its protected-DACL flag).
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw
# Bound in memory: Add-Type would start csc.exe, whose cold compile has run past 30 s on a loaded Windows CI runner.
$type = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('DeletionSnapshotPermissions'), [Reflection.Emit.AssemblyBuilderAccess]::Run).DefineDynamicModule('DeletionSnapshotPermissions').DefineType('DeletionSnapshotPermissions', 'Public, Class')
$method = $type.DefineMethod('SetFileSecurityW', 'Public, Static, PinvokeImpl', [bool], [Type[]]@([string], [uint32], [byte[]]))
$dllImport = [Runtime.InteropServices.DllImportAttribute]
$fields = [Reflection.FieldInfo[]]@($dllImport.GetField('SetLastError'), $dllImport.GetField('CharSet'), $dllImport.GetField('EntryPoint'))
$method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($dllImport.GetConstructor([Type[]]@([string])), [object[]]@('advapi32.dll'), $fields, [object[]]@($true, [Runtime.InteropServices.CharSet]::Unicode, 'SetFileSecurityW')))
$native = $type.CreateType()
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
    # OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION (0x80000005)
    if (-not $native::SetFileSecurityW($entry.file, [uint32]2147483653, $acl.GetSecurityDescriptorBinaryForm())) {
      throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
  }
}`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  try {
    execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { input: JSON.stringify(entries), env, windowsHide: true, timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    if ((error as { status?: number }).status === 73) {
      throw Object.assign(new Error("The deletion snapshot already exists."), { code: "EEXIST" });
    }
    throw error;
  }
}

export function markerNamed(folder: string): string {
  const marker = markerIn(folder);
  return marker === undefined ? PROJECT_FILE : path.relative(folder, marker).split(path.sep).join("/");
}

function markerProject(marker: string): string | undefined {
  try {
    const { project } = JSON.parse(readFileSync(marker, "utf8")) as { project?: unknown };
    return typeof project === "string" ? project : undefined;
  } catch {
    return undefined;
  }
}

function trackedByGit(folder: string, marker: string): boolean {
  try {
    return execFileSync("git", ["ls-files", "--", path.relative(folder, marker)], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() !== "";
  } catch {
    return false;
  }
}
