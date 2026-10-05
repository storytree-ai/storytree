import { after, test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build, stop } from "esbuild";

// Finish the service while Node is still running hooks, before its exit teardown.
after(stop);

// Regression: the merge watcher reached the browser through the claims barrel in September 2026,
// preventing the forest page (and its claim markers) from loading at all.
test("the forest page including claim markers can be built for the browser", async () => {
  await build({
    entryPoints: [fileURLToPath(new URL("../../../../apps/desktop/src/renderer/renderer.ts", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", target: "es2023",
    loader: { ".glb": "binary" }, write: false, logLevel: "silent",
  });
});

// Build the evidence pages too: their observation patches and imports must still
// work against this branch. This launches no browser and never retakes pictures.
const forest = fileURLToPath(new URL("../..", import.meta.url));
const checkout = path.resolve(forest, "../..");
const run = promisify(execFile);
const builders = new Set([
  ...globSync(["src/view/evidence/*/build.mjs", "evidence/*/build.mjs"], { cwd: forest }),
  ...globSync(["evidence/*/page.tsx", "evidence/*/entry.ts", "evidence/*/entry.tsx"], { cwd: forest })
    .map(entry => path.join(path.dirname(entry), "build.mjs")),
  path.join("src", "view", "evidence", "depth", "build.mjs"),
]);
for (const script of [...builders].sort()) {
  test(`the forest evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    const file = path.join(forest, script);
    // The performance comparison takes a checkout and output folder explicitly.
    const args = path.basename(path.dirname(file)) === "one-program-per-frame"
      ? [checkout, path.join(path.dirname(file), "dist", "test")]
      : [];
    await run(process.execPath, ["--import", "tsx", file, ...args], { cwd: checkout, timeout: 120_000 });
  });
}
