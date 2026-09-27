/**
 * Capability 1 · Lifecycle, contract 1.6 in stories/app.md: with storytree closed, an agent's
 * session start opens it, from the record the app leaves of how it was started (app.json). Which
 * build writes that record decides which build opens, so a development copy of the app must not
 * take it from the app that follows merged main (seen 2026-09-27: the record named a stale dev
 * worktree, and weeks of merged work never reached the screen). Also what the app says it is.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { buildLabel, launchToRecord } from "./launch.js";

const runtimeDir = path.resolve("home", "runtime");
const slotApp = path.join(runtimeDir, "b", "apps", "desktop");
const devApp = path.resolve("code", "storytree03-wt", "forest", "apps", "desktop");

test("1.6 the app that follows merged main records how to open it, and a development copy never replaces that record", () => {
  assert.deepEqual(
    launchToRecord({ runtimeDir, appPath: slotApp, execPath: "b/electron.exe", followsMainSetUp: true }),
    { command: "b/electron.exe", args: [slotApp] },
    "the slot's build records itself",
  );
  assert.equal(
    launchToRecord({ runtimeDir, appPath: devApp, execPath: "dev/electron.exe", followsMainSetUp: true }),
    undefined,
    "a development copy leaves the record of the app that follows main alone",
  );
  assert.deepEqual(
    launchToRecord({ runtimeDir, appPath: devApp, execPath: "dev/electron.exe", followsMainSetUp: false }),
    { command: "dev/electron.exe", args: [devApp] },
    "with no app following main on this machine, a development copy is the one to open",
  );
  assert.deepEqual(
    launchToRecord({ runtimeDir, appPath: "ignored", execPath: "temp/app.exe", packaged: { portableFile: "Downloads/storytree.exe" }, followsMainSetUp: false }),
    { command: "Downloads/storytree.exe", args: [] },
    "a packaged portable build records the portable file itself",
  );
});

test("1.6 the app says which build it is: main's commit when it follows merged main, else the development checkout it runs from", () => {
  assert.equal(buildLabel({ runtimeDir, appPath: slotApp, sha: "80bcc63a1b2c" }), "main 80bcc63");
  assert.equal(
    buildLabel({ runtimeDir, appPath: devApp, sha: "9fa208bdeadbeef" }),
    `development build 9fa208b from ${path.resolve("code", "storytree03-wt", "forest")} (does not update itself)`,
  );
  assert.equal(buildLabel({ runtimeDir, appPath: "ignored", packaged: { version: "0.3.0" } }), "version 0.3.0");
});
