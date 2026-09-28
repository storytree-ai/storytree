/** Capability 10 · Settings: every home here is thrown away after its test. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
