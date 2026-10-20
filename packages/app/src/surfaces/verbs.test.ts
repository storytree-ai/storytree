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

test("3.7 the declared `settings show` lists the surfaces its place hands, and `settings set surface` switches one off in the settings file", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };

  const shown = await named("show").act({}, place, words);
  assert.match(shown.text, /^  Globe \(globe\): always on$/m);
  assert.match(shown.text, /^  Sessions \(sessions\): on \(default\)$/m);

  const off = await named("set").act({ words: ["surface", "sessions", "off"] }, place, words);
  assert.match(off.text, /^Sessions \(sessions\): off \(set\)/);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")), { surfaces: { sessions: { on: false } } });
  assert.deepEqual(off.next, [{ command: "settings show", why: "read your settings" }]);
});

test("3.7 the declared `settings set` given a name without a value is refused as a misuse, saving nothing", async (t) => {
  const dir = home(t);
  const refused = await named("set").act({ words: ["context-guidance"] }, { folder: dir, surfaces: async () => declared, parts: async () => graph }, words).catch((error: unknown) => error);
  assert.ok(refused instanceof VerbRefusal && refused.misuse, String(refused));
  assert.throws(() => readFileSync(path.join(dir, "settings.json")), /ENOENT/);
});

test("3.15 `settings set part <part> off` switches a part of the host off with every part standing on it, `on` back on, and `settings show` lists each part; the core, a part the host lacks and a state but on or off are refused, saving nothing", async (t) => {
  const dir = home(t);
  const place: SettingsPlace = { folder: dir, surfaces: async () => declared, parts: async () => graph };
  const file = path.join(dir, "settings.json");

  const off = await named("set").act({ words: ["part", "forest", "off"] }, place, words);
  assert.match(off.text, /^Switched off on this computer: arc-surface \(with forest, which it stands on\), forest\./);
  assert.match(off.text, /restart/i, "a host reads the setting as it starts");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": ["forest"] });
  const shown = await named("show").act({}, place, words);
  assert.match(shown.text, /^  arc-surface: off, with forest$/m);
  assert.match(shown.text, /^  forest: off$/m);
  assert.match(shown.text, /^  library: always on \(the core\)$/m);

  const on = await named("set").act({ words: ["part", "forest", "on"] }, place, words);
  assert.match(on.text, /^No part is switched off on this computer\./);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": [] });

  for (const [given, refusal] of [[["part", "library", "off"], /library is the core/], [["part", "lag", "off"], /no part called lag.*arc-surface, forest/], [["part", "forest", "maybe"], /on or off/]] as const) {
    const refused = await named("set").act({ words: [...given] }, place, words).catch((error: unknown) => error);
    assert.ok(refused instanceof Error && refusal.test(refused.message), String(refused));
  }
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": [] }, "a refused switch saves nothing");
});
