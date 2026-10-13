/**
 * Capability 1 · Manifests. The parts a host's story packages add, read from the `storytree` key of each package's
 * package.json (ADR-1021): per kind, a list of `{ from, export, order? }`, where `from` is one of the package's own
 * export subpaths and `export` the name its module exports the part's declarations under. The packages read are
 * those the host's package.json depends on: storytree's own, never one a user's or project's configuration names.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const file = path.join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(file)) return readJson(file);
    if (path.dirname(dir) === dir) return undefined;
  }
}

const exported = (exports: unknown, from: string): boolean =>
  typeof exports === "object" && exports !== null && !Array.isArray(exports) && Object.hasOwn(exports, from);

/** The parts of `kind` the story packages `host` depends on declare, lowest order first (see 1.3). */
export function storyParts(host: string, kind: string): StoryPart[] {
  const own = readJson(path.join(host, "package.json"));
  const names = [...new Set([...Object.keys(own.dependencies ?? {}), ...Object.keys(own.devDependencies ?? {})])].sort();
  const found: { part: StoryPart; order: number; position: number }[] = [];
  for (const name of names) {
    const pkg = installed(name, host);
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
