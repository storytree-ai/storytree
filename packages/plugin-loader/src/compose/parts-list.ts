/**
 * Capability 2 · Build-time composition. The parts list a build reads (ADR-1021; question_efc2a06dacad, option A): for
 * each `#parts/<kind>` a host's package.json imports, the parts its story packages' manifests name (capability 1), in
 * order and with the part each came from, and the host's parts graph (a composition, capability 4), written to a file
 * of data. The installed hosts are bundles that ship no node_modules, so their parts are composed at build time; the
 * build runs this as a step of its own and packs from the list, importing none of this code. The list carries a
 * fingerprint of every package.json it was written from, so a build can refuse one that is out of date.
 *
 *   node --import tsx parts-list.ts <host folder> <list file>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hostKinds, partsGraph, readsOf, storyParts } from "../manifests/manifests.js";
import { partName } from "../switch/switch.js";

/** Write the parts list of the host in `host` to `file`. */
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
