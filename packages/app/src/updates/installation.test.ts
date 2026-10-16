/**
 * Capability 4 · Updates, contract 4.21 in the app story: which running app is the installed one, and
 * which installed app follows published releases. A throwaway machine holds the bundles, the delivery
 * record and the packaged package.json; the platform is given, so every case runs on every system.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { installation, type RunningApp } from "./installation.js";

function machine(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-installation-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Mac bundle at `bundle`, as electron-builder lays it out, its package.json recording `signing` if given. */
function macApp(home: string, bundle: string, signing?: string): RunningApp {
  const resourcesPath = path.join(bundle, "Contents", "Resources");
  const appPath = path.join(resourcesPath, "app");
  mkdirSync(appPath, { recursive: true });
  writeFileSync(path.join(appPath, "package.json"), JSON.stringify({ name: "@storytree/desktop", ...(signing ? { storytree: { macSigning: signing } } : {}) }));
  return { platform: "darwin", packaged: true, resourcesPath, appPath, home };
}

function delivered(home: string, installDir: string): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "delivery.json"), JSON.stringify({ schema: 1, installDir, tools: { node: "node", mcp: "mcp" } }));
}

test("4.21 a Mac bundle the delivery record names is installed; one elsewhere, unpackaged or unrecorded is not", (t) => {
  const dir = machine(t);
  const home = path.join(dir, ".storytree", "0.3");
  const bundle = path.join(dir, "Applications", "storytree-0.3.app");
  const app = macApp(home, bundle, "developer-id");

  assert.equal(installation(app).installed, false, "no delivery record yet");
  delivered(home, bundle);
  assert.equal(installation(app).installed, true);
  assert.equal(installation({ ...app, packaged: false }).installed, false, "a development run is never installed");
  const copied = macApp(home, path.join(dir, "Downloads", "storytree-0.3.app"), "developer-id");
  assert.equal(installation(copied).installed, false, "a copy of the app elsewhere is not the installed one");
  writeFileSync(path.join(home, "delivery.json"), "{ not json");
  assert.equal(installation(app).installed, false, "an unreadable record names nothing");
});

test("4.21 an installed Mac app follows releases only when its build is Developer ID signed", (t) => {
  const dir = machine(t);
  const home = path.join(dir, ".storytree", "0.3");
  const signed = path.join(dir, "Applications", "signed.app");
  const adHoc = path.join(dir, "Applications", "ad-hoc.app");
  const unrecorded = path.join(dir, "Applications", "unrecorded.app");

  for (const [bundle, signing, follows] of [[signed, "developer-id", true], [adHoc, "ad-hoc", false], [unrecorded, undefined, false]] as const) {
    const app = macApp(home, bundle, signing);
    delivered(home, bundle);
    assert.deepEqual(installation(app), { installed: true, followsReleases: follows, markerFile: undefined }, path.basename(bundle));
  }
  const elsewhere = macApp(home, path.join(dir, "Downloads", "storytree-0.3.app"), "developer-id");
  assert.equal(installation(elsewhere).followsReleases, false, "an app that is not installed follows nothing");
});

test("4.21 a Windows app is installed by the installer's marker, follows releases with it, and a portable one never", (t) => {
  const dir = machine(t);
  const home = path.join(dir, ".storytree", "0.3");
  const resourcesPath = path.join(dir, "Programs", "storytree-0.3", "resources");
  mkdirSync(resourcesPath, { recursive: true });
  const app: RunningApp = { platform: "win32", packaged: true, resourcesPath, appPath: path.join(resourcesPath, "app.asar"), home };

  assert.deepEqual(installation(app), { installed: false, followsReleases: false, markerFile: undefined });
  writeFileSync(path.join(resourcesPath, "storytree-installed"), "nsis-stable");
  assert.deepEqual(installation(app), { installed: true, followsReleases: true, markerFile: path.join(resourcesPath, "storytree-installed") });
  assert.equal(installation({ ...app, portable: path.join(dir, "storytree.exe") }).installed, false);
  assert.equal(installation({ ...app, platform: "linux" }).installed, false, "no other system has an installer");
});

test("4.21 a Linux AppImage the delivery record's folder holds is installed and follows releases; one run from elsewhere is not", (t) => {
  const dir = machine(t);
  const home = path.join(dir, ".storytree", "0.3");
  const installDir = path.join(dir, ".local", "share", "storytree-0.3");
  // A running AppImage's resources sit in its mount, which moves each run; APPIMAGE names the file itself.
  const app: RunningApp = { platform: "linux", packaged: true, resourcesPath: "/tmp/.mount_storyt1/resources", appPath: "/tmp/.mount_storyt1/resources/app.asar", home, appImage: path.join(installDir, "storytree-0.3") };
  const none = { installed: false, followsReleases: false, markerFile: undefined };

  assert.deepEqual(installation(app), none, "no delivery record yet");
  delivered(home, installDir);
  assert.deepEqual(installation(app), { installed: true, followsReleases: true, markerFile: undefined });
  assert.deepEqual(installation({ ...app, packaged: false }), none, "a development run is never installed");
  assert.deepEqual(installation({ ...app, appImage: undefined }), none, "an unpacked build runs from no AppImage");
  assert.deepEqual(installation({ ...app, appImage: path.join(dir, "Downloads", "storytree-0.3") }), none, "a downloaded copy is not the installed one");
});
