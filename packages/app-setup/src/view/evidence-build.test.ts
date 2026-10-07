import { test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build the setup views' evidence captures against this branch: no browser, no pictures retaken.
const view = fileURLToPath(new URL(".", import.meta.url));
const checkout = path.resolve(view, "../../../..");
const run = promisify(execFile);
for (const script of globSync("evidence/*/build.mjs", { cwd: view }).sort()) {
  test(`3.6 the setup views' evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, [path.join(view, script)], { cwd: checkout, timeout: 120_000 });
  });
}
