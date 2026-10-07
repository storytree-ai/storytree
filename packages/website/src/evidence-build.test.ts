import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build the website's evidence capture pages against this branch: no browser, no pictures retaken.
const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const run = promisify(execFile);
const scripts = globSync("evidence/*/build.mjs", { cwd: pkg }).sort();
test("3.12 · the saved growths' evidence captures each have a build to check", () => {
  assert.deepEqual(scripts.map(script => path.dirname(script).split(path.sep).pop()), ["growth", "shop-health"]);
});
for (const script of scripts) {
  test(`3.12 · the website's evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, [path.join(pkg, script)], { cwd: checkout, timeout: 120_000 });
  });
}
