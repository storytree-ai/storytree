/** Capability 2 · Storytree projects. The actual desktop renderer, with read-only globe/navigation observations for capture views. */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export async function buildCapture({ dist, root = path.resolve(import.meta.dirname, "../../../..") }: { dist: string; root?: string }): Promise<void> {
  const require = createRequire(path.join(root, "apps/desktop/package.json"));
  const { build, stop } = require("esbuild") as typeof import("esbuild");
  mkdirSync(dist, { recursive: true });
  try {
    await build({
      absWorkingDir: path.join(root, "apps/desktop"),
      entryPoints: [path.join(root, "apps/desktop/src/renderer/renderer.ts")],
      outfile: path.join(dist, "renderer.js"), bundle: true, logLevel: "warning",
      sourcemap: true, platform: "browser", format: "iife", target: "es2023", loader: { ".glb": "binary" },
      banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
    });
    for (const name of ["index.html", "styles.css"]) copyFileSync(path.join(root, "apps/desktop/src/renderer", name), path.join(dist, name));
    for (const [pkg, name] of [["arc-surface", "arc-surface.css"], ["app-setup", "app-setup.css"], ["forest", "forest.css"]] as const) {
      copyFileSync(require.resolve(`@storytree/${pkg}/view/styles.css`), path.join(dist, name));
    }
    console.log(`Built ${root}'s desktop page into ${dist}.`);
  } finally { stop(); }
}
