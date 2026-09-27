import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("1.1 / 1.3 / 1.4 / 1.6: PowerShell delivery selects Windows architecture, reuses, retries, preserves failures and persists PATH", (t) => {
  const powershell = process.env.STORYTREE_TEST_PWSH ?? "pwsh";
  const found = spawnSync(powershell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  if (found.error && process.platform !== "win32") return t.skip("PowerShell unavailable here; Windows CI runs this proof");
  const result = spawnSync(powershell, ["-NoProfile", "-File", fileURLToPath(new URL("./bootstrap.test.ps1", import.meta.url))], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /delivery bootstrap PASS/);
});
