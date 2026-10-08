// macOS packaging proof, the Apple Silicon twin of check-install.mjs: verify the built .app's signature,
// start the app's own main once (4.17's start check), run its Postgres binaries, verify the shipped
// license (app setup 4.2) and run the bundled Node, commands and MCP from the app (app setup 1.1).
// No real app data, update feed or release is used. Run with tsx, from the checkout's root: the
// release workflow runs it before the Mac assets are uploaded, so an app that cannot start never ships.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolPaths, verifyPayload } from "@storytree/app-setup/deliver";
import { checkTools } from "./check-tools.mjs";
import { startsCleanly } from "./src/main/start-check.ts";

assert.equal(`${process.platform}-${process.arch}`, "darwin-arm64", "Run this proof on Apple Silicon macOS");
const release = path.resolve("apps/desktop/release");
const app = path.join(release, "mac-arm64", "storytree-0.3.app");
assert.ok(existsSync(app), "the Apple Silicon app was not built");
const version = process.env.STORYTREE_RELEASE_VERSION ?? JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const temp = mkdtempSync(path.join(tmpdir(), "storytree-mac-"));

try {
  // A missing or broken signature fails here, before anything is uploaded.
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
  const signature = spawnSync("codesign", ["--display", "--verbose=2", app], { encoding: "utf8" }).stderr;
  assert.match(signature, /flags=0x[0-9a-f]+\([^)]*runtime/, "the app is signed with the hardened runtime");
  const adHoc = /Signature=adhoc/.test(signature);
  for (const binary of [path.join(app, "Contents", "Resources", "agent-tools", "node"), path.join(app, "Contents", "Resources", "postgres", "bin", "postgres")]) {
    execFileSync("codesign", ["--verify", "--strict", binary], { stdio: "inherit" });
  }
  // Gatekeeper accepts only a Developer ID signature that Apple has notarised (increment_9d05fb8a164b).
  if (adHoc) console.log("Gatekeeper assessment NOT RUN: the app is ad-hoc signed, so not notarised");
  else execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], { stdio: "inherit" });

  const resources = path.join(app, "Contents", "Resources");
  assert.deepEqual(readFileSync(path.join(resources, "LICENSE")), readFileSync("LICENSE"), "the app carries the repository license unchanged");
  const update = readFileSync(path.join(resources, "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const executable = path.join(app, "Contents", "MacOS", "storytree-0.3");
  const result = execFileSync(executable, ["--eval", `console.log(require(${JSON.stringify(`${path.join(resources, "app.asar")}/package.json`)}).version)`], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.trim(), version);
  const starter = path.join(temp, "starting user");
  const startHome = path.join(starter, ".storytree", "0.3");
  mkdirSync(startHome, { recursive: true });
  const cannotStart = await startsCleanly({ execPath: executable, args: [], env: { ...process.env, HOME: starter, STORYTREE_HOME: startHome } });
  assert.equal(cannotStart, undefined, `the app cannot start: ${cannotStart}`);
  const postgres = execFileSync(path.join(resources, "postgres", "bin", "postgres"), ["--version"], { encoding: "utf8", timeout: 30_000 });
  assert.match(postgres, /PostgreSQL/);

  const tools = verifyPayload(app, "arm64", "darwin");
  assert.equal(tools.dir, toolPaths(app, "darwin").dir);
  const runtime = JSON.parse(execFileSync(tools.node, ["-p", "JSON.stringify({arch:process.arch,version:process.versions.node})"], { encoding: "utf8", timeout: 30_000 }));
  assert.equal(runtime.arch, "arm64");
  assert.match(runtime.version, /^24\./);
  await checkTools(tools.node, tools.dir, path.join(temp, "fresh user"));

  const built = readdirSync(release);
  for (const name of [`storytree-0.3-${version}-mac-arm64.zip`, `storytree-0.3-${version}-arm64.dmg`, "latest-mac.yml"]) assert.ok(built.includes(name), `${name} was not built`);
  assert.match(readFileSync(path.join(release, "latest-mac.yml"), "utf8"), new RegExp(`version: ${version.replaceAll(".", "\\.")}(?:\\s|$)`));
  console.log(`4.4 PASS (macOS arm64): built ${version} as a zip and dmg; its Electron, Postgres and update configuration work; signature ${adHoc ? "ad-hoc" : "Developer ID"}, hardened runtime, verified deep and strict`);
  console.log("4.17 PASS (macOS arm64): the app's main process started with a throwaway home, reached its handlers and exited 0");
  console.log("app setup 4.2 PASS (macOS arm64): the app carries the repository license");
  console.log("app setup 1.1 PASS (macOS arm64): bundled Node, CLI, hook, setup and MCP run from the app's verified payload");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
