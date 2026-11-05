/** Capability 1 · Lifecycle: the main process as the app bundles it, started beside an app that is already open. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { removeTemp } from "@storytree/test-waits";

import { mainBuild } from "./bundles.js";

/**
 * A stand-in for Electron that records what the main process asks of it, and prints the record as it exits: the
 * single-instance lock is already held, as when the app is open, and the app is never ready.
 */
const STAND_IN = `
const Module = require("node:module");
const asked = [];
const record = (name) => (...args) => { asked.push(name); return undefined; };
const anything = new Proxy(function () {}, { get: (_, key) => key === "then" ? undefined : anything, apply: () => anything, construct: () => anything });
const app = new Proxy({
  isPackaged: false,
  getVersion: () => "0.0.0",
  getAppPath: () => process.cwd(),
  isReady: () => false,
  requestSingleInstanceLock: () => { asked.push("requestSingleInstanceLock"); return false; },
  quit: record("quit"),
  exit: record("exit"),
  whenReady: () => { asked.push("whenReady"); return new Promise(() => {}); },
}, { get: (target, key) => key in target ? target[key] : anything });
const BrowserWindow = function () { asked.push("new BrowserWindow"); return anything; };
BrowserWindow.getAllWindows = () => [];
const electron = new Proxy({ app, BrowserWindow }, { get: (target, key) => key in target ? target[key] : anything });
const load = Module._load;
Module._load = function (request, ...rest) { return request === "electron" ? electron : load.call(this, request, ...rest); };
process.on("exit", () => process.stdout.write("\\nASKED " + JSON.stringify(asked) + "\\n"));
require(process.argv[2]);
setTimeout(() => process.exit(0), 500);
`;

test("1.27 · a second start while the app is open hands over to it: it quits at once, never waiting to be ready, so it opens no window and starts no database", { timeout: 120_000 }, async (t) => {
  const dist = mkdtempSync(path.join(tmpdir(), "storytree-main-"));
  t.after(() => removeTemp(dist));
  await build({ ...mainBuild(dist), entryPoints: [fileURLToPath(new URL("./main.ts", import.meta.url))], logLevel: "silent" });
  const runner = path.join(dist, "run.cjs");
  writeFileSync(runner, STAND_IN);
  const home = path.join(dist, "home");
  const out = execFileSync(process.execPath, [runner, path.join(dist, "main.cjs")], { encoding: "utf8", env: { ...process.env, STORYTREE_HOME: home }, cwd: dist });
  const asked = JSON.parse(/^ASKED (.*)$/m.exec(out)![1]!) as string[];
  assert.deepEqual(asked.filter((one) => one !== "requestSingleInstanceLock"), ["quit"]);
  assert.ok(!existsSync(path.join(home, "pgdata")), "no database was started");
  assert.ok(!existsSync(path.join(home, "app.json")), "the open app's launch record is left alone");
});
