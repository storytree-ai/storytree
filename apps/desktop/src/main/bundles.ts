/**
 * Capability 4 · Updates. The esbuild options that bundle the main process and its preload script for Electron
 * (contract 4.37; the preload's bridge is 8 · Page bridge's 8.10): each one CommonJS file, so a packaged app needs no
 * node_modules. The library, local-postgres and pg are bundled into main.cjs; it loads nothing from outside it but
 * Electron and the optional modules it loads lazily.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { PATH_ONLY } from "@storytree/app-setup/bins";
import { journeyDefine } from "@storytree/app-setup/journey-events/release";
import { embedTreeSitterWasm } from "@storytree/map/tree-sitter-bundle";

import { partsFromList } from "./parts-list.js";

/** A public setting from the build's environment, as an esbuild define: its value, or undefined when it is not set. */
const stamped = (name: string) => (process.env[name] ? JSON.stringify(process.env[name]) : "undefined");

/** The commit the checkout in `dir` has (git HEAD), which a build is stamped with (contract 4.39); undefined outside a checkout. */
export function buildCommit(dir: string): string | undefined {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return undefined;
  }
}

/** The modules main.cjs leaves outside it: Electron, and optional ones it never loads or loads only lazily, from node_modules. */
export const MAIN_EXTERNAL = [
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
];

/**
 * The esbuild options that bundle the main process into `dist`'s main.cjs, from the desktop app in `desktop`, stamped
 * with `commit`, the one its checkout has (null outside a checkout).
 */
export function mainBuild(dist: string, desktop = path.resolve(import.meta.dirname, "../.."), commit: string | null = buildCommit(desktop) ?? null) {
  return {
    entryPoints: [path.join(desktop, "src", "main", "main.ts")],
    outfile: path.join(dist, "main.cjs"),
    absWorkingDir: desktop, bundle: true, platform: "node" as const, format: "cjs" as const, target: "node22",
    // On Windows its bare-named programs (git, gh) are found on PATH only, never in the folder it was started in;
    // after the bundle's own "use strict", which only the first statement can be.
    banner: { js: `"use strict";\n${PATH_ONLY}` },
    // local-postgres finds its binaries from its own location (import.meta.url) only when not told
    // where they are; the app always tells it (main.ts: postgresBinaries), so that path is never taken.
    logOverride: { "empty-import-meta": "silent" as const },
    // The parts storytree's own story packages name in their manifests, packed from the parts list Plugin loader writes
    // for this app (ADR-1021); and tree-sitter's wasm, which the code survey parses Python with (map 8.48).
    plugins: [partsFromList(), embedTreeSitterWasm()],
    // A release build stamps in PostHog's public project token (never a private key); others share nothing.
    // A build offering sign-in for feedback (the staging build) stamps in WorkOS's public client ID (app setup contract 5.6);
    // the app checks its token itself and offers no sign-in without the ID. It is not a secret.
    define: {
      ...journeyDefine(),
      STORYTREE_WORKOS_CLIENT_ID: stamped("STORYTREE_WORKOS_CLIENT_ID"),
      // The commit it was built from, so a packaged build's label and its recorded errors name it (contract 4.39).
      STORYTREE_BUILD_COMMIT: commit === null ? "undefined" : JSON.stringify(commit),
    },
    external: MAIN_EXTERNAL,
  };
}

/** The esbuild options that bundle the preload script into `dist`'s preload.cjs, from the desktop app in `desktop`. */
export function preloadBuild(dist: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  return {
    entryPoints: [path.join(desktop, "src", "preload", "preload.ts")],
    outfile: path.join(dist, "preload.cjs"),
    absWorkingDir: desktop, bundle: true, platform: "node" as const, format: "cjs" as const, target: "node22",
    external: ["electron"],
    // The page channels the story packages' manifests name, packed from the parts list as data (ADR-1021).
    plugins: [partsFromList()],
  };
}
