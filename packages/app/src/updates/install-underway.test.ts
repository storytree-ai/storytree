import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { INSTALLING_FILE, installerRunning, installUnderway, markInstalling } from "./install-underway.js";

async function home(t: test.TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "storytree-installing-"));
  t.after(() => removeTemp(dir));
  return dir;
}

const INSTALLER = String.raw`C:\Users\someone\AppData\Local\storytree-updater\pending\storytree-0.3-0.3.2432-windows-arm64-setup.exe`;
const AT = Date.parse("2026-11-05T12:30:56Z");

test("4.41 a start while the next build's installer runs reads as still updating to that build, and the marker stays", async (t) => {
  const dir = await home(t);
  markInstalling(dir, { nextBuild: "0.3.2432", installer: INSTALLER }, AT);
  const asked: string[] = [];
  const underway = installUnderway({ home: dir, runningBuild: "0.3.2431", now: AT + 4 * 60_000, running: (installer) => { asked.push(installer); return true; } });
  assert.deepEqual(underway, { nextBuild: "0.3.2432" });
  assert.deepEqual(asked, [INSTALLER]);
  assert.ok(existsSync(path.join(dir, INSTALLING_FILE)));
});

test("4.41 the build the marker names clears it on its first start, and starts as usual", async (t) => {
  const dir = await home(t);
  markInstalling(dir, { nextBuild: "0.3.2432", installer: INSTALLER }, AT);
  assert.equal(installUnderway({ home: dir, runningBuild: "0.3.2432", now: AT + 60_000, running: () => true }), undefined);
  assert.equal(existsSync(path.join(dir, INSTALLING_FILE)), false);
});

test("4.41 a marker whose installer has ended, or that is older than ten minutes, is stale: the app starts and the marker is cleared", async (t) => {
  const ended = await home(t);
  markInstalling(ended, { nextBuild: "0.3.2432", installer: INSTALLER }, AT);
  assert.equal(installUnderway({ home: ended, runningBuild: "0.3.2431", now: AT + 60_000, running: () => false }), undefined);
  assert.equal(existsSync(path.join(ended, INSTALLING_FILE)), false);

  const old = await home(t);
  markInstalling(old, { nextBuild: "0.3.2432", installer: INSTALLER }, AT);
  assert.equal(installUnderway({ home: old, runningBuild: "0.3.2431", now: AT + 11 * 60_000, running: () => true }), undefined);
  assert.equal(existsSync(path.join(old, INSTALLING_FILE)), false);
});

test("4.41 no marker, or one that cannot be read, never stops a start", async (t) => {
  const dir = await home(t);
  assert.equal(installUnderway({ home: dir, runningBuild: "0.3.2431", now: AT, running: () => true }), undefined);
  await writeFile(path.join(dir, INSTALLING_FILE), "{ not json");
  assert.equal(installUnderway({ home: dir, runningBuild: "0.3.2431", now: AT, running: () => true }), undefined);
});

test("4.41 windows: a running program's installer reads as running, and one that is not running does not", { skip: process.platform === "win32" ? false : "platform:win32: the installer is found by Windows' tasklist" }, () => {
  assert.equal(installerRunning(process.execPath), true);
  assert.equal(installerRunning(path.join(tmpdir(), "storytree-no-such-installer-setup.exe")), false);
});
