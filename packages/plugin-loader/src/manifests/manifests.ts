// Capability 1 · Manifests
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import { partName, type PartsGraph } from "../switch/switch.js";

export interface StoryPart {
  readonly package: string;
  readonly module: string;
  readonly export: string;
}

export interface PackageJson {
  readonly name?: string;
  readonly exports?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly storytree?: unknown;
}

let reading: Set<string> | undefined;

const readJson = (file: string): PackageJson => {
  if (reading !== undefined) reading.add(realpathSync(file));
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
};

export function readsOf<T>(run: () => T): { value: T; files: string[] } {
  const outer = reading;
  reading = new Set();
  try {
    const value = run();
    return { value, files: [...reading] };
  } finally {
    reading = outer;
  }
}

export function hostKinds(host: string): string[] {
  const imports = (readJson(path.join(host, "package.json")) as { imports?: Record<string, unknown> }).imports ?? {};
  return Object.keys(imports).filter((key) => /^#parts\/[\w-]+$/.test(key)).map((key) => key.slice("#parts/".length));
}

function installed(name: string, from: string): PackageJson | undefined {
  return installedAt(name, from)?.pkg;
}

function installedAt(name: string, from: string): { pkg: PackageJson; dir: string } | undefined {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) return { pkg: readJson(file), dir: path.dirname(realpathSync(file)) };
    if (path.dirname(dir) === dir) return undefined;
  }
}

export function hostOf(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`${from} is in no package: no package.json above it.`);
  }
}

const exported = (exports: unknown, from: string): boolean =>
  typeof exports === "object" && exports !== null && !Array.isArray(exports) && Object.hasOwn(exports, from);

function dependencies(host: string): { name: string; pkg: PackageJson | undefined }[] {
  const own = readJson(path.join(host, "package.json"));
  const names = [...new Set([...Object.keys(own.dependencies ?? {}), ...Object.keys(own.devDependencies ?? {})])].sort();
  return names.map((name) => ({ name, pkg: installed(name, host) }));
}

const manifested = (pkg: PackageJson | undefined): boolean => typeof pkg?.storytree === "object" && pkg.storytree !== null;

const declaresServices = (pkg: PackageJson | undefined): boolean => manifested(pkg) && (pkg!.storytree as Record<string, unknown>).services !== undefined;

export function partsGraph(host: string): PartsGraph {
  return partsGraphOf(dependencies(host).map(({ name }) => name), host, installedAt);
}

export type FoundPackage = { readonly pkg: PackageJson; readonly dir: string };

export function partsGraphOf(names: readonly string[], from: string, find: (name: string, from: string) => FoundPackage | undefined): PartsGraph {
  const graph: Record<string, string[]> = {};
  const visit = (name: string, from: string): void => {
    const found = find(name, from);
    if (!manifested(found?.pkg) || Object.hasOwn(graph, partName(name))) return;
    const standsOn = Object.keys(found!.pkg.dependencies ?? {}).filter((one) => manifested(find(one, found!.dir)?.pkg));
    graph[partName(name)] = standsOn.map(partName).sort();
    for (const one of standsOn) visit(one, found!.dir);
    for (const one of Object.keys(found!.pkg.devDependencies ?? {})) if (declaresServices(find(one, found!.dir)?.pkg)) visit(one, found!.dir);
  };
  for (const name of names) visit(name, from);
  return Object.fromEntries(Object.entries(graph).sort(([a], [b]) => a.localeCompare(b)));
}

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
  return found.sort((a, b) => (a.order === b.order ? 0 : a.order - b.order)).map(({ part }) => part);
}

export type ServiceRun = "always" | { readonly every: `${number}m` };

export const isServiceRun = (run: unknown): run is ServiceRun =>
  run === "always" || (typeof run === "object" && run !== null && Object.keys(run).length === 1 && typeof (run as { every?: unknown }).every === "string" && /^[1-9][0-9]*m$/.test((run as { every: string }).every));

export interface StoryService extends StoryPart {
  readonly name: string;
  readonly run: ServiceRun;
}

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
