/** Capability 2 · Settings, contract 2.18: the system switched off and on by name, and what `settings show` says of it. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { VerbRefusal } from "@storytree/library/verbs";

import { withTempDir } from "../testing/folders.js";
import { readSystemSwitches } from "./settings.js";
import { switchSystem, systemSaid } from "./system.js";

test("2.18 `settings set system <name> off|on` keeps settings.json's system-off and system-on (all, roles, checks, notes, or one record's title or id) apart, leaving the other settings as they were; readSystemSwitches reads them alone, none when it names none; `all on` only clears all; a state but on or off, and a name in both lists, are refused", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    assert.deepEqual(readSystemSwitches(home), { off: [], on: [] });
    writeFileSync(file, JSON.stringify({ "parts-off": ["forest"] }));

    assert.deepEqual(switchSystem("all", "off", home), { off: ["all"], on: [] });
    assert.deepEqual(switchSystem("notes", "on", home), { off: ["all"], on: ["notes"] });
    assert.deepEqual(switchSystem("Test first", "off", home), { off: ["Test first", "all"], on: ["notes"] });
    assert.deepEqual(switchSystem("notes", "off", home), { off: ["Test first", "all", "notes"], on: [] }, "off takes a name out of the on list");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "parts-off": ["forest"], "system-off": ["Test first", "all", "notes"], "system-on": [] });
    assert.deepEqual(readSystemSwitches(home), { off: ["Test first", "all", "notes"], on: [] });

    assert.deepEqual(switchSystem("all", "on", home), { off: ["Test first", "notes"], on: [] }, "all on clears all, adding nothing");
    assert.deepEqual(switchSystem("Test first", "on", home), { off: ["notes"], on: ["Test first"] });

    const said = systemSaid(readSystemSwitches(home));
    assert.match(said, /off: notes$/m);
    assert.match(said, /on: Test first$/m);
    assert.match(said, /storytree settings set system <name> on\|off/);
    assert.match(systemSaid({ off: [], on: [] }), /Nothing of storytree's system is switched off/);

    const before = readFileSync(file, "utf8");
    assert.throws(() => switchSystem("roles", "maybe", home), (error: unknown) => error instanceof VerbRefusal && error.misuse === true);
    assert.equal(readFileSync(file, "utf8"), before, "a refused switch saves nothing");
    writeFileSync(file, JSON.stringify({ "system-off": ["roles"], "system-on": ["roles"] }));
    assert.throws(() => readSystemSwitches(home), /settings\.json.*roles.*both/s);
  });
});
