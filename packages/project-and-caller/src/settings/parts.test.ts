/** Capability 2 · Settings, contract 2.17: a part of the host switched off and on, and the parts `settings show` lists. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withTempDir } from "../testing/folders.js";
import { partsSaid, switchedSaid, switchPart } from "./parts.js";

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
