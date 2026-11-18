// Capability 16 · Build and launch
import path from "node:path";
import { buildLauncher, LAUNCHER_PROGRAM, partsFromList, stageNativeProbes } from "@storytree/app-setup/bins";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { embedTreeSitterWasm } from "@storytree/map/tree-sitter-bundle";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildCommand(outdir: string): Promise<string> {
  await build({
    entryPoints: { storytree: path.join(here, "storytree.ts") },
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: "node24",
    logLevel: "warning",
    sourcemap: process.env.NODE_V8_COVERAGE !== undefined,
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["koffi", "pg-native", "pg-cloudflare", "cloudflare:sockets", "@huggingface/transformers"],
    plugins: [partsFromList(), embedTreeSitterWasm()],
  });
  await stageNativeProbes(outdir);
  if (process.platform === "win32") buildLauncher(path.join(outdir, LAUNCHER_PROGRAM), process.arch === "arm64" ? "arm64" : "x64");
  return path.join(outdir, "storytree.mjs");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = await buildCommand(path.resolve(here, "..", "..", "dist"));
  console.log(`built ${path.relative(process.cwd(), built)}`);
}
