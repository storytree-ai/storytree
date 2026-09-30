import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTempDir } from "./folders.js";

test("a test's temp folder that a child still holds for a moment is removed once the child lets go, without failing the test", {
  skip: process.platform !== "win32" && "only Windows refuses to remove a folder a live process runs in (EBUSY/EPERM)",
}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-held-"));
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], { cwd: dir, stdio: "ignore" });
  const exited = once(child, "exit");
  try {
    await once(child, "spawn");
    await removeTempDir(dir);
    assert.equal(existsSync(dir), false);
  } finally {
    child.kill();
    await exited;
  }
});
