import { test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build session-management's evidence captures against this branch: no browser, no pictures retaken.
// Each is titled by the settings promise its capture pictures.
const pkg = fileURLToPath(new URL("../..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const run = promisify(execFile);
const promise: Record<string, string> = { "idle-setting": "10.10", "library-address": "10.13" };
for (const script of globSync("evidence/*/build.mjs", { cwd: pkg }).sort()) {
  const capture = path.basename(path.dirname(script));
  test(`${promise[capture] ?? "10"} session-management's evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, [path.join(pkg, script)], { cwd: checkout, timeout: 120_000 });
  });
}
