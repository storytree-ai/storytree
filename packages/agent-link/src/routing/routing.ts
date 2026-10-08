/**
 * Capability 1 · Project routing (the agent link story): the first time an agent session starts in
 * a folder that isn't a storytree project, storytree asks the user whether to set one up, and a yes
 * leaves a marker naming the project. From then on everything an agent does anywhere in that folder
 * is routed to that project. It never picks a project by itself, and when storytree isn't running
 * it says so at once.
 *
 * - The marker is `.storytree.json` in the project's folder: `{ "project": "<name>", "identity": "<its
 *   database's>" }`; one written before the identity was recorded names the project only. A folder
 *   belongs to the project of the nearest marker at or above it. A git worktree kept outside its
 *   folder has no marker of its own unless the marker was committed, so a worktree is also looked
 *   up in the folder it is a worktree of.
 * - A marker is a claim, not a key (ADR-0942): a checkout reaches its project's hooks and tools only
 *   once its trunk is approved on this machine (requireApproval), checked before anything is opened,
 *   appended or read. Setting the folder up approves it, and so does joining on purpose, which is
 *   also how a trunk recorded before approval, or one that moved, is approved.
 * - Where storytree is: the running 0.3 app's Postgres, found from the owner record
 *   @storytree/local-postgres keeps beside the app's data directory (`<dataDir>.owner.json`, holding
 *   the owner's pid and the server's port) while the app holds it. Authenticated installations
 *   hand credentials over separately in a private `<dataDir>.auth/connection.json`; only old
 *   installations with no authentication metadata keep the legacy passwordless URL during staging.
 *   A record whose process has ended is a
 *   crashed app's leftover, and counts as not running: its address is never tried, so nothing
 *   waits on it.
 * - Unless the user's `library` setting (capability 10, ADR-0734/0735) names a Google Cloud SQL
 *   instance: then a project routes to that instance and the account to sign in as, whatever the
 *   app's local database is doing, and no local address is looked up at all. What a routed project
 *   carries is the library's own connect() options, so every caller reaches the same place.
 *
 * Discovery is synchronous and uses no network. Stale owners refuse before credentials are read;
 * authenticated Windows discovery also checks the handoff's filesystem ACLs through PowerShell.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { ConnectOptions, Library, Storytree } from "@storytree/library";

import { readLibrary } from "../settings/settings.js";

import { keepOnThisComputer, recordProjectChoice } from "./project-choice.js";
import { approvedTrunk, approveTrunk, forgetTrunk, machineOf, ProjectFolderError, refusal, registerTrunk, type Trunk, trunksOn, unusedName } from "./trunks.js";
import { seedStarterPack } from "./starter-pack.js";
import { authenticatedLocalUrl, HANDOFF_UNAVAILABLE, HandoffPrivacyError, type LocalOwner } from "./local-handoff.js";

/** The marker a folder set up as a storytree project holds. */
export const MARKER_FILE = ".storytree.json";
/** What routing says of a folder nobody has set up. */
export const NOT_A_PROJECT = "not a storytree project";
/** What routing says while the app's database is not running. */
export const NOT_RUNNING = "storytree isn't running";

/**
 * The project a folder belongs to, and the folder holding its marker, with the identity of the
 * project's database when the marker records it; or why there is none.
 */
export type ProjectLookup = { project: string; folder: string; identity?: string } | { project: undefined; message: string };

export interface SetUpOptions {
  /** The folder the user said yes for. */
  readonly folder: string;
  /** The project's name, as the user gave it. */
  readonly project: string;
  /** A connection to the running storytree's library. */
  readonly storytree: Storytree;
  /** The app's home; defaults to STORYTREE_HOME, else ~/.storytree/0.3. It keeps this machine's identity. */
  readonly storytreeHome?: string;
  /** Add this machine's checkout to project `project`, which already exists (ADR-0757 D4). */
  readonly join?: boolean;
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
  | { status: "routed"; project: string; folder: string; identity?: string; library: ConnectOptions }
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
 * Open the project a folder names, only reaching it: a project deleted from the library, perhaps
 * from another computer, is never made again by a folder that still names it (ADR-0831), and with
 * the `identity` its marker records, a new project set up since under the same name is not the
 * folder's. Refused with what to do: free the folder, or set it up again on purpose.
 */
export async function openNamedProject(storytree: Pick<Storytree, "openProject">, project: string, identity?: string): Promise<Library> {
  try {
    return await storytree.openProject(project, { create: false, ...(identity === undefined ? {} : { identity }) });
  } catch (error) {
    // By name: the hooks load the library only when they need it.
    if (!(error instanceof Error && error.name === "ProjectGoneError")) throw error;
    throw new ProjectFolderError(`This folder names project "${project}" in its ${MARKER_FILE}, but the library has no such project: it was deleted, perhaps from another computer. Delete ${MARKER_FILE} to free the folder; to start a project here, set it up again.`);
  }
}

/**
 * Set `folder` up as project `project`, after the user said yes: the one check (ADR-0757) first,
 * then open the project in the library (creating its library the first time, seeded with the
 * starter pack, 1.14), record the folder as
 * the project's trunk on this machine, leave the marker, and record the user's choice for the app.
 * A refused folder (ProjectFolderError) or name (ProjectNameError, judged by the library before
 * anything touches the server) leaves nothing behind. `join` adds this machine's checkout to a
 * project that already exists; without it, an existing project's name is refused. Either approves
 * the trunk (ADR-0942 D1), and joining from a project's own recorded trunk approves it in place.
 */
export async function setUpProject({ folder, project, storytree, storytreeHome: home = storytreeHome(), join = false }: SetUpOptions): Promise<{ project: string; marker: string }> {
  const at = canonical(path.resolve(folder));
  const existing = findProject(at);
  // Joining on purpose from the folder its marker already names is how an unapproved trunk is approved (ADR-0942 D1).
  const rejoining = join && existing.project === project && existing.folder === at;
  if (existing.project !== undefined && !rejoining) throw new ProjectFolderError(`${at} is already part of storytree project "${existing.project}" (its folder is ${existing.folder}).`);
  const machine = machineOf(home);
  const [projects, trunks] = await Promise.all([storytree.listProjects(), liveTrunks(storytree, machine.id)]);
  const refused = refusal({ folder: at, inMain: inMainCheckout(at), project, join, projects, trunks, suggestion: unusedName(suggestedName(at), projects) });
  if (refused !== undefined) throw refused;
  const library = await storytree.openProject(project);
  const { identity } = library;
  try {
    // A new project inherits no lines written under its name before it: an older install's hooks, in a deleted project's folder.
    if (!join) await (await import("../activity/index.js")).forgetProjectActivity(storytree, project);
    const own = trunks.find((trunk) => trunk.project === project);
    const by = join ? "join" : "setup";
    const registered = own === undefined ? await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: at }, by) : own.approvedBy !== undefined || (await approveTrunk(storytree, own, by));
    if (!registered) throw new ProjectFolderError(`${at} or project "${project}" was set up on this machine a moment ago by something else; check it again before setting it up.`);
    rememberApproval(home, machine.id, own ?? { project, folder: at });
    // A new project's library starts with the starter pack; one joined was seeded where it was set up.
    if (!join) await seedStarterPack(library);
  } finally {
    await library.close();
  }
  // Should what follows fail, the trunk stays recorded: a retry here sets its own trunk up again.
  const marker = path.join(at, MARKER_FILE);
  const previous = existsSync(marker) ? readFileSync(marker) : undefined;
  writeFileSync(marker, `${JSON.stringify({ project, identity }, null, 2)}\n`);
  try {
    recordProjectChoice(path.join(home, "project-choice.json"), project);
    // A project removed from this computer and joined again on purpose is back on its list.
    keepOnThisComputer(project, home);
  } catch (error) {
    // A new marker would make the tool's explicit retry stop at "already set up".
    if (previous === undefined) rmSync(marker);
    else writeFileSync(marker, previous);
    throw error;
  }
  return { project, marker };
}

/**
 * Refuse unless `folder` (a git worktree's main checkout standing for it) is in `project`'s approved
 * trunk on this machine (ADR-0942 D1, D2): a marker, a known identity or a folder's name approves
 * nothing. Every hook and tool asks this before it opens the project, appends to its activity or
 * reads it. The refusal (a ProjectFolderError) says how to approve the folder on purpose.
 */
export async function requireApproval(storytree: Storytree, project: string, folder: string, home: string = storytreeHome()): Promise<void> {
  const machine = machineOf(home);
  const at = canonical(inMainCheckout(canonical(path.resolve(folder))));
  // A hook runs at every step: an approval this machine has seen is remembered, so the trunks are asked once.
  if (remembered(home, machine.id).some((trunk) => trunk.project === project && within(at, trunk.folder))) return;
  const trunk = await approvedTrunk(storytree, project, machine.id, at);
  if (trunk !== undefined) return rememberApproval(home, machine.id, trunk);
  throw new ProjectFolderError(`${at} names storytree project "${project}", but it is not approved as "${project}"'s checkout on this machine, so storytree opens nothing and records nothing here. If this is your checkout of "${project}", approve it on purpose: \`storytree doctor --join ${project}\` in a terminal there, or ask your agent to join it.`);
}

/**
 * This machine's trunks whose folders are still there. A trunk whose folder is gone (moved away or
 * deleted) is forgotten, so the project can be joined or seen at its new folder. A folder that is
 * there keeps its trunk even with its marker gone: the record, not the marker, holds it (1.8).
 */
async function liveTrunks(storytree: Storytree, machine: string): Promise<Trunk[]> {
  const trunks = await trunksOn(storytree, machine);
  await forgetStale(storytree, trunks);
  return trunks.filter((trunk) => existsSync(trunk.folder));
}

/** Forget each of `trunks` whose folder is gone; true when any was. */
async function forgetStale(storytree: Storytree, trunks: readonly Trunk[]): Promise<boolean> {
  const stale = trunks.filter((trunk) => !existsSync(trunk.folder));
  for (const trunk of stale) await forgetTrunk(storytree, trunk);
  return stale.length > 0;
}

/** A name to suggest for `folder` as a new project: its own name, or the first of name-2, name-3… no project has. */
export async function suggestProjectName(folder: string, storytree: Storytree): Promise<string> {
  return unusedName(suggestedName(folder), await storytree.listProjects());
}

/**
 * Where `folder` sits in its repository's main checkout when it is in a linked git worktree (the
 * same place in the folder it is a worktree of); `folder` itself otherwise.
 */
export function inMainCheckout(folder: string): string {
  const start = path.resolve(folder);
  const linked = linkedWorktree(start);
  return linked === undefined ? start : path.join(linked.main, path.relative(linked.root, start));
}

/** Where the running storytree's database listens, from the app's owner record, or that it isn't running. */
export function locateStorytree(options: LocateOptions = {}): StorytreeAddress {
  const dataDir = options.dataDir ?? defaultDataDir();
  const record = ownerRecord(dataDir);
  if (record === undefined || !isAlive(record.pid)) return { running: false, message: NOT_RUNNING };
  try {
    return { running: true, url: authenticatedLocalUrl(dataDir, record) ?? `postgres://postgres@127.0.0.1:${record.port}/postgres` };
  } catch (error) {
    // Never forward filesystem, JSON or subprocess errors: they can carry credential contents.
    return { running: false, message: error instanceof HandoffPrivacyError ? error.message : HANDOFF_UNAVAILABLE };
  }
}

/**
 * Where the library is, as the user's `library` setting says: the Cloud SQL instance or Postgres
 * address it names, or the running app's local database. The settings file is read fresh, and an invalid one is thrown
 * as it is, naming the file: it is never read as local.
 */
export function locateLibrary(options: LocateOptions = {}): { found: true; connect: ConnectOptions } | { found: false; message: string } {
  const home = options.home ?? (options.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(options.dataDir)));
  const setting = readLibrary(home);
  if (setting.location === "cloudsql") return { found: true, connect: { cloudSql: { instance: setting.instance, user: setting.user } } };
  if (setting.location === "postgres") return { found: true, connect: { address: setting.address } };
  const local = locateStorytree({ dataDir: options.dataDir ?? path.join(home, "pgdata") });
  return local.running ? { found: true, connect: { url: local.url } } : { found: false, message: local.message };
}

/**
 * Whether the storytree app is running on this machine, whatever its library: its local database's
 * owner record names a live process, or its launch record (app.json, which the app writes at each
 * start with its own process id) does. On a Cloud SQL library the app starts no local database, so
 * the launch record is the only sign of it (app lifecycle 1.11).
 */
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

/** `library` with a deadline on each new local handshake; a Cloud SQL instance or an address keeps its own bound. */
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
  return { status: "routed", project: found.project, folder: found.folder, ...(found.identity === undefined ? {} : { identity: found.identity }), library: library.connect };
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
 * What check_setup says in `folder`, which isn't a storytree project: that it isn't, and how the user
 * can add it. The agent is not told to offer setup (ADR-0752 D3); the user adds projects deliberately.
 */
export function notAProjectYet(folder: string, name: string = suggestedName(folder)): string {
  return `This folder is not a storytree project, so storytree records nothing here; carry on with the user's request. The user can add it as a project: Add project in the storytree app, \`storytree doctor --set-up ${name}\` in a terminal here, or by asking you to set it up.`;
}

/** The storytree 0.3 home: STORYTREE_HOME, else ~/.storytree/0.3, where the desktop app keeps its Postgres. */
export function storytreeHome(): string {
  const home = process.env.STORYTREE_HOME;
  return home !== undefined && home !== "" ? path.resolve(home) : path.join(homedir(), ".storytree", "0.3");
}

function defaultDataDir(): string {
  return path.join(storytreeHome(), "pgdata");
}

/** Where this machine remembers the approved trunks it has seen (ADR-0942), in its storytree home. */
const APPROVALS_FILE = "approved-trunks.json";

/** The approved trunks this machine remembers, as `machine` (its id) saw them. */
function remembered(home: string, machine: string): { project: string; folder: string }[] {
  try {
    const kept = JSON.parse(readFileSync(path.join(home, APPROVALS_FILE), "utf8")) as { machine?: unknown; trunks?: unknown };
    if (kept.machine !== machine || !Array.isArray(kept.trunks)) return [];
    return kept.trunks.filter((trunk): trunk is { project: string; folder: string } => typeof trunk?.project === "string" && typeof trunk?.folder === "string");
  } catch {
    return [];
  }
}

/** Remember `trunk` as approved on `machine`, in place of what was remembered for its project; a failure to write only costs a later ask. */
function rememberApproval(home: string, machine: string, trunk: { project: string; folder: string }): void {
  try {
    const trunks = [...remembered(home, machine).filter((kept) => kept.project !== trunk.project), { project: trunk.project, folder: trunk.folder }];
    mkdirSync(home, { recursive: true });
    const file = path.join(home, APPROVALS_FILE);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ machine, trunks }, null, 2)}\n`);
    renameSync(temp, file);
  } catch {
    // Asked again next time.
  }
}

/** Whether `folder` is `root` or inside it; Windows paths ignore case. */
function within(folder: string, root: string): boolean {
  const key = (file: string) => (process.platform === "win32" ? file.toLowerCase() : file);
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * The nearest marker at or above `start`. A marker that cannot be read, or names no project, stops
 * the search: the folder claims to be a project, and a guess at another would route it wrongly.
 */
function markerAbove(start: string): ProjectLookup | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    const marker = path.join(dir, MARKER_FILE);
    if (isFile(marker)) {
      const named = projectIn(marker);
      return named === undefined ? { project: undefined, message: NOT_A_PROJECT } : { ...named, folder: canonical(dir) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
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
      // Only a worktree the repository itself registered counts (ADR-0942 D2): its git directory is one
      // of the repository's worktrees, and that one names this folder's .git back. A copied or forged
      // .git file pointing at a trunk is no worktree of it.
      if (canonical(path.dirname(ownGitDir)) !== canonical(path.join(commonDir, "worktrees"))) return undefined;
      const back = readText(path.join(ownGitDir, "gitdir")).trim();
      if (back === "" || canonical(path.resolve(ownGitDir, back)) !== canonical(dotGit)) return undefined;
      return { root: dir, main: canonical(path.dirname(commonDir)) };
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The owner record beside `dataDir`, if there is one that names a process and a port. */
function ownerRecord(dataDir: string): LocalOwner | undefined {
  try {
    const record = JSON.parse(readFileSync(`${path.resolve(dataDir)}.owner.json`, "utf8")) as LocalOwner;
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !Number.isSafeInteger(record.port) || record.port < 1 || record.port > 65535) return undefined;
    return record;
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
