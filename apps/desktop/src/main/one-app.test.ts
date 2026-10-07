import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startRefusal } from "./one-app.js";

test("4.18 a desktop start beside the other storytree app is refused, naming it; a checkout start checks nothing", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "one-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const localAppData = path.join(root, "local");
  const installedDir = path.join(localAppData, "Programs", "storytree-0.3");
  mkdirSync(path.join(installedDir, "resources"), { recursive: true });
  writeFileSync(path.join(installedDir, "resources", "storytree-installed"), "latest");
  const runtime = path.join(home, "runtime");
  mkdirSync(path.join(runtime, "a", "apps", "desktop", "node_modules", "electron"), { recursive: true });
  writeFileSync(path.join(runtime, "a", "apps", "desktop", "node_modules", "electron", "path.txt"), "electron");

  assert.match(startRefusal({ slot: "a", installed: false, home, localAppData }) ?? "", new RegExp(`installed storytree 0.3 app.*${installedDir.replaceAll("\\", "\\\\")}`));
  assert.match(startRefusal({ slot: undefined, installed: true, home, localAppData }) ?? "", new RegExp(`follows merged main.*${runtime.replaceAll("\\", "\\\\")}`));
  assert.equal(startRefusal({ slot: undefined, installed: false, home, localAppData }), undefined);
});
