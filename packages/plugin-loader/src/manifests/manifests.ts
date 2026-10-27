/**
 * Capability 1 · Manifests. The parts a host's story packages add, read from the `storytree` key of each package's
 * package.json (ADR-1021): per kind, a list of `{ from, export, order? }`, where `from` is one of the package's own
 * export subpaths and `export` the name its module exports the part's declarations under. The packages read are
 * those the host's package.json depends on: storytree's own, never one a user's or project's configuration names. A
 * package's long-running `services` (ADR-1180 D1) are entries of their own shape, `{ name, from, export, run }`, read by
 * storyServices for the service host.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { partName, type PartsGraph } from "../switch/switch.js";

/** One part a story package adds: the module a host imports and the name the declarations are exported under. */
export interface StoryPart {
  readonly package: string;
  /** The package's export subpath, as a host imports it: `@storytree/forest/surfaces`. */
  readonly module: string;
  readonly export: string;
}

interface PackageJson {
  readonly name?: string;
  readonly exports?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly storytree?: unknown;
}

const readJson = (file: string): PackageJson => JSON.parse(readFileSync(file, "utf8")) as PackageJson;

/** The installed package.json of `name`, found as Node finds a package: in node_modules from `from` upwards. */
function installed(name: string, from: string): PackageJson | undefined {
  return installedAt(name, from)?.pkg;
}

/** The installed package.json of `name` and the folder it really lives in, where its own dependencies are found from. */
function installedAt(name: string, from: string): { pkg: PackageJson; dir: string } | undefined {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) return { pkg: readJson(file), dir: path.dirname(realpathSync(file)) };
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** The host a file belongs to: the nearest folder above it holding a package.json, as Node finds the package a file is in. */
export function hostOf(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`${from} is in no package: no package.json above it.`);
  }
}

const exported = (exports: unknown, from: string): boolean =>
  typeof exports === "object" && exports !== null && !Array.isArray(exports) && Object.hasOwn(exports, from);

/** The story packages `host` depends on, sorted by name, each with its installed package.json. */
function dependencies(host: string): { name: string; pkg: PackageJson | undefined }[] {
  const own = readJson(path.join(host, "package.json"));
  const names = [...new Set([...Object.keys(own.dependencies ?? {}), ...Object.keys(own.devDependencies ?? {})])].sort();
  return names.map((name) => ({ name, pkg: installed(name, host) }));
}

const manifested = (pkg: PackageJson | undefined): boolean => typeof pkg?.storytree === "object" && pkg.storytree !== null;

/**
 * The parts `host` depends on (capability 4): each package with a manifest, by part name, with the parts its package.json
 * depends on. A part reached only through another part is in it too, so switching it off takes the one standing on it.
 */
export function partsGraph(host: string): PartsGraph {
  const graph: Record<string, string[]> = {};
  const visit = (name: string, from: string): void => {
    const found = installedAt(name, from);
    if (!manifested(found?.pkg) || Object.hasOwn(graph, partName(name))) return;
    const standsOn = Object.keys(found!.pkg.dependencies ?? {}).filter((one) => manifested(installedAt(one, found!.dir)?.pkg));
    graph[partName(name)] = standsOn.map(partName).sort();
    for (const one of standsOn) visit(one, found!.dir);
  };
  for (const { name } of dependencies(host)) visit(name, host);
  return Object.fromEntries(Object.entries(graph).sort(([a], [b]) => a.localeCompare(b)));
}

/** The parts of `kind` the story packages `host` depends on declare, lowest order first (see 1.3). */
export function storyParts(host: string, kind: string): StoryPart[] {
  const found: { part: StoryPart; order: number; position: number }[] = [];
  for (const { name, pkg } of dependencies(host)) {
    const manifest = pkg?.storytree;
    if (typeof manifest !== "object" || manifest === null) continue;
    const entries = (manifest as Record<string, unknown>)[kind];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry: { from?: unknown; export?: unknown; order?: unknown }, position) => {
      const from = String(entry?.from);
      if (!exported(pkg!.exports, from)) throw new Error(`${name}'s storytree manifest names ${JSON.stringify(from)} for ${kind}, which the package does not export.`);
      if (typeof entry.export !== "string" || entry.export === "") throw new Error(`${name}'s storytree manifest names ${JSON.stringify(from)} for ${kind} with no export name.`);
      const order = typeof entry.order === "number" ? entry.order : Number.POSITIVE_INFINITY;
      found.push({ part: { package: name, module: path.posix.join(name, from), export: entry.export }, order, position });
    });
  }
  // Names are already sorted, and the sort is stable, so ties keep package name then manifest position.
  return found.sort((a, b) => (a.order === b.order ? 0 : a.order - b.order)).map(({ part }) => part);
}

/** How a service runs: started again whenever it ends, or started every n minutes, never while the last run still goes. */
export type ServiceRun = "always" | { readonly every: `${number}m` };

/** Whether `run` is how a service runs: "always", or { every: "<n>m" } with n a whole number above 0. */
export const isServiceRun = (run: unknown): run is ServiceRun =>
  run === "always" || (typeof run === "object" && run !== null && Object.keys(run).length === 1 && typeof (run as { every?: unknown }).every === "string" && /^[1-9][0-9]*m$/.test((run as { every: string }).every));

/** One long-running service a story package declares (ADR-1180 D1): its name, how it runs, and the module and export a service host starts. */
export interface StoryService extends StoryPart {
  readonly name: string;
  readonly run: ServiceRun;
}

/**
 * The services the story packages `host` depends on declare in their manifests' `services`, by package name then
 * manifest position: each named in lower-case letters, digits and dashes, running "always" or { every: "<n>m" }, from
 * one of its package's export subpaths. One that is not is refused, naming the package.
 */
export function storyServices(host: string): StoryService[] {
  const found: StoryService[] = [];
  for (const { name, pkg } of dependencies(host)) {
    const manifest = pkg?.storytree;
    if (typeof manifest !== "object" || manifest === null) continue;
    const entries = (manifest as Record<string, unknown>).services;
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`${name}'s storytree manifest names services with no list.`);
    entries.forEach((entry: { name?: unknown; from?: unknown; export?: unknown; run?: unknown }, at) => {
      const service = entry?.name;
      if (typeof service !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(service)) throw new Error(`${name}'s service ${at + 1} has no name (lower-case letters, digits and dashes).`);
      if (!isServiceRun(entry.run)) throw new Error(`${name}'s service ${service} runs ${JSON.stringify(entry.run)}, not "always" or { every: "<n>m" }.`);
      const from = String(entry.from);
      if (!exported(pkg!.exports, from)) throw new Error(`${name}'s storytree manifest names ${JSON.stringify(from)} for its service ${service}, which the package does not export.`);
      if (typeof entry.export !== "string" || entry.export === "") throw new Error(`${name}'s storytree manifest names ${JSON.stringify(from)} for its service ${service} with no export name.`);
      found.push({ package: name, name: service, run: entry.run, module: path.posix.join(name, from), export: entry.export });
    });
  }
  return found;
}
