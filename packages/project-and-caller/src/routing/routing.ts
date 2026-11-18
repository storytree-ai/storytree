// Capability 1 · Project routing
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { ConnectOptions, Library, OpenOptions, Storytree } from "@storytree/library";

import { readLibrary } from "../settings/settings.js";

import { approvedTrunk, machineOf, ProjectFolderError, remembered, rememberApproval, storytreeHome } from "./trunks.js";

export { storytreeHome };
import { authenticatedLocalUrl, HANDOFF_UNAVAILABLE, HandoffPrivacyError, type LocalOwner } from "./local-handoff.js";

export const PROJECT_FILE = ".storytree/project.json";
export const ROOT_MARKER_FILE = ".storytree.json";
export const NOT_A_PROJECT = "not a storytree project";
export const NOT_RUNNING = "storytree isn't running";

export type ProjectLookup = { project: string; folder: string; identity?: string } | { project: undefined; message: string };

export interface LocateOptions {
  readonly home?: string;
  readonly dataDir?: string;
}

export type StorytreeAddress = { running: true; url: string } | { running: false; message: string };

export type Route =
  | { status: "routed"; project: string; folder: string; identity?: string; library: ConnectOptions }
  | { status: "not-a-project"; message: string }
  | { status: "not-running"; project: string; message: string };

export function findProject(from: string): ProjectLookup {
  const start = path.resolve(from);
  const found = markerAbove(start);
  if (found !== undefined) return found;
  const linked = linkedWorktree(start);
  if (linked !== undefined) {
    const inMain = markerAbove(path.join(linked.main, path.relative(linked.root, start)));
    if (inMain !== undefined) return inMain;
  }
  return { project: undefined, message: NOT_A_PROJECT };
}

export async function openNamedProject(storytree: Pick<Storytree, "openProject">, project: string, identity?: string, { system, kinds }: Pick<OpenOptions, "system" | "kinds"> = {}): Promise<Library> {
  try {
    return await storytree.openProject(project, { create: false, ...(identity === undefined ? {} : { identity }), ...(system === undefined ? {} : { system }), ...(kinds === undefined ? {} : { kinds }) });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ProjectGoneError")) throw error;
    throw goneProject(project);
  }
}

function goneProject(project: string): ProjectFolderError {
  return new ProjectFolderError(`This folder names project "${project}" in its marker, but the library has no such project: it was deleted, perhaps from another computer. Delete its ${PROJECT_FILE} (or ${ROOT_MARKER_FILE}, in a project set up before it moved there) to free the folder; to start a project here, set it up again.`);
}

export function missingProjectReading(project: string): string {
  return `This folder's marker names storytree project "${project}", but this computer's library has no project "${project}": it was set up against another library, or deleted from this one.`;
}

export async function requireApproval(storytree: Storytree, project: string, folder: string, home: string = storytreeHome()): Promise<void> {
  const machine = machineOf(home);
  const at = checkoutOf(folder);
  if (rememberedHere(project, at, home, machine.id)) return;
  const trunk = await approvedTrunk(storytree, project, machine.id, at);
  if (trunk !== undefined) return rememberApproval(home, machine.id, trunk);
  if (!(await storytree.listProjects()).includes(project)) throw new ProjectFolderError(`${missingProjectReading(project)} To use storytree here, set this folder up as a new project, which replaces its marker (${PROJECT_FILE}, or ${ROOT_MARKER_FILE} in a project set up before it moved there); if "${project}" is in another library you can reach, point this computer's library setting at that library and join it.`);
  throw new ProjectFolderError(`${at} names storytree project "${project}", but it is not approved as "${project}"'s checkout on this machine, so storytree opens nothing and records nothing here. If this is your checkout of "${project}", approve it on purpose: \`storytree doctor --join ${project}\` in a terminal there, or ask your agent to join it.`);
}

export function approvedHere(project: string, folder: string, home: string = storytreeHome()): boolean {
  return rememberedHere(project, checkoutOf(folder), home, machineOf(home).id);
}

function rememberedHere(project: string, at: string, home: string, machine: string): boolean {
  return remembered(home, machine).some((trunk) => trunk.project === project && within(at, trunk.folder));
}

function checkoutOf(folder: string): string {
  return canonical(inMainCheckout(canonical(path.resolve(folder))));
}

export function inMainCheckout(folder: string): string {
  const start = path.resolve(folder);
  const linked = linkedWorktree(start);
  return linked === undefined ? start : path.join(linked.main, path.relative(linked.root, start));
}

export function locateStorytree(options: LocateOptions = {}): StorytreeAddress {
  const dataDir = options.dataDir ?? defaultDataDir();
  const record = ownerRecord(dataDir);
  if (record === undefined || !isAlive(record.pid)) return { running: false, message: NOT_RUNNING };
  try {
    return { running: true, url: authenticatedLocalUrl(dataDir, record) };
  } catch (error) {
    return { running: false, message: error instanceof HandoffPrivacyError ? error.message : HANDOFF_UNAVAILABLE };
  }
}

export function locateLibrary(options: LocateOptions = {}): { found: true; connect: ConnectOptions } | { found: false; message: string } {
  const home = options.home ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));
  const setting = readLibrary(home);
  if (setting.location === "postgres") return { found: true, connect: { address: setting.address } };
  const local = locateStorytree({ dataDir: options.dataDir ?? path.join(home, "pgdata") });
  return local.running ? { found: true, connect: { url: local.url } } : { found: false, message: local.message };
}

export function locateApp(home: string = storytreeHome()): { running: boolean } {
  const owner = ownerRecord(path.join(home, "pgdata"));
  if (owner !== undefined && isAlive(owner.pid)) return { running: true };
  try {
    const { pid } = JSON.parse(readFileSync(path.join(home, "app.json"), "utf8")) as { pid?: unknown };
    return { running: typeof pid === "number" && Number.isInteger(pid) && pid > 0 && isAlive(pid) };
  } catch {
    return { running: false };
  }
}

export function withConnectTimeout(library: ConnectOptions, connectTimeoutMs: number): ConnectOptions {
  return library.url === undefined ? library : { ...library, connectTimeoutMs };
}

export function route(from: string, options: LocateOptions = {}): Route {
  const found = findProject(from);
  if (found.project === undefined) return { status: "not-a-project", message: found.message };
  const library = locateLibrary(options);
  if (!library.found) return { status: "not-running", project: found.project, message: library.message };
  return { status: "routed", project: found.project, folder: found.folder, ...(found.identity === undefined ? {} : { identity: found.identity }), library: library.connect };
}

function defaultDataDir(): string {
  return path.join(storytreeHome(), "pgdata");
}

function within(folder: string, root: string): boolean {
  const key = (file: string) => (process.platform === "win32" ? file.toLowerCase() : file);
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function markerAbove(start: string): ProjectLookup | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const marker = markerIn(dir);
    if (marker !== undefined) {
      const named = projectIn(marker);
      return named === undefined ? { project: undefined, message: NOT_A_PROJECT } : { ...named, folder: canonical(dir) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

export function markerIn(folder: string): string | undefined {
  const file = [PROJECT_FILE, ROOT_MARKER_FILE].find((each) => isFile(path.join(folder, each)));
  return file === undefined ? undefined : path.join(folder, file);
}

function projectIn(marker: string): { project: string; identity?: string } | undefined {
  try {
    const { project, identity } = JSON.parse(readFileSync(marker, "utf8")) as { project?: unknown; identity?: unknown };
    if (typeof project !== "string" || project === "") return undefined;
    return typeof identity === "string" && identity !== "" ? { project, identity } : { project };
  } catch {
    return undefined;
  }
}

function linkedWorktree(start: string): { root: string; main: string } | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, ".git");
    if (existsSync(dotGit)) {
      if (!isFile(dotGit)) return undefined;
      const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit))?.[1];
      if (gitDir === undefined) return undefined;
      const ownGitDir = path.resolve(dir, gitDir);
      const common = readText(path.join(ownGitDir, "commondir")).trim();
      if (common === "") return undefined;
      const commonDir = path.resolve(ownGitDir, common);
      if (path.basename(commonDir) !== ".git") return undefined;
      if (canonical(path.dirname(ownGitDir)) !== canonical(path.join(commonDir, "worktrees"))) return undefined;
      const back = readText(path.join(ownGitDir, "gitdir")).trim();
      if (back === "" || canonical(path.resolve(ownGitDir, back)) !== canonical(dotGit)) return undefined;
      return { root: dir, main: canonical(path.dirname(commonDir)) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function ownerRecord(dataDir: string): LocalOwner | undefined {
  try {
    const record = JSON.parse(readFileSync(`${path.resolve(dataDir)}.owner.json`, "utf8")) as LocalOwner;
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM";
  }
}

function canonical(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
