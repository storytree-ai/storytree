import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
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
