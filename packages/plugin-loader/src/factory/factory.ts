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
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Composition } from "../switch/switch.js";

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

/** The declarations of `kind` plugin `plugin` of `folder` adds, none for a kind it does not name; a plugin that cannot be read is refused with why. */
function pluginParts(folder: string | undefined, plugin: string, kind: string): unknown[] {
  const { dir, pkg } = pluginPackage(folder, plugin);
  const manifest = pkg.storytree;
  if (typeof manifest !== "object" || manifest === null) throw new Error(`${plugin}'s package.json has no storytree manifest`);
  const written = (manifest as Record<string, unknown>).interface;
  if (written === undefined) throw new Error(`${plugin}'s storytree manifest names no plugin interface version; this storytree honours interface ${PLUGIN_INTERFACE}`);
  if (written !== PLUGIN_INTERFACE) throw new Error(`${plugin} was written for storytree's plugin interface ${JSON.stringify(written)}; this storytree honours interface ${PLUGIN_INTERFACE}`);
  const entries = (manifest as Record<string, unknown>)[kind];
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
