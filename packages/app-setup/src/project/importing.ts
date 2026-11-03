/**
 * Capability 12 · Import an existing project (ADR-0993 D1, D2, D6). A storytree project imports an existing
 * JavaScript, TypeScript or Python project's folder: the folder is recorded on the project beside its trunk, through
 * Session management's recordImport, and each package the folder declares becomes a mapped story, through the
 * library's mapStories, the only way a story is made mapped. Importing again maps the folder afresh. Nothing is
 * written into the imported folder: it is read, and git is only asked where it came from and what changed.
 *
 * Importing again runs only these deterministic steps (ADR-0993 D2, D5): it says the commit recorded before and
 * now, and the files git finds added, changed and removed between them, and names each capability an agent
 * explored whose covered files are gone, leaving it as it stands: reshaping it is an agent's work.
 *
 * The packages are what the folder declares: pnpm-workspace.yaml's `packages`, else package.json's
 * `workspaces` (a list, or `{ packages }`), each a folder glob; a folder declaring none is one package.
 * A Python project, a folder with pyproject.toml, setup.cfg or setup.py and no package.json, declares its
 * packages in pyproject.toml (arc_1cb3e3979611): a uv workspace's `members` globs less its `exclude`, with
 * the root too when it is a project itself; else the root and the Poetry path dependencies inside the folder;
 * else it is one package. Each is named by its pyproject.toml's `[project]` or `[tool.poetry]`, else its
 * setup.cfg's `[metadata]`, else by its folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type { Library, MappedPackage, Storytree } from "@storytree/library";
import { folderLanguages } from "@storytree/map/folder-languages";
import { languageList } from "@storytree/map/languages";
import { packageOf } from "@storytree/map/package-of";
import { findProject, importsOf, machineOf, recordImport, storytreeHome, trunksOn } from "@storytree/project-and-caller";

export interface ImportOptions {
  /** The folder of the project to import. */
  readonly folder: string;
  /** The storytree project's library, which the import maps into. */
  readonly library: Library;
  /** The connection to the running storytree, which keeps the trunks and imports. */
  readonly storytree: Storytree;
  /** The app's home; defaults to STORYTREE_HOME, else ~/.storytree/0.3. It keeps this machine's identity. */
  readonly storytreeHome?: string;
}

/**
 * What one import did: the folder as recorded, where it came from, and the stories mapStories added, retired and
 * kept. Imported again: what was recorded before, the files changed since that commit (absent when git cannot
 * compare the two), and each kept story's explored capability that covers a path no longer in the folder.
 */
export interface Imported {
  readonly folder: string;
  readonly repository?: string;
  readonly commit?: string;
  readonly added: { readonly id: string; readonly title: string }[];
  readonly retired: string[];
  readonly kept: string[];
  readonly before?: { readonly commit?: string };
  readonly changes?: FileChanges;
  readonly stranded: Stranded[];
}

/** The files, relative to the imported folder and sorted, git finds added, changed and removed between two commits. */
export interface FileChanges {
  readonly added: string[];
  readonly changed: string[];
  readonly removed: string[];
}

/** An explored capability whose covered paths, `gone`, are no longer in the imported folder. */
export interface Stranded {
  readonly id: string;
  readonly title: string;
  readonly story: string;
  readonly gone: string[];
}

/** Why a folder cannot be imported. */
export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefusedError";
  }
}

/**
 * Import `folder` into `library`'s project: refused, with nothing written, when the folder does not exist,
 * is nested inside the storytree project (its trunk on this machine, or a folder whose marker names it) without
 * being the project's own folder, or has no package.json, pyproject.toml, setup.cfg or setup.py at its top. The project's own folder is mapped in place
 * (ADR-1213 D1), leaving out the package of each story storytree built there (ADR-0993 D2). Otherwise the folder is recorded, with its repository's address and commit when it
 * is a git checkout with a remote, and its packages are mapped, keyed by that address or else by the folder.
 */
export async function importProject({ folder, library, storytree, storytreeHome: home = storytreeHome() }: ImportOptions): Promise<Imported> {
  const at = canonical(path.resolve(folder));
  if (!existsSync(at) || !statSync(at).isDirectory()) throw new ImportRefusedError(`${at} does not exist, so there is nothing to import.`);
  const machine = machineOf(home);
  const trunk = (await trunksOn(storytree, machine.id)).find((own) => own.project === library.name);
  const marked = findProject(at);
  // The project's own folder, the one its marker is in, is an existing repository set up in place, mapped where it is (ADR-1213 D1).
  const inPlace = marked.project === library.name && key(marked.folder) === key(at);
  if (!inPlace && ((trunk !== undefined && within(at, trunk.folder)) || marked.project === library.name)) {
    throw new ImportRefusedError(`${at} is inside storytree project "${library.name}"; import a folder outside it, where the existing project lives.`);
  }
  if (!existsSync(path.join(at, "package.json")) && !holdsPython(at)) {
    // Code the survey cannot read is named, with what still works for it (12.7).
    const { unread } = await folderLanguages(at);
    const other = unread.length === 0 ? "" : ` Its code is in ${languageList(unread)}, which storytree's map cannot read; planning its stories by hand still works, and so does health from what the agent reports.`;
    throw new ImportRefusedError(`${at} has no package.json, pyproject.toml, setup.cfg or setup.py at its top, so it holds no JavaScript, TypeScript or Python package to import.${other}`);
  }
  const origin = gitOrigin(at);
  const packages = inPlace ? await unbuilt(library, packagesOf(at)) : packagesOf(at);
  const recorded = (await importsOf(storytree, library.name, machine.id)).find((imported) => imported.folder === at);
  await recordImport(storytree, { project: library.name, machine: machine.id, machineName: machine.name, folder: at, ...origin });
  const mapped = await library.mapStories(origin.repository ?? at, packages);
  const changes = recorded?.commit !== undefined && origin.commit !== undefined ? changedBetween(at, recorded.commit, origin.commit) : undefined;
  return {
    folder: at,
    ...origin,
    added: mapped.added.map((story) => ({ id: story.id, title: story.fields.title })),
    retired: mapped.retired,
    kept: mapped.kept,
    ...(recorded === undefined ? {} : { before: recorded.commit === undefined ? {} : { commit: recorded.commit } }),
    ...(changes === undefined ? {} : { changes }),
    stranded: mapped.kept.length === 0 ? [] : await strandedIn(library, at, new Set(mapped.kept)),
  };
}

/** The most file names of each kind importLines lists; the rest are counted. */
const NAMED = 10;

/** What an import did, as lines for the user: the commit before and now and the files changed between them, then each stranded capability. */
export function importLines(imported: Imported): string[] {
  if (imported.before === undefined) return [];
  const short = (commit: string | undefined): string => commit?.slice(0, 12) ?? "no commit";
  if (imported.before.commit === undefined && imported.commit === undefined) return ["No commit is recorded: the folder is not a git checkout with a remote.", ...strandedLines(imported)];
  const lines = [imported.before.commit === imported.commit
    ? `The commit did not move: ${short(imported.commit)}.`
    : `The commit moved from ${short(imported.before.commit)} to ${short(imported.commit)}.`];
  const { changes } = imported;
  if (changes === undefined) {
    if (imported.before.commit !== imported.commit) lines.push("Git could not compare the two commits, so the files changed between them are not known.");
  } else if (imported.before.commit !== imported.commit) {
    const kinds = [["added", changes.added], ["changed", changes.changed], ["removed", changes.removed]] as const;
    lines.push(`Files between them: ${kinds.map(([kind, files]) => `${files.length} ${kind}`).join(", ")}.`);
    for (const [kind, files] of kinds) {
      if (files.length === 0) continue;
      const more = files.length - NAMED;
      lines.push(`  ${kind}: ${files.slice(0, NAMED).join(", ")}${more > 0 ? `, and ${more} more` : ""}`);
    }
  }
  return [...lines, ...strandedLines(imported)];
}

/** A line for each explored capability whose covered paths are gone. */
function strandedLines({ stranded }: Imported): string[] {
  return stranded.map((capability) => `Capability "${capability.title}" (${capability.id}) covers ${capability.gone.join(", ")}, no longer in the folder; it is left as it stands, for an agent to reshape.`);
}

/** The files git finds added, changed and removed from commit `from` to `to` in `folder`; undefined when it cannot compare them. */
function changedBetween(folder: string, from: string, to: string): FileChanges | undefined {
  if (from === to) return { added: [], changed: [], removed: [] };
  const run = spawnSync("git", ["-C", folder, "diff", "--name-status", "--no-renames", "-z", from, to], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (run.status !== 0) return undefined;
  const changes = { added: [] as string[], changed: [] as string[], removed: [] as string[] };
  const fields = run.stdout.split("\0");
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const status = fields[at]!;
    const file = fields[at + 1]!;
    (status === "A" ? changes.added : status === "D" ? changes.removed : changes.changed).push(file);
  }
  return { added: changes.added.sort(), changed: changes.changed.sort(), removed: changes.removed.sort() };
}

/** The capabilities of `stories` whose covered paths are not all in `folder`, by id, each with the paths gone. */
async function strandedIn(library: Library, folder: string, stories: ReadonlySet<string>): Promise<Stranded[]> {
  return (await library.list("capability"))
    .filter((capability) => stories.has(capability.fields.story))
    .flatMap((capability) => {
      const gone = (capability.fields.covers ?? []).filter((cover) => !existsSync(path.join(folder, cover)));
      return gone.length === 0 ? [] : [{ id: capability.id, title: capability.fields.title, story: capability.fields.story, gone }];
    })
    .sort((one, other) => one.id.localeCompare(other.id));
}

/** `packages` but those in the folder packages/<package> of a live story built in the project, which is never mapped (ADR-0993 D2). */
async function unbuilt(library: Library, packages: readonly MappedPackage[]): Promise<MappedPackage[]> {
  const built = new Set((await library.list("story"))
    .filter((story) => story.fields.mapped === undefined)
    .map((story) => `packages/${packageOf({ id: story.id, title: story.fields.title })}`));
  return packages.filter((one) => !built.has(one.package));
}

/** The packages `root` declares, by folder, each named as its package.json names it (else by its folder); a Python project's by its own rules. */
function packagesOf(root: string): MappedPackage[] {
  if (!existsSync(path.join(root, "package.json"))) return pythonPackagesOf(root);
  const patterns = declared(root);
  const folders = patterns === undefined ? ["."] : matching(root, patterns, (folder) => existsSync(path.join(root, folder, "package.json")));
  return folders.map((folder) => {
    const manifest = readManifest(path.join(root, folder));
    const title = typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : path.basename(path.join(root, folder));
    const description = typeof manifest.description === "string" && manifest.description !== "" ? manifest.description : undefined;
    return { package: folder, title, ...(description === undefined ? {} : { description }), folders: [folder] };
  });
}

/** The Python manifests a folder may hold. */
const PYTHON_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py"];

/** Whether `folder` holds a Python manifest. */
const holdsPython = (folder: string): boolean => PYTHON_MANIFESTS.some((manifest) => existsSync(path.join(folder, manifest)));

/** The packages a Python project at `root` declares, by folder, each named as its manifest names it (else by its folder). */
function pythonPackagesOf(root: string): MappedPackage[] {
  const pyproject = readPyproject(root);
  const workspace = tableAt(pyproject, "tool", "uv", "workspace");
  const members = strings(workspace?.members);
  const folders = members.length > 0
    ? [...(tableAt(pyproject, "project") === undefined ? [] : ["."]), ...matching(root, [...members, ...strings(workspace?.exclude).map((glob) => `!${glob}`)], (folder) => holdsPython(path.join(root, folder)))]
    : [".", ...poetryPaths(root, pyproject)];
  return folders.map((folder) => {
    const at = path.join(root, folder);
    const own = readPyproject(at);
    const meta = tableAt(own, "project") ?? tableAt(own, "tool", "poetry");
    const cfg = setupMetadata(at);
    const title = text(meta?.name) ?? cfg.name ?? path.basename(at);
    const description = text(meta?.description) ?? cfg.description;
    return { package: folder, title, ...(description === undefined ? {} : { description }), folders: [folder] };
  });
}

/** The folders, relative to `root` and sorted, of the Poetry path dependencies in `pyproject` (its main and group dependencies) inside `root` that hold a Python manifest. */
function poetryPaths(root: string, pyproject: Record<string, unknown>): string[] {
  const poetry = tableAt(pyproject, "tool", "poetry");
  const groups = Object.values(tableAt(poetry ?? {}, "group") ?? {}).map((group) => tableAt(group, "dependencies"));
  const found = new Set<string>();
  for (const dependencies of [tableAt(poetry ?? {}, "dependencies"), ...groups]) {
    for (const dependency of Object.values(dependencies ?? {})) {
      const at = text(tableAt(dependency)?.path);
      if (at === undefined) continue;
      const folder = path.posix.normalize(at.replace(/\\/g, "/")).replace(/\/$/, "");
      if (folder === "." || folder === ".." || folder.startsWith("../") || path.posix.isAbsolute(folder) || path.win32.isAbsolute(folder)) continue;
      if (holdsPython(path.join(root, folder))) found.add(folder);
    }
  }
  return [...found].sort();
}

/** A folder's pyproject.toml, or nothing when it is missing or is no TOML. */
function readPyproject(folder: string): Record<string, unknown> {
  try {
    return parseToml(readFileSync(path.join(folder, "pyproject.toml"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The name and description a folder's setup.cfg gives in its `[metadata]` section. */
function setupMetadata(folder: string): { name?: string; description?: string } {
  let config: string;
  try {
    config = readFileSync(path.join(folder, "setup.cfg"), "utf8");
  } catch {
    return {};
  }
  const found: { name?: string; description?: string } = {};
  let section = "";
  for (const line of config.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header !== null) section = header[1]!.trim();
    const entry = section === "metadata" ? /^(name|description)\s*[=:]\s*(.+?)\s*$/.exec(line) : null;
    if (entry !== null) found[entry[1] as "name" | "description"] = entry[2]!;
  }
  return found;
}

/** The table at `keys` inside `value`, when each step is one. */
function tableAt(value: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let at = value;
  for (const key of keys) at = typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>) : undefined;
}

/** `value` when it is a string that is not empty. */
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The strings in `value`, when it is a list. */
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []);

/** The workspace globs `root` declares, or undefined when it declares none. */
function declared(root: string): string[] | undefined {
  const pnpm = path.join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    const listed = yamlPackages(readFileSync(pnpm, "utf8"));
    if (listed.length > 0) return listed;
  }
  const workspaces = readManifest(root).workspaces;
  const listed = Array.isArray(workspaces) ? workspaces : (workspaces as { packages?: unknown } | undefined)?.packages;
  return Array.isArray(listed) && listed.length > 0 ? listed.filter((glob): glob is string => typeof glob === "string") : undefined;
}

/** The entries of a pnpm-workspace.yaml's top-level `packages:` list. */
function yamlPackages(text: string): string[] {
  const entries: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
    const entry = inPackages ? /^\s*-\s*(.+?)\s*$/.exec(line.replace(/\s#.*$/, ""))?.[1] : undefined;
    if (entry !== undefined) entries.push(entry.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return entries;
}

/** The most `**` segments a workspace glob may hold. */
const GLOBSTARS = 3;

/** The most folders one workspace glob may look through. */
const VISITS = 10_000;

/**
 * The folders under `root`, relative and sorted, that a glob of `patterns` matches and a `!` glob does not, each one `holds` a package in.
 * A glob is refused when it climbs out of `root` with `..`, holds more than GLOBSTARS `**`, or looks through more than VISITS folders.
 */
function matching(root: string, patterns: readonly string[], holds: (folder: string) => boolean): string[] {
  const found = new Set<string>();
  const left = new Set<string>();
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const segments = (negated ? pattern.slice(1) : pattern).replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter((segment) => segment !== "" && segment !== ".");
    if (segments.includes("..")) throw new ImportRefusedError(`Workspace pattern "${pattern}" climbs out of the folder with "..", so the import is refused.`);
    if (segments.filter((segment) => segment === "**").length > GLOBSTARS) throw new ImportRefusedError(`Workspace pattern "${pattern}" holds more than ${GLOBSTARS} '**', so the import is refused.`);
    const visits = { left: VISITS };
    const list = (at: string): string[] => {
      const subs = subfolders(root, at);
      visits.left -= subs.length;
      if (visits.left < 0) throw new ImportRefusedError(`Workspace pattern "${pattern}" looks through more than ${VISITS} folders, so the import is refused.`);
      return subs;
    };
    for (const folder of expand(root, "", segments, list)) (negated ? left : found).add(folder);
  }
  return [...found].filter((folder) => !left.has(folder) && holds(folder)).sort();
}

/** The folders under `root`/`at` that `segments` match, listing each folder's subfolders with `list`: `**` any depth, `*` within one folder name. */
function expand(root: string, at: string, segments: readonly string[], list: (at: string) => string[]): string[] {
  if (segments.length === 0) return [at === "" ? "." : at];
  const [segment, ...rest] = segments as [string, ...string[]];
  if (segment === "**") return [...expand(root, at, rest, list), ...list(at).flatMap((sub) => expand(root, sub, segments, list))];
  if (!segment.includes("*")) return existsSync(path.join(root, at, segment)) ? expand(root, path.posix.join(at, segment), rest, list) : [];
  return list(at).filter((sub) => starMatches(segment, path.posix.basename(sub))).flatMap((sub) => expand(root, sub, rest, list));
}

/** Whether `name` matches `segment`, whose `*`s each stand for any run of characters: its pieces found in order, in time linear in the name. */
function starMatches(segment: string, name: string): boolean {
  const pieces = segment.split("*");
  const first = pieces[0]!;
  const last = pieces[pieces.length - 1]!;
  if (name.length < first.length + last.length || !name.startsWith(first) || !name.endsWith(last)) return false;
  let from = first.length;
  const end = name.length - last.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = name.indexOf(piece, from);
    if (found === -1 || found + piece.length > end) return false;
    from = found + piece.length;
  }
  return true;
}

/** The folders directly in `root`/`at`, relative to `root`, leaving out node_modules and hidden ones. */
function subfolders(root: string, at: string): string[] {
  try {
    return readdirSync(path.join(root, at), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
      .map((entry) => path.posix.join(at, entry.name));
  } catch {
    return [];
  }
}

/** A folder's package.json, or nothing when it is missing or unreadable. */
function readManifest(folder: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as unknown;
    return typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Where `folder` came from, when it is the top of a git checkout with a remote: the remote's address and the commit checked out. */
function gitOrigin(folder: string): { repository?: string; commit?: string } {
  const ask = (...args: string[]): string | undefined => {
    const run = spawnSync("git", ["-C", folder, ...args], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    return run.status === 0 ? run.stdout.trim() : undefined;
  };
  const top = ask("rev-parse", "--show-toplevel");
  if (top === undefined || canonical(top) !== folder) return {};
  const remote = (ask("remote") ?? "").split("\n").filter(Boolean);
  const name = remote.includes("origin") ? "origin" : remote[0];
  const repository = name === undefined ? undefined : ask("remote", "get-url", name);
  if (repository === undefined || repository === "") return {};
  const commit = ask("rev-parse", "HEAD");
  return { repository, ...(commit === undefined ? {} : { commit }) };
}

/** Whether `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
