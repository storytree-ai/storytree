// Windows packaging proof: install the built NSIS payload, run its Electron and Postgres
// binaries, verify the shipped license (app setup 4.2), and uninstall. No real app data,
// update feed or release is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const release = path.resolve("apps/desktop/release");
const installer = readdirSync(release).find((file) => file.endsWith("-setup.exe"));
assert.ok(installer, "NSIS installer was not built");
assert.equal(process.platform, "win32", "Run this proof on Windows");
const version = process.env.STORYTREE_RELEASE_VERSION ?? JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const temp = mkdtempSync(path.join(tmpdir(), "storytree-installer-"));
const installed = path.join(temp, "app");
const license = readFileSync("LICENSE");
try {
  execFileSync(path.join(release, installer), ["/S", `/D=${installed}`], { timeout: 180_000 });
  assert.deepEqual(readFileSync(path.join(installed, "resources", "LICENSE")), license, "the installed app carries the repository license unchanged");
  assert.deepEqual(readFileSync(path.join(release, "win-arm64-unpacked", "resources", "LICENSE")), license, "the arm64 portable payload carries the same license");
  assert.equal(readFileSync(path.join(installed, "resources", "storytree-installed"), "utf8"), "nsis");
  const update = readFileSync(path.join(installed, "resources", "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const archive = path.join(installed, "resources", "app.asar");
  const result = execFileSync(path.join(installed, "storytree-0.3.exe"), ["--eval", `console.log(require(${JSON.stringify(`${archive}/package.json`)}).version)`], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.trim(), version);
  const postgres = execFileSync(path.join(installed, "resources", "postgres", "bin", "postgres.exe"), ["--version"], { encoding: "utf8", timeout: 30_000 });
  assert.match(postgres, /PostgreSQL/);
  assert.match(readFileSync(path.join(release, "latest.yml"), "utf8"), new RegExp(`version: ${version.replaceAll(".", "\\.")}(?:\\s|$)`));
  console.log(`4.4 PASS: NSIS installed ${version}; its Electron, Postgres and update configuration work`);
  console.log("app setup 4.2 PASS: the NSIS and arm64 portable payloads carry the same offline license");
} finally {
  const uninstaller = path.join(installed, "Uninstall storytree-0.3.exe");
  if (existsSync(uninstaller)) execFileSync(uninstaller, ["/S"], { timeout: 180_000 });
  rmSync(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
}
