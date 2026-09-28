// Packaging adapter: reuse the agent link's build, then stage both native Windows runtimes.
import { buildBins, stageNativeProbes } from "@storytree/agent-link/bins";
import { NODE_VERSION, stageRuntime, windowsRuntime, writePayloadManifest } from "@storytree/app-setup/deliver";
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function buildToolBundle(outdir) {
  mkdirSync(outdir, { recursive: true });
  await buildBins(outdir);
  await build({
    stdin: {
      contents: 'import { runDeliveryCommand } from "@storytree/app-setup/deliver"; runDeliveryCommand().catch(error => { console.error(error.message); process.exitCode = 1; });',
      resolveDir: here,
      sourcefile: "storytree-deliver.ts",
    },
    outfile: path.join(outdir, "storytree-deliver.mjs"),
    bundle: true, platform: "node", format: "esm", target: "node24", logLevel: "warning",
    banner: { js: 'import { createRequire as __storytreeRequire } from "node:module"; const require = __storytreeRequire(import.meta.url);' },
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets", "@google-cloud/cloud-sql-connector"],
  });
}

export async function stageTools() {
  const root = path.join(here, "dist", "agent-tools");
  const common = path.join(root, "common");
  rmSync(root, { recursive: true, force: true });
  await buildToolBundle(common);
  for (const arch of ["x64", "arm64"]) {
    const dir = path.join(root, arch);
    cpSync(common, dir, { recursive: true });
    await stageNativeProbes(dir, "win32", arch);
    await stageRuntime(path.join(dir, "node.exe"), windowsRuntime(arch));
    const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${NODE_VERSION}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
    if (!license.ok) throw new Error(`Could not download the Node ${NODE_VERSION} license`);
    writeFileSync(path.join(dir, "NODE-LICENSE"), await license.text());
    writePayloadManifest(dir, arch, NODE_VERSION);
    console.log(`staged ${arch}: Node ${NODE_VERSION} (SHA-256 verified), Node license, complete buildBins output, target Koffi probes and delivery helper`);
  }
  rmSync(common, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await stageTools();
