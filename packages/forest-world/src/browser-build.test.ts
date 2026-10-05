import { test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Exercise the capture's own build, without Chromium or new pictures.
const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const run = promisify(execFile);
const builders = new Set([
  ...globSync("evidence/*/build.mjs", { cwd: pkg }),
  ...globSync("evidence/*/page.tsx", { cwd: pkg })
    .map(entry => path.join(path.dirname(entry), "build.mjs")),
]);
for (const script of [...builders].sort()) {
  test(`the world evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, ["--import", "tsx", path.join(pkg, script)], { cwd: checkout, timeout: 120_000 });
  });
}
