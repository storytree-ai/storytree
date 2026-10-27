/**
 * Capability 5 · Factory plugins (question_5867f490cdd6: run-time loading). A plugin in the user's factory folder,
 * `<factory>/plugins/<plugin>/package.json` with a `storytree` manifest of storytree's own shape, stands in for a part
 * this computer switches off: its declarations of a kind are loaded from the folder as a host starts and put in the
 * composition where the part's were, so a host mounts them only while that part is off (capability 4). The folder is
 * the one the user chose, which is the approval; nothing else a configuration names is loaded. A plugin imports nothing
 * of storytree's: it exports declarations, and the host hands their work its context (ADR-1112 D2). The modules are
 * ready-to-run JavaScript, required synchronously (an ES module without top-level await), so a host's synchronous start
 * stays as it is. A plugin that cannot be loaded leaves its part off and says why, and the host still starts. Its
 * manifest names the version of storytree's plugin interface it was written for, so an update that changes what a host
 * hands a plugin leaves an older plugin unmounted, said why, rather than broken in silence. A host that hands a plugin's
 * file on by itself (the desktop window serving a view to its page) finds it by the name the plugin exports, and only so.
 * A mounted plugin may also declare its own kinds of record, as data in its manifest's `recordKinds` (ADR-1178 D3), each
 * named under the plugin's own name; a host opens the library with them, and while the plugin is not mounted its
 * records read dormant.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { pluginSchema, type PluginRecordKind } from "@storytree/library";
import type { OutsideWriter } from "@storytree/library/outside-writer";

import { CORE, switchedOff, type Composition, type PartsGraph } from "../switch/switch.js";

/** This computer's factory folder, when one is chosen, and the plugin named to stand in for each switched-off part. */
export interface StandIns {
  readonly folder?: string;
  /** Part name to the factory plugin standing in for it. */
  readonly plugins: Readonly<Record<string, string>>;
}

/** The version of storytree's plugin interface (what a host hands a plugin's declarations) this storytree honours. */
export const PLUGIN_INTERFACE = 1;

// A CommonJS bundle (the desktop's main process) has no import.meta.url, and has __filename instead.
const load = createRequire((import.meta.url as string | undefined) ?? pathToFileURL(__filename).href);

/** Plugin `plugin`'s folder in `folder` and its package.json, refused with why when there is none. */
function pluginPackage(folder: string | undefined, plugin: string): { dir: string; pkg: { exports?: unknown; storytree?: unknown } } {
  if (folder === undefined) throw new Error("no factory folder is chosen on this computer (storytree settings set factory <folder>)");
  if (plugin === "" || plugin === "." || plugin === ".." || /[\\/]/.test(plugin)) throw new Error(`${JSON.stringify(plugin)} is not a plugin's name`);
  const dir = path.join(folder, "plugins", plugin);
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) throw new Error(`the factory has no plugin called ${plugin} (no ${file})`);
  return { dir, pkg: JSON.parse(readFileSync(file, "utf8")) as { exports?: unknown; storytree?: unknown } };
}

/** The file plugin `plugin` of `folder` exports as `from`, inside its own folder; any other name or place is refused with why. */
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

/** Plugin `plugin`'s storytree manifest, refused with why when there is none or it names an interface this storytree does not honour. */
function pluginManifest(folder: string | undefined, plugin: string): { dir: string; pkg: { exports?: unknown }; manifest: Record<string, unknown> } {
  const { dir, pkg } = pluginPackage(folder, plugin);
  const manifest = pkg.storytree;
  if (typeof manifest !== "object" || manifest === null) throw new Error(`${plugin}'s package.json has no storytree manifest`);
  const written = (manifest as Record<string, unknown>).interface;
  if (written === undefined) throw new Error(`${plugin}'s storytree manifest names no plugin interface version; this storytree honours interface ${PLUGIN_INTERFACE}`);
  if (written !== PLUGIN_INTERFACE) throw new Error(`${plugin} was written for storytree's plugin interface ${JSON.stringify(written)}; this storytree honours interface ${PLUGIN_INTERFACE}`);
  return { dir, pkg, manifest: manifest as Record<string, unknown> };
}

/** The declarations of `kind` plugin `plugin` of `folder` adds, none for a kind it does not name; a plugin that cannot be read is refused with why. */
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

/**
 * `composition` with each stand-in `standIns` names for one of its parts: the plugin's declarations of `kind`, placed
 * after the last of the part's (at the end when the part has none of this kind), owned by the plugin and standing in
 * for the part. A plugin that cannot be loaded adds nothing and is named, with why, against the part it stands in for.
 */
export function standIn<Part>(composition: Composition<Part>, kind: string, standIns: StandIns): Composition<Part> {
  const parts = [...composition.parts];
  const owners = [...composition.owners];
  const standsIn: Record<string, string> = { ...composition.standsIn };
  const failed: Record<string, string> = { ...composition.failed };
  for (const [part, plugin] of Object.entries(standIns.plugins)) {
    if (!Object.hasOwn(composition.graph, part)) continue;
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
  }
  return { parts, owners, graph: composition.graph, standsIn, failed };
}

/**
 * The kinds of record plugin `plugin` of `folder` declares in its manifest's `recordKinds`, none when it names none. Each
 * must be named `<plugin>.<kind>` under the plugin's own name, name who may write it, and be one the library can read;
 * a plugin with one that is not is refused with why.
 */
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

/**
 * The grant plugin `plugin` of `folder` declares for its own librarian (ADR-1178 D5, question_0700cb2e567c: option A), as
 * its manifest's `librarian`, `{ "role": "<database role>", "update"?: true }`: the role librarian-<plugin> connects as,
 * fenced to every kind the plugin declares, and whether it may change their records, not only add them. None when it
 * names none. Its role is its own, never one of its kinds' writers, so a door that adds records never gains the right to
 * change them; a librarian with no kinds to keep, or of another shape, is refused with why.
 */
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

/**
 * The kinds of record the factory plugins a host mounts declare: each stand-in `standIns` names whose part `off`
 * switches off, in `graph`, or names off itself though `graph` lacks it (a plugin's kinds are the library's, not one
 * host's: no host's graph holds a part that has left the base, such as voice). A plugin whose part is on declares none,
 * and one whose kinds cannot be read declares none, named, with why, against the part it stands in for.
 */
export function recordKinds(graph: PartsGraph, standIns: StandIns, off: readonly string[]): { kinds: PluginRecordKind[]; failed: Record<string, string> } {
  const switched = switchedOff(graph, off);
  const kinds: PluginRecordKind[] = [];
  const failed: Record<string, string> = {};
  for (const [part, plugin] of Object.entries(standIns.plugins)) {
    if (!switched.has(part) && !(off.includes(part) && !CORE.includes(part))) continue;
    try {
      kinds.push(...pluginRecordKinds(standIns.folder, plugin));
    } catch (error) {
      failed[part] = `its stand-in ${plugin}'s record kinds could not be read: ${(error as Error).message}`;
    }
  }
  return { kinds, failed };
}
