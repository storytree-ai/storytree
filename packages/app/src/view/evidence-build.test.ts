import { test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build the app's evidence captures against this branch: no browser, no pictures retaken.
const pkg = fileURLToPath(new URL("../..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const run = promisify(execFile);
for (const script of globSync("evidence/*/build.mjs", { cwd: pkg }).sort()) {
  test(`4.8 the app's evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, [path.join(pkg, script)], { cwd: checkout, timeout: 120_000 });
  });
}
