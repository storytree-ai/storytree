/**
 * Capability 3 · Surfaces. The page's own script (contracts 3.17, 3.23): renderer.ts and every story surface it mounts,
 * built for the browser as renderer.js beside index.html.
 */
import path from "node:path";

/** The esbuild options that build the page's script into `folder`, the page's own folder, from the desktop app in `desktop`. */
export function pageBuild(folder: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  return {
    entryPoints: [path.join(desktop, "src", "renderer", "renderer.ts")], outfile: path.join(folder, "renderer.js"),
    absWorkingDir: desktop, bundle: true, platform: "browser" as const, format: "iife" as const, target: "es2023",
    // Left unset, esbuild reads NODE_ENV as "development" for the browser, and the page ran React's development build,
    // about twice the frame time on a turning map (arc_b7b14259abb9). Unminified, so a page error's stack still reads.
    define: { "process.env.NODE_ENV": '"production"' },
  };
}
