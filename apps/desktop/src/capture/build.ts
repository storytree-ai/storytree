/** Capability 2 · Storytree projects. The actual desktop renderer, with read-only globe/navigation observations for capture views. */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pageBuild } from "../renderer/page-build.js";
import { roadWorkerBuild } from "../renderer/road-worker.js";

export async function buildCapture({ dist, root = path.resolve(import.meta.dirname, "../../../..") }: { dist: string; root?: string }): Promise<void> {
  const require = createRequire(path.join(root, "apps/desktop/package.json"));
  const { build, stop } = require("esbuild") as typeof import("esbuild");
  mkdirSync(dist, { recursive: true });
  try {
    // The shipped page's own build, so a capture's measurements are the app's (contract 2.21), plus the capture's seams.
    await build({
      ...pageBuild(dist, path.join(root, "apps/desktop")), logLevel: "warning", sourcemap: true, loader: { ".glb": "binary" },
      banner: { js: "globalThis.__storytreeCaptureGlobe = get => Object.defineProperty(globalThis, '__globe', { get, configurable: true }); globalThis.__storytreeCaptureNavigation = nav => { globalThis.__nav = nav; };" },
    });
    await build({ ...roadWorkerBuild(dist, path.join(root, "apps/desktop")), absWorkingDir: path.join(root, "apps/desktop"), logLevel: "warning" });
    for (const name of ["index.html", "styles.css"]) copyFileSync(path.join(root, "apps/desktop/src/renderer", name), path.join(dist, name));
    for (const [pkg, name] of [["arc-surface", "arc-surface.css"], ["app-setup", "app-setup.css"], ["forest", "forest.css"]] as const) {
      copyFileSync(require.resolve(`@storytree/${pkg}/view/styles.css`), path.join(dist, name));
    }
    console.log(`Built ${root}'s desktop page into ${dist}.`);
  } finally { stop(); }
}
