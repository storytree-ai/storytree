import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build the consent and settings capture's renderer against this branch: no browser, no pictures retaken.
const pkg = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
test("3.1–3.2 the consent and settings capture's renderer builds", { timeout: 130_000 }, async t => {
  const dist = mkdtempSync(path.join(tmpdir(), "journey-capture-build-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await run(process.execPath, ["--import", "tsx", path.join(pkg, "evidence/build.mjs"), dist], { cwd: path.resolve(pkg, "../.."), timeout: 120_000 });
});
