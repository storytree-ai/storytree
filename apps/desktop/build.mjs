// Build the desktop app into dist/: esbuild bundles the main process and the preload script
// (CommonJS, for Electron) and the page's script (for the browser), and the page's HTML and CSS
// are copied beside it. Everything the app runs is in dist/, so a packaged app needs no
// node_modules: the library, local-postgres and pg are bundled into main.cjs.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { journeyDefine } from "@storytree/journey-events/release";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const src = path.join(here, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "renderer"), { recursive: true });

const common = { bundle: true, logLevel: "warning", sourcemap: "linked", absWorkingDir: here };
/** A public setting from the build's environment, as an esbuild define: its value, or undefined when it is not set. */
const stamped = (name) => (process.env[name] ? JSON.stringify(process.env[name]) : "undefined");

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
  // A release build stamps in PostHog's public project token (never a private key); others share nothing.
  // A build offering sign-in for feedback stamps in WorkOS's public client ID and the identity endpoint (app setup contract 5.6);
  // the app checks both and offers no sign-in without them. Neither is a secret.
  define: {
    ...journeyDefine(),
    STORYTREE_WORKOS_CLIENT_ID: stamped("STORYTREE_WORKOS_CLIENT_ID"),
    STORYTREE_IDENTITY_URL: stamped("STORYTREE_IDENTITY_URL"),
  },
  external: [
    "electron",
    // Optional parts of pg that the app never uses: its native client and its Cloudflare sockets.
    "pg-native",
    "pg-cloudflare",
    "cloudflare:sockets",
    // The library's Cloud SQL path (capability 8) loads these lazily, from node_modules, when the
    // library setting names a Cloud SQL instance (ADR-0734). Google's auth library stays outside the
    // bundle too: the connector accepts only its own copy's GoogleAuth.
    "@google-cloud/cloud-sql-connector",
    "google-auth-library",
    // Ranked search loads the embedding model runtime lazily, from node_modules (native ONNX Runtime).
    "@huggingface/transformers",
  ],
});

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
});

cpSync(fileURLToPath(import.meta.resolve("@storytree/arc-surface/view/styles.css")), path.join(dist, "renderer", "arc-surface.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/app-setup/view/styles.css")), path.join(dist, "renderer", "app-setup.css"));
cpSync(fileURLToPath(import.meta.resolve("@storytree/forest/view/styles.css")), path.join(dist, "renderer", "forest.css"));
cpSync(path.join(here, "..", "..", "LICENSE"), path.join(dist, "LICENSE"));

for (const file of ["index.html", "styles.css"]) {
  cpSync(path.join(src, "renderer", file), path.join(dist, "renderer", file));
}
console.log(`built ${path.relative(process.cwd(), dist) || "dist"}`);
