/**
 * Capability 1 · Project routing (the agent link story): the first time an agent session starts in
 * a folder that isn't a storytree project, storytree asks the user whether to set one up, and a yes
 * leaves a marker naming the project. From then on everything an agent does anywhere in that folder
 * is routed to that project. It never picks a project by itself, and when storytree isn't running
 * it says so at once.
 *
 * - The marker is `.storytree.json` in the project's folder: `{ "project": "<name>" }`. A folder
 *   belongs to the project of the nearest marker at or above it. A git worktree kept outside its
 *   folder has no marker of its own unless the marker was committed, so a worktree is also looked
 *   up in the folder it is a worktree of.
 * - Where storytree is: the running 0.3 app's Postgres, found from the owner record
 *   @storytree/local-postgres keeps beside the app's data directory (`<dataDir>.owner.json`, holding
 *   the owner's pid and the server's port) while the app holds it. Its server is always
 *   `postgres@127.0.0.1:<port>`, trusting local connections. A record whose process has ended is a
 *   crashed app's leftover, and counts as not running: its address is never tried, so nothing
 *   waits on it.
 * - Unless the user's `library` setting (capability 10, ADR-0734/0735) names a Google Cloud SQL
 *   instance: then a project routes to that instance and the account to sign in as, whatever the
 *   app's local database is doing, and no local address is looked up at all. What a routed project
 *   carries is the library's own connect() options, so every caller reaches the same place.
 *
 * Everything here but setting a folder up is synchronous and touches only the file system, so an
 * answer, "not running" included, comes back in milliseconds.
 */
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ConnectOptions, Storytree } from "@storytree/library";

import { readLibrary } from "../settings/settings.js";

import { recordProjectChoice } from "./project-choice.js";

/** The marker a folder set up as a storytree project holds. */
export const MARKER_FILE = ".storytree.json";
/** What routing says of a folder nobody has set up. */
export const NOT_A_PROJECT = "not a storytree project";
/** What routing says while the app's database is not running. */
export const NOT_RUNNING = "storytree isn't running";

/** The project a folder belongs to, and the folder holding its marker; or why there is none. */
export type ProjectLookup = { project: string; folder: string } | { project: undefined; message: string };

export interface SetUpOptions {
  /** The folder the user said yes for. */
  readonly folder: string;
  /** The project's name, as the user gave it. */
  readonly project: string;
  /** A connection to the running storytree's library. */
  readonly storytree: Storytree;
  /** The app's home; defaults to STORYTREE_HOME, else ~/.storytree/0.3. */
  readonly storytreeHome?: string;
}

export interface LocateOptions {
  /**
   * The storytree home whose settings.json says where the library lives. By default the folder
   * holding `dataDir` when one is given, else STORYTREE_HOME, else ~/.storytree/0.3.
   */
  readonly home?: string;
  /**
   * The app's Postgres data directory, beside which its owner record is kept. By default
   * `<storytree home>/pgdata`, the home being STORYTREE_HOME when set, else ~/.storytree/0.3.
   */
  readonly dataDir?: string;
}

/** Where the running storytree's database listens, or that it isn't running. */
export type StorytreeAddress = { running: true; url: string } | { running: false; message: string };

/** Where an agent's activity in a folder goes. */
export type Route =
  | { status: "routed"; project: string; folder: string; library: ConnectOptions }
  | { status: "not-a-project"; message: string }
  | { status: "not-running"; project: string; message: string };

/**
 * The project `from` belongs to: the one named by the nearest marker at or above it, or, for a git
 * worktree with none, at or above the same place in the folder it is a worktree of.
 */
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

/**
 * Set `folder` up as project `project`, after the user said yes: open the project in the library
 * (creating its library the first time), leave the marker, then record the user's choice for the app.
 * The name is judged by the library,
 * which refuses one that breaks its rule (ProjectNameError) before anything touches the server; a
 * refusal leaves nothing behind.
 */
export async function setUpProject({ folder, project, storytree, storytreeHome: home = storytreeHome() }: SetUpOptions): Promise<{ project: string; marker: string }> {
  const library = await storytree.openProject(project);
  await library.close();
  const marker = path.join(folder, MARKER_FILE);
  const previous = existsSync(marker) ? readFileSync(marker) : undefined;
  writeFileSync(marker, `${JSON.stringify({ project }, null, 2)}\n`);
  try {
    recordProjectChoice(path.join(home, "project-choice.json"), project);
  } catch (error) {
    // A new marker would make the tool's explicit retry stop at "already set up".
    if (previous === undefined) rmSync(marker);
    else writeFileSync(marker, previous);
    throw error;
  }
  return { project, marker };
}

/** Where the running storytree's database listens, from the app's owner record, or that it isn't running. */
export function locateStorytree(options: LocateOptions = {}): StorytreeAddress {
  const record = ownerRecord(options.dataDir ?? defaultDataDir());
  if (record === undefined || !isAlive(record.pid)) return { running: false, message: NOT_RUNNING };
  return { running: true, url: `postgres://postgres@127.0.0.1:${record.port}/postgres` };
}

/**
 * Where the library is, as the user's `library` setting says: the Cloud SQL instance it names, or
 * the running app's local database. The settings file is read fresh, and an invalid one is thrown
 * as it is, naming the file: it is never read as local.
 */
export function locateLibrary(options: LocateOptions = {}): { found: true; connect: ConnectOptions } | { found: false; message: string } {
  const home = options.home ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));
  const setting = readLibrary(home);
  if (setting.location === "cloudsql") return { found: true, connect: { cloudSql: { instance: setting.instance, user: setting.user } } };
  const local = locateStorytree({ dataDir: options.dataDir ?? path.join(home, "pgdata") });
  return local.running ? { found: true, connect: { url: local.url } } : { found: false, message: local.message };
}

/** `library` with a deadline on each new local handshake; a Cloud SQL instance keeps its own bound. */
export function withConnectTimeout(library: ConnectOptions, connectTimeoutMs: number): ConnectOptions {
  return library.url === undefined ? library : { ...library, connectTimeoutMs };
}

/**
 * Where an agent's activity in `from` goes: the project it belongs to on the running storytree, or
 * why nowhere. A folder that is not a project is that whatever storytree's state.
 */
export function route(from: string, options: LocateOptions = {}): Route {
  const found = findProject(from);
  if (found.project === undefined) return { status: "not-a-project", message: found.message };
  const library = locateLibrary(options);
  if (!library.found) return { status: "not-running", project: found.project, message: library.message };
  return { status: "routed", project: found.project, folder: found.folder, library: library.connect };
}

/** A project name to suggest for `folder`: its own name, as the library's project-name rule allows. */
export function suggestedName(folder: string): string {
  const name = path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return name === "" ? "my-project" : name;
}

/**
 * What the agent is to do in `folder`, which isn't a storytree project yet: ask the user, and set it
 * up only on their yes (ADR-0626 D5). check_setup says it, and so does the session-start hook.
 */
export function askToSetUp(folder: string): string {
  return `This folder isn't a storytree project yet. Ask the user whether to set storytree up here, as project "${suggestedName(folder)}" or a name they choose (lower-case letters, digits and hyphens). Only if they say yes, call set_up_project with that name; without a yes, set nothing up and carry on.`;
}

/** The storytree 0.3 home: STORYTREE_HOME, else ~/.storytree/0.3, where the desktop app keeps its Postgres. */
export function storytreeHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}

function defaultDataDir(): string {
  return path.join(storytreeHome(), "pgdata");
}

/**
 * The nearest marker at or above `start`. A marker that cannot be read, or names no project, stops
 * the search: the folder claims to be a project, and a guess at another would route it wrongly.
 */
function markerAbove(start: string): ProjectLookup | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const marker = path.join(dir, MARKER_FILE);
    if (isFile(marker)) {
      const project = projectIn(marker);
      return project === undefined ? { project: undefined, message: NOT_A_PROJECT } : { project, folder: canonical(dir) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

function projectIn(marker: string): string | undefined {
  try {
    const { project } = JSON.parse(readFileSync(marker, "utf8")) as { project?: unknown };
    return typeof project === "string" && project !== "" ? project : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The linked git worktree `start` is in: its root, and the root of the main worktree it belongs to.
 * A linked worktree's `.git` is a file naming its own git directory, whose `commondir` leads to the
 * repository's shared `.git`, inside the main worktree. Undefined when `start` is in no linked
 * worktree (a main worktree, a submodule, or no repository at all).
 */
function linkedWorktree(start: string): { root: string; main: string } | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const dotGit = path.join(dir, ".git");
    if (existsSync(dotGit)) {
      if (!isFile(dotGit)) return undefined; // a main worktree
      const gitDir = /^gitdir:\s*(.+?)\s*$/m.exec(readText(dotGit))?.[1];
      if (gitDir === undefined) return undefined;
      const ownGitDir = path.resolve(dir, gitDir);
      const common = readText(path.join(ownGitDir, "commondir")).trim();
      if (common === "") return undefined; // a submodule: its git directory has no commondir
      const commonDir = path.resolve(ownGitDir, common);
      if (path.basename(commonDir) !== ".git") return undefined; // a bare repository has no main worktree
      return { root: dir, main: canonical(path.dirname(commonDir)) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The owner record beside `dataDir`, if there is one that names a process and a port. */
function ownerRecord(dataDir: string): { pid: number; port: number } | undefined {
  try {
    const { pid, port } = JSON.parse(readFileSync(`${path.resolve(dataDir)}.owner.json`, "utf8")) as { pid?: unknown; port?: unknown };
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(port)) return undefined;
    return { pid: pid as number, port: port as number };
  } catch {
    return undefined;
  }
}

/** Whether process `pid` is running. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === "EPERM"; // alive, but not ours to signal
  }
}

/** The path with symlinks resolved and, on Windows, short (8.3) names spelled out; as it is if it cannot be. */
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
