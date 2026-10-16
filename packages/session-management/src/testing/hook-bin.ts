/**
 * The hook command built as a harness runs it, for Session management's own tests: one plain Node script that runs
 * bins/storytree-hook.ts's hookCommand() with testing/declared.ts's stand-in for the map's file-to-capability
 * lookup, which this story may not import. The release build of every command, this one included, is the app setup story's
 * buildBins (packages/app-setup/src/bins/build.ts, ADR-0969 D3), which this package may not import; the options
 * that shape how fast a hook starts (split chunks, pg's require banner) are kept the same here.
 */
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The command's entry, with no file of its own: what it runs is Session management's, and only its tests run it so.
 * A test may set how long the shell guard waits (STORYTREE_TEST_GUARD_MS), so a slow runner's answer is not its clock's.
 */
const ENTRY = 'import { hookCommand } from "../bins/storytree-hook.ts";\nimport { declaredInTests } from "./declared.ts";\n\nconst guardMs = Number(process.env.STORYTREE_TEST_GUARD_MS) || undefined;\nhookCommand({ declaredCapabilities: declaredInTests, guardMs });\n';

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
  // Koffi (the Windows handoff check's) is resolved from beside the command, as the release build stages it there.
  const koffi = path.dirname(createRequire(createRequire(import.meta.url).resolve("@storytree/project-and-caller/routing")).resolve("koffi"));
  mkdirSync(path.join(outdir, "node_modules"), { recursive: true });
  symlinkSync(realpathSync(koffi), path.join(outdir, "node_modules", "koffi"), "junction");
  return path.join(outdir, "storytree-hook.mjs");
}
