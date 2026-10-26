import { test } from "node:test";
import { execFile } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const run = promisify(execFile);
for (const script of globSync("evidence/*/build.mjs", { cwd: pkg }).sort()) {
  test(`the knowledge core evidence capture builds: ${script}`, { timeout: 130_000 }, async () => {
    await run(process.execPath, ["--import", "tsx", path.join(pkg, script)], { cwd: checkout, timeout: 120_000 });
  });
}
