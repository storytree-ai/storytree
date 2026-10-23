import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setFactory } from "@storytree/project-and-caller";

import { setupHelpActions } from "./actions.js";

test("3.11 The desktop app's first launch asks for no factory folder: setting up the first-run guide makes storytree's own, ~/.storytree/your-factory, when none is chosen, and leaves a chosen one alone", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-app-factory-folder-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unused = async () => { throw new Error("not used here"); };
  const launch = (storytreeHome: string) => setupHelpActions({
    licenseFile: "", storytreeHome, chooseFolder: unused, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); },
  });

  const home = path.join(dir, ".storytree", "0.3");
  launch(home);
  assert.ok(statSync(path.join(dir, ".storytree", "your-factory", "plugins")).isDirectory(), "storytree's own factory, with its plugins folder");
  assert.equal(existsSync(path.join(home, "settings.json")), false, "no setting is saved for it");

  const other = path.join(dir, "other", "0.3");
  const mine = path.join(dir, "mine");
  mkdirSync(mine);
  setFactory(mine, other);
  launch(other);
  assert.equal(existsSync(path.join(dir, "other", "your-factory")), false, "a chosen factory is used in its place");
  assert.deepEqual(readdirSync(mine), ["plugins"], "and left as it was");
});
