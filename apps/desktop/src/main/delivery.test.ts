import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("app setup 1.1 / library 14.5: delivered tools run outside a checkout, including native embedding inference without a model download", () => {
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
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
