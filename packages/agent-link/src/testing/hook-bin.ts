/**
 * The hook command built as a harness runs it, for the agent link's own tests: one plain Node script that runs
 * bins/storytree-hook.ts's hookCommand() with testing/declared.ts's stand-in for the map's file-to-capability
 * lookup, which this story may not import. The release build of every command, this one included, is the app setup story's
 * buildBins (packages/app-setup/src/bins/build.ts, ADR-0969 D3), which this package may not import; the options
 * that shape how fast a hook starts (split chunks, pg's require banner) are kept the same here.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The command's entry, with no file of its own: what it runs is the agent link's, and only its tests run it so. */
const ENTRY = 'import { hookCommand } from "../bins/storytree-hook.ts";\nimport { declaredInTests } from "./declared.ts";\n\nhookCommand({ declaredCapabilities: declaredInTests });\n';

/** Build the hook command into `outdir`, and return its path. */
export async function buildHook(outdir: string): Promise<string> {
  await build({
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: "storytree-hook.ts", loader: "ts" },
    entryNames: "storytree-hook",
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
