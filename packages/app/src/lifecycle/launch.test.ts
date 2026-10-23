/**
 * Capability 1 · Lifecycle, contract 1.6 in the app story: with storytree closed, an agent's
 * session start opens it, from the record the app leaves of how it was started (app.json). Which
 * build writes that record decides which build opens, so a development copy of the app must not
 * take it from the installed app (seen 2026-09-27: the record named a stale dev worktree, and weeks
 * of merged work never reached the screen). Also what the app says it is.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildLabel, checkoutSha, launchToRecord } from "./launch.js";

const devApp = path.resolve("code", "storytree03-wt", "forest", "apps", "desktop");

test("1.6 a development copy records how to open it only where no installed app is, and a packaged portable build records its portable file", () => {
  assert.equal(
    launchToRecord({ appPath: devApp, execPath: "dev/electron.exe", installedHere: true }),
    undefined,
    "a development copy leaves the installed app's record alone",
  );
  assert.deepEqual(
    launchToRecord({ appPath: devApp, execPath: "dev/electron.exe", installedHere: false }),
    { command: "dev/electron.exe", args: [devApp] },
    "with no installed app on this machine, a development copy is the one to open",
  );
  assert.deepEqual(
    launchToRecord({ appPath: "ignored", execPath: "temp/app.exe", packaged: { portableFile: "Downloads/storytree.exe" }, installedHere: true }),
    { command: "Downloads/storytree.exe", args: [] },
    "a packaged portable build records the portable file itself",
  );
});

test("1.6 a packaged build run from an AppImage records the AppImage file, not the mount it vanishes from", () => {
  const mounted = "/tmp/.mount_storyt3x/storytree";
  assert.deepEqual(
    launchToRecord({ appPath: "ignored", execPath: mounted, packaged: { appImage: "/home/u/Applications/storytree.AppImage" }, installedHere: false }),
    { command: "/home/u/Applications/storytree.AppImage", args: [] },
    "the AppImage file outlives the run; its mount does not",
  );
  assert.deepEqual(
    launchToRecord({ appPath: "ignored", execPath: mounted, packaged: { appImage: "/home/u/Applications/storytree.AppImage", sandboxOff: true }, installedHere: false }),
    { command: "/home/u/Applications/storytree.AppImage", args: ["--no-sandbox"] },
    "where the kernel blocks the sandbox, the AppImage reopens as it was started, with --no-sandbox",
  );
});

test("1.6 the app says which build it is: its version when packaged, else the development checkout and commit it runs from", async (t) => {
  const checkout = mkdtempSync(path.join(tmpdir(), "storytree-checkout-"));
  t.after(() => rmSync(checkout, { recursive: true, force: true }));
  // A commit with a fixed author, date and message is always the same commit, whatever machine makes it.
  const env = { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
  const git = (...args: string[]) => execFileSync("git", ["-C", checkout, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env });
  git("init", "--quiet", "--object-format=sha1");
  git("commit", "--quiet", "--allow-empty", "-m", "a commit");
  assert.equal(
    buildLabel({ appPath: devApp, sha: "9fa208bdeadbeef" }),
    `development build 9fa208b from ${path.resolve("code", "storytree03-wt", "forest")} (does not update itself)`,
  );
  assert.equal(buildLabel({ appPath: "ignored", packaged: { version: "0.3.0" } }), "version 0.3.0");
  assert.equal(await checkoutSha(checkout), "9a9002bdbb9230a758a26831033a5263447c4e24");
});
