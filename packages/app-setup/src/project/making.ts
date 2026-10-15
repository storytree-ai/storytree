/**
 * Capability 6 · Make a folder a project (ADR-0969 D3, ADR-0757). After the user says yes, a folder becomes a storytree
 * project: the one check every way of adding a project goes through (the installer, the app's Add project,
 * `storytree doctor --set-up`, the agent's set_up_project), then the project opened (its library seeded with
 * the starter pack the first time), the folder recorded and approved as this machine's trunk, the marker left,
 * and the app's choice recorded. Reading which project a folder belongs to is Session management's project routing,
 * beneath the hooks; this writes to the trunks table it reads, through Session management's trunk functions.
 *
 * The one check, refusal(), refuses a second trunk for a project on this machine, a folder that is, is inside,
 * is a worktree of, or holds another project's trunk, and a name some project already has unless this
 * machine's checkout is joining it on purpose.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ProjectGoneError, type Storytree } from "@storytree/library";
import { forgetProjectActivity } from "@storytree/session-management";
import { approveTrunk, findProject, forgetTrunk, inMainCheckout, keepOnThisComputer, machineOf, MARKER_FILE, ProjectFolderError, recordProjectChoice, registerTrunk, rememberApproval, storytreeHome, trunksOn, type Trunk } from "@storytree/project-and-caller";

import { seedStarterPack } from "./starter-pack.js";

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
  /** The name the user's factory is found or made under (ADR-1040); by default FACTORY_NAME. */
  readonly factory?: string;
}

/** The name the user's factory is made under, unless a product project already has it (ADR-1040). */
export const FACTORY_NAME = "factory";

/**
 * Set `folder` up as project `project`, after the user said yes: the one check (ADR-0757) first,
 * then open the project in the library (creating its library the first time, seeded with the
 * starter pack, 6.7), record the folder as
 * the project's trunk on this machine, leave the marker, and record the user's choice for the app.
 * A refused folder (ProjectFolderError) or name (ProjectNameError, judged by the library before
 * anything touches the server) leaves nothing behind. `join` adds this machine's checkout to a
 * project that already exists; without it, an existing project's name is refused. Either approves
 * the trunk (ADR-0942 D1), and joining from a project's own recorded trunk approves it in place. A new project
 * names the user's factory (6.11), made the first time; a join makes none.
 */
export async function setUpProject({ folder, project, storytree, storytreeHome: home = storytreeHome(), join = false, factory = FACTORY_NAME }: SetUpOptions): Promise<{ project: string; marker: string }> {
  const at = canonical(path.resolve(folder));
  const existing = findProject(at);
  // Joining on purpose from the folder its marker already names is how an unapproved trunk is approved (ADR-0942 D1).
  const rejoining = join && existing.project === project && existing.folder === at;
  if (existing.project !== undefined && !rejoining) throw new ProjectFolderError(`${at} is already part of storytree project "${existing.project}" (its folder is ${existing.folder}).`);
  const machine = machineOf(home);
  const [projects, trunks] = await Promise.all([storytree.listProjects(), liveTrunks(storytree, machine.id, home)]);
  const refused = refusal({ folder: at, inMain: inMainCheckout(at), project, join, projects, trunks, suggestion: unusedName(suggestedName(at), projects) });
  if (refused !== undefined) throw refused;
  const library = await storytree.openProject(project);
  const { identity } = library;
  try {
    // A new project inherits no lines written under its name before it: an older install's hooks, in a deleted project's folder.
    if (!join) await forgetProjectActivity(storytree, project);
    const own = trunks.find((trunk) => trunk.project === project);
    const by = join ? "join" : "setup";
    const registered = own === undefined ? await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: at }, by) : own.approvedBy !== undefined || (await approveTrunk(storytree, own, by));
    if (!registered) throw new ProjectFolderError(`${at} or project "${project}" was set up on this machine a moment ago by something else; check it again before setting it up.`);
    rememberApproval(home, machine.id, own ?? { project, folder: at });
    // A new project's library starts with the starter pack and names the user's factory; one joined was set up where it was made.
    if (!join) {
      await library.recordFactory(await userFactory(storytree, factory, [...projects, project]));
      await seedStarterPack(library);
    }
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
 * The user's factory (ADR-1040, 6.11): a project with no folder of its own, only a library, holding the system their
 * product projects build with. Found as the first project named `name`, `name-2`, `name-3`… that is a factory; else
 * made under the first of those names `taken` lacks, marked a factory and seeded with the starter pack. Of two setups
 * making it at once, only the one whose mark made it seeds it.
 */
export async function userFactory(storytree: Storytree, name: string, taken: readonly string[]): Promise<string> {
  const candidate = new RegExp(`^${name}(-[0-9]+)?$`);
  const named = taken.filter((each) => candidate.test(each)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const each of named) {
    // A project deleted since the list was read is no factory.
    const library = await storytree.openProject(each, { create: false }).catch((error: unknown) => {
      if (error instanceof ProjectGoneError) return undefined;
      throw error;
    });
    if (library === undefined) continue;
    try {
      if ((await library.factory()).kind === "factory") return each;
    } finally {
      await library.close();
    }
  }
  const made = unusedName(name, taken);
  const library = await storytree.openProject(made);
  try {
    if (await library.markFactory()) await seedStarterPack(library);
  } finally {
    await library.close();
  }
  return made;
}

/**
 * What making a project's folder a git repository came to (6.10). With no git identity, the repository is made and
 * its marker staged, waiting for the first commit (firstCommit) once git has one.
 */
export type RepositoryMade =
  | { readonly state: "made" }
  | { readonly state: "already"; readonly root: string }
  | { readonly state: "no identity"; readonly reason: string }
  | { readonly state: "could not"; readonly reason: string };

/** What the user is asked to do when git has no identity to commit a project's repository with (6.10, 8.31). */
export const IDENTITY_FIX = 'ask the user for the name and email their commits should carry, and with their words run git config --global user.name "<name>" and git config --global user.email "<email>"; the next check_setup then makes the first commit';

/**
 * Make `folder`, a project's folder, a git repository when it is in none (6.10, increment_c270de438175): review,
 * landing and verified health all read one. The first commit holds the project's marker alone, under the user's own
 * git identity, never a guessed one. A folder already in a repository is left as it is. Never throws: with no git
 * nothing is made; with no identity the repository stays, its marker staged for the first commit
 * (increment_e2cb527f4320); any other failure takes the half-made repository away again. Each says its reason.
 */
export function makeRepository(folder: string, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): RepositoryMade {
  const run = gitIn(folder, env);
  try {
    return { state: "already", root: canonical(run("rev-parse", "--show-toplevel")) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "could not", reason: "git is not installed" };
  }
  try {
    run("init", "-q");
    run("add", "--", MARKER_FILE);
  } catch (error) {
    rmSync(path.join(folder, ".git"), { recursive: true, force: true });
    return { state: "could not", reason: `git init failed: ${gitError(error)}` };
  }
  const made = commitMarker(run);
  if (made.state === "could not") rmSync(path.join(folder, ".git"), { recursive: true, force: true });
  return made;
}

/**
 * Make the first commit of a repository makeRepository began in `folder` with no identity (6.10, 8.31): one whose
 * root is the folder, with no commit yet and the project's marker alone staged. Undefined for any other folder, so a
 * repository the user began is never committed to.
 */
export function firstCommit(folder: string, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): Exclude<RepositoryMade, { state: "already" }> | undefined {
  const run = gitIn(folder, env);
  try {
    if (canonical(run("rev-parse", "--show-toplevel")) !== canonical(path.resolve(folder))) return undefined;
    if (run("rev-list", "-n", "1", "--all") !== "") return undefined;
    if (run("ls-files") !== MARKER_FILE) return undefined;
  } catch {
    return undefined;
  }
  return commitMarker(run);
}

/** Run git in `folder` with `env`, giving back what it printed, trimmed. */
function gitIn(folder: string, env: NodeJS.ProcessEnv): (...args: string[]) => string {
  return (...args) => execFileSync("git", args, { cwd: folder, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}

/** Commit the staged marker under the user's own identity, never one git guesses. */
function commitMarker(run: (...args: string[]) => string): Exclude<RepositoryMade, { state: "already" }> {
  try {
    run("-c", "user.useConfigOnly=true", "commit", "-q", "-m", "Set up storytree project", "--", MARKER_FILE);
    return { state: "made" };
  } catch (error) {
    const said = gitError(error);
    return /user\.(name|email)|identity|author/i.test(said) ? { state: "no identity", reason: `git has no identity to commit with (user.name and user.email): ${said}` } : { state: "could not", reason: `git could not commit: ${said}` };
  }
}

/** What git said when it failed, on one line. */
function gitError(error: unknown): string {
  const stderr = (error as { stderr?: string | Buffer }).stderr?.toString().trim();
  return (stderr || (error as Error).message).split(/\r?\n/).filter(Boolean).slice(0, 3).join(" ");
}

/**
 * This machine's trunks whose folders are still there. A trunk whose folder is gone (moved away or
 * deleted) is forgotten, so the project can be joined or seen at its new folder. A folder that is
 * there keeps its trunk even with its marker gone: the record, not the marker, holds it (6.2).
 */
async function liveTrunks(storytree: Storytree, machine: string, home: string): Promise<Trunk[]> {
  const trunks = await trunksOn(storytree, machine);
  for (const trunk of trunks) if (!existsSync(trunk.folder)) await forgetTrunk(storytree, trunk, home);
  return trunks.filter((trunk) => existsSync(trunk.folder));
}

/** A name to suggest for `folder` as a new project: its own name, or the first of name-2, name-3… no project has. */
export async function suggestProjectName(folder: string, storytree: Storytree): Promise<string> {
  return unusedName(suggestedName(folder), await storytree.listProjects());
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

/** `name`, or the first of `name-2`, `name-3`… that is no project yet, within the project-name length. */
export function unusedName(name: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${name.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

interface Asked {
  /** The folder, canonical. */
  readonly folder: string;
  /** Where the folder sits in its trunk's main checkout, when it is in a git worktree; else the folder. */
  readonly inMain: string;
  readonly project: string;
  /** Adding this machine's checkout to an existing project, on purpose (ADR-0757 D4). */
  readonly join: boolean;
  /** Every project on the server. */
  readonly projects: readonly string[];
  /** This machine's trunks. */
  readonly trunks: readonly Trunk[];
  /** The name to suggest for the folder if it is new. */
  readonly suggestion: string;
}

/** Why `asked` must be refused, or undefined when the folder may be set up as its project. */
function refusal(asked: Asked): ProjectFolderError | undefined {
  for (const trunk of asked.trunks) {
    if (within(asked.folder, trunk.folder) || within(asked.inMain, trunk.folder)) {
      if (trunk.project === asked.project && samePath(asked.folder, trunk.folder)) continue;
      return new ProjectFolderError(`${asked.folder} is part of storytree project "${trunk.project}" (its folder on this machine is ${trunk.folder}), so it cannot be set up again or added to another project.`);
    }
    if (within(trunk.folder, asked.folder)) {
      return new ProjectFolderError(`${asked.folder} holds storytree project "${trunk.project}"'s folder ${trunk.folder}; projects never share a folder, so choose a folder that holds no project.`);
    }
  }
  const own = asked.trunks.find((trunk) => trunk.project === asked.project);
  // Setting its own trunk up again (after a setup that failed on this machine, say) is no new folder.
  if (own !== undefined && samePath(own.folder, asked.folder)) return undefined;
  if (own !== undefined) {
    return new ProjectFolderError(`storytree project "${asked.project}" already lives at ${own.folder} on this machine, and a project has one folder per machine: work in a git worktree of it (git worktree add), or set this folder up as a new project, such as "${asked.suggestion}".`, asked.suggestion);
  }
  const exists = asked.projects.includes(asked.project);
  if (exists && !asked.join) {
    return new ProjectFolderError(`There is already a storytree project called "${asked.project}". A new folder gets its own project: set it up as "${asked.suggestion}". To make this folder "${asked.project}"'s checkout on this machine, add it to "${asked.project}" on purpose: \`storytree doctor --join ${asked.project}\` here, or ask your agent to join it.`, asked.suggestion);
  }
  if (!exists && asked.join) {
    return new ProjectFolderError(`There is no storytree project called "${asked.project}" to add this machine's checkout to.`, asked.suggestion);
  }
  return undefined;
}

/** Whether `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

/** A path as compared: Windows paths ignore case. */
function key(folder: string): string {
  return process.platform === "win32" ? folder.toLowerCase() : folder;
}

/** The path with symlinks resolved and, on Windows, short (8.3) names spelled out; as it is if it cannot be. */
function canonical(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
}
