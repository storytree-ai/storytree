/** Capability 10 · Settings: every home here is thrown away after its test. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as agentLink from "../index.js";
import { withTempDir } from "../testing/folders.js";

test("10.1 without a settings file, context guidance reads as 700,000 tokens with its type and meaning", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    assert.equal(typeof agentLink.readSettings, "function", "settings need a public reader");
    const reading = agentLink.readSettings(home)["context-guidance"];
    assert.equal(reading.name, "context-guidance");
    assert.equal(reading.value, 700_000);
    assert.equal(reading.default, 700_000);
    assert.equal(reading.source, "default");
    assert.equal(reading.type, "positive whole number");
    assert.equal(reading.unit, "tokens");
    assert.match(reading.meaning, /soft/i);
    assert.match(reading.meaning, /context/i);
    assert.equal(existsSync(home), false, "reading a default does not create a home or file");
  });
});

test("10.3 unknown names and values that are not positive whole numbers are refused without changing the file", async () => {
  await withTempDir((home) => {
    agentLink.setSetting("context-guidance", "400000", home);
    const file = path.join(home, "settings.json");
    const before = readFileSync(file, "utf8");
    for (const name of ["unknown", "toString", "__proto__"]) {
      assert.throws(() => agentLink.setSetting(name, "1", home), /unknown setting/i);
      assert.equal(readFileSync(file, "utf8"), before);
    }
    for (const value of ["0", "-1", "1.5", "", " ", "many", "NaN", "Infinity", "1e3", "0x10", "9007199254740992"]) {
      assert.throws(() => agentLink.setSetting("context-guidance", value, home), /context-guidance.*positive whole number/i, value);
      assert.equal(readFileSync(file, "utf8"), before, value);
    }
    const absentHome = path.join(home, "absent");
    assert.throws(() => agentLink.setSetting("context-guidance", "0", absentHome), /positive whole number/i);
    assert.equal(existsSync(absentHome), false);
  });
});
