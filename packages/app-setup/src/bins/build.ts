/**
 * Capability 8 · Setup check. storytree's commands, built into plain Node scripts: what a harness runs, with no tsx and
 * only its staged native dependencies beside it. Each is one ES module that esbuild bundles with everything it
 * imports (the library, pg and zod included). The setup command is this story's, and so is the hook command's
 * entry, which gives the agent link's hook the map's file-to-capability lookup (bins/storytree-hook.ts); the tool
 * server is the MCP server story's and the `storytree` command the command line's, each built from its own package
 * by path (ADR-0969 D3).
 *
 * `pnpm --filter @storytree/app-setup build` writes them to packages/app-setup/dist/; tests build
 * them into a directory of their own with buildBins().
 */
import path from "node:path";
import { writeFileSync, writeSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { journeyDefine } from "@storytree/journey-events/release";

import { buildLauncher, LAUNCHER_PROGRAM } from "./launcher.js";

export { buildLauncher, LAUNCHER_PROGRAM };

const here = path.dirname(fileURLToPath(import.meta.url));

/** The commands, by the file each is built to. */
const ENTRY_POINTS: Readonly<Record<string, string>> = {
  "storytree-hook": path.join(here, "storytree-hook.ts"),
  "storytree-setup": path.join(here, "storytree-setup.ts"),
  // The tool server is the MCP server story's (ADR-0969 D1), and the installed launcher the command-line
  // story's: the two doors, built beside the hook and setup scripts.
  "storytree-mcp": path.resolve(here, "../../../mcp-server/src/bins/storytree-mcp.ts"),
  storytree: path.resolve(here, "../../../cli/src/bins/storytree.ts"),
};

/**
 * Build every command into `outdir`, and return the path of each, by name. A `release` is stamped in, for `storytree --version` to print.
 * `launcher: false` leaves out the host's Windows command, for a caller that builds its own per architecture: compiling it
 * launches LLVM, and a cold first launch on a busy Windows runner costs most of a delivery build's time.
 */
export async function buildBins(outdir: string, { release, launcher = true }: { release?: { version: string; commit: string }; launcher?: boolean } = {}): Promise<Record<string, string>> {
  await buildPhase("bundle JavaScript", () => build({
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
    // Under a coverage run (`pnpm survey:coverage`), the code survey traces the bundle back to its files.
    sourcemap: process.env.NODE_V8_COVERAGE !== undefined,
    ...(release === undefined ? {} : { define: { STORYTREE_RELEASE: JSON.stringify(JSON.stringify(release)), ...journeyDefine() } }),
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
  }));
  await buildPhase("stage native probes", () => stageNativeProbes(outdir));
  // On Windows the `storytree` command is a program of its own, beside the script it runs (ADR-0854).
  if (launcher && process.platform === "win32") {
    await buildPhase("compile Windows launcher", () => buildLauncher(path.join(outdir, LAUNCHER_PROGRAM), process.arch === "arm64" ? "arm64" : "x64"));
  }
  // The release beside the scripts, so the setup check can say when installed hooks lag the latest (contract 8.18).
  if (release !== undefined) writeFileSync(path.join(outdir, "release.json"), `${JSON.stringify(release)}\n`);
  return Object.fromEntries(Object.keys(ENTRY_POINTS).map((name) => [name, path.join(outdir, `${name}.mjs`)]));
}

// Keep the last phase even when a deadline kills the process. stderr stays separate from a
// caller's command/protocol output; a diagnostic write must not turn a successful build red.
async function buildPhase<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  const observe = (state: string) => {
    try { writeSync(2, `buildBins: ${name} ${state} (${Math.round(performance.now() - started)} ms)\n`); } catch { /* diagnostic only */ }
  };
  observe("START");
  try {
    const result = await run();
    observe("PASS");
    return result;
  } catch (error) {
    observe("FAIL");
    throw error;
  }
}

/** Stage the exact native target beside CLI and MCP; packaging calls this again for each payload. */
export async function stageNativeProbes(outdir: string, platform = process.platform, arch = process.arch): Promise<void> {
  const require = createRequire(import.meta.url);
  const ownRequire = createRequire(require.resolve('@storytree/processes/process'));
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
