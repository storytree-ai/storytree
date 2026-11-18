// Capability 3 · Run-time composition
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostOf, partsGraph, storyParts } from "../manifests/manifests.js";
import { partName, type Composition } from "../switch/switch.js";

export async function composeParts<Part = unknown>(from: string | URL, kind: string): Promise<Composition<Part>> {
  const file = typeof from === "string" && !from.startsWith("file:") ? from : fileURLToPath(from);
  const host = hostOf(path.dirname(file));
  const resolve = createRequire(path.join(host, "package.json")).resolve;
  const parts = storyParts(host, kind);
  const modules = await Promise.all(parts.map(async (part) => {
    const module = await import(pathToFileURL(resolve(part.module)).href) as Record<string, unknown>;
    const declared = module[part.export];
    if (!Array.isArray(declared)) throw new Error(`${part.module} exports no list called ${part.export} for ${kind}.`);
    return declared as Part[];
  }));
  return {
    parts: modules.flat(),
    owners: modules.flatMap((declared, index) => declared.map(() => partName(parts[index]!.package))),
    graph: partsGraph(host),
  };
}
