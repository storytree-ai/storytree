/** Capability 4 · Updates, the release's Windows update check (contract 4.45): GitHub refusing its one-liner a download. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../../app-setup/testing/windows-acceptance/update-over-tools.ps1", import.meta.url));

// The check runs under PowerShell 7 (the release job's shell): CI's Windows runners have it; elsewhere it may be absent.
function run(t: { skip: (why: string) => void }, body: string): { status: number | null; out: string } | undefined {
  const required = process.platform === "win32" && Boolean(process.env.CI);
  const found = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  if (found.error && !required) { t.skip("pwsh unavailable here; Windows CI runs this proof"); return undefined; }
  assert.ifError(found.error);
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", `$ErrorActionPreference = 'Stop'; . '${script.replace(/'/g, "''")}' -LibraryOnly; ${body}`], { encoding: "utf8" });
  return { status: result.status, out: result.stdout + result.stderr };
}

test("4.45 · the Windows update check tries its one-liner again when GitHub refuses it a download (403 or 429), and a refusal on every try fails naming GitHub, not the build", (t) => {
  const answer = run(t, `
    # The refusal as run 43596024668's one-liner wrote it (Windows PowerShell 5.1), and as PowerShell 7 words it.
    Write-Output "51: $(Get-GitHubRefusal 'storytree delivery failed at download: The remote server returned an error: (403) Forbidden.. Retry')"
    Write-Output "7: $(Get-GitHubRefusal 'Response status code does not indicate success: 429 (Too Many Requests).')"
    Write-Output "other: [$(Get-GitHubRefusal 'storytree delivery failed at install: NSIS installer exited with code 2.')]"
    $script:tries = 0
    Write-Output "recovered: $(Invoke-PastRefusal { $script:tries++; if ($script:tries -lt 3) { throw 'GitHub refused a download (403 Forbidden)' }; 'installed 0.3.2838' } @(0, 0))"
    $script:tries = 0
    try { Invoke-PastRefusal { $script:tries++; throw 'the one-liner exited 1' } @(0, 0) } catch { Write-Output "build: $($_.Exception.Message) after $script:tries" }
    $script:tries = 0
    try { Invoke-PastRefusal { $script:tries++; throw 'GitHub refused a download (429 Too Many Requests)' } @(0, 0) } catch { Write-Output "spent: $($_.Exception.Message) after $script:tries" }
  `);
  if (!answer) return;
  assert.equal(answer.status, 0, answer.out);
  assert.match(answer.out, /^51: 403 Forbidden$/m);
  assert.match(answer.out, /^7: 429 Too Many Requests$/m);
  assert.match(answer.out, /^other: \[\]$/m);
  assert.match(answer.out, /^recovered: installed 0\.3\.2838, after GitHub refused 2 tries \(403 Forbidden; 403 Forbidden\)$/m);
  // A failure that is not GitHub's refusal is the build's, and is not tried again.
  assert.match(answer.out, /^build: the one-liner exited 1 after 1$/m);
  assert.match(answer.out, /^spent: GitHub refused a download on all 3 tries \(429 Too Many Requests; 429 Too Many Requests; 429 Too Many Requests\): an outside fault, not the build's after 3$/m);
});
