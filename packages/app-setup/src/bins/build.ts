// Capability 18 · Built commands.
import path from "node:path";
import { writeFileSync, writeSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { embedTreeSitterWasm } from "@storytree/map/tree-sitter-bundle";
import { journeyDefine } from "../journey-events/release.js";
import { buildLauncher, LAUNCHER_PROGRAM } from "./launcher.js";
import { partsFromList } from "./parts-list.js";

export { buildLauncher, LAUNCHER_PROGRAM, partsFromList };

const here = path.dirname(fileURLToPath(import.meta.url));

export const PATH_ONLY = 'if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath ??= "1";';

export const ENTRY_BANNER = `${PATH_ONLY} import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);`;

const ENTRY_POINTS: Readonly<Record<string, string>> = {
  "storytree-hook": path.join(here, "storytree-hook.ts"),
  "storytree-setup": path.join(here, "storytree-setup.ts"),
  "storytree-mcp": path.resolve(here, "../../../mcp-server/src/bins/storytree-mcp.ts"),
  storytree: path.resolve(here, "../../../cli/src/bins/storytree.ts"),
};

export async function buildBins(outdir: string, { release, launcher = true }: { release?: { version: string; commit: string }; launcher?: boolean } = {}): Promise<Record<string, string>> {
  await buildPhase("bundle JavaScript", () => build({
    entryPoints: ENTRY_POINTS,
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
    ...(release === undefined ? {} : { define: { STORYTREE_RELEASE: JSON.stringify(JSON.stringify(release)), ...journeyDefine() } }),
    banner: { js: ENTRY_BANNER },
    external: [
      "koffi",
      "pg-native",
      "pg-cloudflare",
      "cloudflare:sockets",
      "@huggingface/transformers",
    ],
    plugins: [partsFromList(), embedTreeSitterWasm()],
  }));
  await buildPhase("stage native probes", () => stageNativeProbes(outdir));
  if (launcher && process.platform === "win32") {
    await buildPhase("compile Windows launcher", () => buildLauncher(path.join(outdir, LAUNCHER_PROGRAM), process.arch === "arm64" ? "arm64" : "x64"));
  }
  if (release !== undefined) writeFileSync(path.join(outdir, "release.json"), `${JSON.stringify(release)}\n`);
  return Object.fromEntries(Object.keys(ENTRY_POINTS).map((name) => [name, path.join(outdir, `${name}.mjs`)]));
}

async function buildPhase<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  const observe = (state: string) => {
    try { writeSync(2, `buildBins: ${name} ${state} (${Math.round(performance.now() - started)} ms)\n`); } catch {}
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

export async function stageNativeProbes(outdir: string, platform = process.platform, arch = process.arch): Promise<void> {
  const require = createRequire(import.meta.url);
  const ownRequire = createRequire(require.resolve('@storytree/session-management/processes/process'));
  const koffi = ownRequire.resolve('koffi');
  const nativeName = `@koromix/koffi-${platform}-${arch}`;
  const native = createRequire(koffi).resolve(nativeName);
  const modules = path.join(outdir, 'node_modules');
  await mkdir(modules, { recursive: true });
  await rm(path.join(modules, '@koromix'), { recursive: true, force: true });
  const staged = path.join(modules, 'koffi');
  await rm(staged, { recursive: true, force: true });
  await cp(path.dirname(koffi), staged, { recursive: true, dereference: true });
  await cp(path.dirname(native), path.join(staged, 'build', 'koffi'), { recursive: true, dereference: true });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const built = await buildBins(path.resolve(here, "..", "..", "dist"));
  for (const file of Object.values(built)) console.log(`built ${path.relative(process.cwd(), file)}`);
}
