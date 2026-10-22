/**
 * Capability 5 · Factory plugins (question_5867f490cdd6: run-time loading). A plugin in the user's factory folder,
 * `<factory>/plugins/<plugin>/package.json` with a `storytree` manifest of storytree's own shape, stands in for a part
 * this computer switches off: its declarations of a kind are loaded from the folder as a host starts and put in the
 * composition where the part's were, so a host mounts them only while that part is off (capability 4). The folder is
 * the one the user chose, which is the approval; nothing else a configuration names is loaded. A plugin imports nothing
 * of storytree's: it exports declarations, and the host hands their work its context (ADR-1112 D2). The modules are
 * ready-to-run JavaScript, required synchronously (an ES module without top-level await), so a host's synchronous start
 * stays as it is. A plugin that cannot be loaded leaves its part off and says why, and the host still starts.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { Composition } from "../switch/switch.js";

/** This computer's factory folder, when one is chosen, and the plugin named to stand in for each switched-off part. */
export interface StandIns {
  readonly folder?: string;
  /** Part name to the factory plugin standing in for it. */
  readonly plugins: Readonly<Record<string, string>>;
}

const load = createRequire(import.meta.url);

/** The declarations of `kind` plugin `plugin` of `folder` adds, none for a kind it does not name; a plugin that cannot be read is refused with why. */
function pluginParts(folder: string | undefined, plugin: string, kind: string): unknown[] {
  if (folder === undefined) throw new Error("no factory folder is chosen on this computer (storytree settings set factory <folder>)");
  const dir = path.join(folder, "plugins", plugin);
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) throw new Error(`the factory has no plugin called ${plugin} (no ${file})`);
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { exports?: unknown; storytree?: unknown };
  const manifest = pkg.storytree;
  if (typeof manifest !== "object" || manifest === null) throw new Error(`${plugin}'s package.json has no storytree manifest`);
  const entries = (manifest as Record<string, unknown>)[kind];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) throw new Error(`${plugin}'s storytree manifest names ${kind} with no list`);
  return entries.flatMap((entry: { from?: unknown; export?: unknown }) => {
    const from = String(entry?.from);
    const target = typeof pkg.exports === "object" && pkg.exports !== null ? (pkg.exports as Record<string, unknown>)[from] : undefined;
    if (typeof target !== "string") throw new Error(`${plugin}'s storytree manifest names ${JSON.stringify(from)} for ${kind}, which the plugin does not export`);
    const module = load(path.resolve(dir, target)) as Record<string, unknown>;
    const declared = module[String(entry.export)];
    if (!Array.isArray(declared)) throw new Error(`${plugin}'s ${target} exports no list called ${String(entry.export)} for ${kind}`);
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
