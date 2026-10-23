/** Capability 2 · Settings, contract 2.17: a part of the host switched off and on, and the parts `settings show` lists. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withTempDir } from "../testing/folders.js";
import { partsSaid, switchedSaid, switchPart } from "./parts.js";
import { factoryFolder, readStandIns, setFactory } from "./settings.js";

/** A host's parts: the core, and forest with arc-surface standing on it. */
const parts = ["arc-surface", "forest", "library", "project-and-caller"];

test("2.17 `settings set part <part> off` switches a part of the host off and `on` back on, saying every part now off with the part each stands on and that hosts take it as they start, and `settings show` lists each part on, off, off with another or always on; the core, a part the host lacks and a state but on or off are refused, saving nothing", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");

    assert.deepEqual(switchPart("forest", "off", parts, home), ["forest"]);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": ["forest"] });
    const switched = new Map([["forest", "forest"], ["arc-surface", "forest"]]);
    const said = switchedSaid(switched);
    assert.match(said, /^Switched off on this computer: arc-surface \(with forest, which it stands on\), forest\./);
    assert.match(said, /restart/i, "a host reads the setting as it starts");
    const shown = partsSaid(parts, switched);
    assert.match(shown, /^  arc-surface: off, with forest$/m);
    assert.match(shown, /^  forest: off$/m);
    assert.match(shown, /^  library: always on \(the core\)$/m);
    assert.match(partsSaid(parts, new Map()), /^  forest: on$/m);

    assert.deepEqual(switchPart("forest", "on", parts, home), []);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": [] });
    assert.match(switchedSaid(new Map()), /^No part is switched off on this computer\./);

    for (const [part, state, refusal] of [["library", "off", /library is the core/], ["lag", "off", /no part called lag.*arc-surface, forest\.$/], ["forest", "maybe", /on or off/]] as const) {
      assert.throws(() => switchPart(part, state, parts, home), (error: unknown) => error instanceof Error && refusal.test(error.message));
    }
    assert.throws(() => switchPart("forest", "maybe", parts, home), (error: unknown) => error instanceof VerbRefusal && error.misuse === true);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": [] }, "a refused switch saves nothing");
  });
});

test("2.20 `settings set factory <folder>` chooses this computer's factory folder, an existing folder, saved as its full path: an empty one is given the factory's shape, a factory is accepted, and any other folder is refused with why, left as it was and not saved; `settings set part <part> plugin <plugin>` switches the part off and names the factory plugin standing in for it, which readStandIns reads with the folder and `settings show` lists; `on` switches it back on and drops the stand-in, and a plugin with no name is refused, saving nothing", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    assert.throws(() => setFactory(path.join(home, "no-such"), home), /no folder/);
    mkdirSync(path.join(home, "notes"));
    writeFileSync(path.join(home, "notes", "todo.md"), "mine");
    assert.throws(() => setFactory(path.join(home, "notes"), home), /notes holds other files and no plugins folder/);
    assert.equal(existsSync(path.join(home, "notes", "plugins")), false, "a refused folder is left as it was");
    assert.equal(existsSync(file), false, "a refused folder is not saved");
    mkdirSync(path.join(home, "factory", ".git"), { recursive: true });
    assert.deepEqual(setFactory(path.join(home, "factory", "."), home), { status: "set up", folder: path.join(home, "factory") }, "an empty folder (a fresh repository counts) is set up");
    assert.ok(statSync(path.join(home, "factory", "plugins")).isDirectory(), "the factory's shape: a plugins folder");
    writeFileSync(path.join(home, "factory", "README.md"), "my plugins");
    assert.deepEqual(setFactory(path.join(home, "factory"), home), { status: "already a factory", folder: path.join(home, "factory") }, "a folder with the factory's shape is accepted as it is");

    assert.deepEqual(switchPart("forest", "plugin", parts, home, "my-forest"), ["forest"]);
    assert.deepEqual(readStandIns(home), { folder: path.join(home, "factory"), plugins: { forest: "my-forest" } });
    const standIns = readStandIns(home).plugins;
    assert.match(switchedSaid(new Map([["forest", "forest"]]), standIns), /forest \(my-forest stands in for it\)/);
    assert.match(partsSaid(parts, new Map([["forest", "forest"]]), standIns), /^  forest: off, my-forest stands in for it$/m);

    assert.throws(() => switchPart("forest", "plugin", parts, home), /names the plugin/);
    assert.deepEqual(switchPart("forest", "on", parts, home), []);
    assert.deepEqual(readStandIns(home).plugins, {});
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { factory: path.join(home, "factory"), "parts-off": [], "stand-ins": {} });
  });
});

test("2.21 With no factory setting, storytree makes and uses its own factory folder, your-factory, with the factory's shape and no setting saved: beside its versioned home (~/.storytree/your-factory), inside any other home", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, ".storytree", "0.3");
    const made = path.join(dir, ".storytree", "your-factory");
    assert.deepEqual(factoryFolder(home), { folder: made, chosen: false });
    assert.ok(statSync(path.join(made, "plugins")).isDirectory(), "the factory's shape: a plugins folder");
    assert.deepEqual(readStandIns(home), { folder: made, plugins: {} }, "the hosts load plugins from it");
    assert.equal(existsSync(path.join(home, "settings.json")), false, "the default is not saved as a setting");

    mkdirSync(path.join(made, "plugins", "my-forest"));
    assert.deepEqual(factoryFolder(home), { folder: made, chosen: false });
    assert.ok(existsSync(path.join(made, "plugins", "my-forest")), "a default folder already there is used as it is");

    const lane = path.join(dir, "lane-home");
    assert.equal(factoryFolder(lane).folder, path.join(lane, "your-factory"), "any other home keeps its factory inside it");

    mkdirSync(path.join(dir, "mine"));
    setFactory(path.join(dir, "mine"), home);
    assert.deepEqual(factoryFolder(home), { folder: path.join(dir, "mine"), chosen: true });
    assert.equal(readStandIns(home).folder, path.join(dir, "mine"));
  });
});
