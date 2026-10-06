// TEMPORARY diagnostic for increment_520c71a12eed: never merged.
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const checkout = path.resolve(pkg, "../..");
const folder = path.join(pkg, "evidence/traversal-when-selected");
const run = promisify(execFile);

test("4.16 probe: the click's steps timed, one at a time, while 110 s allow", { timeout: 170_000 }, async () => {
  const began = Date.now();
  await run(process.execPath, ["--import", "tsx", path.join(folder, "build.mjs"), checkout, "smoke"], { cwd: checkout, timeout: 60_000 });
  for (let round = 0; Date.now() - began < 110_000; round++) {
    const out = await run(process.execPath, ["--import", "tsx", path.join(folder, "probe.mjs"), "after", "--smoke"],
      { cwd: checkout, timeout: 150_000 - (Date.now() - began), env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? "chrome" } })
      .then(r => r.stderr, (e: any) => `FAILED ${String(e.stderr ?? e).slice(-1500)}`);
    for (const l of out.split("\n").filter(l => l.startsWith("PROBE") || l.startsWith("FAILED") || l.includes("Timeout"))) console.log(`round ${round} at ${Date.now() - began} ms: ${l}`);
  }
});
