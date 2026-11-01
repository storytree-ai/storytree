// Build the desktop app into dist/: esbuild bundles the main process and the preload script
// (CommonJS, for Electron) and the page's script (for the browser), and the page's HTML and CSS
// are copied beside it. Everything the app runs is in dist/, so a packaged app needs no
// node_modules: the library, local-postgres and pg are bundled into main.cjs.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { mainBuild, preloadBuild } from "./src/main/bundles.ts";
import { pageBuild } from "./src/renderer/page-build.ts";
import { roadWorkerBuild } from "./src/renderer/road-worker.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const src = path.join(here, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "renderer"), { recursive: true });

const common = { bundle: true, logLevel: "warning", sourcemap: "linked", absWorkingDir: here };

await build({ ...common, ...mainBuild(dist) });

// The code survey's worker thread (map 8.16), resolved through the forest package the app mounts it from.
const surveyWorker = createRequire(fileURLToPath(import.meta.resolve("@storytree/forest/code-survey"))).resolve("@storytree/map/code-survey/worker");
await build({
  ...common,
  entryPoints: [surveyWorker],
  outfile: path.join(dist, "survey-worker.cjs"),
  platform: "node",
  format: "cjs",
  target: "node22",
});

await build({ ...common, ...preloadBuild(dist) });

// The page's script, built with React's production build (contract 3.23).
await build({ ...common, ...pageBuild(path.join(dist, "renderer")) });

// The map's roads are routed in this worker, off the page's main thread (contract 3.18).
await build({ ...common, ...roadWorkerBuild(path.join(dist, "renderer")) });

cpSync(fileURLToPath(import.meta.resolve("@storytree/arc-surface/view/styles.css")), path.join(dist, "renderer", "arc-surface.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/app-setup/view/styles.css")), path.join(dist, "renderer", "app-setup.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/forest/view/styles.css")), path.join(dist, "renderer", "forest.css"));
cpSync(path.join(here, "..", "..", "LICENSE"), path.join(dist, "LICENSE"));

for (const file of ["index.html", "styles.css"]) {
  cpSync(path.join(src, "renderer", file), path.join(dist, "renderer", file));
}
console.log(`built ${path.relative(process.cwd(), dist) || "dist"}`);
