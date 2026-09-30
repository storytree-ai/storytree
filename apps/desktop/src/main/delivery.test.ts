import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

test("app setup 1.1 / library 14.5: delivered tools run outside a checkout, including native embedding inference without a model download", async () => {
  const temp = mkdtempSync(path.join(tmpdir(), "storytree delivered tools "));
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  try {
    const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { buildToolBundle } from './apps/desktop/tools.mjs';
      import { checkTools } from './apps/desktop/check-tools.mjs';
      import path from 'node:path';
      const temp = process.env.STORYTREE_DELIVERY_TEST_DIR;
      const dir = path.join(temp, 'installed app', 'resources', 'agent-tools');
      await buildToolBundle(dir);
      await checkTools(process.execPath, dir, path.join(temp, 'fresh user'));
      console.log('standalone tools PASS');
    `], { cwd, env: { ...process.env, STORYTREE_DELIVERY_TEST_DIR: temp }, encoding: "utf8", timeout: 60_000 });
    assert.match(result, /standalone tools PASS/);
    assert.match(result, /native ONNX CPU inference returned 42; no model download/);
    console.log(result.trim());
  } finally { await removeTempDir(temp); }
});

// On Windows the folder can stay held for a moment after the child that loaded native binaries from
// it exits (EBUSY, EPERM): retry for a while, then leave it in the system's temp directory and say
// so, rather than failing the delivery this test protects. The agent link's tests do the same
// (packages/agent-link/src/testing/folders.ts).
async function removeTempDir(dir: string, waitMs = 10_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await rm(dir, { recursive: true, force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code)) throw error;
      if (Date.now() >= deadline) return console.warn(`left the test folder ${dir} behind: still held after ${waitMs} ms (${code})`);
      await pause(100);
    }
  }
}
