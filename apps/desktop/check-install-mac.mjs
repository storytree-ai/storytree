import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import asar from "@electron/asar";
import { toolPaths, verifyPayload } from "@storytree/app-setup/deliver";
import { AUTH_SCHEME } from "@storytree/project-and-caller/identity/desktop";
import { checkTools } from "./check-tools.mjs";
import { archiveVersion, fuseMismatches } from "./packaged-app.mjs";
import { gatekeeperSkip, staplerSkip } from "./mac-signing.mjs";
import { startsCleanly } from "./src/main/start-check.ts";

assert.equal(`${process.platform}-${process.arch}`, "darwin-arm64", "Run this proof on Apple Silicon macOS");
const release = path.resolve("apps/desktop/release");
const app = path.join(release, "mac-arm64", "storytree-0.3.app");
assert.ok(existsSync(app), "the Apple Silicon app was not built");
const version = process.env.STORYTREE_RELEASE_VERSION || JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const temp = mkdtempSync(path.join(tmpdir(), "storytree-mac-"));

try {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
  const signature = spawnSync("codesign", ["--display", "--verbose=2", app], { encoding: "utf8" }).stderr;
  assert.match(signature, /flags=0x[0-9a-f]+\([^)]*runtime/, "the app is signed with the hardened runtime");
  const adHoc = /Signature=adhoc/.test(signature);
  const recorded = JSON.parse(asar.extractFile(path.join(app, "Contents", "Resources", "app.asar"), "package.json").toString("utf8")).storytree?.macSigning;
  assert.equal(recorded, adHoc ? "ad-hoc" : "developer-id", "the app's recorded signing mode matches its signature");
  for (const binary of [path.join(app, "Contents", "Resources", "agent-tools", "node"), path.join(app, "Contents", "Resources", "postgres", "bin", "postgres")]) {
    execFileSync("codesign", ["--verify", "--strict", binary], { stdio: "inherit" });
  }
  const answerFile = path.join(release, "mac-notarisation.json");
  const answer = existsSync(answerFile) ? JSON.parse(readFileSync(answerFile, "utf8")) : undefined;
  const skip = gatekeeperSkip({ adHoc, answer });
  if (skip) console.log(`Gatekeeper assessment NOT RUN: ${skip}`);
  else execFileSync("spctl", ["--assess", "--type", "execute", "--verbose=2", app], { stdio: "inherit" });
  const unstapled = staplerSkip({ adHoc, answer });
  if (unstapled) console.log(`Stapled ticket NOT RUN: ${unstapled}`);
  else {
    const unzipped = path.join(temp, "zip");
    execFileSync("ditto", ["-x", "-k", path.join(release, `storytree-0.3-${version}-mac-arm64.zip`), unzipped]);
    execFileSync("xcrun", ["stapler", "validate", path.join(unzipped, "storytree-0.3.app")], { stdio: "inherit" });
    console.log("The app in the zip carries its stapled notarisation ticket.");
  }

  const resources = path.join(app, "Contents", "Resources");
  const urlTypes = JSON.parse(execFileSync("plutil", ["-extract", "CFBundleURLTypes", "json", "-o", "-", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }));
  assert.ok(urlTypes.some((type) => type.CFBundleURLSchemes?.includes(AUTH_SCHEME)), `the app's Info.plist does not declare ${AUTH_SCHEME}: ${JSON.stringify(urlTypes)}`);
  assert.deepEqual(readFileSync(path.join(resources, "LICENSE")), readFileSync("LICENSE"), "the app carries the repository license unchanged");
  const update = readFileSync(path.join(resources, "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const executable = path.join(app, "Contents", "MacOS", "storytree-0.3");
  assert.equal(archiveVersion(path.join(resources, "app.asar")), version);
  assert.deepEqual(await fuseMismatches(app), [], "the packaged app's fuses are set as the build sets them");
  const starter = path.join(temp, "starting user");
  const startHome = path.join(starter, ".storytree", "0.3");
  mkdirSync(startHome, { recursive: true });
  const cannotStart = await startsCleanly({ execPath: executable, args: ["--page-check"], env: { ...process.env, CI: "true", HOME: starter, STORYTREE_HOME: startHome } });
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
  for (const name of [`storytree-0.3-${version}-mac-arm64.zip`, "latest-mac.yml"]) assert.ok(built.includes(name), `${name} was not built`);
  assert.match(readFileSync(path.join(release, "latest-mac.yml"), "utf8"), new RegExp(`version: ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`));
  console.log(`4.4 PASS (macOS arm64): built ${version} as a zip; its Electron, Postgres and update configuration work; signature ${adHoc ? "ad-hoc" : "Developer ID"}, hardened runtime, verified deep and strict`);
  console.log("4.17 PASS (macOS arm64): the app's main process started with a throwaway home, reached its handlers and exited 0");
  console.log("1.41 PASS (macOS arm64): the packaged app's page loaded from its own scheme, with file:// extra privileges off, and its road worker answered");
  console.log(`Context 6.5 PASS (macOS arm64): the app's Info.plist declares the ${AUTH_SCHEME} scheme, so sign-in callbacks reach it`);
  console.log("app setup 4.2 PASS (macOS arm64): the app carries the repository license");
  console.log("app setup 1.1 PASS (macOS arm64): bundled Node, CLI, hook, setup and MCP run from the app's verified payload");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
