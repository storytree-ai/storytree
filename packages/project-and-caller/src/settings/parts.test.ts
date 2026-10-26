/** Capability 2 · Settings, contract 2.17: a part of the host switched off and on, and the parts `settings show` lists. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withTempDir } from "../testing/folders.js";
import { partsSaid, switchedSaid, switchPart } from "./parts.js";
import { factoryFolder, makeFactoryFolder, readStandIns, setFactory } from "./settings.js";

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
    assert.deepEqual({ ...readStandIns(home), switched: undefined }, { folder: path.join(home, "factory"), plugins: { forest: "my-forest" }, switched: undefined, history: {} });
    const standIns = readStandIns(home).plugins;
    assert.match(switchedSaid(new Map([["forest", "forest"]]), standIns), /forest \(my-forest stands in for it\)/);
    assert.match(partsSaid(parts, new Map([["forest", "forest"]]), standIns), /^  forest: off, my-forest stands in for it$/m);

    // A part that has left the base (voice) is in no host's parts, yet a factory plugin stands in for it, and it switches back.
    assert.deepEqual(switchPart("voice", "plugin", parts, home, "voice"), ["forest", "voice"]);
    assert.equal(readStandIns(home).plugins.voice, "voice");
    assert.deepEqual(switchPart("voice", "on", parts, home), ["forest"]);
    assert.equal(readStandIns(home).plugins.voice, undefined);
    assert.throws(() => switchPart("voice", "on", parts, home), /no part called voice/, "a part the host lacks and no setting names is still refused");

    assert.throws(() => switchPart("forest", "plugin", parts, home), /names the plugin/);
    assert.deepEqual(switchPart("forest", "on", parts, home), []);
    assert.deepEqual(readStandIns(home).plugins, {});
    const { "factory-switched": _switched, "stand-ins-history": _history, ...saved } = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(saved, { factory: path.join(home, "factory"), "parts-off": [], "stand-ins": {}, "stand-ins-switched": {} });
  });
});

test("2.21 With no factory setting, storytree makes and uses its own factory folder, your-factory, with the factory's shape and no setting saved: beside its versioned home (~/.storytree/your-factory), inside any other home", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, ".storytree", "0.3");
    const made = path.join(dir, ".storytree", "your-factory");
    assert.deepEqual(factoryFolder(home), { folder: made, chosen: false });
    assert.equal(existsSync(made), false, "reading it writes nothing");
    assert.deepEqual(makeFactoryFolder(home), { folder: made, chosen: false });
    assert.ok(statSync(path.join(made, "plugins")).isDirectory(), "the factory's shape: a plugins folder");
    assert.deepEqual(readStandIns(home), { folder: made, plugins: {}, switched: {}, history: {} }, "the hosts load plugins from it");
    assert.equal(existsSync(path.join(home, "settings.json")), false, "the default is not saved as a setting");

    mkdirSync(path.join(made, "plugins", "my-forest"));
    assert.deepEqual(makeFactoryFolder(home), { folder: made, chosen: false });
    assert.ok(existsSync(path.join(made, "plugins", "my-forest")), "a default folder already there is used as it is");

    const lane = path.join(dir, "lane-home");
    assert.equal(factoryFolder(lane).folder, path.join(lane, "your-factory"), "any other home keeps its factory inside it");

    mkdirSync(path.join(dir, "mine"));
    setFactory(path.join(dir, "mine"), home);
    assert.deepEqual({ ...makeFactoryFolder(home), switched: undefined }, { folder: path.join(dir, "mine"), chosen: true, switched: undefined });
    assert.equal(readStandIns(home).folder, path.join(dir, "mine"));
  });
});

test("2.22 Switching or importing the factory folder asks for no approval and records who switched it and when: the desktop app, the command line or an agent's session, kept beside the folder and read back with it, and storytree's own folder has no record", async () => {
  await withTempDir((home) => {
    mkdirSync(path.join(home, "mine"));
    assert.equal(factoryFolder(home).switched, undefined, "storytree's own folder was switched by no one");
    setFactory(path.join(home, "mine"), home, { through: "agent tool", session: "s-1" }, new Date("2026-10-23T05:00:00.000Z"));
    assert.deepEqual(factoryFolder(home), { folder: path.join(home, "mine"), chosen: true, switched: { through: "agent tool", session: "s-1", at: "2026-10-23T05:00:00.000Z" } });

    mkdirSync(path.join(home, "theirs"));
    setFactory(path.join(home, "theirs"), home, { through: "desktop app" }, new Date("2026-10-23T06:00:00.000Z"));
    assert.deepEqual(factoryFolder(home).switched, { through: "desktop app", at: "2026-10-23T06:00:00.000Z" }, "the latest switch replaces the one before");

    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ factory: path.join(home, "theirs"), "factory-switched": { through: "a stranger" } }));
    assert.throws(() => factoryFolder(home), /factory-switched/, "a damaged record is reported");
  });
});

test("2.23 Switching a part off with a factory plugin standing in records who switched it and when, kept beside the stand-in and read back with it, and `settings show` says it; switching the part back drops the stand-in but keeps who switched it in, beside who switched it back and when, and `settings show` names both; a damaged record is reported", async () => {
  await withTempDir((home) => {
    assert.deepEqual(readStandIns(home).switched, {}, "no stand-in, no record");
    switchPart("forest", "plugin", parts, home, "my-forest", { through: "command line", session: "s-1" }, new Date("2026-10-23T05:00:00.000Z"));
    const { plugins, switched } = readStandIns(home);
    assert.deepEqual(switched, { forest: { through: "command line", session: "s-1", at: "2026-10-23T05:00:00.000Z" } });
    assert.match(partsSaid(parts, new Map([["forest", "forest"]]), plugins, switched), /^  forest: off, my-forest stands in for it \(switched by session s-1 from the command line, 2026-10-23T05:00:00\.000Z\)$/m);

    switchPart("arc-surface", "plugin", parts, home, "my-arcs", { through: "command line" }, new Date("2026-10-23T06:00:00.000Z"));
    assert.deepEqual(readStandIns(home).switched["arc-surface"], { through: "command line", at: "2026-10-23T06:00:00.000Z" }, "each stand-in keeps its own record");
    switchPart("forest", "on", parts, home, undefined, { through: "agent tool", session: "s-2" }, new Date("2026-10-23T07:00:00.000Z"));
    const back = readStandIns(home);
    assert.deepEqual(back.switched, { "arc-surface": { through: "command line", at: "2026-10-23T06:00:00.000Z" } }, "switching back restores the built-in part, with no live record");
    assert.deepEqual(back.history, { forest: [{ plugin: "my-forest", in: { through: "command line", session: "s-1", at: "2026-10-23T05:00:00.000Z" }, back: { through: "agent tool", session: "s-2", at: "2026-10-23T07:00:00.000Z" } }] }, "the switch in is kept, with the switch back");
    assert.match(partsSaid(parts, new Map(), back.plugins, back.switched, back.history), /^  forest: on, my-forest stood in for it \(switched in by session s-1 from the command line, 2026-10-23T05:00:00\.000Z; switched back by session s-2 through an agent's tool, 2026-10-23T07:00:00\.000Z\)$/m);

    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ "stand-ins": { forest: "my-forest" }, "stand-ins-switched": { forest: { through: "a stranger" } } }));
    assert.throws(() => readStandIns(home), /stand-ins-switched/, "a damaged record is reported");
    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ "stand-ins-history": { forest: [{ plugin: "my-forest" }] } }));
    assert.throws(() => readStandIns(home), /stand-ins-history/, "a damaged history is reported");
  });
});
