/**
 * The hook command built as a harness runs it, for the agent link's own tests: one plain Node script bundled from
 * bins/storytree-hook.ts. The release build of every command, this one included, is the app setup story's
 * buildBins (packages/app-setup/src/bins/build.ts, ADR-0969 D3), which this package may not import; the options
 * that shape how fast a hook starts (split chunks, pg's require banner) are kept the same here.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const ENTRY = fileURLToPath(new URL("../bins/storytree-hook.ts", import.meta.url));

/** Build the hook command into `outdir`, and return its path. */
export async function buildHook(outdir: string): Promise<string> {
  await build({
    entryPoints: { "storytree-hook": ENTRY },
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: "node24",
    logLevel: "warning",
    // Under a coverage run (`pnpm survey:coverage`), the code survey traces the bundle back to its files.
    sourcemap: process.env.NODE_V8_COVERAGE !== undefined,
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets"],
  });
  return path.join(outdir, "storytree-hook.mjs");
}
