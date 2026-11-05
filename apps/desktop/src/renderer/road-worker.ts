/**
 * Capability 3 · Surfaces. The page's road worker (contract 3.18): the drawing engine's road-worker script, built for the
 * browser beside renderer.js and named in index.html's storytree-road-worker meta, so the map's roads are routed off the
 * page's main thread, and go on routing while the window is hidden (the drawing engine's 4.21).
 * Beside it, the forest's territory search worker (its 3.80), named in the storytree-territory-worker meta.
 */
import { createRequire } from "node:module";
import path from "node:path";

/** The esbuild options that build the road worker into `folder`, the page's own folder (the page names its file), from the
 * desktop app in `desktop`: this one, or the checkout a capture builds. */
export function roadWorkerBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  // Resolved through the forest package, which mounts the drawing engine's planet into the page.
  const forest = createRequire(path.join(desktop, "package.json")).resolve("@storytree/forest/view");
  const entry = createRequire(forest).resolve("@storytree/forest-world/road-worker");
  return {
    entryPoints: [entry], outfile: path.join(folder, "road-worker.js"),
    bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
  };
}

/** The esbuild options that build the forest's territory search worker (the forest's 3.80) into `folder`, beside the road
 * worker, named in index.html's storytree-territory-worker meta: the selected island's search runs there, never on the page. */
export function territoryWorkerBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  const entry = createRequire(path.join(desktop, "package.json")).resolve("@storytree/forest/territory-worker");
  return {
    entryPoints: [entry], outfile: path.join(folder, "territory-worker.js"),
    bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
  };
}
