import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("app setup 1.1: the desktop's complete tool bundle runs outside a checkout, including MCP and imported chunks", () => {
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
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
