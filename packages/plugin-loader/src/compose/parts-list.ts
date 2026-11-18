// Capability 2 · Build-time composition
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hostKinds, partsGraph, readsOf, storyParts } from "../manifests/manifests.js";
import { partName } from "../switch/switch.js";

export function writePartsList(host: string, file: string): void {
  const { value, files } = readsOf(() => ({
    kinds: Object.fromEntries(hostKinds(host).map((kind) => [kind, storyParts(host, kind).map((part) => ({ module: part.module, export: part.export, owner: partName(part.package) }))])),
    graph: partsGraph(host),
  }));
  const inputs = Object.fromEntries(files.map((one) => [one, createHash("sha256").update(readFileSync(one)).digest("hex")]));
  writeFileSync(file, `${JSON.stringify({ host, ...value, inputs }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [host, file] = process.argv.slice(2);
  if (host === undefined || file === undefined) throw new Error("usage: parts-list.ts <host folder> <list file>");
  writePartsList(path.resolve(host), path.resolve(file));
}
