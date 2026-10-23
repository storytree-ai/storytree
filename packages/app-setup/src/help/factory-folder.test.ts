import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("3.12 The app reads this computer's factory folder and imports or switches it through the native picker with no approval: an empty folder is set up, a factory kept, the desktop app recorded as who switched it, a cancelled picker changes nothing and any other folder is refused with why", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-app-factory-switch-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unused = async () => { throw new Error("not used here"); };
  let picked: string | undefined;
  const home = path.join(dir, ".storytree", "0.3");
  const actions = setupHelpActions({ licenseFile: "", storytreeHome: home, chooseFolder: async () => picked, openExternal: unused, copyText: unused, library: () => { throw new Error("not used here"); } });

  assert.deepEqual(await actions.factoryFolder(), { folder: path.join(dir, ".storytree", "your-factory"), chosen: false }, "storytree's own, made as the app starts");
  assert.equal(await actions.chooseFactory(), null, "a cancelled picker changes nothing");

  picked = path.join(dir, "mine");
  mkdirSync(picked);
  assert.deepEqual(await actions.chooseFactory(), { status: "set up", folder: picked });
  const now = await actions.factoryFolder();
  assert.equal(now.folder, picked);
  assert.equal(now.switched?.through, "desktop app", "who switched it is recorded; nobody was asked to approve it");

  picked = path.join(dir, "notes");
  mkdirSync(picked);
  writeFileSync(path.join(picked, "todo.md"), "mine");
  await assert.rejects(actions.chooseFactory(), /not a factory/);
  assert.equal((await actions.factoryFolder()).folder, path.join(dir, "mine"), "a refused folder is not switched to");
});
