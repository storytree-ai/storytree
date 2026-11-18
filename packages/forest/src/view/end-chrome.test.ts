// Capability 3 · Story node render
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { removeTemp, waitUntil } from "@storytree/test-waits";

test("3.100 · a file that ends its Chrome exits while Chrome's process still holds its pipes and the server's kill never resolves", async t => {
  const folder = await mkdtemp(path.join(tmpdir(), "forest-end-chrome-"));
  t.after(() => removeTemp(folder));
  const marker = path.join(folder, "chrome-may-live");
  await writeFile(marker, "");
  const chromeScript = `setInterval(() => { if (!require("node:fs").existsSync(${JSON.stringify(marker)})) process.exit(0); }, 100);
    setTimeout(() => process.exit(0), 120000);`;
  const script = `import { spawn } from "node:child_process";
    import { endChrome } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "end-chrome.ts")).href)};
    const chrome = spawn(process.execPath, ["-e", ${JSON.stringify(chromeScript)}], { stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"] });
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
    if (!exited) file.kill();
    await removeTemp(marker);
  }
  assert.ok(Number.isInteger(Number.parseInt(out, 10)), "the stand-in for Chrome was started");
});
