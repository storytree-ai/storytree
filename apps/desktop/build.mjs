// Build the desktop app into dist/: esbuild bundles the main process and the preload script
// (CommonJS, for Electron) and the page's script (for the browser), and the page's HTML and CSS
// are copied beside it. Everything the app runs is in dist/, so a packaged app needs no
// node_modules: the library, local-postgres and pg are bundled into main.cjs.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const src = path.join(here, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "renderer"), { recursive: true });

const common = { bundle: true, logLevel: "warning", sourcemap: "linked", absWorkingDir: here };

await build({
  ...common,
  entryPoints: [path.join(src, "main", "main.ts")],
  outfile: path.join(dist, "main.cjs"),
  platform: "node",
  format: "cjs",
  target: "node22",
  // local-postgres finds its binaries from its own location (import.meta.url) only when not told
  // where they are; the app always tells it (main.ts: postgresBinaries), so that path is never taken.
  logOverride: { "empty-import-meta": "silent" },
  external: [
    "electron",
    // Optional parts of pg that the app never uses: its native client and its Cloudflare sockets.
    "pg-native",
    "pg-cloudflare",
    "cloudflare:sockets",
    // The library's Cloud SQL path (capability 8) loads this lazily; the app only reaches a local Postgres.
    "@google-cloud/cloud-sql-connector",
  ],
});

await build({
  ...common,
  entryPoints: [path.join(src, "preload", "preload.ts")],
  outfile: path.join(dist, "preload.cjs"),
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

await build({
  ...common,
  entryPoints: [path.join(src, "renderer", "renderer.ts")],
  outfile: path.join(dist, "renderer", "renderer.js"),
  platform: "browser",
  format: "iife",
  target: "es2023",
  // The forest view's pine kit export is bundled into the page as its bytes (@storytree/forest/view).
  loader: { ".glb": "binary" },
});

cpSync(fileURLToPath(import.meta.resolve("@storytree/arc-surface/view/styles.css")), path.join(dist, "renderer", "arc-surface.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/app-setup/view/styles.css")), path.join(dist, "renderer", "app-setup.css"));
cpSync(path.join(here, "..", "..", "LICENSE"), path.join(dist, "LICENSE"));

for (const file of ["index.html", "styles.css"]) {
  cpSync(path.join(src, "renderer", file), path.join(dist, "renderer", file));
}
console.log(`built ${path.relative(process.cwd(), dist) || "dist"}`);
