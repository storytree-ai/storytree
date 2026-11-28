// Capability 12 · Import an existing project.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import type { Library, MappedPackage, SchemaRecord, Storytree } from "@storytree/library";
import { drawImport } from "@storytree/map/code-survey";
import { folderLanguages } from "@storytree/map/folder-languages";
import { languageList } from "@storytree/map/languages";
import { packageOf } from "@storytree/map/package-of";
import { findProject, importsOf, machineOf, recordImport, storytreeHome, trunksOn } from "@storytree/project-and-caller";

export interface ImportOptions {
  readonly folder: string;
  readonly library: Library;
  readonly storytree: Storytree;
  readonly storytreeHome?: string;
}

export interface Imported {
  readonly folder: string;
  readonly repository?: string;
  readonly commit?: string;
  readonly added: { readonly id: string; readonly title: string; readonly capabilities: number }[];
  readonly retired: string[];
  readonly kept: string[];
  readonly before?: { readonly commit?: string };
  readonly changes?: FileChanges;
  readonly redrawn: Redrawn[];
}

export interface FileChanges {
  readonly added: string[];
  readonly changed: string[];
  readonly removed: string[];
}

export interface Named {
  readonly id: string;
  readonly title: string;
}

export interface Redrawn {
  readonly story: Named;
  readonly merged: { readonly into: Named; readonly from: Named[] }[];
  readonly split: { readonly from: Named; readonly into: Named[] }[];
  readonly added: Named[];
  readonly retired: (Named & { readonly contractsTo?: Named })[];
  readonly left: (Named & { readonly gone: string[] })[];
}

export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefusedError";
  }
}

export async function importProject({ folder, library, storytree, storytreeHome: home = storytreeHome() }: ImportOptions): Promise<Imported> {
  const at = canonical(path.resolve(folder));
  if (!existsSync(at) || !statSync(at).isDirectory()) throw new ImportRefusedError(`${at} does not exist, so there is nothing to import.`);
  const machine = machineOf(home);
  const trunk = (await trunksOn(storytree, machine.id)).find((own) => own.project === library.name);
  const marked = findProject(at);
  const inPlace = marked.project === library.name && key(marked.folder) === key(at);
  if (!inPlace && ((trunk !== undefined && within(at, trunk.folder)) || marked.project === library.name)) {
    throw new ImportRefusedError(`${at} is inside storytree project "${library.name}"; import a folder outside it, where the existing project lives.`);
  }
  if (!existsSync(path.join(at, "package.json")) && !holdsPython(at)) {
    const { unread } = await folderLanguages(at);
    const other = unread.length === 0 ? "" : ` Its code is in ${languageList(unread)}, which storytree's map cannot read; planning its stories by hand still works, and so does health from what the agent reports.`;
    throw new ImportRefusedError(`${at} has no package.json, pyproject.toml, setup.cfg or setup.py at its top, so it holds no JavaScript, TypeScript or Python package to import.${other}`);
  }
  const origin = gitOrigin(at);
  const packages = inPlace ? await unbuilt(library, packagesOf(at)) : packagesOf(at);
  const recorded = (await importsOf(storytree, library.name, machine.id)).find((imported) => imported.folder === at);
  await recordImport(storytree, { project: library.name, machine: machine.id, machineName: machine.name, folder: at, ...origin });
  const mapped = await library.mapStories(origin.repository ?? at, packages);
  const stories = await library.list("story");
  const added: Imported["added"][number][] = [];
  for (const story of mapped.added) added.push({ id: story.id, title: story.fields.title, capabilities: await drawn(library, story, at, stories) });
  const redrawn: Redrawn[] = [];
  for (const story of stories.filter((one) => mapped.kept.includes(one.id))) {
    const changed = await redraw(library, story, at, stories);
    if (changed !== undefined) redrawn.push(changed);
  }
  const changes = recorded?.commit !== undefined && origin.commit !== undefined ? changedBetween(at, recorded.commit, origin.commit) : undefined;
  return {
    folder: at,
    ...origin,
    added,
    retired: mapped.retired,
    kept: mapped.kept,
    ...(recorded === undefined ? {} : { before: recorded.commit === undefined ? {} : { commit: recorded.commit } }),
    ...(changes === undefined ? {} : { changes }),
    redrawn,
  };
}

async function drawn(library: Library, story: SchemaRecord<"story">, folder: string, stories: readonly SchemaRecord<"story">[]): Promise<number> {
  const { mapped } = story.fields;
  if (mapped === undefined) return 0;
  const drawing = await drawImport({ mapped }, folder, stories.map((one) => one.fields));
  const ids = new Map<string, string>();
  for (const part of drawing.capabilities) ids.set(part.title, (await library.addCapability({ story: story.id, title: part.title, covers: [...part.covers], proposed: false })).id);
  for (const link of drawing.links) await library.addEdge({ from: ids.get(link.from)!, to: ids.get(link.to)! });
  return drawing.capabilities.length;
}

async function redraw(library: Library, story: SchemaRecord<"story">, folder: string, stories: readonly SchemaRecord<"story">[]): Promise<Redrawn | undefined> {
  const { mapped } = story.fields;
  if (mapped === undefined) return undefined;
  const drawing = await drawImport({ mapped }, folder, stories.map((one) => one.fields));
  if (drawing.capabilities.length === 0) return undefined;
  const top = mapped.package === "." ? "" : `${path.posix.normalize(mapped.package).replace(/\/$/, "")}/`;
  const pathTitle = (covers: readonly string[]): string => [...covers].sort().map((cover) => cover.slice(top.length)).join(" + ");
  const same = (one: readonly string[], other: readonly string[]): boolean => pathTitle(one) === pathTitle(other);
  return library.inOneWrite(async () => {
    const old = (await library.list("capability")).filter((capability) => capability.fields.story === story.id).sort(byId);
    const filesOf = new Map(old.map((capability) => [capability.id, new Set((capability.fields.covers ?? []).flatMap((cover) => filesUnder(folder, cover)))] as const));
    const parts = drawing.capabilities.map((part) => ({ ...part, files: new Set(part.covers.flatMap((cover) => filesUnder(folder, cover))) }));
    const shared = (part: (typeof parts)[number], capability: string): number => [...part.files].filter((file) => filesOf.get(capability)!.has(file)).length;
    const holder = new Map<string, string>();
    const unchanged = new Set<string>();
    for (const part of parts) {
      const kept = old.find((capability) => !unchanged.has(capability.id) && same(capability.fields.covers ?? [], part.covers));
      if (kept === undefined) continue;
      holder.set(part.title, kept.id);
      unchanged.add(kept.id);
    }
    const shares = parts.filter((part) => !holder.has(part.title))
      .flatMap((part) => old.filter((capability) => !unchanged.has(capability.id)).map((capability) => ({ part, capability, count: shared(part, capability.id) })))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count || byText(a.capability.id, b.capability.id) || byText(a.part.title, b.part.title));
    const inherited = new Set<string>();
    for (const { part, capability } of shares) {
      if (holder.has(part.title) || inherited.has(capability.id)) continue;
      holder.set(part.title, capability.id);
      inherited.add(capability.id);
    }
    const holderOf = (capability: string): string | undefined => parts
      .map((part) => ({ part, count: shared(part, capability) }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count || byText(a.part.title, b.part.title))
      .map(({ part }) => holder.get(part.title))[0];

    const contracts = await library.list("contract");
    const edges = await library.list("edge");
    const titles = new Map(old.map((capability) => [capability.id, capability.fields.title] as const));
    const retired: Redrawn["retired"][number][] = [];
    const left: Redrawn["left"] = [];
    const gone = old.filter((capability) => !unchanged.has(capability.id) && !inherited.has(capability.id));
    for (const capability of gone) {
      const to = holderOf(capability.id);
      const own = contracts.filter((contract) => contract.fields.capability === capability.id);
      const onEdges = contracts.filter((contract) => edges.some((edge) => edge.id === contract.fields.edge && edge.fields.from === capability.id));
      if (to === undefined && own.length + onEdges.length > 0) {
        left.push({ id: capability.id, title: capability.fields.title, gone: [...(capability.fields.covers ?? [])] });
        continue;
      }
      for (const contract of [...own, ...onEdges]) await library.editContract(contract.id, { capability: to!, title: contract.fields.title });
      for (const edge of edges.filter((one) => one.fields.from === capability.id || one.fields.to === capability.id)) await library.retire(edge.id, `${capability.id} retires: the story is redrawn from its code`);
      for (const dependent of (await library.list("capability")).filter((one) => one.fields.dependsOn?.includes(capability.id) === true)) {
        const links = [...new Set(dependent.fields.dependsOn!.flatMap((id) => (id !== capability.id ? [id] : to === undefined || to === dependent.id ? [] : [to])))];
        await library.editCapability(dependent.id, { dependsOn: links });
      }
      await library.retire(capability.id, "the story is redrawn from its code, and no part of the drawing is this capability");
      retired.push({ id: capability.id, title: capability.fields.title, ...(own.length + onEdges.length === 0 || to === undefined ? {} : { contractsTo: { id: to, title: "" } }) });
    }

    const grows = ({ part, capability }: { part: (typeof parts)[number]; capability: SchemaRecord<"capability"> }): number => Number([...part.files].some((file) => !filesOf.get(capability.id)!.has(file)));
    const moves = parts.filter((part) => inherited.has(holder.get(part.title) ?? ""))
      .map((part) => ({ part, capability: old.find(({ id }) => id === holder.get(part.title))! }))
      .sort((a, b) => grows(a) - grows(b));
    for (const { part, capability } of moves) {
      const [number, ...rest] = capability.fields.title.split(" · ");
      const unnamed = rest.join(" · ") === pathTitle(capability.fields.covers ?? []);
      const title = unnamed && capabilityNumbered(capability.fields.title) ? `${number} · ${part.title}` : capability.fields.title;
      await library.editCapability(capability.id, { covers: [...part.covers], ...(title === capability.fields.title ? {} : { title }) });
      titles.set(capability.id, title);
    }
    const added: Named[] = [];
    for (const part of parts.filter((one) => !holder.has(one.title))) {
      const created = await library.addCapability({ story: story.id, title: part.title, covers: [...part.covers], proposed: false });
      holder.set(part.title, created.id);
      titles.set(created.id, created.fields.title);
      added.push({ id: created.id, title: created.fields.title });
    }

    const wanted = new Set(drawing.links.map((link) => `${holder.get(link.from)} ${holder.get(link.to)}`));
    const live = new Set(holder.values());
    const standing = (await library.list("edge")).filter((edge) => live.has(edge.fields.from) && live.has(edge.fields.to));
    for (const edge of standing.filter((one) => !wanted.has(`${one.fields.from} ${one.fields.to}`))) {
      for (const contract of contracts.filter((one) => one.fields.edge === edge.id)) await library.editContract(contract.id, { capability: edge.fields.from, title: contract.fields.title });
      await library.retire(edge.id, "the story is redrawn from its code, and its imports no longer make this link");
    }
    const drawn = new Set(standing.map((edge) => `${edge.fields.from} ${edge.fields.to}`));
    const relinked = standing.some((edge) => !wanted.has(`${edge.fields.from} ${edge.fields.to}`)) || [...wanted].some((one) => !drawn.has(one));
    for (const link of [...wanted].filter((one) => !drawn.has(one))) {
      const [from, to] = link.split(" ") as [string, string];
      await library.addEdge({ from, to });
    }

    const named = (id: string): Named => ({ id, title: titles.get(id)! });
    const holdersOf = (capability: string): string[] => parts.filter((part) => shared(part, capability) > 0).map((part) => holder.get(part.title)!).sort(byText);
    const merged = parts
      .map((part) => ({ into: holder.get(part.title)!, from: old.filter((capability) => shared(part, capability.id) > 0).map(({ id }) => id) }))
      .filter(({ from }) => from.length > 1)
      .map(({ into, from }) => ({ into: named(into), from: from.map(named) }))
      .sort((a, b) => byText(a.into.id, b.into.id));
    const split = old.map(({ id }) => ({ from: id, into: holdersOf(id) })).filter(({ into }) => into.length > 1).map(({ from, into }) => ({ from: named(from), into: into.map(named) }));
    const changed: Redrawn = {
      story: { id: story.id, title: story.fields.title },
      merged,
      split,
      added: added.sort((a, b) => byText(a.id, b.id)),
      retired: retired.map((one) => (one.contractsTo === undefined ? one : { ...one, contractsTo: named(one.contractsTo.id) })),
      left,
    };
    return relinked || moves.length + added.length + retired.length + left.length > 0 ? changed : undefined;
  });
}

const capabilityNumbered = (title: string): boolean => /^\d+ · /.test(title);

const byId = (one: { readonly id: string }, other: { readonly id: string }): number => byText(one.id, other.id);

const byText = (one: string, other: string): number => (one < other ? -1 : one > other ? 1 : 0);

function filesUnder(folder: string, cover: string): string[] {
  const at = path.join(folder, cover);
  try {
    if (!statSync(at).isDirectory()) return [cover];
  } catch {
    return [];
  }
  return readdirSync(at, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && !entry.name.startsWith("."))
    .flatMap((entry) => (entry.isDirectory() || entry.isFile() ? filesUnder(folder, path.posix.join(cover, entry.name)) : []));
}

export async function unimportedPackages(folder: string, library: Library): Promise<MappedPackage[]> {
  const found = findProject(path.resolve(folder));
  if (found.project !== library.name) return [];
  const at = found.folder;
  if (!existsSync(path.join(at, "package.json")) && !holdsPython(at)) return [];
  let packages: MappedPackage[];
  try {
    packages = packagesOf(at);
  } catch (error) {
    if (error instanceof ImportRefusedError) return [];
    throw error;
  }
  const mapped = new Set((await library.list("story")).flatMap((story) => (story.fields.mapped === undefined ? [] : [story.fields.mapped.package])));
  const left = (await unbuilt(library, packages)).filter((one) => !mapped.has(one.package));
  return left.length === packages.length ? left : [];
}

export function unimportedSentence(packages: readonly MappedPackage[]): string {
  const named = packages.map((one) => `"${one.title}"`);
  const list = named.length === 1 ? `the package ${named[0]}` : `the packages ${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `This folder holds an existing codebase not yet imported: it declares ${list}.`;
}

const NAMED = 10;

export function importLines(imported: Imported): string[] {
  if (imported.before === undefined) return [];
  const short = (commit: string | undefined): string => commit?.slice(0, 12) ?? "no commit";
  if (imported.before.commit === undefined && imported.commit === undefined) return ["No commit is recorded: the folder is not a git checkout with a remote.", ...redrawnLines(imported)];
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
  return [...lines, ...redrawnLines(imported)];
}

function redrawnLines({ redrawn }: Imported): string[] {
  const name = ({ id, title }: Named): string => `"${title}" (${id})`;
  const list = (names: readonly Named[]): string => names.map(name).join(", ");
  return redrawn.flatMap((story) => [
    `Story ${name(story.story)} is redrawn from its code, keeping its capabilities' names, descriptions and contracts:`,
    ...story.merged.map(({ into, from }) => `  merged ${list(from)} into ${name(into)}`),
    ...story.split.map(({ from, into }) => `  split ${name(from)} into ${list(into)}`),
    ...story.added.map((one) => `  added ${name(one)}`),
    ...story.retired.map((one) => `  retired ${name(one)}${one.contractsTo === undefined ? "" : `, its contracts moved to ${name(one.contractsTo)}`}`),
    ...story.left.map((one) => `  left ${name(one)} as it stands: its files (${one.gone.join(", ")}) are gone and its contracts have nowhere to move`),
  ]);
}

function changedBetween(folder: string, from: string, to: string): FileChanges | undefined {
  if (from === to) return { added: [], changed: [], removed: [] };
  const run = spawnSync("git", ["-C", folder, "diff", "--name-status", "-M", "-z", from, to], { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (run.status !== 0) return undefined;
  const changes = { added: [] as string[], changed: [] as string[], removed: [] as string[] };
  const fields = run.stdout.split("\0");
  for (let at = 0; at + 1 < fields.length;) {
    const status = fields[at]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      if (status.startsWith("R")) changes.removed.push(fields[at + 1]!);
      changes.added.push(fields[at + 2]!);
      at += 3;
      continue;
    }
    const file = fields[at + 1]!;
    (status === "A" ? changes.added : status === "D" ? changes.removed : changes.changed).push(file);
    at += 2;
  }
  return { added: changes.added.sort(), changed: changes.changed.sort(), removed: changes.removed.sort() };
}

async function unbuilt(library: Library, packages: readonly MappedPackage[]): Promise<MappedPackage[]> {
  const built = new Set((await library.list("story"))
    .filter((story) => story.fields.mapped === undefined)
    .map((story) => `packages/${packageOf({ id: story.id, title: story.fields.title })}`));
  return packages.filter((one) => !built.has(one.package));
}

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

const PYTHON_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py"];

const holdsPython = (folder: string): boolean => PYTHON_MANIFESTS.some((manifest) => existsSync(path.join(folder, manifest)));

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

function readPyproject(folder: string): Record<string, unknown> {
  try {
    return parseToml(readFileSync(path.join(folder, "pyproject.toml"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

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
    const entry = section === "metadata" ? /^(name|description)\s*[=:](.+)$/.exec(line) : null;
    if (entry !== null) found[entry[1] as "name" | "description"] = entry[2]!.trim();
  }
  return found;
}

function tableAt(value: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  let at = value;
  for (const key of keys) at = typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>)[key] : undefined;
  return typeof at === "object" && at !== null && !Array.isArray(at) ? (at as Record<string, unknown>) : undefined;
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []);

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

function yamlPackages(text: string): string[] {
  const entries: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
    const entry = inPackages ? /^\s*-(.+)$/.exec(line.replace(/\s#.*$/, ""))?.[1]?.trim() : undefined;
    if (entry !== undefined) entries.push(entry.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return entries;
}

const GLOBSTARS = 3;

const VISITS = 10_000;

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

function expand(root: string, at: string, segments: readonly string[], list: (at: string) => string[]): string[] {
  if (segments.length === 0) return [at === "" ? "." : at];
  const [segment, ...rest] = segments as [string, ...string[]];
  if (segment === "**") return [...expand(root, at, rest, list), ...list(at).flatMap((sub) => expand(root, sub, segments, list))];
  if (!segment.includes("*")) return existsSync(path.join(root, at, segment)) ? expand(root, path.posix.join(at, segment), rest, list) : [];
  return list(at).filter((sub) => starMatches(segment, path.posix.basename(sub))).flatMap((sub) => expand(root, sub, rest, list));
}

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

function subfolders(root: string, at: string): string[] {
  try {
    return readdirSync(path.join(root, at), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
      .map((entry) => path.posix.join(at, entry.name));
  } catch {
    return [];
  }
}

function readManifest(folder: string): Record<string, unknown> {
  try {
    const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as unknown;
    return typeof manifest === "object" && manifest !== null ? (manifest as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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

function within(folder: string, root: string): boolean {
  const relative = path.relative(key(root), key(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
