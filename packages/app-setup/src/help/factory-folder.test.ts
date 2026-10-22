import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setupHelpActions } from "./actions.js";
import { chooseFactoryStep } from "../view/factory-step.js";

test("3.10 First launch's factory folder: none chosen until one is picked; an empty folder is given the factory's shape, a factory is accepted, any other folder is refused with why and nothing is saved; the folder picked is the factory setting", async (t) => {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), "storytree-app-factory-folder-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  let picked: string | undefined;
  const actions = setupHelpActions({
    licenseFile: "", storytreeHome: home, chooseFolder: async () => picked,
    openExternal: async () => {}, copyText: async () => {}, library: () => { throw new Error("no library is needed"); },
  });
  const saved = () => (existsSync(path.join(home, "settings.json")) ? JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")).factory : undefined);

  assert.equal(await actions.factoryFolder(), null, "a new computer has no factory folder");
  assert.equal(await actions.chooseFactory(), null, "cancelling the picker chooses nothing");
  assert.equal(saved(), undefined);

  picked = path.join(dir, "notes");
  mkdirSync(picked);
  writeFileSync(path.join(picked, "todo.md"), "mine");
  await assert.rejects(actions.chooseFactory(), /notes holds other files and no plugins folder/, "a folder that is neither empty nor a factory is refused, saying why");
  assert.equal(saved(), undefined, "a refused folder is not saved");
  assert.equal(existsSync(path.join(picked, "plugins")), false, "a refused folder is left as it was");

  picked = path.join(dir, "my factory");
  mkdirSync(path.join(picked, ".git"), { recursive: true });
  assert.deepEqual(await actions.chooseFactory(), { status: "set up", folder: picked }, "an empty folder (a fresh repository counts) is set up");
  assert.ok(statSync(path.join(picked, "plugins")).isDirectory(), "the factory's shape: a plugins folder");
  assert.equal(saved(), picked, "the folder picked is this computer's factory setting");
  assert.equal(await actions.factoryFolder(), picked);

  picked = path.join(dir, "older factory");
  mkdirSync(path.join(picked, "plugins", "ci-lite"), { recursive: true });
  writeFileSync(path.join(picked, "README.md"), "my plugins");
  assert.deepEqual(await actions.chooseFactory(), { status: "already a factory", folder: picked }, "a folder with the factory's shape is accepted as it is");
  assert.equal(saved(), picked);
});

test("3.10 The factory step shows until a factory folder is chosen, stays after a cancel or a refusal with its reason, and goes once one is picked", async () => {
  const said: string[] = [];
  let chosen: string | null = null;
  let answer: () => Promise<{ status: "set up" | "already a factory"; folder: string } | null> = async () => null;
  const step = chooseFactoryStep({ factoryFolder: async () => chosen, chooseFactory: () => answer() }, (text) => said.push(text));

  assert.equal(await step.needed(), true, "no factory folder: the step shows");
  assert.equal(await step.choose(), false, "a cancelled picker leaves the step showing");
  answer = async () => { throw new Error("/work/notes holds other files and no plugins folder"); };
  assert.equal(await step.choose(), false, "a refused folder leaves the step showing");
  assert.match(said.at(-1)!, /That folder cannot be your factory: \/work\/notes holds other files/);
  answer = async () => ({ status: "set up", folder: "/work/factory" });
  assert.equal(await step.choose(), true, "a picked folder ends the step");
  assert.match(said.at(-1)!, /\/work\/factory is now your factory/);

  chosen = "/work/factory";
  assert.equal(await step.needed(), false, "once chosen, the step does not come back");
});
