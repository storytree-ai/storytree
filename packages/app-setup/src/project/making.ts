// Capability 6 · Make a folder a project.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ProjectGoneError, type Storytree } from "@storytree/library";
import { ACTIONS } from "@storytree/shown-words";
import { forgetProjectActivity } from "@storytree/session-management";
import { approveTrunk, findProject, forgetTrunk, inMainCheckout, keepOnThisComputer, machineOf, PROJECT_FILE, ProjectFolderError, recordProjectChoice, registerTrunk, rememberApproval, ROOT_MARKER_FILE, storytreeHome, trunkedProjects, trunksOn, type Trunk } from "@storytree/project-and-caller";

import { smallFixesArc } from "./small-fixes.js";
import { seedStarterPack } from "./starter-pack.js";
import { IGNORE_FILE, STORYTREE_FOLDER } from "./storytree-folder.js";

export interface SetUpOptions {
  readonly folder: string;
  readonly project: string;
  readonly storytree: Storytree;
  readonly storytreeHome?: string;
  readonly join?: boolean;
  readonly factory?: string;
}

export const FACTORY_NAME = "factory";

export async function setUpProject({ folder, project, storytree, storytreeHome: home = storytreeHome(), join = false, factory = FACTORY_NAME }: SetUpOptions): Promise<{ project: string; marker: string; replaced?: string; smallFixesArc?: string }> {
  const at = canonical(path.resolve(folder));
  const existing = findProject(at);
  const rejoining = join && existing.project === project && existing.folder === at;
  const machine = machineOf(home);
  const [projects, trunks] = await Promise.all([storytree.listProjects(), liveTrunks(storytree, machine.id, home)]);
  const replaced = !join && existing.project !== undefined && existing.folder === at && !projects.includes(existing.project) ? existing.project : undefined;
  if (existing.project !== undefined && !rejoining && replaced === undefined) throw new ProjectFolderError(`${at} is already part of storytree project "${existing.project}" (its folder is ${existing.folder}).`);
  const refused = refusal({ folder: at, inMain: inMainCheckout(at), project, join, projects, trunks, suggestion: unusedName(suggestedName(at), projects) });
  if (refused !== undefined) throw refused;
  const library = await storytree.openProject(project);
  const { identity } = library;
  let smallFixes: string | undefined;
  try {
    if (!join) await forgetProjectActivity(storytree, project);
    const own = trunks.find((trunk) => trunk.project === project);
    const by = join ? "join" : "setup";
    const registered = own === undefined ? await registerTrunk(storytree, { project, machine: machine.id, machineName: machine.name, folder: at }, by) : own.approvedBy !== undefined || (await approveTrunk(storytree, own, by));
    if (!registered) throw new ProjectFolderError(`${at} or project "${project}" was set up on this machine a moment ago by something else; check it again before setting it up.`);
    rememberApproval(home, machine.id, own ?? { project, folder: at });
    if (!join) await library.recordFactory(await userFactory(storytree, factory, [...projects, project]));
    if (!join) smallFixes = (await smallFixesArc(library))?.id;
  } finally {
    await library.close();
  }
  const storytreeFolder = path.join(at, STORYTREE_FOLDER);
  const madeFolder = !existsSync(storytreeFolder);
  mkdirSync(storytreeFolder, { recursive: true });
  const marker = path.join(at, PROJECT_FILE);
  const ignore = path.join(at, IGNORE_FILE);
  const [previous, previousIgnore] = [marker, ignore].map((file) => (existsSync(file) ? readFileSync(file) : undefined));
  writeFileSync(marker, `${JSON.stringify({ project, identity }, null, 2)}\n`);
  writeFileSync(ignore, ignoring(previousIgnore?.toString("utf8")));
  try {
    recordProjectChoice(path.join(home, "project-choice.json"), project);
    keepOnThisComputer(project, home);
  } catch (error) {
    if (madeFolder) rmSync(storytreeFolder, { recursive: true, force: true });
    else {
      for (const [file, was] of [[marker, previous], [ignore, previousIgnore]] as const) {
        if (was === undefined) rmSync(file, { force: true });
        else writeFileSync(file, was);
      }
    }
    throw error;
  }
  if (replaced !== undefined && rootMarkerNames(at, replaced)) rmSync(path.join(at, ROOT_MARKER_FILE), { force: true });
  return { project, marker, ...(replaced === undefined ? {} : { replaced }), ...(smallFixes === undefined ? {} : { smallFixesArc: smallFixes }) };
}

function rootMarkerNames(folder: string, project: string): boolean {
  try {
    return (JSON.parse(readFileSync(path.join(folder, ROOT_MARKER_FILE), "utf8")) as { project?: unknown }).project === project;
  } catch {
    return false;
  }
}

const LOCAL_FILES = "*.local.json";

function ignoring(was: string | undefined): string {
  if (was === undefined) return `${LOCAL_FILES}\n`;
  if (was.split(/\r?\n/).some((line) => line.trim() === LOCAL_FILES)) return was;
  return `${was}${was === "" || was.endsWith("\n") ? "" : "\n"}${LOCAL_FILES}\n`;
}

export async function userFactory(storytree: Storytree, name: string, taken: readonly string[]): Promise<string> {
  const candidate = new RegExp(`^${name}(-[0-9]+)?$`);
  const named = taken.filter((each) => candidate.test(each)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  for (const each of named) if (await isFactory(storytree, each)) return each;
  const trunked = await trunkedProjects(storytree);
  const brought = taken.filter((each) => !candidate.test(each) && trunked.has(each)).sort();
  for (const each of brought) if (await isFactory(storytree, each)) return each;
  const made = unusedName(name, taken);
  const library = await storytree.openProject(made);
  try {
    if (await library.markFactory()) await seedStarterPack(library);
  } finally {
    await library.close();
  }
  return made;
}

async function isFactory(storytree: Storytree, name: string, attempt = 1): Promise<boolean> {
  const library = await storytree.openProject(name, { create: false }).catch((error: unknown) => {
    if (error instanceof ProjectGoneError) return undefined;
    throw error;
  });
  if (library === undefined) return false;
  try {
    return (await library.factory()).kind === "factory";
  } catch (error) {
    if (attempt > 1) throw error;
  } finally {
    await library.close();
  }
  return isFactory(storytree, name, attempt + 1);
}

export type RepositoryMade =
  | { readonly state: "made" }
  | { readonly state: "already"; readonly root: string }
  | { readonly state: "no identity"; readonly reason: string }
  | { readonly state: "could not"; readonly reason: string };

export const IDENTITY_FIX = 'ask the user for the name and email their commits should carry, and with their words run git config --global user.name "<name>" and git config --global user.email "<email>"; the next check_setup then makes the first commit';

export function makeRepository(folder: string, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): RepositoryMade {
  const run = gitIn(folder, env);
  try {
    return { state: "already", root: canonical(run("rev-parse", "--show-toplevel")) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "could not", reason: "git is not installed" };
  }
  try {
    run("init", "-q");
    run("add", "--", STORYTREE_FOLDER);
  } catch (error) {
    rmSync(path.join(folder, ".git"), { recursive: true, force: true });
    return { state: "could not", reason: `git init failed: ${gitError(error)}` };
  }
  const made = commitMarker(run);
  if (made.state === "could not") rmSync(path.join(folder, ".git"), { recursive: true, force: true });
  return made;
}

export function firstCommit(folder: string, { env = process.env }: { env?: NodeJS.ProcessEnv } = {}): Exclude<RepositoryMade, { state: "already" }> | undefined {
  const run = gitIn(folder, env);
  try {
    if (canonical(run("rev-parse", "--show-toplevel")) !== canonical(path.resolve(folder))) return undefined;
    if (run("rev-list", "-n", "1", "--all") !== "") return undefined;
    const staged = run("ls-files");
    if (staged === ROOT_MARKER_FILE) return commitMarker(run, ROOT_MARKER_FILE);
    if (staged.split("\n").some((file) => !file.startsWith(`${STORYTREE_FOLDER}/`))) return undefined;
  } catch {
    return undefined;
  }
  return commitMarker(run);
}

function gitIn(folder: string, env: NodeJS.ProcessEnv): (...args: string[]) => string {
  return (...args) => execFileSync("git", args, { cwd: folder, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}

function commitMarker(run: (...args: string[]) => string, staged: string = STORYTREE_FOLDER): Exclude<RepositoryMade, { state: "already" }> {
  try {
    run("-c", "user.useConfigOnly=true", "commit", "-q", "-m", "Set up storytree project", "--", staged);
    return { state: "made" };
  } catch (error) {
    const said = gitError(error);
    return /user\.(name|email)|identity|author/i.test(said) ? { state: "no identity", reason: `git has no identity to commit with (user.name and user.email): ${said}` } : { state: "could not", reason: `git could not commit: ${said}` };
  }
}

function gitError(error: unknown): string {
  const stderr = (error as { stderr?: string | Buffer }).stderr?.toString().trim();
  return (stderr || (error as Error).message).split(/\r?\n/).filter(Boolean).slice(0, 3).join(" ");
}

async function liveTrunks(storytree: Storytree, machine: string, home: string): Promise<Trunk[]> {
  const trunks = await trunksOn(storytree, machine);
  for (const trunk of trunks) if (!existsSync(trunk.folder)) await forgetTrunk(storytree, trunk, home);
  return trunks.filter((trunk) => existsSync(trunk.folder));
}

export async function suggestProjectName(folder: string, storytree: Storytree): Promise<string> {
  return unusedName(suggestedName(folder), await storytree.listProjects());
}

export function suggestedName(folder: string): string {
  const name = path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/(?<!-)-+$/, "");
  return name === "" ? "my-project" : name;
}

export function notAProjectYet(folder: string, name: string = suggestedName(folder)): string {
  return `This folder is not a storytree project, so storytree records nothing here; carry on with the user's request. The user can add it as a project: ${ACTIONS.addProject} in the storytree app, \`storytree doctor --set-up ${name}\` in a terminal here, or by asking you to set it up.`;
}

export function unusedName(name: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${name.slice(0, 40 - suffix.length).replace(/(?<!-)-+$/, "")}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

interface Asked {
  readonly folder: string;
  readonly inMain: string;
  readonly project: string;
  readonly join: boolean;
  readonly projects: readonly string[];
  readonly trunks: readonly Trunk[];
  readonly suggestion: string;
}

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

function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function samePath(a: string, b: string): boolean {
  return key(a) === key(b);
}

function key(folder: string): string {
  return process.platform === "win32" ? folder.toLowerCase() : folder;
}

function canonical(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
}
