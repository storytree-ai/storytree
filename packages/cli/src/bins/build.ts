/**
 * The `storytree` command, built into one plain Node script: what a person's shell runs, with no
 * tsx and only its staged native dependencies beside it. esbuild bundles it with everything it imports (the library,
 * the agent link, pg and zod included).
 *
 * `pnpm --filter @storytree/cli build` writes it to packages/cli/dist/; tests build it into a
 * directory of their own with buildCommand().
 */
import path from "node:path";
import { stageNativeProbes } from "@storytree/agent-link/bins";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Build the `storytree` command into `outdir`, and return the path of its script. */
export async function buildCommand(outdir: string): Promise<string> {
  await build({
    entryPoints: { storytree: path.join(here, "storytree.ts") },
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    // What a verb needs only sometimes goes into chunks of its own, loaded when first used, so an
    // answer that needs no database ("storytree isn't running", the help) comes back quickly.
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: "node24",
    logLevel: "warning",
    // pg is CommonJS and requires Node's own modules; an ES module has no `require` of its own.
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["koffi", "pg-native", "pg-cloudflare", "cloudflare:sockets", "@huggingface/transformers"],
  });
  await stageNativeProbes(outdir);
  return path.join(outdir, "storytree.mjs");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = await buildCommand(path.resolve(here, "..", "..", "dist"));
  console.log(`built ${path.relative(process.cwd(), built)}`);
}
