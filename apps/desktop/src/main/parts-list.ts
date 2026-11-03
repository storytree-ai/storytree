/**
 * Capability 1 · Lifecycle. How the main process and preload script are packed with the parts the app's story packages'
 * manifests name (ADR-1021): esbuild answers each `import parts from "#parts/<kind>"` with a module importing the parts
 * the importing file's package's parts list names. Plugin loader writes that list as data, by a step of its own run as
 * part of this build (question_efc2a06dacad, option A): the build reads its output and imports none of its code. A
 * list missing, or out of date with a package.json it was written from, stops the build rather than pack the wrong parts.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { Plugin } from "esbuild";

/** A host's parts list, as Plugin loader writes it. */
interface PartsList {
  readonly host: string;
  readonly kinds: Record<string, readonly { module: string; export: string; owner: string }[]>;
  readonly graph: unknown;
  readonly inputs: Record<string, string>;
}

/** Write the parts list of the host in `host` to `file`. */
export type WriteList = (host: string, file: string) => Promise<void>;

/** Plugin loader's step, run as the command it is: node, with tsx from Plugin loader's own folder, on its parts-list module. */
export const writeWithPluginLoader: WriteList = async (host, file) => {
  const step = createRequire(import.meta.url).resolve("@storytree/plugin-loader/parts-list");
  const tsx = pathToFileURL(createRequire(step).resolve("tsx")).href;
  await promisify(execFile)(process.execPath, ["--import", tsx, step, host, file]);
};

/** The package a file belongs to: the nearest folder above it holding a package.json. */
function hostOf(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`${from} is in no package: no package.json above it.`);
  }
}

/** The list at `file` for `host`, refused when it is missing or a package.json it was written from has changed since. */
function readList(host: string, file: string): PartsList {
  if (!existsSync(file)) throw new Error(`There is no parts list for ${host}: Plugin loader's step wrote none, so the build stops rather than pack no parts.`);
  const list = JSON.parse(readFileSync(file, "utf8")) as PartsList;
  if (list.host !== host) throw new Error(`The parts list for ${host} was written for ${list.host}.`);
  for (const [input, sha] of Object.entries(list.inputs)) {
    const now = existsSync(input) ? createHash("sha256").update(readFileSync(input)).digest("hex") : undefined;
    if (now !== sha) throw new Error(`The parts list for ${host} is out of date: ${input} changed since it was written, so the build stops rather than pack the wrong parts.`);
  }
  return list;
}

/** The esbuild plugin that packs `#parts/<kind>` from each host's parts list, written once per host per build by `write`. */
export function partsFromList({ write = writeWithPluginLoader }: { write?: WriteList } = {}): Plugin {
  return {
    name: "storytree-parts-list",
    setup(build) {
      const lists = new Map<string, Promise<PartsList>>();
      const listOf = (host: string): Promise<PartsList> => {
        let list = lists.get(host);
        if (list === undefined) {
          list = (async () => {
            const dir = mkdtempSync(path.join(tmpdir(), "storytree-parts-list-"));
            try {
              const file = path.join(dir, "parts-list.json");
              await write(host, file);
              return readList(host, file);
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          })();
          lists.set(host, list);
        }
        return list;
      };
      // The module's path names its host as well as its kind: esbuild loads one module per path, and two hosts in one
      // bundle pack a kind each from their own lists. The host is a
      // hash of its folder, since a path esbuild names a chunk after holds no folder.
      build.onResolve({ filter: /^#parts\/[\w-]+$/ }, (args) => {
        const host = hostOf(args.resolveDir);
        const tag = createHash("sha256").update(host).digest("hex").slice(0, 12);
        return { path: `${args.path.slice("#parts/".length)}-${tag}`, namespace: "storytree-parts", pluginData: host };
      });
      build.onLoad({ filter: /.*/, namespace: "storytree-parts" }, async (args) => {
        const host = String(args.pluginData);
        const kind = args.path.slice(0, args.path.lastIndexOf("-"));
        const list = await listOf(host);
        const parts = list.kinds[kind];
        if (parts === undefined) throw new Error(`The parts list for ${host} holds no #parts/${kind}: its package.json's imports map no such kind.`);
        const imports = parts.map((part, index) => `import { ${part.export} as part${index} } from ${JSON.stringify(part.module)};`);
        const declared = parts.map((_, index) => `...part${index}`).join(", ");
        const owners = parts.map((part, index) => `...part${index}.map(() => ${JSON.stringify(part.owner)})`).join(", ");
        const contents = `${imports.join("\n")}\nexport default { parts: [${declared}], owners: [${owners}], graph: ${JSON.stringify(list.graph)} };\n`;
        return { contents, resolveDir: host, loader: "js" };
      });
    },
  };
}
