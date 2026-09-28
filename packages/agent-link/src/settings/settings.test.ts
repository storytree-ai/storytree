/** Capability 10 · Settings: every home here is thrown away after its test. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

test("10.4 invalid settings are reported on read and set, and their bytes are preserved", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    for (const content of [
      '{"context-guidance":null}', "{broken", "", "null", "[]", "1", '"settings"',
      '{"context-guidance":"400000"}', '{"context-guidance":0}', '{"context-guidance":-1}',
      '{"context-guidance":1.5}', '{"context-guidance":9007199254740992}', '{"unknown":1}',
    ]) {
      writeFileSync(file, content);
      const reported = (error: unknown): boolean => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /invalid settings file/i);
        assert.ok(error.message.includes(file), error.message);
        return true;
      };
      assert.throws(() => agentLink.readSettings(home), reported, content);
      assert.throws(() => agentLink.setSetting("context-guidance", "400000", home), reported, content);
      assert.equal(readFileSync(file, "utf8"), content);
      assert.deepEqual(readdirSync(home), ["settings.json"], "no temporary files left behind");
    }
    writeFileSync(file, "{}");
    assert.equal(agentLink.readSettings(home)["context-guidance"].source, "default");
    assert.equal(agentLink.readSettings(home)["context-guidance"].value, 700_000);
    agentLink.setSetting("context-guidance", "700000", home);
    assert.equal(agentLink.readSettings(home)["context-guidance"].source, "set");
  });
});

test("10.4 an unreadable settings path is reported and a set does not replace it", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    // A directory fails as a file on all supported platforms, including Windows and root-run tests.
    mkdirSync(file);
    writeFileSync(path.join(file, "kept"), "untouched");
    for (const operation of [() => agentLink.readSettings(home), () => agentLink.setSetting("context-guidance", "400000", home)]) {
      assert.throws(operation, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /cannot read settings file/i);
        assert.ok(error.message.includes(file), error.message);
        return true;
      });
      assert.equal(readFileSync(path.join(file, "kept"), "utf8"), "untouched");
      assert.deepEqual(readdirSync(home), ["settings.json"]);
    }
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
