import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Build the consent and settings capture's renderer against this branch: no browser, no pictures retaken.
const pkg = fileURLToPath(new URL("../..", import.meta.url));
const run = promisify(execFile);
test("15.1–15.2 the consent and settings capture's renderer builds", { timeout: 130_000 }, async t => {
  const dist = mkdtempSync(path.join(tmpdir(), "journey-capture-build-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await run(process.execPath, ["--import", "tsx", path.join(pkg, "testing/journey-events/build.mjs"), dist], { cwd: path.resolve(pkg, "../.."), timeout: 120_000 });
  // The page loads whole: every file it links was built beside it, and its bundle is React's production build.
  const linked = [...readFileSync(path.join(dist, "index.html"), "utf8").matchAll(/(?:src|href)="([^"]+)"/g)].map(([, file]) => file!);
  assert.ok(linked.includes("renderer.js"), linked.join(", "));
  assert.deepEqual(linked.filter((file) => !existsSync(path.join(dist, file))), [], "every file the page links was built");
  assert.ok(!readFileSync(path.join(dist, "renderer.js"), "utf8").includes("process.env.NODE_ENV"), "the bundle reads NODE_ENV as production");
});
