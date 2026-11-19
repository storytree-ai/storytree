import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { mainBuild, preloadBuild, surveyWorkerBuild } from "./src/main/bundles.ts";
import { pageBuild } from "./src/renderer/page-build.ts";
import { roadWorkerBuild, territoryWorkerBuild } from "./src/renderer/road-worker.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const src = path.join(here, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "renderer"), { recursive: true });

const common = { bundle: true, logLevel: "warning", sourcemap: "linked", absWorkingDir: here };

await build({ ...common, ...mainBuild(dist) });

await build({ ...common, ...surveyWorkerBuild(dist) });

await build({ ...common, ...preloadBuild(dist) });

await build({ ...common, ...pageBuild(path.join(dist, "renderer")) });

await build({ ...common, ...roadWorkerBuild(path.join(dist, "renderer")) });
await build({ ...common, ...territoryWorkerBuild(path.join(dist, "renderer")) });

cpSync(fileURLToPath(import.meta.resolve("@storytree/arc-surface/view/styles.css")), path.join(dist, "renderer", "arc-surface.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/app-setup/view/styles.css")), path.join(dist, "renderer", "app-setup.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/forest/view/styles.css")), path.join(dist, "renderer", "forest.css"));
cpSync(path.join(here, "..", "..", "LICENSE"), path.join(dist, "LICENSE"));

for (const file of ["index.html", "styles.css"]) {
  cpSync(path.join(src, "renderer", file), path.join(dist, "renderer", file));
}
console.log(`built ${path.relative(process.cwd(), dist) || "dist"}`);
