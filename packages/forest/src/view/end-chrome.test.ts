/** Capability 3 · Story node render: a real-browser test file ends its Chrome without waiting on Chrome's pipes (3.100). */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { waitUntil } from "@storytree/test-waits";

test("3.100 · a file that ends its Chrome exits while Chrome's process still holds its pipes and the server's kill never resolves", async () => {
  // A stand-in for Chrome: a live child on piped stdio, as Playwright launches it, behind a kill that never finishes.
  const script = `import { spawn } from "node:child_process";
    import { endChrome } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "end-chrome.ts")).href)};
    const chrome = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] });
    console.log(chrome.pid);
    endChrome({ kill: () => new Promise(() => {}), process: () => chrome }, { close: () => new Promise(() => {}) });`;
  const file = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  file.stdout.on("data", (chunk: Buffer) => { out += chunk; });
  let exited = false;
  file.on("exit", () => { exited = true; });
  try {
    await waitUntil(() => exited, 15_000, "the file's process to exit with Chrome's still alive");
  } finally {
    const chrome = Number.parseInt(out, 10);
    if (Number.isInteger(chrome)) try { process.kill(chrome); } catch { /* already gone */ }
    if (!exited) file.kill();
  }
  assert.ok(Number.isInteger(Number.parseInt(out, 10)), "the stand-in for Chrome was started");
});
