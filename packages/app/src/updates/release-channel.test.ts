import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseChannel, releaseChannelChoice } from "./release-channel.js";

test("4.15 a fresh installation stays stable, while an existing owner installation keeps alpha across upgrades", () => {
  for (const [marker, expected] of [["nsis-stable", "stable"], ["nsis", "alpha"]] as const) {
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

test("4.15 an installation recorded on the channel's old name, development, follows alpha and never drifts to stable", () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
  try {
    writeFileSync(path.join(home, "release-channel.json"), '{"schema":1,"channel":"development"}');
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("4.24 the user's channel choice is kept in the installation's release-channel.json; a fresh one reads stable, and a choice that is not one is refused", () => {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-channel-"));
  try {
    const choice = releaseChannelChoice({ available: true, home, marker: () => "nsis-stable" });
    assert.deepEqual(choice.read(), { available: true, channel: "stable" });
    assert.deepEqual(choice.set("alpha"), { available: true, channel: "alpha" });
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha", "the updater's next read follows the choice");
    for (const wrong of ["development", "preview", { channel: "stable" }]) assert.throws(() => choice.set(wrong), /alpha or stable/);
    assert.equal(releaseChannel(home, "nsis-stable"), "alpha", "a refused choice leaves the kept one");
    assert.deepEqual(choice.set("stable"), { available: true, channel: "stable" });
    assert.throws(() => releaseChannelChoice({ available: false, home, marker: () => "nsis-stable" }).set("alpha"), /installed/);
    assert.equal(releaseChannel(home, "nsis-stable"), "stable");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
