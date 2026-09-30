import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// install.ps1 promises Windows PowerShell 5.1, the engine stock Windows ships, as well as PowerShell 7.
// On Windows, 5.1 is always required and pwsh runs too when present (CI requires both); elsewhere pwsh only.
const engines = process.env.STORYTREE_TEST_PWSH
  ? [{ command: process.env.STORYTREE_TEST_PWSH, required: true }]
  : process.platform === "win32"
    ? [{ command: "powershell.exe", required: true }, { command: "pwsh", required: Boolean(process.env.CI) }]
    : [{ command: "pwsh", required: false }];

for (const { command, required } of engines) {
  test(`1.1 / 1.3 / 1.4 / 1.6 under ${command}: PowerShell delivery selects Windows architecture, reuses, retries, preserves failures and persists PATH`, (t) => {
    const found = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
    if (found.error && !required) return t.skip(`platform:win32: ${command} unavailable here; Windows CI runs this proof`);
    assert.ifError(found.error);
    // A user opens Windows PowerShell afresh; a module path inherited from pwsh (CI's shell) would load 7's modules into 5.1.
    const env = { ...process.env };
    if (command === "powershell.exe") for (const name of Object.keys(env)) if (name.toUpperCase() === "PSMODULEPATH") delete env[name];
    const result = spawnSync(command, ["-NoProfile", "-File", fileURLToPath(new URL("./bootstrap.test.ps1", import.meta.url))], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /delivery bootstrap PASS/);
  });
}
