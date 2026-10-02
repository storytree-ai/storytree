import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("1.10 release delivery assets publish a stable command, an explicit development command and a channel-aware installer manifest", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-delivery-assets-"));
  try {
    const bytes = Buffer.from("the already-built installer");
    writeFileSync(path.join(dir, "storytree-0.3-0.3.123-setup.exe"), bytes);
    const { deliveryAssets } = await import(new URL("../../../../apps/desktop/delivery-assets.mjs", import.meta.url).href);
    deliveryAssets(dir, "0.3.123");
    const manifest = JSON.parse(readFileSync(path.join(dir, "storytree-delivery.json"), "utf8"));
    assert.equal(manifest.channelSchema, 1);
    assert.deepEqual(manifest.installer, {
      name: "storytree-0.3-0.3.123-setup.exe",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sha512: createHash("sha512").update(bytes).digest("base64"),
      size: bytes.length,
    });
    assert.match(readFileSync(path.join(dir, "install-storytree.txt"), "utf8"), /raw\.githubusercontent\.com\/storytree-ai\/storytree\/release-channel-stable\/install-storytree\.ps1/);
    assert.match(readFileSync(path.join(dir, "install-storytree-development.txt"), "utf8"), /releases\/latest\/download\/install-storytree\.ps1.*-Channel development/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// install.ps1 promises Windows PowerShell 5.1, the engine stock Windows ships, as well as PowerShell 7.
// On Windows, 5.1 is always required and pwsh runs too when present (CI requires both); elsewhere pwsh only.
const engines = process.env.STORYTREE_TEST_PWSH
  ? [{ command: process.env.STORYTREE_TEST_PWSH, required: true }]
  : process.platform === "win32"
    ? [{ command: "powershell.exe", required: true }, { command: "pwsh", required: Boolean(process.env.CI) }]
    : [{ command: "pwsh", required: false }];

for (const { command, required } of engines) {
  test(`1.1 / 1.3 / 1.4 / 1.6 / 1.10 under ${command}: PowerShell delivery selects and persists its channel, selects architecture, reuses, retries and persists PATH`, (t) => {
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
