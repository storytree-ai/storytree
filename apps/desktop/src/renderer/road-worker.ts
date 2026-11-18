// Capability 3 · Surfaces
import { createRequire } from "node:module";
import path from "node:path";

export function roadWorkerBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  const forest = createRequire(path.join(desktop, "package.json")).resolve("@storytree/forest/view");
  const entry = createRequire(forest).resolve("@storytree/forest-world/road-worker");
  return {
    entryPoints: [entry], outfile: path.join(folder, "road-worker.js"),
    bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
  };
}

export function territoryWorkerBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  const entry = createRequire(path.join(desktop, "package.json")).resolve("@storytree/forest/territory-worker");
  return {
    entryPoints: [entry], outfile: path.join(folder, "territory-worker.js"),
    bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
  };
}
