/**
 * Capability 3 · Surfaces, contract 3.7, as the declared `settings show` and `settings set` answer it: the surfaces are
 * the ones the door's place hands, read and switched in a throwaway storytree home.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { VerbRefusal, type DoorWords, type Verb, type VerbInputs } from "@storytree/library/verbs";

import type { SurfaceDeclaration } from "./switches.js";
import { SETTINGS_FAMILIES, type SettingsPlace } from "./verbs.js";

const words: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const declared: readonly SurfaceDeclaration[] = [
  { id: "globe", name: "Globe", description: "The planet.", switchable: false, settings: [] },
  { id: "sessions", name: "Sessions", description: "Who is working.", switchable: true, settings: [] },
];

/** The host's parts, each with the parts it stands on. */
const graph = { library: [], "project-and-caller": ["library"], forest: ["library"], "arc-surface": ["forest", "library"] };

function home(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-settings-verbs-"));
  const was = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = dir;
  t.after(() => {
    if (was === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const named = (name: string): Verb<VerbInputs, SettingsPlace> =>
  SETTINGS_FAMILIES[0]!.verbs.find((each) => "name" in each.command && each.command.name === name)!;

test("3.7 the declared `settings show` lists the surfaces its place hands, and `settings set surface` switches one off in the settings file, offering no `settings show` after it, since what it says is the setting set (ADR-1090)", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };

  const shown = await named("show").act({}, place, words);
  assert.match(shown.text, /^  Globe \(globe\): always on$/m);
  assert.match(shown.text, /^  Sessions \(sessions\): on \(default\)$/m);

  const off = await named("set").act({ words: ["surface", "sessions", "off"] }, place, words);
  assert.match(off.text, /^Sessions \(sessions\): off \(set\)/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")), { surfaces: { sessions: { on: false } } });
  assert.equal(off.next, undefined);
});

test("3.7 the declared `settings set` given a name without a value is refused as a misuse, saving nothing", async (t) => {
  const dir = home(t);
  const refused = await named("set").act({ words: ["context-guidance"] }, { folder: dir, surfaces: async () => declared, parts: async () => graph }, words).catch((error: unknown) => error);
  assert.ok(refused instanceof VerbRefusal && refused.misuse, String(refused));
  assert.throws(() => readFileSync(path.join(dir, "settings.json")), /ENOENT/);
});

test("3.16 An agent switches this computer's factory folder with the declared switch_factory tool, no approval asked: an empty folder is set up, the calling session recorded, `settings set factory` records the command line, and `settings show` says who switched it and when; a folder that cannot be a factory is refused", async (t) => {
  const dir = home(t);
  const tool = SETTINGS_FAMILIES[0]!.verbs.find((each) => "name" in each.tool && each.tool.name === "switch_factory")!;
  assert.ok("absent" in tool.command, "the command line has `settings set factory` for it");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(path.join(dir, "mine"));
  const switched = await tool.act({ folder: "mine" }, { folder: dir, session: "s-7", harness: "claude-code", surfaces: async () => declared, parts: async () => graph }, words);
  assert.match(switched.text, /set up as your factory/i);
  assert.equal(switched.next, undefined, "it offers no `settings show`: its answer names the folder switched to");
  const stored = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.equal(stored.factory, path.join(dir, "mine"), "a folder is read from where the agent works");
  assert.deepEqual({ ...stored["factory-switched"], at: undefined }, { through: "agent tool", session: "s-7", at: undefined });

  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };
  assert.match((await named("show").act({}, place, words)).text, /^factory: .*mine \(switched by session s-7 through an agent's tool, \d{4}-\d\d-\d\dT/m);
  await named("set").act({ words: ["factory", path.join(dir, "mine")] }, place, words);
  assert.match((await named("show").act({}, place, words)).text, /^factory: .*mine \(switched from the command line, /m);

  mkdirSync(path.join(dir, "notes"));
  writeFileSync(path.join(dir, "notes", "todo.md"), "mine");
  const refused = await tool.act({ folder: path.join(dir, "notes") }, { folder: dir, surfaces: async () => declared, parts: async () => graph }, words).catch((error: unknown) => error);
  assert.ok(refused instanceof VerbRefusal && /not a factory/.test(refused.message), String(refused));
});

test("project-and-caller 2.23 `settings set part <part> plugin <plugin>` records the calling session from the command line, and `settings show` says who switched the stand-in and when; `on` switches it back with no record", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, session: "s-9", surfaces: async () => declared, parts: async () => graph };
  await named("set").act({ words: ["part", "forest", "plugin", "my-forest"] }, place, words);
  assert.match((await named("show").act({}, place, words)).text, /^  forest: off, my-forest stands in for it \(switched by session s-9 from the command line, \d{4}-\d\d-\d\dT/m);
  await named("set").act({ words: ["part", "forest", "on"] }, place, words);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"))["stand-ins-switched"], {});
});

test("project-and-caller 2.20 · 2.26 · A part in none of the host's parts, one that has left the base or one a factory plugin adds, is switched to a factory plugin of its own name by `settings set part`, which says the plugin adds it, as `settings show` does, and switched back", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };
  assert.match((await named("set").act({ words: ["part", "voice", "plugin", "voice"] }, place, words)).text, /^Added on this computer: voice \(by the factory plugin voice\)\.\nNo part is switched off on this computer\./);
  assert.match((await named("show").act({}, place, words)).text, /^  voice: added by the factory plugin voice \(switched from the command line, /m);
  assert.match((await named("set").act({ words: ["part", "voice", "on"] }, place, words)).text, /^No part is switched off on this computer\./);
  assert.doesNotMatch((await named("show").act({}, place, words)).text, /^  voice: /m);
});

test("3.19 `settings show`'s factory line names where a plugin's contract is read, and how to start and check one", async (t) => {
  const dir = home(t);
  const shown = await named("show").act({}, { folder: dir, surfaces: async () => declared, parts: async () => graph }, words);
  assert.match(shown.text, /^factory: [^]*`storytree plugin contract`[^]*`storytree plugin new <plugin> --for <part>`[^]*`storytree plugin check <plugin>`/m);
});

test("project-and-caller 2.25 `settings set service <part>/<service> on|off` turns a service on or off for this computer and says what is on, and `settings show` lists the services turned on", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };
  assert.match((await named("set").act({ words: ["service", "voice/listen", "on"] }, place, words)).text, /^Turned on on this computer: voice\/listen\./);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8"))["services-on"], ["voice/listen"]);
  assert.match((await named("show").act({}, place, words)).text, /^Turned on on this computer: voice\/listen\./m);
  assert.match((await named("set").act({ words: ["service", "voice/listen", "off"] }, place, words)).text, /^No service is turned on on this computer\./);
});

/** The host's command families, as `#parts/verbs` composes them: ci-health's `health`, and forest's `globe` with a tool. */
const hostVerbs = {
  parts: [
    { name: "health", verbs: [{ command: { family: "health", name: "worklist" }, tool: { absent: "the MCP server's own" } }, { command: { family: "health", name: "ci" }, tool: { absent: "a terminal step" } }] },
    { name: "globe", verbs: [{ command: { family: "globe", name: "spin" }, tool: { name: "spin_globe" } }] },
  ],
  owners: ["ci-health", "forest"],
  graph: { ...graph, "ci-health": ["library"] },
};

test("plugin-loader 4.3 · `settings set part <part> off` or `plugin <plugin>` names the command families, commands and tools the parts it switches off take away, and those the plugin adds in their place", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => hostVerbs.graph, hostVerbs: async () => hostVerbs };
  const off = (await named("set").act({ words: ["part", "ci-health", "off"] }, place, words)).text;
  assert.match(off, /^ci-health takes away the command family health: health worklist, health ci\.$/m);
  const forest = (await named("set").act({ words: ["part", "forest", "off"] }, place, words)).text;
  assert.match(forest, /^forest takes away the command family globe: globe spin; and the tool spin_globe\.$/m);
  assert.match(forest, /^arc-surface, which stands on forest, takes away nothing of the command line or the MCP server's\.$/m);
  assert.doesNotMatch(forest, /^ci-health takes away/m, "only what this switch takes away is said");

  const { mkdirSync, writeFileSync } = await import("node:fs");
  const plugin = path.join(dir, "factory", "plugins", "laptop-health");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(path.join(plugin, "package.json"), JSON.stringify({ name: "laptop-health", type: "module", exports: { "./verbs": "./verbs.js" }, storytree: { interface: 1, verbs: [{ from: "./verbs", export: "verbs" }] } }));
  writeFileSync(path.join(plugin, "verbs.js"), `export const verbs = [{ name: "laptop-health", summary: "s", order: 40, verbs: [{ command: { family: "laptop-health", name: "worklist", summary: "s" }, tool: { name: "laptop_worklist", description: "d" }, inputs: {}, async act() { return { text: "" }; } }] }];\n`);
  await named("set").act({ words: ["factory", path.join(dir, "factory")] }, place, words);
  const swapped = (await named("set").act({ words: ["part", "ci-health", "plugin", "laptop-health"] }, place, words)).text;
  assert.match(swapped, /^ci-health takes away the command family health: health worklist, health ci\.$/m);
  assert.match(swapped, /^laptop-health adds in its place the command family laptop-health: laptop-health worklist; and the tool laptop_worklist\.$/m);
  assert.doesNotMatch((await named("set").act({ words: ["part", "ci-health", "on"] }, place, words)).text, /takes away/);
});
