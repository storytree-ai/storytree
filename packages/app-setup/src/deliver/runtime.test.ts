import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stageRuntime, windowsRuntime } from "./runtime.js";

test("1.1 / 1.4: runtime acquisition verifies bytes before replacing a payload", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree runtime "));
  const file = path.join(dir, "node.exe");
  const bytes = Buffer.from("verified executable");
  const runtime = { url: "https://example.invalid/node.exe", sha256: createHash("sha256").update(bytes).digest("hex") };
  try {
    writeFileSync(file, "last usable runtime");
    await assert.rejects(stageRuntime(file, runtime, async () => new Response("interrupted download")), /checksum/);
    assert.equal(readFileSync(file, "utf8"), "last usable runtime");
    await stageRuntime(file, runtime, async () => new Response(bytes));
    assert.deepEqual(readFileSync(file), bytes);
    let fetched = false;
    await stageRuntime(file, runtime, async () => { fetched = true; throw new Error("offline"); });
    assert.equal(fetched, false, "a verified staged runtime is reusable offline");
    assert.match(windowsRuntime("x64").url, /win-x64\/node.exe$/);
    assert.match(windowsRuntime("arm64").url, /win-arm64\/node.exe$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
