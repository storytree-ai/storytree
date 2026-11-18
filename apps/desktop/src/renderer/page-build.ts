// Capability 3 · Surfaces
import path from "node:path";

export function pageBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  return {
    entryPoints: [path.join(desktop, "src", "renderer", "renderer.ts")], outfile: path.join(folder, "renderer.js"),
    absWorkingDir: desktop, bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
    define: { "process.env.NODE_ENV": '"production"' },
  };
}
