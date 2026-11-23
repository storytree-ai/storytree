// Capability 5 · Factory plugins
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { pluginSchema, type PluginPlan, type PluginPlanHeld, type PluginRecordKind } from "@storytree/library";
import type { OutsideWriter } from "@storytree/library/outside-writer";
import type { VerbContext } from "@storytree/library/verbs";
import type { SettingsReading } from "@storytree/project-and-caller";

import { isServiceRun, type ServiceRun } from "../manifests/manifests.js";
import { pluginAt, standInPlaces, type Composition, type PartsGraph } from "../switch/switch.js";

export type { ServiceRun };

export interface StandIns {
  readonly folder?: string;
  readonly plugins: Readonly<Record<string, string>>;
}

export const PLUGIN_INTERFACE = 1;

const load = createRequire((import.meta.url as string | undefined) ?? pathToFileURL(__filename).href);

function pluginPackage(folder: string | undefined, plugin: string): { dir: string; pkg: { exports?: unknown; storytree?: unknown } } {
  if (folder === undefined) throw new Error("no factory folder is chosen on this computer (storytree settings set factory <folder>)");
  if (plugin === "" || plugin === "." || plugin === ".." || /[\\/]/.test(plugin)) throw new Error(`${JSON.stringify(plugin)} is not a plugin's name`);
  const dir = path.join(folder, "plugins", plugin);
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) throw new Error(`the factory has no plugin called ${plugin} (no ${file})`);
  return { dir, pkg: JSON.parse(readFileSync(file, "utf8")) as { exports?: unknown; storytree?: unknown } };
}

export function pluginExport(folder: string | undefined, plugin: string, from: string): string {
  const { dir, pkg } = pluginPackage(folder, plugin);
  return exported(dir, plugin, pkg, from);
}

function exported(dir: string, plugin: string, pkg: { exports?: unknown }, from: string): string {
  const target = typeof pkg.exports === "object" && pkg.exports !== null && Object.hasOwn(pkg.exports, from) ? (pkg.exports as Record<string, unknown>)[from] : undefined;
  if (typeof target !== "string") throw new Error(`${plugin} does not export ${JSON.stringify(from)}`);
  const file = path.resolve(dir, target);
  const within = path.relative(dir, file);
  if (within === "" || within.startsWith("..") || path.isAbsolute(within)) throw new Error(`${plugin} exports ${JSON.stringify(from)} as ${target}, outside its own folder`);
  return file;
}

function pluginManifest(folder: string | undefined, plugin: string): { dir: string; pkg: { exports?: unknown }; manifest: Record<string, unknown> } {
  const { dir, pkg } = pluginPackage(folder, plugin);
  const manifest = pkg.storytree;
  if (typeof manifest !== "object" || manifest === null) throw new Error(`${plugin}'s package.json has no storytree manifest`);
  const written = (manifest as Record<string, unknown>).interface;
  if (written === undefined) throw new Error(`${plugin}'s storytree manifest names no plugin interface version; this storytree honours interface ${PLUGIN_INTERFACE}`);
  if (written !== PLUGIN_INTERFACE) throw new Error(`${plugin} was written for storytree's plugin interface ${JSON.stringify(written)}; this storytree honours interface ${PLUGIN_INTERFACE}`);
  return { dir, pkg, manifest: manifest as Record<string, unknown> };
}

export function pluginFor(folder: string | undefined, plugin: string): string | undefined {
  const named = pluginManifest(folder, plugin).manifest.for;
  return typeof named === "string" && named !== "" ? named : undefined;
}

export function pluginParts(folder: string | undefined, plugin: string, kind: string): unknown[] {
  const { dir, pkg, manifest } = pluginManifest(folder, plugin);
  const entries = manifest[kind];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw new Error(`${plugin}'s storytree manifest names ${kind} with no list`);
  return entries.flatMap((entry: { from?: unknown; export?: unknown }) => {
    const from = String(entry?.from);
    let file: string;
    try {
      file = exported(dir, plugin, pkg, from);
    } catch (error) {
      throw new Error(`${plugin}'s storytree manifest names ${JSON.stringify(from)} for ${kind}, which ${(error as Error).message.replace(`${plugin} `, "it ")}`);
    }
    const module = load(file) as Record<string, unknown>;
    const declared = module[String(entry.export)];
    if (!Array.isArray(declared)) throw new Error(`${plugin}'s ${path.relative(dir, file)} exports no list called ${String(entry.export)} for ${kind}`);
    return declared as unknown[];
  });
}

export interface UnnamedPlugin {
  readonly plugin: string;
  readonly part: string;
}

const UNMOUNTED_FIELDS = new Set(["interface", "for", "plan"]);

export function unnamedPlugins(standIns: StandIns): UnnamedPlugin[] {
  const { folder } = standIns;
  if (folder === undefined) return [];
  const named = new Set(Object.values(standIns.plugins));
  let plugins: string[];
  try {
    plugins = readdirSync(path.join(folder, "plugins")).sort();
  } catch {
    return [];
  }
  return plugins.filter((plugin) => !named.has(plugin)).flatMap((plugin) => {
    try {
      const { manifest } = pluginManifest(folder, plugin);
      if (Object.keys(manifest).every((field) => UNMOUNTED_FIELDS.has(field))) return [];
      return [{ plugin, part: pluginFor(folder, plugin) ?? plugin }];
    } catch {
      return [];
    }
  });
}

export function unnamedOwnerOf(standIns: StandIns, kind: string, name: string): UnnamedPlugin | undefined {
  return unnamedPlugins(standIns).find(({ plugin }) => {
    try {
      return pluginParts(standIns.folder, plugin, kind).some((one) => typeof one === "object" && one !== null && (one as { name?: unknown }).name === name);
    } catch {
      return false;
    }
  });
}

export function standIn<Part>(composition: Composition<Part>, kind: string, standIns: StandIns): Composition<Part> {
  const parts = [...composition.parts];
  const owners = [...composition.owners];
  const fromPlugin = composition.owners.map((_, index) => pluginAt(composition, index));
  const standsIn: Record<string, string> = { ...composition.standsIn };
  const failed: Record<string, string> = { ...composition.failed };
  for (const [part, plugin] of Object.entries(standIns.plugins)) {
    let declared: unknown[];
    try {
      declared = pluginParts(standIns.folder, plugin, kind);
    } catch (error) {
      failed[part] = `its stand-in ${plugin} could not be loaded: ${(error as Error).message}`;
      continue;
    }
    standsIn[plugin] = part;
    const at = owners.lastIndexOf(part) + 1 || owners.length;
    parts.splice(at, 0, ...declared as Part[]);
    owners.splice(at, 0, ...declared.map(() => plugin));
    fromPlugin.splice(at, 0, ...declared.map(() => plugin));
  }
  return { parts, owners, graph: composition.graph, standsIn, fromPlugin, failed };
}

export function pluginRecordKinds(folder: string | undefined, plugin: string): PluginRecordKind[] {
  const declared = pluginManifest(folder, plugin).manifest.recordKinds;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error(`${plugin}'s storytree manifest names recordKinds with no list`);
  for (const entry of declared as { kind?: unknown; writers?: unknown }[]) {
    const kind = JSON.stringify(entry?.kind);
    if (typeof entry?.kind !== "string" || !entry.kind.startsWith(`${plugin}.`)) throw new Error(`${plugin}'s record kind ${kind} is not named ${plugin}.<kind>`);
    if (!Array.isArray(entry.writers) || entry.writers.length === 0 || !entry.writers.every((writer) => typeof writer === "string" && writer !== "")) {
      throw new Error(`${plugin}'s record kind ${kind} names no writers (the database roles that may write it)`);
    }
  }
  const kinds = declared as PluginRecordKind[];
  try {
    pluginSchema(kinds);
  } catch (error) {
    throw new Error(`${plugin}'s ${(error as Error).message.replace(/^the /, "")}`);
  }
  return kinds;
}

export function pluginPlan(folder: string | undefined, plugin: string): PluginPlan | undefined {
  const named = planFile(folder, plugin);
  if (named === undefined) return undefined;
  const { file, within } = named;
  if (!existsSync(file)) throw new Error(`${plugin}'s plan ${within} is not there (no ${file})`);
  let plan: unknown;
  try {
    plan = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${plugin}'s plan ${within} is not JSON: ${(error as Error).message}`);
  }
  const { story, capabilities } = (typeof plan === "object" && plan !== null ? plan : {}) as { story?: unknown; capabilities?: unknown };
  const listed = Array.isArray(capabilities) && capabilities.every((capability: { contracts?: unknown } | null) => Array.isArray(capability?.contracts));
  if (typeof story !== "object" || story === null || !listed) throw new Error(`${plugin}'s plan ${within} is not { story, capabilities: [{ …, contracts: […] }] }`);
  return plan as PluginPlan;
}

function planFile(folder: string | undefined, plugin: string): { file: string; within: string } | undefined {
  const { dir, manifest } = pluginManifest(folder, plugin);
  const named = manifest.plan;
  if (named === undefined) return undefined;
  if (typeof named !== "string" || named === "") throw new Error(`${plugin}'s storytree manifest names its plan as ${JSON.stringify(named)}, not a file in its folder`);
  const file = path.resolve(dir, named);
  const within = path.relative(dir, file);
  if (within === "" || within.startsWith("..") || path.isAbsolute(within)) throw new Error(`${plugin}'s plan ${named} is outside its own folder`);
  return { file, within };
}

export function pluginPlanHeld(folder: string | undefined, plugin: string): PluginPlanHeld | undefined {
  const named = planFile(folder, plugin);
  if (named === undefined) return undefined;
  const git = (args: string[], input?: string): Buffer | undefined => {
    try {
      return execFileSync("git", args, { cwd: path.dirname(named.file), stdio: ["pipe", "pipe", "ignore"], maxBuffer: 1 << 30, ...(input === undefined ? {} : { input }) });
    } catch {
      return undefined;
    }
  };
  const prefix = git(["rev-parse", "--show-prefix"])?.toString().trim();
  if (prefix === undefined) return undefined;
  const relative = `${prefix}${path.basename(named.file)}`;
  const commits = (git(["log", "--format=%H", "HEAD", "--", `:(top)${relative}`])?.toString() ?? "").split("\n").filter((line) => line !== "");
  const versions: unknown[] = [];
  const read = (text: string): void => {
    try {
      versions.push(JSON.parse(text));
    } catch {
    }
  };
  if (commits.length > 0) {
    const batch = git(["cat-file", "--batch"], commits.map((commit) => `${commit}:${relative}\n`).join("")) ?? Buffer.alloc(0);
    for (let at = 0; at < batch.length; ) {
      const end = batch.indexOf(10, at);
      if (end < 0) break;
      const [, kind, size] = batch.subarray(at, end).toString().split(" ");
      at = end + 1;
      if (kind !== "blob") continue;
      read(batch.subarray(at, at + Number(size)).toString("utf8"));
      at += Number(size) + 1;
    }
  }
  if (existsSync(named.file)) read(readFileSync(named.file, "utf8"));
  const capabilities = new Set<number>();
  const contracts = new Set<string>();
  for (const version of versions) {
    const listed = (version as { capabilities?: unknown } | null)?.capabilities;
    for (const capability of Array.isArray(listed) ? listed : []) {
      const number = /^(\d+) · /.exec(String(capability?.title))?.[1];
      if (number !== undefined) capabilities.add(Number(number));
      for (const contract of Array.isArray(capability?.contracts) ? capability.contracts : []) {
        const own = /^(\d+\.\d+)(?![\d.])/.exec(String(contract?.title))?.[1];
        if (own !== undefined) contracts.add(own);
      }
    }
  }
  return { capabilities: [...capabilities], contracts: [...contracts], versions };
}

export function pluginLibrarian(folder: string | undefined, plugin: string): OutsideWriter | undefined {
  const declared = pluginManifest(folder, plugin).manifest.librarian;
  if (declared === undefined) return undefined;
  const { role, update } = (typeof declared === "object" && declared !== null ? declared : {}) as { role?: unknown; update?: unknown };
  if (typeof role !== "string" || role === "") throw new Error(`${plugin}'s librarian names no role (the database role librarian-${plugin} connects as)`);
  if (update !== undefined && typeof update !== "boolean") throw new Error(`${plugin}'s librarian's update is ${JSON.stringify(update)}, not true or false`);
  const kinds = pluginRecordKinds(folder, plugin);
  if (kinds.length === 0) throw new Error(`${plugin}'s librarian has no kinds to keep: its manifest declares no recordKinds`);
  const door = kinds.find((kind) => kind.writers.includes(role));
  if (door !== undefined) throw new Error(`${plugin}'s librarian's role ${role} also writes ${door.kind}: give the librarian a role of its own, so the door that adds records never changes them`);
  return { role, kinds: kinds.map((kind) => kind.kind), ...(update === true ? { update } : {}) };
}

export function pluginFences(folder: string | undefined, plugin: string): OutsideWriter[] {
  const writes = new Map<string, string[]>();
  for (const { kind, writers } of pluginRecordKinds(folder, plugin)) for (const role of writers) writes.set(role, [...(writes.get(role) ?? []), kind]);
  const librarian = pluginLibrarian(folder, plugin);
  return [...[...writes].map(([role, kinds]) => ({ role, kinds })), ...(librarian === undefined ? [] : [librarian])];
}

export function recordKinds(graph: PartsGraph, standIns: StandIns, off: readonly string[]): { kinds: PluginRecordKind[]; failed: Record<string, string> } {
  const places = standInPlaces(graph, off);
  const kinds: PluginRecordKind[] = [];
  const failed: Record<string, string> = {};
  for (const [part, plugin] of Object.entries(standIns.plugins)) {
    if (!places.has(part)) continue;
    try {
      kinds.push(...pluginRecordKinds(standIns.folder, plugin));
    } catch (error) {
      failed[part] = `its stand-in ${plugin}'s record kinds could not be read: ${(error as Error).message}`;
    }
  }
  return { kinds, failed };
}

export interface ServiceHost {
  readonly folder: string;
  readonly settings: SettingsReading;
  log(line: string): void;
  readonly stopping: AbortSignal;
  readonly context?: VerbContext;
}

export interface PluginService {
  readonly name: string;
  readonly run: ServiceRun;
  start(host: ServiceHost): Promise<void> | void;
}

export function pluginServices(folder: string | undefined, plugin: string): PluginService[] {
  const { dir, pkg, manifest } = pluginManifest(folder, plugin);
  const declared = manifest.services;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) throw new Error(`${plugin}'s storytree manifest names services with no list`);
  const named = new Set<string>();
  return declared.map((entry: { name?: unknown; from?: unknown; export?: unknown; run?: unknown }, at) => {
    const { name, run } = entry ?? {};
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`${plugin}'s service ${at + 1} has no name (lower-case letters, digits and dashes)`);
    if (named.has(name)) throw new Error(`${plugin} declares the service ${name} twice`);
    named.add(name);
    if (!isServiceRun(run)) throw new Error(`${plugin}'s service ${name} runs ${JSON.stringify(run)}, not "always" or { every: "<n>m" }`);
    const from = String(entry.from);
    let file: string;
    try {
      file = exported(dir, plugin, pkg, from);
    } catch (error) {
      throw new Error(`${plugin}'s service ${name} names ${JSON.stringify(from)}, which ${(error as Error).message.replace(`${plugin} `, "it ")}`);
    }
    const service = (load(file) as Record<string, unknown>)[String(entry.export)] as { start?: unknown } | undefined;
    if (typeof service?.start !== "function") throw new Error(`${plugin}'s service ${name}: ${path.relative(dir, file)} exports no { start(host) } called ${String(entry.export)}`);
    const start = service.start as PluginService["start"];
    return { name, run, start: (host: ServiceHost) => start.call(service, host) };
  });
}

const gitRun = promisify(execFile);

async function gitOut(folder: string, args: string[], timeout?: number): Promise<string | undefined> {
  try {
    const { stdout } = await gitRun("git", args, { cwd: folder, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 1 << 26, ...(timeout === undefined ? {} : { timeout }) });
    return stdout;
  } catch {
    return undefined;
  }
}

export async function factoryStale(folder: string): Promise<string | undefined> {
  if ((await gitOut(folder, ["rev-parse", "--is-inside-work-tree"]))?.trim() !== "true") return undefined;
  await gitOut(folder, ["fetch", "-q", "origin", "main"], 10_000);
  const behind = Number((await gitOut(folder, ["rev-list", "--count", "HEAD..origin/main"]))?.trim() ?? 0) || 0;
  const changed = (await gitOut(folder, ["status", "--porcelain"]) ?? "").split("\n").filter((line) => line !== "").length;
  if (behind === 0 && changed === 0) return undefined;
  const said = [
    ...(behind === 0 ? [] : [`is behind origin/main by ${behind} commit${behind === 1 ? "" : "s"}`]),
    ...(changed === 0 ? [] : [`has ${changed} changed path${changed === 1 ? "" : "s"}`]),
  ];
  return `storytree: the factory clone ${folder} ${said.join(" and ")}; to run from an up-to-date worktree, run with STORYTREE_FACTORY=<worktree>`;
}
