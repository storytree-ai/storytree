/**
 * The agent link's commands, built into plain Node scripts: what a harness runs, with no tsx and
 * only its staged native dependencies beside it. Each is one ES module that esbuild bundles with everything it
 * imports (the library, pg and zod included).
 *
 * `pnpm --filter @storytree/agent-link build` writes them to packages/agent-link/dist/; tests build
 * them into a directory of their own with buildBins().
 */
import path from "node:path";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The commands, by the file each is built to. */
const ENTRY_POINTS: Readonly<Record<string, string>> = {
  "storytree-hook": path.join(here, "storytree-hook.ts"),
  "storytree-mcp": path.join(here, "storytree-mcp.ts"),
  "storytree-setup": path.join(here, "storytree-setup.ts"),
  // The installed launcher is the command-line story's door, beside the hook and setup scripts.
  storytree: path.resolve(here, "../../../cli/src/bins/storytree.ts"),
};

/** Build every command into `outdir`, and return the path of each, by name. */
export async function buildBins(outdir: string): Promise<Record<string, string>> {
  await build({
    entryPoints: ENTRY_POINTS,
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    // Code a command needs only sometimes goes into chunks of its own, loaded when first used: a
    // hook with nothing to write then loads a few kilobytes, not the database code (pg, zod),
    // which on a busy machine is the difference between a quick hook and a slow one.
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    target: "node24",
    logLevel: "warning",
    // pg is CommonJS and requires Node's own modules; an ES module has no `require` of its own.
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: [
      // Native probes load physical libraries relative to Koffi’s package.
      "koffi",
      // Optional parts of pg the commands never use: its native client and its Cloudflare sockets.
      "pg-native",
      "pg-cloudflare",
      "cloudflare:sockets",
      // Ranked search loads the embedding model runtime lazily, from node_modules (native ONNX Runtime).
      "@huggingface/transformers",
    ],
  });
  await stageNativeProbes(outdir);
  return Object.fromEntries(Object.keys(ENTRY_POINTS).map((name) => [name, path.join(outdir, `${name}.mjs`)]));
}

/** Stage the exact native target beside CLI and MCP; packaging calls this again for each payload. */
export async function stageNativeProbes(outdir: string, platform = process.platform, arch = process.arch): Promise<void> {
  const require = createRequire(import.meta.url);
  const ownRequire = createRequire(require.resolve('@storytree/own/process'));
  const koffi = ownRequire.resolve('koffi');
  const nativeName = `@koromix/koffi-${platform}-${arch}`;
  // pnpm installs both Windows targets as well as the host (root supportedArchitectures).
  // Resolution fails the build if a required binary is missing; never ship a host-only payload.
  const native = createRequire(koffi).resolve(nativeName);
  const modules = path.join(outdir, 'node_modules');
  await mkdir(modules, { recursive: true });
  await rm(path.join(modules, '@koromix'), { recursive: true, force: true });
  const staged = path.join(modules, 'koffi');
  await rm(staged, { recursive: true, force: true });
  await cp(path.dirname(koffi), staged, { recursive: true, dereference: true });
  // Koffi's supported prebuild layout avoids scoped package paths, which the installer's
  // payload guard rejects. Keep every ABI triplet from the exact target package (e.g. musl).
  await cp(path.dirname(native), path.join(staged, 'build', 'koffi'), { recursive: true, dereference: true });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = await buildBins(path.resolve(here, "..", "..", "dist"));
  for (const file of Object.values(built)) console.log(`built ${path.relative(process.cwd(), file)}`);
}
