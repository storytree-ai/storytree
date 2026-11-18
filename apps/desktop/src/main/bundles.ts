// Capability 4 · Updates
import { execFileSync } from "node:child_process";
import path from "node:path";

import { PATH_ONLY } from "@storytree/app-setup/bins";
import { journeyDefine } from "@storytree/app-setup/journey-events/release";
import { embedTreeSitterWasm } from "@storytree/map/tree-sitter-bundle";

import { partsFromList } from "./parts-list.js";

const stamped = (name: string) => (process.env[name] ? JSON.stringify(process.env[name]) : "undefined");

export function buildCommit(dir: string): string | undefined {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return undefined;
  }
}

export const MAIN_EXTERNAL = [
  "electron",
  "pg-native",
  "pg-cloudflare",
  "cloudflare:sockets",
  "@huggingface/transformers",
];

export function mainBuild(dist: string, desktop = path.resolve(import.meta.dirname, "../.."), commit: string | null = buildCommit(desktop) ?? null) {
  return {
    entryPoints: [path.join(desktop, "src", "main", "main.ts")],
    outfile: path.join(dist, "main.cjs"),
    absWorkingDir: desktop, bundle: true, platform: "node" as const, format: "cjs" as const, target: "node22",
    banner: { js: `"use strict";\n${PATH_ONLY}` },
    logOverride: { "empty-import-meta": "silent" as const },
    plugins: [partsFromList(), embedTreeSitterWasm()],
    define: {
      ...journeyDefine(),
      STORYTREE_WORKOS_CLIENT_ID: stamped("STORYTREE_WORKOS_CLIENT_ID"),
      STORYTREE_BUILD_COMMIT: commit === null ? "undefined" : JSON.stringify(commit),
    },
    external: MAIN_EXTERNAL,
  };
}

export function preloadBuild(dist: string, desktop = path.resolve(import.meta.dirname, "../..")) {
  return {
    entryPoints: [path.join(desktop, "src", "preload", "preload.ts")],
    outfile: path.join(dist, "preload.cjs"),
    absWorkingDir: desktop, bundle: true, platform: "node" as const, format: "cjs" as const, target: "node22",
    external: ["electron"],
    plugins: [partsFromList()],
  };
}
