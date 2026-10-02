import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseChannel } from "./release-channel.js";

test("4.15 a fresh installation stays stable, while an existing owner installation keeps development across upgrades", () => {
  for (const [marker, expected] of [["nsis-stable", "stable"], ["nsis", "development"]] as const) {
    const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
    try {
      assert.equal(releaseChannel(home, marker), expected);
      assert.equal(releaseChannel(home, "nsis-stable"), expected);
      assert.equal(JSON.parse(readFileSync(path.join(home, "release-channel.json"), "utf8")).channel, expected);
      writeFileSync(path.join(home, "release-channel.json"), "{broken");
      assert.throws(() => releaseChannel(home, marker), /channel/i);
      writeFileSync(path.join(home, "release-channel.json"), '{"schema":1,"channel":"preview"}');
      assert.throws(() => releaseChannel(home, marker), /channel/i);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});
