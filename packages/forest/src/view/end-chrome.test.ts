/** Capability 3 · Story node render: a real-browser test file ends its Chrome without waiting on Chrome's pipes (3.100). */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { test } from "node:test";

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
  const exited = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 15_000);
    file.on("exit", () => { clearTimeout(timer); resolve(true); });
  });
  const chrome = Number.parseInt(out, 10);
  try { process.kill(chrome); } catch { /* already gone */ }
  if (!exited) file.kill();
  assert.ok(Number.isInteger(chrome), "the stand-in for Chrome was started");
  assert.ok(exited, "the file's process exited with Chrome's still alive");
});
