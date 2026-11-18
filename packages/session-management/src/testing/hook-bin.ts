import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

const ENTRY = 'import { deafIfHandingOffAtOnce } from "../hooks/at-once.ts";\n\ndeafIfHandingOffAtOnce();\nconst { hookCommand } = await import("../bins/storytree-hook.ts");\nconst { declaredInTests } = await import("./declared.ts");\nconst guardMs = Number(process.env.STORYTREE_TEST_GUARD_MS) || undefined;\nhookCommand({ declaredCapabilities: declaredInTests, guardMs });\n';

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
    sourcemap: process.env.NODE_V8_COVERAGE !== undefined,
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets"],
  });
  const koffi = path.dirname(createRequire(createRequire(import.meta.url).resolve("@storytree/project-and-caller/routing")).resolve("koffi"));
  mkdirSync(path.join(outdir, "node_modules"), { recursive: true });
  symlinkSync(realpathSync(koffi), path.join(outdir, "node_modules", "koffi"), "junction");
  return path.join(outdir, "storytree-hook.mjs");
}
