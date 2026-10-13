/**
 * Capability 3 · Run-time composition. What a host's `#parts/<kind>` names when it runs unbundled (under tsx, in tests
 * and `pnpm storytree`): the host's package.json `imports` maps it to a module of its own that exports
 * `await composeParts(import.meta.url, kind)`. The parts are those capability 1 reads, each imported as the host
 * resolves it; a bundle never reaches this, since the parts plugin answers the same import first (capability 2).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostOf, storyParts } from "../manifests/manifests.js";

/** Every part of `kind` the story packages of the host `from` (a file's URL or path) is in declare, concatenated in storyParts' order. */
export async function composeParts<Part = unknown>(from: string | URL, kind: string): Promise<Part[]> {
  const file = typeof from === "string" && !from.startsWith("file:") ? from : fileURLToPath(from);
  const host = hostOf(path.dirname(file));
  const resolve = createRequire(path.join(host, "package.json")).resolve;
  const modules = await Promise.all(storyParts(host, kind).map(async (part) => {
    const module = await import(pathToFileURL(resolve(part.module)).href) as Record<string, unknown>;
    const declared = module[part.export];
    if (!Array.isArray(declared)) throw new Error(`${part.module} exports no list called ${part.export} for ${kind}.`);
    return declared as Part[];
  }));
  return modules.flat();
}
