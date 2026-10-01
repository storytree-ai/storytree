import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { withTempDir } from "../testing/folders.js";
import { renderSettings } from "../view/render.js";
import { settingsActions } from "./panel.js";
import { readSettings, setSetting } from "./settings.js";

// Capability 10, proposed contracts 10.7–10.9 in evidence/settings-panel/library-update.
test("10.7 the panel reads every setting and writes through the CLI's writers", async () => {
  await withTempDir(async (home) => {
    const panel = settingsActions(home);
    assert.deepEqual(await panel.readSettings(), { ok: true, value: readSettings(home) });
    const saved = await panel.saveSetting("context-guidance", ["420000"]);
    assert.equal(saved.ok, true);
    assert.equal(readSettings(home)["context-guidance"].value, 420000);
    assert.equal(readSettings(home)["context-guidance"].source, "set");
    assert.equal((await panel.saveSetting("idle-after", ["10m"])).ok, true);
    assert.equal(readSettings(home)["idle-after"].value, "10m");
    assert.equal((await panel.saveSetting("library", ["cloudsql", "my-project:australia-southeast1:my-instance", "you@example.com"])).ok, true);
    assert.equal(readSettings(home).library.location, "cloudsql");
    assert.equal((await panel.saveSetting("library", ["local"])).ok, true);
    assert.equal(readSettings(home).library.location, "local");
  });
});

test("10.13 the panel offers a Postgres address as a third library location, saved through the same writer", async () => {
  await withTempDir(async (home) => {
    const panel = settingsActions(home);
    const address = "postgres://me@db.example.com:5432/postgres";
    assert.equal((await panel.saveSetting("library", ["postgres", address])).ok, true);
    const library = readSettings(home).library;
    assert.equal(library.location, "postgres");
    assert.equal(library.location === "postgres" && library.address, address);
    const html = renderSettings(readSettings(home), "library");
    assert.match(html, /<option value="local">On this computer<\/option>/);
    assert.match(html, /<option value="cloudsql">Google Cloud SQL<\/option>/);
    assert.match(html, /<option value="postgres" selected>[^<]+<\/option>/);
    assert.match(html, new RegExp(`<input name="address"[^>]* value="${address.replaceAll("/", "\\/")}"`));
  });
});

test("10.8 refusal crosses IPC as the exact writer reason and preserves saved bytes", async () => {
  await withTempDir(async (home) => {
    const panel = settingsActions(home);
    setSetting("context-guidance", "420000", home);
    const file = path.join(home, "settings.json");
    const before = readFileSync(file, "utf8");
    let reason = "";
    try { setSetting("context-guidance", "0", home); } catch (error) { reason = (error as Error).message; }
    assert.deepEqual(await panel.saveSetting("context-guidance", ["0"]), { ok: false, error: reason });
    assert.equal((await panel.saveSetting("library", ["cloudsql", "broken", "you@example.com"])).ok, false);
    assert.equal((await panel.saveSetting("context-guidance", ["1", "ignored"])).ok, false);
    assert.equal((await panel.saveSetting(null, ["1"])).ok, false);
    for (const value of ["soon", "0m", "-5m"]) {
      const result = await panel.saveSetting("idle-after", [value]);
      assert.ok(!result.ok);
      assert.match(result.error, /idle-after.*positive duration/i);
    }
    assert.equal(readFileSync(file, "utf8"), before);
  });
});
