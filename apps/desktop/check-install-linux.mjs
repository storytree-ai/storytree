// Linux packaging proof, the x64 twin of check-install-mac.mjs: unpack the built AppImage itself (no
// FUSE needed), start the app's own main once (4.17's start check), run its Postgres binaries, verify the
// shipped license (app setup 4.2), check it declares the sign-in callback scheme (identity 2.5) and run the
// bundled Node, commands and MCP from the app (app setup 1.1).
// No real app data, update feed or release is used. Run with tsx, from the checkout's root: the release
// workflow runs it before the Linux assets are uploaded, so an app that cannot start never ships.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toolPaths, verifyPayload } from "@storytree/app-setup/deliver";
import { AUTH_SCHEME } from "@storytree/identity/desktop";
import { checkTools } from "./check-tools.mjs";
import { startsCleanly } from "./src/main/start-check.ts";

assert.equal(`${process.platform}-${process.arch}`, "linux-x64", "Run this proof on x64 Linux");
const release = path.resolve("apps/desktop/release");
const version = process.env.STORYTREE_RELEASE_VERSION ?? JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
const appImage = path.join(release, `storytree-0.3-${version}-linux-x86_64.AppImage`);
assert.ok(existsSync(appImage), "the x64 AppImage was not built");
const temp = mkdtempSync(path.join(tmpdir(), "storytree-linux-"));

try {
  // What a user runs is the AppImage, so prove its contents rather than the unpacked build folder.
  execFileSync(appImage, ["--appimage-extract"], { cwd: temp, stdio: "ignore", timeout: 120_000 });
  const app = path.join(temp, "squashfs-root");
  const resources = path.join(app, "resources");
  // The desktop entry is how a Linux desktop hands a sign-in's storytree-auth callback to the app (identity 2.5).
  const entry = readdirSync(app).find((name) => name.endsWith(".desktop"));
  assert.ok(entry, "the AppImage carries no desktop entry");
  const desktop = readFileSync(path.join(app, entry), "utf8");
  assert.match(desktop, new RegExp(`^MimeType=.*x-scheme-handler/${AUTH_SCHEME};`, "m"), `the desktop entry does not declare ${AUTH_SCHEME}:\n${desktop}`);
  assert.deepEqual(readFileSync(path.join(resources, "LICENSE")), readFileSync("LICENSE"), "the app carries the repository license unchanged");
  const update = readFileSync(path.join(resources, "app-update.yml"), "utf8");
  assert.match(update, /provider: github/);
  assert.match(update, /owner: storytree-ai/);
  assert.match(update, /repo: storytree\s/);
  const executable = path.join(app, "storytree-0.3");
  const result = execFileSync(executable, ["--eval", `console.log(require(${JSON.stringify(`${path.join(resources, "app.asar")}/package.json`)}).version)`], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.trim(), version);
  const starter = path.join(temp, "starting user");
  const startHome = path.join(starter, ".storytree", "0.3");
  mkdirSync(startHome, { recursive: true });
  // The check is main's start, not the sandbox or a display: an extracted AppImage's chrome-sandbox is not
  // setuid root, and a runner has no display server, so Chromium starts unsandboxed on its headless platform.
  const cannotStart = await startsCleanly({ execPath: executable, args: ["--no-sandbox", "--ozone-platform=headless"], env: { ...process.env, HOME: starter, STORYTREE_HOME: startHome } });
  assert.equal(cannotStart, undefined, `the app cannot start: ${cannotStart}`);
  const postgres = execFileSync(path.join(resources, "postgres", "bin", "postgres"), ["--version"], { encoding: "utf8", timeout: 30_000 });
  assert.match(postgres, /PostgreSQL/);

  const tools = verifyPayload(app, "x64", "linux");
  assert.equal(tools.dir, toolPaths(app, "linux").dir);
  const runtime = JSON.parse(execFileSync(tools.node, ["-p", "JSON.stringify({arch:process.arch,version:process.versions.node})"], { encoding: "utf8", timeout: 30_000 }));
  assert.equal(runtime.arch, "x64");
  assert.match(runtime.version, /^24\./);
  await checkTools(tools.node, tools.dir, path.join(temp, "fresh user"));

  assert.ok(readdirSync(release).includes("latest-linux.yml"), "latest-linux.yml was not built");
  const feed = readFileSync(path.join(release, "latest-linux.yml"), "utf8");
  assert.match(feed, new RegExp(`version: ${version.replaceAll(".", "\\.")}(?:\\s|$)`));
  assert.match(feed, new RegExp(`path: storytree-0\\.3-${version.replaceAll(".", "\\.")}-linux-x86_64\\.AppImage`));
  console.log(`4.4 PASS (Linux x64): built ${version} as an AppImage with latest-linux.yml; its Electron, Postgres and update configuration work from the AppImage's own contents`);
  console.log("4.17 PASS (Linux x64): the app's main process started with a throwaway home, reached its handlers and exited 0");
  console.log(`identity 2.5 PASS (Linux x64): the AppImage's desktop entry declares the ${AUTH_SCHEME} scheme, so sign-in callbacks reach it`);
  console.log("app setup 4.2 PASS (Linux x64): the app carries the repository license");
  console.log("app setup 1.1 PASS (Linux x64): bundled Node, CLI, hook, setup and MCP run from the app's verified payload");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
